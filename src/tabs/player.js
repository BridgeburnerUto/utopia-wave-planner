// ── TAB: PLAYER ────────────────────────────────────────────────────────────
// "My Orders" tab — province picker + attack plan calculator.
// calcAttacks() is pure business logic, separated from the render function.

// ── Manual stat overrides (per province, persisted in localStorage) ─────────
// Players enter their own max off / NW / generals rather than relying on
// potentially stale SoM/SoT API data.

function _mkey(provName) { return 'wc_ms_' + provName; }

function loadManual(provName) {
  try { return JSON.parse(localStorage.getItem(_mkey(provName)) || '{}'); }
  catch(e) { return {}; }
}

function saveManual(provName, obj) {
  localStorage.setItem(_mkey(provName), JSON.stringify(obj));
}

/** Called by inline oninput handlers — saves a single field and re-renders. */
function setManualStat(provName, field, rawVal) {
  var ms = loadManual(provName);
  var v  = parseInt(rawVal);
  if (v > 0) ms[field] = v; else delete ms[field];
  saveManual(provName, ms);
  renderPlayer();
}

/** Return the effective value for a stat: manual override > API data > 0 */
function _eff(provName, field, apiVal) {
  var ms = loadManual(provName);
  return ms[field] != null ? ms[field] : (apiVal || 0);
}

// ── Raze / Massacre claim storage (per war, per device) ──────────────────────
// Stored as { "raze_18": "My Province", "massacre_5": "My Province" }
// Key is scoped to enemy location so it resets each new war automatically.

function _claimKey() { return 'wc_raze_' + (S.eLoc || ''); }
function loadClaims() {
  try { return JSON.parse(localStorage.getItem(_claimKey()) || '{}'); }
  catch(e) { return {}; }
}

/** Toggle a raze/massacre claim for a slot. Called from inline onclick. */
function claimAction(slot, type) {
  const c = loadClaims();
  const k = type + '_' + slot;
  if (c[k]) delete c[k]; else c[k] = S.playerProv?.name || '✓';
  localStorage.setItem(_claimKey(), JSON.stringify(c));
  renderPlayer();
}

/**
 * Pure function: given a province, return an ordered attack plan.
 *
 * Key mechanics:
 *  - sentOff = gens × (aOff / gensHome)   — scales by gens HOME, NOT max-5
 *  - No hard NW cutoff; all targets are hittable, sorted by NW quality
 *  - Greedy: use minimum gens per attack to maximise attack count
 *  - Leftover gens that can't start a new attack are bundled onto the last attack
 *  - Second attack on same target gets a SoD reminder
 *
 * Returns {attacks, gensHome, best, gensLeft, homeOffRemaining, reason}
 */
