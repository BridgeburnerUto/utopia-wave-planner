// ── TAB: PLAYER ────────────────────────────────────────────────────────────
// "My Orders" tab — province picker + attack plan calculator.
// calcAttacks() is pure business logic, separated from the render function.

/**
 * Pure function: given a province, return an ordered attack plan.
 * Returns {attacks, totalGenerals, gensHome, best, reason}
 */
function calcAttacks(prov) {
  // Wave targets: all provinces assigned to current wave or pre-plan
  const waveTargets = S.enemy ? S.enemy.provinces
    .filter(p => S.provinces[p.slot]?.wave)
    .map(p => ({
      province: { slot: '['+p.slot+']', name: p.name, race: p.race,
                  requiredOps: S.provinces[p.slot]?.requiredOps || [],
                  notes: S.provinces[p.slot]?.notes || '' },
      waveName: S.provinces[p.slot]?.wave === 'current' ? 'Current Wave' : 'Pre-Plan',
    })) : [];
  if (!waveTargets.length) return { attacks: [], reason: 'no_targets' };

  const aOff        = prov.som?.offPointsHome || 0;
  const aNW         = prov.networth || 0;
  const gensHome    = prov.som?.standingArmy?.generals ?? prov.sot?.generals ?? 5;
  const totalGenerals = 5; // standard max

  if (!aOff) return { attacks: [], reason: 'no_off' };

  // Score each wave target
  const scored = waveTargets.map(item => {
    const tp   = pd(item.province.slot);
    const tDef = tp?.calcs?.defPointsSummary?.defPointsHome || 0;
    const tNW  = tp?.networth || aNW || 1;
    const nwOk = canHit(aNW, tNW);
    const away = tp?.som?.armiesAway?.length > 0;
    const pct  = tDef > 0 ? aOff / tDef : 0;
    const dAge = tp?.calcs?.defPointsSummary?.ageSeconds;
    const score = (nwOk ? 100 : 0) + (pct > 1.01 ? 80 : 0) + (away ? 30 : 0)
                + (pct > 1.5 ? 20 : pct > 1.2 ? 10 : 0) - (tDef / 10000);
    return { item, tp, tDef, tNW, nwOk, away, breaks: pct > 1.01, pct, dAge, score, waveName: item.waveName };
  }).sort((a, b) => b.score - a.score);

  const best = scored.find(t => t.nwOk && t.breaks) || scored.find(t => t.nwOk) || scored[0];
  if (!best) return { attacks: [], reason: 'no_range' };

  /** Fewest generals needed to break a target (simplified linear scaling model) */
  function minGens(off, def, maxG) {
    if (!def || !off) return maxG;
    for (let n = 1; n <= maxG; n++) {
      if (off * (n / maxG) > def * 1.01) return n;
    }
    return maxG;
  }

  const breakable = scored.filter(t => t.nwOk && t.breaks);

  if (!breakable.length) {
    // Can't break anything clean — show best option with a warning
    const mg = minGens(aOff, best.tDef, totalGenerals);
    return {
      attacks: [{
        n: 1, target: best, gens: mg, result: 'marginal',
        pct: Math.round(best.pct * 100),
        note: 'Cannot cleanly break — consider waiting for enemy army to return or fresher intel',
      }],
      prov, totalGenerals, gensHome, best,
    };
  }

  // Greedy: assign generals across up to 5 attacks cycling through breakable targets
  const attacks = [];
  let gensAvailable = gensHome;
  const cycleTargets = [...breakable];

  for (let i = 0; i < Math.min(5, Math.max(gensAvailable, 1)); i++) {
    const t          = cycleTargets[i % cycleTargets.length];
    const mg         = minGens(aOff, t.tDef, totalGenerals);
    const actualGens = Math.min(mg, gensAvailable);
    const scaledOff  = aOff * (actualGens / totalGenerals);
    attacks.push({
      n:         attacks.length + 1,
      target:    t,
      gens:      actualGens,
      minGens:   mg,
      result:    scaledOff > t.tDef * 1.01 ? 'yes' : 'close',
      pct:       Math.round(scaledOff / (t.tDef || 1) * 100),
      scaledOff,
      note:      i > 0 ? 'Send after previous attack is away' : null,
    });
    gensAvailable -= actualGens;
    if (gensAvailable <= 0) break;
  }

  return { attacks, prov, totalGenerals, gensHome, best };
}

function renderPlayer() {
  renderTab('__wpc_player', _buildPlayer);
}

