// ── TAB: ALERTS ────────────────────────────────────────────────────────────

function setThr(key, val) {
  S.thresholds[key] = parseInt(val) || 0;
  renderAlerts();
}

function renderAlerts() {
  renderTab('__wpc_alerts', _buildAlerts);
}

function _buildAlerts() {
  const thr      = S.thresholds;
  const isLeader = S.role === 'leader';

  // ── Threshold settings (leader only) ──────────────────────────────────
  const settingsHtml = isLeader ? `
    <div class="wthr">
      <div class="wthr-title">
        Alert Thresholds
        <span>Set to 0 to disable. Saved with war plan.</span>
      </div>

      <div style="font-size:10px;font-weight:700;color:#D4A017;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;margin-top:4px;border-left:2px solid #8B6914;padding-left:8px;">Enemy Kingdom</div>

      <div class="wthr-row">
        <div class="wthr-label">Food ↑</div>
        <input class="wthr-input" type="number" min="0" placeholder="0 = off"
          value="${thr.enemyFoodRich || ''}" onblur="__wpA.setThr('enemyFoodRich',this.value)" onkeydown="if(event.key==='Enter')__wpA.setThr('enemyFoodRich',this.value)">
        <div class="wthr-hint">Above X → <span style="color:#c87030">steal / vermin</span> target</div>
      </div>
      <div class="wthr-row">
        <div class="wthr-label">Food ↓</div>
        <input class="wthr-input" type="number" min="0" placeholder="0 = off"
          value="${thr.enemyFoodLow || ''}" onblur="__wpA.setThr('enemyFoodLow',this.value)" onkeydown="if(event.key==='Enter')__wpA.setThr('enemyFoodLow',this.value)">
        <div class="wthr-hint">Below X → <span style="color:#E05050">starvation risk</span> — vermin + drought + gluttony</div>
      </div>
      <div class="wthr-row">
        <div class="wthr-label">GC ↑</div>
        <input class="wthr-input" type="number" min="0" placeholder="0 = off"
          value="${thr.enemyGcRich || ''}" onblur="__wpA.setThr('enemyGcRich',this.value)" onkeydown="if(event.key==='Enter')__wpA.setThr('enemyGcRich',this.value)">
        <div class="wthr-hint">Above X → <span style="color:#c87030">fools gold / steal</span> target</div>
      </div>
      <div class="wthr-row">
        <div class="wthr-label">Runes ↑</div>
        <input class="wthr-input" type="number" min="0" placeholder="0 = off"
          value="${thr.enemyRunesRich || ''}" onblur="__wpA.setThr('enemyRunesRich',this.value)" onkeydown="if(event.key==='Enter')__wpA.setThr('enemyRunesRich',this.value)">
        <div class="wthr-hint">Above X → <span style="color:#c87030">lightning strike / steal</span> target</div>
      </div>

      <div style="font-size:10px;font-weight:700;color:#60C040;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;margin-top:16px;border-left:2px solid #2a6614;padding-left:8px;">Own Kingdom</div>

      <div class="wthr-row">
        <div class="wthr-label">Food ↓</div>
        <input class="wthr-input" type="number" min="0" placeholder="0 = off"
          value="${thr.ownFoodLow || ''}" onblur="__wpA.setThr('ownFoodLow',this.value)" onkeydown="if(event.key==='Enter')__wpA.setThr('ownFoodLow',this.value)">
        <div class="wthr-hint">Below X → <span style="color:#e09040">send aid!</span></div>
      </div>
      <div class="wthr-row">
        <div class="wthr-label">Peons ↓</div>
        <input class="wthr-input" type="number" min="0" placeholder="0 = off"
          value="${thr.ownPeasLow || ''}" onblur="__wpA.setThr('ownPeasLow',this.value)" onkeydown="if(event.key==='Enter')__wpA.setThr('ownPeasLow',this.value)">
        <div class="wthr-hint">Below X → <span style="color:#E05050">beware!</span> low peasant population</div>
      </div>
    </div>` : '';

  // ── Discord settings (leader only) ───────────────────────────────────────
  const discordHtml = isLeader ? `
    <div class="wthr" style="border-color:#5865F233">
      <div style="font-size:10px;font-weight:700;color:#7075c0;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;border-left:2px solid #5055a0;padding-left:8px;">Discord Alerts <span style="color:#7a5a2a;font-weight:400;text-transform:none;letter-spacing:0;font-size:10px;">— fires on state change</span></div>
      <div class="wthr-row">
        <div class="wthr-label" style="width:80px;font-size:11px">Webhook</div>
        <input class="wthr-input" type="text" placeholder="https://discord.com/api/webhooks/..."
          value="${esc(S.discordWebhook || '')}"
          style="width:320px;font-size:11px"
          onblur="__wpA.setDiscordWebhook(this.value)" onkeydown="if(event.key==='Enter')__wpA.setDiscordWebhook(this.value)">
        <button class="wb" style="font-size:10px;padding:3px 9px;margin-left:8px" onclick="__wpA.testDiscord()">Test</button>
      </div>
      <div style="font-size:10px;color:#7a5a2a;margin-top:6px;line-height:1.6">
        In Discord: Channel Settings → Integrations → Webhooks → New Webhook → Copy URL<br>
        Alerts fire automatically on tool open when status changes. Save plan to persist URL.
      </div>
    </div>` : '';

  // ── Snatch News timed alert ────────────────────────────────────────────
  const snAlert = _buildSnAlert();
  const snHtml  = snAlert ? `
    <div style="background:rgba(0,212,255,.06);border:1px solid rgba(0,212,255,.2);border-radius:3px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:12px">
      <div>
        <span class="wabg wai" style="margin-right:8px">SN DUE</span>
        <span style="font-size:12px">Take a <b>Snatch News</b> op on the enemy — last acknowledged <b>${snAlert.ago}</b> ago</span>
      </div>
      <button class="wb g" style="font-size:10px;padding:3px 10px;white-space:nowrap" onclick="__wpA.snAck()">✓ SN Taken</button>
    </div>` : '';

  // ── Gather all other alerts ────────────────────────────────────────────
  const al = _gatherAlerts(thr);

  // Update badge on tab button
  const totalCount = al.length + (snAlert ? 1 : 0);
  const ac = $id('__wpalc');
  if (ac) {
    ac.textContent = totalCount ? ' (' + totalCount + ')' : '';
    ac.style.color = al.some(a => a.c === 'u') ? '#E05050' : '#e09040';
  }

  // ── Build alert list HTML ─────────────────────────────────────────────
  const sections = [
    { key: 'enemy_rich', label: 'Enemy Resource Targets', color: '#D4A017' },
    { key: 'enemy_low',  label: 'Enemy Starvation Risk',  color: '#E05050' },
    { key: 'own',        label: 'Own Kingdom',            color: '#e09040' },
    { key: 'military',   label: 'Military / Intel',       color: '#7a5a2a' },
  ];

  let aHtml = '';
  if (!al.length && !snAlert) {
    aHtml = `<div style="color:#7a5a2a;font-size:12px;padding:20px 0;font-style:italic;">
      No active alerts${_anyThresholdSet(thr) ? '.' : ' — set thresholds on the left to enable resource alerts.'}
    </div>`;
  } else {
    if (snHtml) aHtml += snHtml;
    sections.forEach(sec => {
      const group = al.filter(a => a.group === sec.key);
      if (!group.length) return;
      aHtml += `<div style="font-size:10px;font-weight:700;color:${sec.color};letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;margin-top:${aHtml?'16':'0'}px;padding-bottom:6px;border-bottom:1px solid #3a2810;display:flex;align-items:center;gap:8px;">
        ${sec.label} <span style="background:#1a1208;border:1px solid #3a2810;color:#7a5a2a;font-size:10px;padding:1px 7px;border-radius:2px;">${group.length}</span>
      </div>`;
      aHtml += group.map(a => `
        <div class="walt" style="${a.bg || 'background:#1a1208;border-color:#3a2810;'}">
          <span class="wabg ${a.cls}">${a.badge}</span>
          <span>${a.t}</span>
        </div>`).join('');
    });
  }

  // Two-column layout: settings+discord left, live alerts right
  return `<div style="display:grid;grid-template-columns:300px 1fr;gap:24px;align-items:start;">
    <div>${settingsHtml}${discordHtml}</div>
    <div>${aHtml}</div>
  </div>`;
}