function calcAttacks(prov) {
  // ── Collect wave targets ─────────────────────────────────────────────────────
  const waveTargets = S.enemy ? S.enemy.provinces
    .filter(p => S.provinces[p.slot]?.wave)
    .map(p => ({
      province: {
        slot: '['+p.slot+']', rawSlot: p.slot, name: p.name, race: p.race,
        requiredOps:   S.provinces[p.slot]?.requiredOps   || [],
        notes:         S.provinces[p.slot]?.notes         || '',
        needsRaze:     S.provinces[p.slot]?.needsRaze     || false,
        needsMassacre: S.provinces[p.slot]?.needsMassacre || false,
      },
      waveName: S.provinces[p.slot]?.wave === 'current' ? 'Current Wave' : 'Pre-Plan',
    })) : [];
  if (!waveTargets.length) return { attacks: [], reason: 'no_targets' };

  const aOff     = _eff(prov.name, 'off',  prov.som?.offPointsHome || 0);
  const aNW      = _eff(prov.name, 'nw',   prov.networth || 0);
  const gensHome = _eff(prov.name, 'gens', prov.som?.standingArmy?.generals ?? prov.sot?.generals ?? 5);

  if (!aOff)     return { attacks: [], reason: 'no_off' };
  if (!gensHome) return { attacks: [], reason: 'no_gens' };

  // CORRECT formula: offense per general = total_home_offense / generals_home
  const offPerGen = aOff / gensHome;

  /** Fewest generals needed to break tDef with at most gensAvail generals */
  function minGens(tDef, gensAvail) {
    if (!tDef) return 1;
    return Math.min(Math.ceil((tDef * 1.01) / offPerGen), gensAvail);
  }

  /**
   * NW quality score — NO hard cutoff, any target is hittable.
   * 3 = optimal (90–110%), 2 = good (75–133%), 1 = marginal (outside 75–133%)
   */
  function nwQuality(tNW) {
    if (!aNW || !tNW) return 1;
    const r = aNW / tNW;
    if (r >= 0.90 && r <= 1.10) return 3;
    if (r >= 0.75 && r <= 1.33) return 2;
    return 1;
  }

  // ── Enrich all targets, split into in-range and out-of-range ───────────────────
  // Within each group, sort by tDef ASC (lowest def = fewest gens = most attacks).
  // NW range is the primary filter: in-range targets (75–133%) first.
  // Out-of-range targets are only used with leftover gens, or as a last resort
  // when own offense is too low to break anything in range.
  const enriched = waveTargets.map(item => {
    const tp       = pd(item.province.slot);
    const tDef     = tp?.calcs?.defPointsSummary?.defPointsHome || 0;
    const tNW      = tp?.networth || 0;
    const nwQ      = nwQuality(tNW);
    const away     = tp?.som?.armiesAway?.length > 0;
    const dAge     = tp?.calcs?.defPointsSummary?.ageSeconds;
    const mg       = minGens(tDef, gensHome);
    const canBreak = (mg * offPerGen) > (tDef * 1.01);
    return { item, tp, tDef, tNW, nwQ, nwOk: nwQ >= 2, away, breaks: canBreak, dAge, waveName: item.waveName };
  });
  // Keep a flat scored list (for context table + fallback display)
  const scored   = [...enriched].sort((a, b) => a.tDef - b.tDef);
  const inRange  = enriched.filter(t => t.nwQ >= 2).sort((a, b) => a.tDef - b.tDef);
  const outRange = enriched.filter(t => t.nwQ  < 2).sort((a, b) => a.tDef - b.tDef);

  const best = inRange[0] || scored[0];
  if (!best) return { attacks: [], reason: 'no_range' };

  // If nothing is breakable at all, show a warning card for the easiest target
  if (!scored.some(t => t.breaks)) {
    const mg      = minGens(best.tDef, gensHome);
    const sentOff = mg * offPerGen;
    return {
      attacks: [{
        n: 1, target: best, gens: mg, sentOff, result: 'marginal',
        pct: Math.round(sentOff / (best.tDef || 1) * 100),
        note: 'Cannot cleanly break any target — check intel age, or wait for enemy armies to return',
      }],
      prov, gensHome, best,
      gensLeft: gensHome - mg, homeOffRemaining: (gensHome - mg) * offPerGen,
    };
  }

  // ── Greedy: in-range first (by def ASC), out-of-range only with spare gens ───
  // Priority order each iteration:
  //   1. Unvisited in-range breakable  (cover all war-leader in-range targets first)
  //   2. Visited   in-range breakable  (cycle back if gens remain)
  //   3. Unvisited out-of-range breakable  (spare gens / fallback)
  //   4. Visited   out-of-range breakable  (spare gens, cycling)
  const attacks  = [];
  let gensLeft   = gensHome;
  const hitCount = {}; // rawSlot → times targeted, for SoD reminders

  function canBreakWith(c, gens) {
    return (minGens(c.tDef, gens) * offPerGen) > (c.tDef * 1.01);
  }
  const slotOf = c => c.item.province.rawSlot; // helper — defined once outside loop

  for (let iter = 0; iter < 20 && gensLeft > 0; iter++) {
    const t =
      inRange.find( c => !hitCount[slotOf(c)] && canBreakWith(c, gensLeft)) ||
      inRange.find( c =>                         canBreakWith(c, gensLeft)) ||
      outRange.find(c => !hitCount[slotOf(c)] && canBreakWith(c, gensLeft)) ||
      outRange.find(c =>                         canBreakWith(c, gensLeft));

    if (!t) {
      // No breakable target remains — bundle leftover gens onto last attack
      if (attacks.length > 0) {
        const last     = attacks[attacks.length - 1];
        last.gens     += gensLeft;
        last.sentOff   = last.gens * offPerGen;
        last.pct       = Math.round(last.sentOff / (last.target.tDef || 1) * 100);
        last.bundleNote = `+${gensLeft} extra gen${gensLeft > 1 ? 's' : ''} bundled — not enough offense left for a new attack`;
      }
      gensLeft = 0;
      break;
    }

    const mg      = minGens(t.tDef, gensLeft);
    const sentOff = mg * offPerGen;
    const rs      = slotOf(t);
    hitCount[rs]  = (hitCount[rs] || 0) + 1;
    gensLeft     -= mg;

    attacks.push({
      n:          attacks.length + 1,
      target:     t,
      gens:       mg,
      sentOff,
      result:     'yes',
      pct:        Math.round(sentOff / (t.tDef || 1) * 100),
      sodNote:    hitCount[rs] > 1
                    ? `Take a fresh SoD on ${t.item.province.name} before sending this attack`
                    : null,
      waveName:   t.waveName,
    });
  }

  return {
    attacks, prov, gensHome, best,
    gensLeft,
    homeOffRemaining: gensLeft * offPerGen,
  };
}