function _buildPlayer() {
  if (!S.own || !S.enemy) return '<div class="watk-noprov">Loading data...</div>';
  if (!S.playerProv)      return _buildProvPicker();

  const prov = S.playerProv;
  const { attacks, totalGenerals, gensHome, reason } = calcAttacks(prov);
  const waveTargets = S.enemy ? S.enemy.provinces
    .filter(p => S.provinces[p.slot]?.wave)
    .map(p => ({
      province: { slot: '['+p.slot+']', name: p.name, race: p.race,
                  requiredOps: S.provinces[p.slot]?.requiredOps || [],
                  notes: S.provinces[p.slot]?.notes || '' },
      waveName: S.provinces[p.slot]?.wave === 'current' ? 'Current Wave' : 'Pre-Plan',
    })) : [];
  const aOff        = prov.som?.offPointsHome || 0;

  let h = _playerHeader(prov, aOff, gensHome, totalGenerals, waveTargets.length);

  if (!waveTargets.length) {
    return h + `<div class="watk-notarget">// No wave targets assigned yet<br>
      <span style="font-size:11px">The war leader needs to set targets in the WAR BOARD tab first</span></div>`;
  }
  if (reason === 'no_off') {
    return h + `<div class="watk-notarget">// No offensive data available for this province<br>
      <span style="font-size:11px">SoM data needed to calculate attacks</span></div>`;
  }
  if (!attacks.length) {
    return h + `<div class="watk-notarget">// No valid targets in NW range<br>
      <span style="font-size:11px">Your NW (${fK(prov.networth)}) doesn't overlap with any wave target</span></div>`;
  }

  // Group attacks by wave name
  const byWave = {};
  attacks.forEach(atk => {
    const wn = atk.target.waveName || 'Wave';
    if (!byWave[wn]) byWave[wn] = [];
    byWave[wn].push(atk);
  });

  h += `<div class="wsech">// ATTACK PLAN</div>`;
  Object.entries(byWave).forEach(([wave, list]) => {
    h += _buildAttackCard(wave, list, aOff, totalGenerals);
  });

  h += _buildContextTable(waveTargets2 || waveTargets, prov, aOff);
  return h;
}