function _anyThresholdSet(thr) {
  return Object.values(thr).some(v => v > 0);
}

/** Build Snatch News alert object if 24h has passed since last ack */
function _buildSnAlert() {
  const lastAck = S.snLastAck || 0;
  const elapsed = Date.now() - lastAck;
  const twentyFourH = 24 * 60 * 60 * 1000;
  if (elapsed < twentyFourH) return null;
  // Format how long ago it was acknowledged
  const h = Math.floor(elapsed / 3600000);
  const ago = lastAck === 0 ? 'never' : h < 48 ? h + 'h' : Math.floor(h/24) + 'd';
  return { ago };
}

function _gatherAlerts(thr) {
  const al = [];

  // ── Dragon alerts ────────────────────────────────────────────────────────
  const ownDragon = S.own?.kdEffects?.dragon || '';
  const eneDragon = S.enemy?.kdEffects?.dragon || '';

  if (ownDragon) {
    al.push({ group: 'own', badge: 'DRAGON', cls: 'wau',
      bg: 'background:rgba(255,68,85,.08);border:1px solid rgba(255,68,85,.3);',
      t: `<b>🐉 ${esc(ownDragon)}</b> is ravaging our lands! Cast Dragon Slayer if available.` });
  }
  if (eneDragon) {
    al.push({ group: 'military', badge: 'DRAGON', cls: 'wai',
      bg: 'background:rgba(0,212,255,.06);border:1px solid rgba(0,212,255,.2);',
      t: `Enemy has a <b>🐉 ${esc(eneDragon)}</b> active on their lands.` });
  }

  // ── Enemy province alerts ──────────────────────────────────────────────
  if (S.enemy) {
    S.enemy.provinces.forEach(p => {
      const da  = p.calcs?.defPointsSummary?.ageSeconds;
      const age = da != null ? ` <span style="color:#7a5a2a">(intel ${fA(da)} old)</span>` : '';

      if (p.sot) {
        const food  = p.sot.food  || 0;
        const gc    = p.sot.money || 0;
        const runes = p.sot.runes || 0;

        if (thr.enemyFoodRich > 0 && food > thr.enemyFoodRich)
          al.push({ group: 'enemy_rich', badge: 'FOOD', cls: 'wai',
            bg: 'background:rgba(170,102,255,.06);border:1px solid rgba(170,102,255,.15);',
            t: `<b>${esc(p.name)}</b> has ${fK(food)} food — steal / vermin${age}` });

        if (thr.enemyGcRich > 0 && gc > thr.enemyGcRich)
          al.push({ group: 'enemy_rich', badge: 'GC', cls: 'wai',
            bg: 'background:rgba(170,102,255,.06);border:1px solid rgba(170,102,255,.15);',
            t: `<b>${esc(p.name)}</b> has ${fK(gc)} gc — fools gold / steal${age}` });

        if (thr.enemyRunesRich > 0 && runes > thr.enemyRunesRich)
          al.push({ group: 'enemy_rich', badge: 'RUNES', cls: 'wai',
            bg: 'background:rgba(170,102,255,.06);border:1px solid rgba(170,102,255,.15);',
            t: `<b>${esc(p.name)}</b> has ${fK(runes)} runes — lightning strike / steal${age}` });

        if (thr.enemyFoodLow > 0 && food < thr.enemyFoodLow)
          al.push({ group: 'enemy_low', badge: 'STARVE', cls: 'wau',
            bg: 'background:rgba(255,68,85,.06);border:1px solid rgba(255,68,85,.2);',
            t: `<b>${esc(p.name)}</b> only ${fK(food)} food — vermin + drought + gluttony${age}` });
      }

      // Missing SoM on high OPA
      const opa = p.sot?.opa || 0;
      if (opa > 80 && !p.som)
        al.push({ group: 'military', badge: 'SOM', cls: 'waw2',
          t: `Missing SoM: <b>${esc(p.name)}</b> — ${opa} OPA attacker` });

      // Armies away
      p.som?.armiesAway?.forEach(a => {
        al.push({ group: 'military', badge: 'AWAY', cls: 'wai',
          t: `Army away: <b>${esc(p.name)}</b> — ${a.oSpecs || 0} oSpecs, ${a.land || 0} acres, ${a.secondsRemaining > 0 ? fA(a.secondsRemaining) + ' to return' : 'overdue'}` });
      });

      // Stale intel
      const da2 = p.calcs?.defPointsSummary?.ageSeconds;
      if (da2 != null && da2 > 28800)
        al.push({ group: 'military', badge: 'STALE', cls: 'waw2',
          t: `Stale intel: <b>${esc(p.name)}</b> — ${fA(da2)} old` });
    });
  }

  // ── Own kingdom alerts ─────────────────────────────────────────────────
  if (S.own) {
    S.own.provinces.forEach(p => {
      if (p.sot) {
        const food = p.sot.food     || 0;
        const peas = p.sot.peasants || p.sot.peons || 0;

        if (thr.ownFoodLow > 0 && food < thr.ownFoodLow)
          al.push({ group: 'own', badge: 'FOOD', cls: 'waw2',
            bg: 'background:rgba(255,170,0,.06);border:1px solid rgba(255,170,0,.2);',
            t: `<b>${esc(p.name)}</b> only ${fK(food)} food — send aid!` });

        if (thr.ownPeasLow > 0 && peas > 0 && peas < thr.ownPeasLow)
          al.push({ group: 'own', badge: 'PEONS', cls: 'wau',
            bg: 'background:rgba(255,68,85,.06);border:1px solid rgba(255,68,85,.2);',
            t: `<b>${esc(p.name)}</b> only ${fK(peas)} peasants — beware!` });
      }

      p.som?.armiesAway?.forEach(a => {
        al.push({ group: 'own', badge: 'AWAY', cls: 'wai',
          t: `Own army away: <b>${esc(p.name)}</b> — ${a.secondsRemaining > 0 ? fA(a.secondsRemaining) + ' to return' : 'overdue'}` });
      });
    });
  }

  return al;
}
