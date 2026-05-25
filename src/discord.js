// ── DISCORD ────────────────────────────────────────────────────────────────
// Sends rich embed alerts to a Discord channel via webhook.
// Webhook URL stored in war plan. Alert state stored in Firebase.
// Only fires when alert status CHANGES since last check.

const DISCORD = {
  COUNCIL_ROLE:   '1397235789980631165',
  ATTACKER_ROLE:  '1503879181291753593',
  COLORS: {
    red:    16711680,  // #FF0000
    yellow: 16776960,  // #FFFF00
    green:  65280,     // #00FF00
  },
};

// ── Webhook send ─────────────────────────────────────────────────────────────

async function sendDiscordEmbed(webhookUrl, { content, embeds }) {
  if (!webhookUrl) return false;
  try {
    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content || '', embeds }),
    });
    if (!r.ok) console.warn('[WavePlanner] Discord webhook failed:', r.status);
    return r.ok;
  } catch(e) {
    console.warn('[WavePlanner] Discord webhook error:', e.message);
    return false;
  }
}

// ── Alert state helpers ───────────────────────────────────────────────────────

async function loadAlertState() {
  const kdId = S.own?.location.replace(':', '_');
  if (!kdId) return {};
  try {
    const doc = await fbGet(`meta/${kdId}_alert_state`);
    if (!doc?.fields) return {};
    // Unwrap Firestore format — values stored as JSON strings
    const state = {};
    Object.entries(doc.fields).forEach(([k, v]) => {
      try { state[k] = JSON.parse(v.stringValue || 'null'); }
      catch(e) { state[k] = null; }
    });
    return state;
  } catch(e) { return {}; }
}

async function saveAlertState(state) {
  const kdId = S.own?.location.replace(':', '_');
  if (!kdId) return;
  // Store each value as a JSON string
  const data = {};
  Object.entries(state).forEach(([k, v]) => { data[k] = JSON.stringify(v); });
  await fbWrite(`meta/${kdId}_alert_state`, data);
}

// ── Main alert check ──────────────────────────────────────────────────────────

