// ── TAB: ALERTS ────────────────────────────────────────────────────────────

function setThr(key, val) {
  S.thresholds[key] = parseInt(val) || 0;
  renderAlerts();
}

function renderAlerts() {
  renderTab('__wpc_alerts', _buildAlerts);
}

function _buildAlerts() {
  const thr = S.thresholds;
  const isLeader = S.role === 'leader';

  const settingsHtml = isLeader ? `
    <div class="wthr">
      <div class="wthr-title">
        Resource Alert Thresholds
        <span>Flag enemy provinces with resources ABOVE these limits</span>
      </div>
      <div class="wthr-row">
        <div class="wthr-label">Food</div>
        <input class="wthr-input" type="number" min="0" placeholder="0 = off"
          value="${thr.food || ''}" oninput="__wpA.setThr('food',this.value)">
        <div class="wthr-hint">e.g. 50000 — flag rich food targets for TM/fireball</div>
      </div>
      <div class="wthr-row">
        <div class="wthr-label">GC</div>
        <input class="wthr-input" type="number" min="0" placeholder="0 = off"
          value="${thr.gc || ''}" oninput="__wpA.setThr('gc',this.value)">
        <div class="wthr-hint">e.g. 100000 — good robbery/plunder target</div>
      </div>
      <div class="wthr-row">
        <div class="wthr-label">Runes</div>
        <input class="wthr-input" type="number" min="0" placeholder="0 = off"
          value="${thr.runes || ''}" oninput="__wpA.setThr('runes',this.value)">
        <div class="wthr-hint">e.g. 5000 — rich magic target</div>
      </div>
    </div>` : '';

  const al = _gatherAlerts(thr);

  // Update the badge on the Alerts tab button
  const ac = $id('__wpalc');
  if (ac) {
    ac.textContent = al.length ? ' (' + al.length + ')' : '';
    ac.style.color = al.some(a => a.c === 'u') ? '#ff4455' : '#ffaa00';
  }

  const resAlerts   = al.filter(a => a.c === 'r');
  const otherAlerts = al.filter(a => a.c !== 'r');
  let aHtml = '';

  if (resAlerts.length) {
    aHtml += `<div style="font-family:monospace;font-size:10px;color:#ffaa00;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">
      Resource Targets (${resAlerts.length})
    </div>`;
    aHtml += resAlerts.map(a => `
      <div class="walt" style="background:rgba(255,170,0,.06);border:1px solid rgba(255,170,0,.15);border-radius:3px;margin-bottom:4px">
        <span class="wabg" style="background:rgba(255,170,0,.2);color:#ffaa00;border:1px solid #cc8800">RESOURCE</span>
        <span>${a.t}</span>
      </div>`).join('');
  }

  if (otherAlerts.length) {
    if (resAlerts.length) aHtml += `<div style="font-family:monospace;font-size:10px;color:#4a6a88;letter-spacing:2px;text-transform:uppercase;margin:12px 0 8px">Military / Intel</div>`;
    aHtml += otherAlerts.map(a => `
      <div class="walt">
        <span class="wabg ${a.c === 'u' ? 'wau' : a.c === 'w' ? 'waw2' : 'wai'}">
          ${a.c === 'u' ? 'URGENT' : a.c === 'w' ? 'WARN' : 'INFO'}
        </span>
        <span>${a.t}</span>
      </div>`).join('');
  }

  if (!al.length) {
    aHtml = `<div style="color:#4a6a88;font-family:monospace;font-size:11px;padding:16px 0">
      // No active alerts${(thr.food || thr.gc || thr.runes) ? '' : ' — set thresholds above to enable resource alerts'}
    </div>`;
  }

  return settingsHtml + aHtml;
}

/** Build the flat list of alert objects from current state */
function _gatherAlerts(thr) {
  const al = [];

  if (S.enemy) {
    S.enemy.provinces.forEach(p => {
      const da  = p.calcs?.defPointsSummary?.ageSeconds;
      const age = da != null ? ` (intel ${fA(da)} old)` : '';

      // Resource thresholds
      if (p.sot) {
        const food = p.sot.food || 0, gc = p.sot.money || 0, runes = p.sot.runes || 0;
        if (thr.food > 0 && food > thr.food)
          al.push({ c: 'r', t: `<b>Food target:</b> ${esc(p.name)} has ${fK(food)} food (limit ${fK(thr.food)})${age} — TM/fireball` });
        if (thr.gc > 0 && gc > thr.gc)
          al.push({ c: 'r', t: `<b>GC target:</b> ${esc(p.name)} has ${fK(gc)} gc (limit ${fK(thr.gc)})${age} — robbery/plunder` });
        if (thr.runes > 0 && runes > thr.runes)
          al.push({ c: 'r', t: `<b>Runes target:</b> ${esc(p.name)} has ${fK(runes)} runes (limit ${fK(thr.runes)})${age} — magic drain` });
      }

      // Missing SoM on high-OPA province
      const opa = p.sot?.opa || 0;
      if (opa > 80 && !p.som)
        al.push({ c: 'w', t: `Missing SoM: <b>${esc(p.name)}</b> — ${opa} OPA attacker` });

      // Armies away
      p.som?.armiesAway?.forEach(a => {
        al.push({ c: 'i', t: `Army away: <b>${esc(p.name)}</b> — ${a.oSpecs || 0} oSpecs, ${a.land || 0} acres, ${a.secondsRemaining > 0 ? fA(a.secondsRemaining) + ' to return' : 'overdue'}` });
      });

      // No food
      if (p.sot && (p.sot.food || 1) === 0 && opa > 0)
        al.push({ c: 'u', t: `No food: <b>${esc(p.name)}</b>` });

      // Low GC
      if (p.sot && p.som && (p.sot.money || 0) < 1000)
        al.push({ c: 'w', t: `Low GC: <b>${esc(p.name)}</b> — ${fK(p.sot.money || 0)} gc` });

      // Stale intel (>8h)
      if (da != null && da > 28800)
        al.push({ c: 'w', t: `Stale intel: <b>${esc(p.name)}</b> — ${fA(da)} old` });
    });
  }

  if (S.own) {
    S.own.provinces.forEach(p => {
      p.som?.armiesAway?.forEach(a => {
        al.push({ c: 'i', t: `Own army away: <b>${esc(p.name)}</b> — ${a.secondsRemaining > 0 ? fA(a.secondsRemaining) + ' to return' : 'overdue'}` });
      });
      if (p.sot && (p.sot.money || 0) < 500)
        al.push({ c: 'u', t: `Own low GC: <b>${esc(p.name)}</b> — ${fK(p.sot.money || 0)} gc` });
    });
  }

  return al;
}