function renderPlayer() {
  renderTab('__wpc_player', _buildPlayer);
}

function _buildPlayer() {
  if (!S.own || !S.enemy) return '<div class="watk-noprov">Loading data...</div>';
  if (!S.playerProv)      return _buildProvPicker();

  const prov = S.playerProv;
  const { attacks, gensHome, gensLeft, homeOffRemaining, reason } = calcAttacks(prov);
  const waveTargets = S.enemy ? S.enemy.provinces
    .filter(p => S.provinces[p.slot]?.wave)
    .map(p => ({
      province: { slot: '['+p.slot+']', rawSlot: p.slot, name: p.name, race: p.race,
                  requiredOps:   S.provinces[p.slot]?.requiredOps   || [],
                  notes:         S.provinces[p.slot]?.notes         || '',
                  needsRaze:     S.provinces[p.slot]?.needsRaze     || false,
                  needsMassacre: S.provinces[p.slot]?.needsMassacre || false },
      waveName: S.provinces[p.slot]?.wave === 'current' ? 'Current Wave' : 'Pre-Plan',
    })) : [];
  const aOff        = _eff(prov.name, 'off',  prov.som?.offPointsHome || 0);

  let h = _playerHeader(prov, aOff, gensHome, waveTargets.length);

  if (!waveTargets.length) {
    return h + `<div class="watk-notarget">// No wave targets assigned yet<br>
      <span style="font-size:17px">The war leader needs to set targets in the WAR BOARD tab first</span></div>`;
  }
  if (reason === 'no_off') {
    return h + `<div class="watk-notarget">// No offensive data available for this province<br>
      <span style="font-size:17px">SoM data needed to calculate attacks</span></div>`;
  }
  if (!attacks.length) {
    return h + `<div class="watk-notarget">// No attack plan generated<br>
      <span style="font-size:17px">No wave targets found — check wave assignments in the War Board tab</span></div>`;
  }

  // Group attacks by wave name
  const byWave = {};
  attacks.forEach(atk => {
    const wn = atk.target.waveName || 'Wave';
    if (!byWave[wn]) byWave[wn] = [];
    byWave[wn].push(atk);
  });

  h += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
    <div class="wsech" style="margin-bottom:0">// ATTACK PLAN</div>
    <button onclick="__wpA.toggleNWPanel()"
      style="padding:4px 12px;background:#1a2828;border:1px solid #617070;color:#a0d0b0;
             font-size:17px;font-weight:700;cursor:pointer;border-radius:3px"
      title="Open wave target province pages to get real-time NW during a wave">
      ⟳ NW
    </button>
  </div>`;
  Object.entries(byWave).forEach(([wave, list]) => {
    h += _buildAttackCard(wave, list);
  });

  if (gensLeft > 0 && homeOffRemaining > 0) {
    h += `<div style="margin:10px 0;padding:8px 12px;background:#1a2828;border:1px solid #617070;
                      border-radius:3px;font-family:monospace;font-size:17px;color:#7a9090">
      🏠 ${gensLeft} gen${gensLeft > 1 ? 's' : ''} remaining home
      — ${fK(Math.round(homeOffRemaining))} off available for ambush / defense
    </div>`;
  }

  h += _buildContextTable(waveTargets, prov, aOff);
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
            style="background:#2b3333;border:1px solid #617070;border-radius:3px;padding:12px 14px;cursor:pointer;
                   display:flex;align-items:center;justify-content:space-between;transition:border-color .15s"
            onmouseover="this.style.borderColor='#617070'" onmouseout="this.style.borderColor='#617070'">
            <div>
              <div style="font-size:21px;font-weight:700">${esc(p.name)}</div>
              <div style="font-family:monospace;font-size:17px;color:#7a9090">${esc(p.race || '')} · ${esc(p.sot?.personality || '')}</div>
            </div>
            <div style="text-align:right">
              <div style="font-family:monospace;font-size:19px;color:#ffd400">${fK(off)} off</div>
              <div style="font-family:monospace;font-size:17px;color:#7a9090">${gens} gens home · ${fK(p.networth)} NW</div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

function _playerHeader(prov, aOff, gensHome, targetCount) {
  const genColor = gensHome >= 3 ? '#60C040' : gensHome >= 1 ? '#e09040' : '#E05050';
  const ms = loadManual(prov.name);  // single localStorage read for the whole header
  const apiOff  = prov.som?.offPointsHome || 0;
  const apiNW   = prov.networth || 0;
  const apiGens = prov.som?.standingArmy?.generals ?? prov.sot?.generals ?? 5;
  // Escape province name for safe embedding in both HTML attrs and JS string literals
  const pn = prov.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '&lt;');

  const inputStyle = 'background:#1a2828;border:1px solid #617070;color:#ffffff;font-family:monospace;' +
    'font-size:17px;padding:4px 8px;border-radius:3px;width:100%;box-sizing:border-box;margin-top:3px';
  const hintStyle = 'font-size:13px;color:#7a9090;margin-top:2px';

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div>
        <div style="font-size:21px;font-weight:700">${esc(prov.name)}</div>
        <div style="font-family:monospace;font-size:17px;color:#7a9090">${esc(prov.race || '')} · ${esc(prov.sot?.personality || '')}</div>
      </div>
      <button onclick="__wpA.pickProv('')"
        style="padding:5px 10px;background:#2b3333;border:1px solid #617070;color:#ffffff;font-size:17px;font-weight:700;cursor:pointer;border-radius:3px">
        ↩ Change
      </button>
    </div>

    <div style="background:#1a2828;border:1px solid #617070;border-radius:3px;padding:12px 14px;margin-bottom:14px">
      <div style="font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#7a9090;margin-bottom:10px">
        My Stats — enter your current values (saves on Tab/Enter/click away)
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <div>
          <div style="font-size:13px;color:#7a9090;font-weight:700;text-transform:uppercase;letter-spacing:1px">Max Offense</div>
          <input type="number" value="${ms.off || apiOff || ''}" placeholder="${apiOff ? fK(apiOff)+' (API)' : 'e.g. 85000'}"
            style="${inputStyle}"
            onchange="__wpA.setManualStat('${pn}','off',this.value)"
            onkeydown="if(event.key==='Enter')this.blur()">
          ${ms.off ? '<div style="'+hintStyle+'">✎ manual</div>' : (apiOff ? '<div style="'+hintStyle+'">from SoM</div>' : '')}
        </div>
        <div>
          <div style="font-size:13px;color:#7a9090;font-weight:700;text-transform:uppercase;letter-spacing:1px">Net Worth</div>
          <input type="number" value="${ms.nw || apiNW || ''}" placeholder="${apiNW ? fK(apiNW)+' (API)' : 'e.g. 250000'}"
            style="${inputStyle}"
            onchange="__wpA.setManualStat('${pn}','nw',this.value)"
            onkeydown="if(event.key==='Enter')this.blur()">
          ${ms.nw ? '<div style="'+hintStyle+'">✎ manual</div>' : (apiNW ? '<div style="'+hintStyle+'">from IS</div>' : '')}
        </div>
        <div>
          <div style="font-size:13px;color:#7a9090;font-weight:700;text-transform:uppercase;letter-spacing:1px">Generals</div>
          <input type="number" min="0" max="5" value="${ms.gens != null ? ms.gens : (apiGens || '')}" placeholder="${apiGens || '1-5'}"
            style="${inputStyle}"
            onchange="__wpA.setManualStat('${pn}','gens',this.value)"
            onkeydown="if(event.key==='Enter')this.blur()">
          ${ms.gens != null ? '<div style="'+hintStyle+'">✎ manual</div>' : (apiGens ? '<div style="'+hintStyle+'">from SoM</div>' : '')}
        </div>
      </div>
    </div>

    <div class="watk-summary">
      <div class="watk-sstat"><div class="l">Off Home</div><div class="v">${fK(aOff)}</div></div>
      <div class="watk-sstat"><div class="l">Generals Home</div>
        <div class="v" style="color:${genColor}">${gensHome}<span style="font-size:19px;color:#7a9090"> / 5</span></div>
      </div>
      <div class="watk-sstat"><div class="l">Own NW</div><div class="v">${fK(aOff ? (ms.nw || apiNW) : 0)}</div></div>
      <div class="watk-sstat"><div class="l">Targets Set</div><div class="v">${targetCount}</div><div class="s">by war leader</div></div>
    </div>`;
}