async function checkAndSendDiscordAlerts() {
  const webhookUrl = S.discordWebhook;
  if (!webhookUrl) return;
  if (!S.own) return;

  const prev = await loadAlertState();
  const next  = {};
  const toSend = []; // array of {content, embeds}

  // ── 1. Dragon on own KD — does not need enemy data ────────────────────
  const ownDragon = S.own.kdEffects?.dragon || '';
  next.dragon_own = ownDragon;
  if (ownDragon && ownDragon !== (prev.dragon_own || '')) {
    toSend.push({
      content: '@everyone',
      embeds: [{
        title: '🐉 Dragon incoming',
        description: `A **${ownDragon}** is now ravaging our lands!`,
        color: DISCORD.COLORS.red,
        timestamp: new Date().toISOString(),
        footer: { text: 'Wave Planner · War Planning Tool' },
      }],
    });
  }

  // ── Own food low — does not need enemy data ────────────────────────────
  const foodThr = S.thresholds.ownFoodLow || 0;
  if (foodThr > 0) {
    const lowFood = (S.own.provinces || [])
      .filter(p => p.sot && (p.sot.food || 0) < foodThr)
      .map(p => ({ name: p.name, food: p.sot.food || 0 }));
    next.own_food_low = lowFood.map(p => p.name);
    const prevLowFood = prev.own_food_low || [];
    const newLowFood  = lowFood.filter(p => !prevLowFood.includes(p.name));
    if (newLowFood.length) {
      const foodLines = newLowFood.map(p => `· ${p.name} — ${fK(p.food)} food`).join('\n');
      toSend.push({
        content: '',
        embeds: [{
          title: `🍞 Own food critical — ${newLowFood.length} province${newLowFood.length > 1 ? 's' : ''}`,
          description: foodLines,
          color: DISCORD.COLORS.red,
          footer: { text: 'Send aid immediately · Wave Planner' },
          timestamp: new Date().toISOString(),
        }],
      });
    }
  } else {
    next.own_food_low = [];
  }

  // ── Own peons low — does not need enemy data ───────────────────────────
  const peasThr = S.thresholds.ownPeasLow || 0;
  if (peasThr > 0) {
    const lowPeas = (S.own.provinces || [])
      .filter(p => {
        const peas = p.sot?.peasants || p.sot?.peons || 0;
        return peas > 0 && peas < peasThr;
      })
      .map(p => ({ name: p.name, peas: p.sot?.peasants || p.sot?.peons || 0 }));
    next.own_peas_low = lowPeas.map(p => p.name);
    const prevLowPeas = prev.own_peas_low || [];
    const newLowPeas  = lowPeas.filter(p => !prevLowPeas.includes(p.name));
    if (newLowPeas.length) {
      const peasLines = newLowPeas.map(p => `· ${p.name} — ${fK(p.peas)} peasants`).join('\n');
      toSend.push({
        content: '',
        embeds: [{
          title: `👥 Own population critical — ${newLowPeas.length} province${newLowPeas.length > 1 ? 's' : ''}`,
          description: peasLines,
          color: DISCORD.COLORS.red,
          footer: { text: 'Check for starvation or hostile spells · Wave Planner' },
          timestamp: new Date().toISOString(),
        }],
      });
    }
  } else {
    next.own_peas_low = [];
  }

  // ── Enemy-dependent checks — skip and preserve prev state if not loaded ─
  if (S.enemy) {
    // ── 2. Dragon slayed on enemy ────────────────────────────────────────
    const eneDragon = S.enemy.kdEffects?.dragon || '';
    next.dragon_enemy = eneDragon;
    const prevEneDragon = prev.dragon_enemy || '';
    if (!eneDragon && prevEneDragon) {
      toSend.push({
        content: `<@&${DISCORD.COUNCIL_ROLE}>`,
        embeds: [{
          title: '⚔️ Enemy dragon gone',
          description: `The enemy **${prevEneDragon}** is no longer active.\nConfirm via SoT.`,
          color: DISCORD.COLORS.red,
          timestamp: new Date().toISOString(),
          footer: { text: 'Wave Planner · War Planning Tool' },
        }],
      });
    }

    // ── 3. Missing SoM (new provinces only) ──────────────────────────────
    const missingSom = (S.enemy.provinces || [])
      .filter(p => (p.sot?.opa || 0) > 80 && !p.som)
      .map(p => p.name);
    next.missing_som = missingSom;
    const prevMissing = prev.missing_som || [];
    const newMissing  = missingSom.filter(n => !prevMissing.includes(n));
    if (newMissing.length) {
      const missingLines = newMissing.map(name => {
        const p = S.enemy?.provinces?.find(p => p.name === name);
        const opa = p?.sot?.opa || 0;
        return `· ${name}${opa ? ' (' + opa + ' OPA)' : ''}`;
      }).join('\n');
      toSend.push({
        content: `<@&${DISCORD.ATTACKER_ROLE}>`,
        embeds: [{
          title: `⚠️ Missing SoM — ${newMissing.length} province${newMissing.length > 1 ? 's' : ''}`,
          description: missingLines,
          color: DISCORD.COLORS.yellow,
          footer: { text: 'Take a SoM on these before the next wave · Wave Planner' },
          timestamp: new Date().toISOString(),
        }],
      });
    }

    // ── 6. Enemy food rich ────────────────────────────────────────────────
    const foodRichThr = S.thresholds.enemyFoodRich || 0;
    if (foodRichThr > 0) {
      const richFood = (S.enemy.provinces || [])
        .filter(p => p.sot && (p.sot.food || 0) > foodRichThr)
        .map(p => ({ name: p.name, food: p.sot.food || 0 }));
      next.enemy_food_rich = richFood.map(p => p.name);
      const newRichFood = richFood.filter(p => !(prev.enemy_food_rich || []).includes(p.name));
      if (newRichFood.length) {
        toSend.push({
          content: `<@&${DISCORD.ATTACKER_ROLE}>`,
          embeds: [{
            title: `🍞 Enemy food target — ${newRichFood.length} province${newRichFood.length > 1 ? 's' : ''}`,
            description: newRichFood.map(p => `· ${p.name} — ${fK(p.food)} food`).join('\n') + '\nUse steal food / vermin.',
            color: DISCORD.COLORS.yellow,
            footer: { text: `Threshold: ${fK(foodRichThr)} · Wave Planner` },
            timestamp: new Date().toISOString(),
          }],
        });
      }
    } else { next.enemy_food_rich = []; }

    // ── 7. Enemy food low / starvation risk ──────────────────────────────
    const foodLowThr = S.thresholds.enemyFoodLow || 0;
    if (foodLowThr > 0) {
      const starveProv = (S.enemy.provinces || [])
        .filter(p => p.sot && (p.sot.food || 0) < foodLowThr)
        .map(p => ({ name: p.name, food: p.sot.food || 0 }));
      next.enemy_food_low = starveProv.map(p => p.name);
      const newStarve = starveProv.filter(p => !(prev.enemy_food_low || []).includes(p.name));
      if (newStarve.length) {
        toSend.push({
          content: `<@&${DISCORD.ATTACKER_ROLE}>`,
          embeds: [{
            title: `💀 Enemy starvation risk — ${newStarve.length} province${newStarve.length > 1 ? 's' : ''}`,
            description: newStarve.map(p => `· ${p.name} — only ${fK(p.food)} food`).join('\n') + '\nUse vermin + drought + gluttony.',
            color: DISCORD.COLORS.red,
            footer: { text: `Threshold: ${fK(foodLowThr)} · Wave Planner` },
            timestamp: new Date().toISOString(),
          }],
        });
      }
    } else { next.enemy_food_low = []; }

    // ── 8. Enemy GC rich ──────────────────────────────────────────────────
    const gcRichThr = S.thresholds.enemyGcRich || 0;
    if (gcRichThr > 0) {
      const richGc = (S.enemy.provinces || [])
        .filter(p => p.sot && (p.sot.money || 0) > gcRichThr)
        .map(p => ({ name: p.name, gc: p.sot.money || 0 }));
      next.enemy_gc_rich = richGc.map(p => p.name);
      const newRichGc = richGc.filter(p => !(prev.enemy_gc_rich || []).includes(p.name));
      if (newRichGc.length) {
        toSend.push({
          content: `<@&${DISCORD.ATTACKER_ROLE}>`,
          embeds: [{
            title: `💰 Enemy GC target — ${newRichGc.length} province${newRichGc.length > 1 ? 's' : ''}`,
            description: newRichGc.map(p => `· ${p.name} — ${fK(p.gc)} GC`).join('\n') + '\nUse fools gold / steal gold.',
            color: DISCORD.COLORS.yellow,
            footer: { text: `Threshold: ${fK(gcRichThr)} · Wave Planner` },
            timestamp: new Date().toISOString(),
          }],
        });
      }
    } else { next.enemy_gc_rich = []; }

    // ── 9. Enemy runes rich ───────────────────────────────────────────────
    const runesRichThr = S.thresholds.enemyRunesRich || 0;
    if (runesRichThr > 0) {
      const richRunes = (S.enemy.provinces || [])
        .filter(p => p.sot && (p.sot.runes || 0) > runesRichThr)
        .map(p => ({ name: p.name, runes: p.sot.runes || 0 }));
      next.enemy_runes_rich = richRunes.map(p => p.name);
      const newRichRunes = richRunes.filter(p => !(prev.enemy_runes_rich || []).includes(p.name));
      if (newRichRunes.length) {
        toSend.push({
          content: `<@&${DISCORD.ATTACKER_ROLE}>`,
          embeds: [{
            title: `🔮 Enemy runes target — ${newRichRunes.length} province${newRichRunes.length > 1 ? 's' : ''}`,
            description: newRichRunes.map(p => `· ${p.name} — ${fK(p.runes)} runes`).join('\n') + '\nUse lightning strike / steal runes.',
            color: DISCORD.COLORS.yellow,
            footer: { text: `Threshold: ${fK(runesRichThr)} · Wave Planner` },
            timestamp: new Date().toISOString(),
          }],
        });
      }
    } else { next.enemy_runes_rich = []; }

  } else {
    // Enemy not loaded — carry forward previous enemy state so we don't
    // lose track of what was already alerted and avoid false re-fires later.
    next.dragon_enemy    = prev.dragon_enemy    || '';
    next.missing_som     = prev.missing_som     || [];
    next.enemy_food_rich = prev.enemy_food_rich || [];
    next.enemy_food_low  = prev.enemy_food_low  || [];
    next.enemy_gc_rich   = prev.enemy_gc_rich   || [];
    next.enemy_runes_rich = prev.enemy_runes_rich || [];
  }

  // ── Send all queued alerts ─────────────────────────────────────────────
  for (const msg of toSend) {
    await sendDiscordEmbed(webhookUrl, msg);
    // Small delay between messages to avoid Discord rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  // ── Save new state ────────────────────────────────────────────────────
  await saveAlertState(next);

  if (toSend.length) {
    console.log(`[WavePlanner] Sent ${toSend.length} Discord alert(s)`);
  }
}

// ── Reset Discord alert state ─────────────────────────────────────────────────
// Clears all saved state so every active condition fires again on next check.

async function resetDiscordAlertState() {
  const kdId = S.own?.location.replace(':', '_');
  if (!kdId) return;
  await fbWrite(`meta/${kdId}_alert_state`, {});
  console.log('[WavePlanner] Discord alert state cleared');
}

// ── Test ping ─────────────────────────────────────────────────────────────────

async function testDiscordWebhook(webhookUrl) {
  if (!webhookUrl) return false;
  return sendDiscordEmbed(webhookUrl, {
    content: '',
    embeds: [{
      title: '✅ Wave Planner connected',
      description: 'Discord alerts are working correctly.',
      color: 65280,
      timestamp: new Date().toISOString(),
      footer: { text: 'Wave Planner · War Planning Tool' },
    }],
  });
}