function _buildProvPicker() {
  return `
    <div style="max-width:480px">
      <div class="wsech">// SELECT YOUR PROVINCE</div>
      <div style="display:grid;gap:8px">
        ${(S.own?.provinces || []).map(p => {
          const off  = p.som?.offPointsHome || p.sot?.offPoints || 0;
          const gens = p.som?.standingArmy?.generals ?? '?';
          return `<div onclick="__wpA.pickProv(${p.slot})"
            style="background:#120d04;border:1px solid #3a2810;border-radius:3px;padding:12px 14px;cursor:pointer;
                   display:flex;align-items:center;justify-content:space-between;transition:border-color .15s"
            onmouseover="this.style.borderColor='#4a3010'" onmouseout="this.style.borderColor='#3a2810'">
            <div>
              <div style="font-size:14px;font-weight:700">${esc(p.name)}</div>
              <div style="font-family:monospace;font-size:10px;color:#7a5a2a">${esc(p.race || '')} · ${esc(p.sot?.personality || '')}</div>
            </div>
            <div style="text-align:right">
              <div style="font-family:monospace;font-size:13px;color:#D4A017">${fK(off)} off</div>
              <div style="font-family:monospace;font-size:10px;color:#7a5a2a">${gens} gens home · ${fK(p.networth)} NW</div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

function _playerHeader(prov, aOff, gensHome, totalGenerals, targetCount) {
  const genColor = gensHome >= 3 ? '#60C040' : gensHome >= 1 ? '#e09040' : '#E05050';
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div>
        <div style="font-size:18px;font-weight:700">${esc(prov.name)}</div>
        <div style="font-family:monospace;font-size:11px;color:#7a5a2a">
          ${esc(prov.race || '')} · ${esc(prov.sot?.personality || '')} · ${fK(prov.networth)} NW
        </div>
      </div>
      <button onclick="__wpA.pickProv('')"
        style="padding:5px 10px;background:#120d04;border:1px solid #4a3010;color:#c8a060;font-size:11px;font-weight:700;cursor:pointer;border-radius:3px">
        ↩ Change
      </button>
    </div>
    <div class="watk-summary">
      <div class="watk-sstat"><div class="l">Off Home</div><div class="v">${fK(aOff)}</div></div>
      <div class="watk-sstat"><div class="l">Generals Home</div>
        <div class="v" style="color:${genColor}">${gensHome}<span style="font-size:12px;color:#7a5a2a"> / ${totalGenerals}</span></div>
      </div>
      <div class="watk-sstat"><div class="l">Own NW</div><div class="v">${fK(prov.networth)}</div></div>
      <div class="watk-sstat"><div class="l">Targets Set</div><div class="v">${targetCount}</div><div class="s">by war leader</div></div>
    </div>`;
}

function _buildAttackCard(wave, atkList, aOff, totalGenerals) {
  let h = `
    <div class="watk-card">
      <div class="watk-header">
        <span class="watk-wave">// ${esc(wave.toUpperCase())}</span>
        <span style="font-family:monospace;font-size:10px;color:#7a5a2a">${atkList.length} attack${atkList.length > 1 ? 's' : ''}</span>
      </div>
      <div class="watk-body">`;

  atkList.forEach(atk => {
    const t         = atk.target;
    const away      = t.tp?.som?.armiesAway?.length > 0;
    const ops       = t.item.province.requiredOps || [];
    const da        = t.dAge;
    const genColor  = atk.gens <= 2 ? '#60C040' : atk.gens <= 3 ? '#e09040' : '#c8a060';
    const resCls    = atk.result === 'yes' ? 'watk-yes' : atk.result === 'close' ? 'watk-cl' : 'watk-no';
    const resLabel  = atk.result === 'yes' ? 'BREAKS' : atk.result === 'close' ? 'CLOSE' : 'RISKY';
    const sentOff   = atk.scaledOff || aOff * (atk.gens / totalGenerals);

    h += `
      <div class="watk-row">
        <div class="watk-num" style="color:#7a5a2a">${atk.n}</div>
        <div class="watk-main">
          <div class="watk-target">
            ${esc(t.item.province.name)}
            ${away ? ' <span style="color:#60C040;font-size:11px">↗ army away</span>' : ''}
          </div>
          <div class="watk-detail">
            ${fK(t.tDef)} def · ${fK(sentOff)} off sent · ${atk.pct}% ratio
            ${da != null ? ` · intel <span class="${aC(da)}">${fA(da)}</span> old` : ''}
            ${atk.note ? `<br><span style="color:#e09040">⚠ ${esc(atk.note)}</span>` : ''}
          </div>
          ${ops.length ? `<div class="watk-ops">${ops.map(o => `<span class="wtag" style="cursor:default">${o}</span>`).join('')}</div>` : ''}
          ${t.item.province.notes ? `<div style="margin-top:4px;font-size:10px;color:#c8a060;background:#120d04;padding:4px 6px;border-radius:2px;border-left:2px solid #D4A017">${esc(t.item.province.notes)}</div>` : ''}
        </div>
        <div class="watk-gen">
          <div class="watk-gen-num" style="color:${genColor}">${atk.gens}</div>
          <div class="watk-gen-label">generals</div>
        </div>
        <div class="watk-result ${resCls}">${resLabel}<br>${atk.pct}%</div>
      </div>`;
  });

  h += '</div></div>';
  return h;
}

function _buildContextTable(waveTargets, prov, aOff) {
  const rows = waveTargets.map(item => {
    const tp    = pd(item.province.slot);
    const tDef  = tp?.calcs?.defPointsSummary?.defPointsHome || 0;
    const tNW   = tp?.networth || 0;
    const nwOk  = canHit(prov.networth, tNW);
    const pct   = tDef > 0 ? Math.round(aOff / tDef * 100) : 0;
    const away  = tp?.som?.armiesAway?.length > 0;
    const cls   = !nwOk ? 'wmno' : aOff > tDef * 1.01 ? 'wmyes' : 'wmcl';
    return `<tr style="border-bottom:1px solid #3a2810">
      <td style="padding:6px 8px;font-weight:600">${esc(item.province.name)}</td>
      <td style="padding:6px 8px;font-family:monospace">${fK(tDef)}</td>
      <td style="padding:6px 8px;font-family:monospace">${fK(tNW)}</td>
      <td style="padding:6px 8px"><span class="wmatch ${cls}">${pct}%</span></td>
      <td style="padding:6px 8px"><span class="wmatch ${nwOk ? 'wmyes' : 'wmno'}">${nwOk ? '✓ in range' : '✗ out'}</span></td>
      <td style="padding:6px 8px">${away ? '<span style="color:#60C040;font-family:monospace;font-size:10px">AWAY</span>' : '—'}</td>
    </tr>`;
  }).join('');

  return `
    <div style="margin-top:20px" class="wsech">// ALL WAVE TARGETS (context)</div>
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr>
        <th style="text-align:left;padding:5px 8px;font-size:9px;font-weight:700;color:#7a5a2a;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #3a2810">Province</th>
        <th style="text-align:left;padding:5px 8px;font-size:9px;font-weight:700;color:#7a5a2a;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #3a2810">Def Home</th>
        <th style="text-align:left;padding:5px 8px;font-size:9px;font-weight:700;color:#7a5a2a;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #3a2810">NW</th>
        <th style="text-align:left;padding:5px 8px;font-size:9px;font-weight:700;color:#7a5a2a;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #3a2810">Off/Def</th>
        <th style="text-align:left;padding:5px 8px;font-size:9px;font-weight:700;color:#7a5a2a;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #3a2810">NW Range</th>
        <th style="text-align:left;padding:5px 8px;font-size:9px;font-weight:700;color:#7a5a2a;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #3a2810">Army</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function pickProv(slot) {
  if (!slot) { S.playerProv = null; renderPlayer(); return; }
  S.playerProv = S.own.provinces.find(p => p.slot === parseInt(slot)) || null;
  renderPlayer();
}