function _buildAttackCard(wave, atkList) {
  let h = `
    <div class="watk-card">
      <div class="watk-header">
        <span class="watk-wave">// ${esc(wave.toUpperCase())}</span>
        <span style="font-family:monospace;font-size:17px;color:#7a9090">${atkList.length} attack${atkList.length > 1 ? 's' : ''}</span>
      </div>
      <div class="watk-body">`;

  const claims = loadClaims();

  atkList.forEach(atk => {
    const t         = atk.target;
    const away      = t.tp?.som?.armiesAway?.length > 0;
    const ops       = t.item.province.requiredOps || [];
    const da        = t.dAge;
    const genColor  = atk.gens <= 2 ? '#60C040' : atk.gens <= 3 ? '#e09040' : '#ffffff';
    const resCls    = atk.result === 'yes' ? 'watk-yes' : atk.result === 'close' ? 'watk-cl' : 'watk-no';
    const resLabel  = atk.result === 'yes' ? 'BREAKS' : atk.result === 'close' ? 'CLOSE' : 'RISKY';
    const sentOff   = atk.sentOff || 0;
    const rs        = t.item.province.rawSlot;
    const razeClaim = claims['raze_'     + rs];
    const massClaim = claims['massacre_' + rs];

    h += `
      <div class="watk-row">
        <div class="watk-num" style="color:#7a9090">${atk.n}</div>
        <div class="watk-main">
          <div class="watk-target">
            ${esc(t.item.province.name)}
            ${away ? ' <span style="color:#60C040;font-size:17px">↗ army away</span>' : ''}
          </div>
          <div class="watk-detail">
            ${fK(t.tDef)} def · ${fK(sentOff)} off sent · ${atk.pct}% ratio
            ${da != null ? ` · intel <span class="${aC(da)}">${fA(da)}</span> old` : ''}
            ${atk.note       ? `<br><span style="color:#e09040">⚠ ${esc(atk.note)}</span>` : ''}
            ${atk.sodNote    ? `<br><span style="color:#ffd400;font-weight:700">⚠ ${esc(atk.sodNote)}</span>` : ''}
            ${atk.bundleNote ? `<br><span style="color:#7a9090;font-style:italic">ℹ ${esc(atk.bundleNote)}</span>` : ''}
          </div>
          ${ops.length ? `<div class="watk-ops">${ops.map(o => `<span class="wtag" style="cursor:default">${o}</span>`).join('')}</div>` : ''}
          ${t.item.province.notes ? `<div style="margin-top:4px;font-size:17px;color:#ffffff;background:#2b3333;padding:4px 6px;border-radius:2px;border-left:2px solid #ffd400">${esc(t.item.province.notes)}</div>` : ''}
          ${t.item.province.needsRaze ? `
          <div class="watk-task${razeClaim ? ' claimed' : ''}">
            <span>🔥</span>
            <span style="font-weight:700;color:${razeClaim ? '#ffd400' : '#E05050'}">${razeClaim ? 'RAZE — you claimed this' : 'RAZE NEEDED'}</span>
            <label class="watk-claim">
              <input type="checkbox" ${razeClaim ? 'checked' : ''} onchange="__wpA.claimAction(${rs},'raze')"
                style="cursor:pointer;width:14px;height:14px;accent-color:#ffd400">
              <span style="font-size:17px;color:${razeClaim ? '#ffd400' : '#7a9090'}">${razeClaim ? 'unclaim' : 'claim'}</span>
            </label>
          </div>` : ''}
          ${t.item.province.needsMassacre ? `
          <div class="watk-task${massClaim ? ' claimed' : ''}">
            <span>💀</span>
            <span style="font-weight:700;color:${massClaim ? '#ffd400' : '#E05050'}">${massClaim ? 'MASSACRE — you claimed this' : 'MASSACRE NEEDED'}</span>
            <label class="watk-claim">
              <input type="checkbox" ${massClaim ? 'checked' : ''} onchange="__wpA.claimAction(${rs},'massacre')"
                style="cursor:pointer;width:14px;height:14px;accent-color:#ffd400">
              <span style="font-size:17px;color:${massClaim ? '#ffd400' : '#7a9090'}">${massClaim ? 'unclaim' : 'claim'}</span>
            </label>
          </div>` : ''}
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
  // Use effective NW (manual override wins over API) for range check — same as calcAttacks()
  const aNW = _eff(prov.name, 'nw', prov.networth || 0);
  const ctxClaims = loadClaims();
  const thStyle   = 'text-align:left;padding:5px 8px;font-size:15px;font-weight:700;color:#7a9090;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #617070';

  const rows = waveTargets.map(item => {
    const tp    = pd(item.province.slot);
    const tDef  = tp?.calcs?.defPointsSummary?.defPointsHome || 0;
    const tNW   = tp?.networth || 0;
    const away  = tp?.som?.armiesAway?.length > 0;
    // NW quality (no hard cutoff — any target is hittable)
    const nwQ   = (!aNW || !tNW) ? 1
                : (() => { const r = aNW / tNW; return r >= 0.90 && r <= 1.10 ? 3 : r >= 0.75 && r <= 1.33 ? 2 : 1; })();
    const nwLabel = nwQ === 3 ? '✓ optimal' : nwQ === 2 ? '✓ good' : '~ marginal';
    const nwCls   = nwQ === 3 ? 'wmyes' : nwQ === 2 ? 'wmyes' : 'wmcl';
    const pct   = tDef > 0 && aOff > 0 ? Math.round(aOff / tDef * 100) : 0;
    const breaksCls = !aOff || !tDef ? 'wmcl' : aOff > tDef * 1.01 ? 'wmyes' : 'wmno';
    const rs    = item.province.rawSlot;
    const razeClaim = ctxClaims['raze_' + rs];
    const massClaim = ctxClaims['massacre_' + rs];
    const taskHtml  = [
      item.province.needsRaze     ? `<span style="color:${razeClaim?'#ffd400':'#E05050'};font-weight:700">🔥${razeClaim?' ✓':''}</span>` : '',
      item.province.needsMassacre ? `<span style="color:${massClaim?'#ffd400':'#E05050'};font-weight:700">💀${massClaim?' ✓':''}</span>` : '',
    ].filter(Boolean).join(' ') || '—';
    return `<tr style="border-bottom:1px solid #617070">
      <td style="padding:6px 8px;font-weight:600">${esc(item.province.name)}</td>
      <td style="padding:6px 8px;font-family:monospace">${fK(tDef)}</td>
      <td style="padding:6px 8px;font-family:monospace">${fK(tNW)}</td>
      <td style="padding:6px 8px"><span class="wmatch ${breaksCls}">${pct}%</span></td>
      <td style="padding:6px 8px"><span class="wmatch ${nwCls}">${nwLabel}</span></td>
      <td style="padding:6px 8px">${away ? '<span style="color:#60C040;font-family:monospace;font-size:17px">AWAY</span>' : '—'}</td>
      <td style="padding:6px 8px">${taskHtml}</td>
    </tr>`;
  }).join('');

  return `
    <div style="margin-top:20px" class="wsech">// ALL WAVE TARGETS (context)</div>
    <table style="width:100%;border-collapse:collapse;font-size:17px">
      <thead><tr>
        <th style="${thStyle}">Province</th>
        <th style="${thStyle}">Def Home</th>
        <th style="${thStyle}">NW</th>
        <th style="${thStyle}">Off/Def</th>
        <th style="${thStyle}">NW Range</th>
        <th style="${thStyle}">Army</th>
        <th style="${thStyle}">Task</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function pickProv(slot) {
  if (!slot) { S.playerProv = null; renderPlayer(); return; }
  S.playerProv = S.own.provinces.find(p => p.slot === parseInt(slot)) || null;
  renderPlayer();
}
