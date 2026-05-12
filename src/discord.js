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
  if (!S.own || !S.enemy) return;

  const prev = await loadAlertState();
  const next  = {};
  const toSend = []; // array of {content, embeds}

  // ── 1. Dragon on own KD ────────────────────────────────────────────────
  const ownDragon = S.own.kdEffects?.dragon || '';
  next.dragon_own = ownDragon;
  if (ownDragon && ownDragon !== (prev.dragon_own || '')) {
    toSend.push({
      content: '@everyone',
      embeds: [{
        title: '🐉 DRAGON INCOMING',
        description: `A **${ownDragon}** is now ravaging our lands!`,
        color: DISCORD.COLORS.red,
        fields: [{ name: 'Action', value: 'Prepare defences — cast Dragon Slayer if available', inline: false }],
        timestamp: new Date().toISOString(),
      }],
    });
  }

  // ── 2. Dragon slayed on enemy ──────────────────────────────────────────
  const eneDragon = S.enemy.kdEffects?.dragon || '';
  next.dragon_enemy = eneDragon;
  const prevEneDragon = prev.dragon_enemy || '';
  if (!eneDragon && prevEneDragon) {
    toSend.push({
      content: `<@&${DISCORD.COUNCIL_ROLE}>`,
      embeds: [{
        title: '⚔️ ENEMY DRAGON GONE',
        description: `The enemy **${prevEneDragon}** is no longer active.`,
        color: DISCORD.COLORS.red,
        fields: [{ name: 'Action', value: 'Confirm via SoT — consider launching our own dragon', inline: false }],
        timestamp: new Date().toISOString(),
      }],
    });
  }

  // ── 3. Missing SoM (new provinces only) ───────────────────────────────
  const missingSom = (S.enemy.provinces || [])
    .filter(p => (p.sot?.opa || 0) > 80 && !p.som)
    .map(p => p.name);
  next.missing_som = missingSom;
  const prevMissing = prev.missing_som || [];
  const newMissing  = missingSom.filter(n => !prevMissing.includes(n));
  if (newMissing.length) {
    toSend.push({
      content: `<@&${DISCORD.ATTACKER_ROLE}>`,
      embeds: [{
        title: '⚠️ MISSING SoM',
        description: `${newMissing.length} high-OPA province${newMissing.length > 1 ? 's are' : ' is'} missing SoM data`,
        color: DISCORD.COLORS.yellow,
        fields: newMissing.map(name => ({
          name: '📍 Province',
          value: name,
          inline: true,
        })),
        footer: { text: 'Take a SoM on these provinces before the next wave' },
        timestamp: new Date().toISOString(),
      }],
    });
  }

  // ── 4. Own food low (new provinces only) ──────────────────────────────
  const foodThr = S.thresholds.ownFoodLow || 0;
  if (foodThr > 0) {
    const lowFood = (S.own.provinces || [])
      .filter(p => p.sot && (p.sot.food || 0) < foodThr)
      .map(p => ({ name: p.name, food: p.sot.food || 0 }));
    next.own_food_low = lowFood.map(p => p.name);
    const prevLowFood = prev.own_food_low || [];
    const newLowFood  = lowFood.filter(p => !prevLowFood.includes(p.name));
    if (newLowFood.length) {
      toSend.push({
        content: '',
        embeds: [{
          title: '🍞 OWN FOOD CRITICAL',
          description: `${newLowFood.length} province${newLowFood.length > 1 ? 's are' : ' is'} below food threshold (${fK(foodThr)})`,
          color: DISCORD.COLORS.red,
          fields: newLowFood.map(p => ({
            name: p.name,
            value: `${fK(p.food)} food`,
            inline: true,
          })),
          footer: { text: 'Send aid immediately' },
          timestamp: new Date().toISOString(),
        }],
      });
    }
  } else {
    next.own_food_low = [];
  }

  // ── 5. Own peons low (new provinces only) ─────────────────────────────
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
      toSend.push({
        content: '',
        embeds: [{
          title: '👥 OWN POPULATION CRITICAL',
          description: `${newLowPeas.length} province${newLowPeas.length > 1 ? 's are' : ' is'} below peasant threshold (${fK(peasThr)})`,
          color: DISCORD.COLORS.red,
          fields: newLowPeas.map(p => ({
            name: p.name,
            value: `${fK(p.peas)} peasants`,
            inline: true,
          })),
          footer: { text: 'Check for starvation or hostile spells' },
          timestamp: new Date().toISOString(),
        }],
      });
    }
  } else {
    next.own_peas_low = [];
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

// ── Test ping ─────────────────────────────────────────────────────────────────

async function testDiscordWebhook(webhookUrl) {
  if (!webhookUrl) return false;
  return sendDiscordEmbed(webhookUrl, {
    content: '',
    embeds: [{
      title: '✅ Wave Planner Connected',
      description: 'Discord alerts are working correctly.',
      color: 65280,
      timestamp: new Date().toISOString(),
      footer: { text: 'Wave Planner · War Planning Tool' },
    }],
  });
}
