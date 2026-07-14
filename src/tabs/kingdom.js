// ── TAB: KINGDOM ─────────────────────────────────────────────────────────────
// Own-kingdom attacker roster & settings — the data foundation for the wave
// solver (stage 2). Shows every own province with its computed MAX OFFENSE
// (one big hit, all sendable generals, fanaticism assumed cast) and lets
// anyone set the shared "% of elites sent" per province.
//
// Elite-% settings are shared kingdom-wide via Firestore meta/{kdId}_atk_settings
// (stored as a JSON string, same pattern as warplan/{kdId}) so they survive
// devices and sessions. Set once or twice per age, adjustable any time.

function _atkKdId() { return S.own?.location?.replace(':', '_') || null; }

async function loadAtkSettings() {
  const kdId = _atkKdId();
  if (!kdId) return;
  try {
    const doc  = await fbGet(`meta/${kdId}_atk_settings`);
    const json = doc?.fields?.json?.stringValue;
    if (json) S.atkSettings = JSON.parse(json) || {};
  } catch (e) {
    console.warn('[WavePlanner] loadAtkSettings failed:', e.message);
  }
  S.atkSettingsLoaded = true;
}

async function _saveAtkSettings() {
  const kdId = _atkKdId();
  if (!kdId) return;
  await fbWrite(`meta/${kdId}_atk_settings`, {
    json:      JSON.stringify(S.atkSettings),
    updatedAt: Date.now(),
    updatedBy: S.playerProv?.name || 'leader',
  });
}

function _atkSet(slot) { return S.atkSettings[slot] || {}; }

/**
 * Default % of elites sent, by race: races with DEFENSIVE elites (off < def,
 * e.g. Faery 4/16, Halfling 10/13) keep them home → 0%. Offensive elites →
 * 100%. Without this, pure-defense provinces look like attackers because
 * sot.offPoints includes their elites' small offense value.
 */
function _defaultElitePct(race) {
  const u = RACE_UNITS[(race || '').toLowerCase()];
  if (!u) return 100;
  return u.elite[0] >= u.elite[1] ? 100 : 0;
}

/** Effective elite % for a province: shared setting wins, else race default. */
function _elitePctFor(prov) {
  const set = _atkSet(prov.slot);
  return set.elitePct != null ? set.elitePct : _defaultElitePct(prov.race);
}

/** Inline input handler: % of elites this province sends on attacks (0–100). */
function setElitePct(slot, rawVal) {
  let v = parseInt(rawVal);
  if (isNaN(v)) v = 100;
  v = Math.max(0, Math.min(100, v));
  S.atkSettings[slot] = { ..._atkSet(slot), elitePct: v, setAt: Date.now() };
  _saveAtkSettings();
  renderKingdom();
}

/** Inline input handler: manual elite count override (blank = use API). */
function setEliteCount(slot, rawVal) {
  const v   = parseInt(rawVal);
  const cur = { ..._atkSet(slot) };
  if (v > 0) cur.eliteCount = v; else delete cur.eliteCount;
  cur.setAt = Date.now();
  S.atkSettings[slot] = cur;
  _saveAtkSettings();
  renderKingdom();
}

// ── Elite count from API ─────────────────────────────────────────────────────
// Field names VERIFIED against a real IS dump (2026-07-14):
//   sot.elites — total elites regardless of location (primary; pairs with
//                sot.offPoints which also covers all troops)
//   som.standingArmy.elites (home) + armiesAway[].elites (per army) — fallback
function _apiEliteCount(prov) {
  const sotElites = prov.sot?.elites;
  if (sotElites != null) return { count: sotElites, complete: true };
  const home = prov.som?.standingArmy?.elites;
  if (home == null) return { count: null, complete: false };
  let away = 0;
  for (const a of (prov.som?.armiesAway || [])) away += a?.elites || 0;
  return { count: home + away, complete: true };
}

/** Offense value of one elite for this race/personality (General: +2). */
function _eliteOffValue(race, personality) {
  const u = RACE_UNITS[(race || '').toLowerCase()];
  if (!u) return null;
  return u.elite[0] + (PERS_ELITE_OFF_BONUS[(personality || '').toLowerCase()] || 0);
}

/**
 * Max offense in ONE hit committing every sendable general.
 *
 *   maxOff = (sot.offPoints − withheldEliteOff)
 *            × genMult (1 + 0.05 × (sendableGens − 1))
 *            × FANATICISM_OFF_MULT (assumed cast at wave time)
 *
 * VERIFIED 2026-07-14 against a real IS dump: sot.offPoints is total offense
 * of ALL troops (home + away) and ALREADY includes the full OME (race,
 * personality, science, honor, spells) — som.ome exposes it as a percentage.
 * So no race/personality multiplier is applied here, and the withheld-elite
 * subtraction must scale the raw Age-116 elite value by ome/100 to match the
 * points inside offPoints:
 *   withheld = eliteCount × eliteRawOff × (1 − elitePct/100) × ome/100
 * Caveat: if the province had fanaticism active when the SoT was taken, ome
 * already contains it and the ×1.05 double-counts slightly (~5%).
 * Returns a breakdown object so the roster and the solver can both use it.
 */
function calcMaxOff(prov) {
  const set      = _atkSet(prov.slot);
  const elitePct = _elitePctFor(prov);   // race default: defensive elites → 0%
  const baseOff  = prov.sot?.offPoints || 0;
  const ome      = (prov.som?.ome || 100) / 100;

  const api        = _apiEliteCount(prov);
  const eliteCount = set.eliteCount != null ? set.eliteCount : api.count;
  const eliteSrc   = set.eliteCount != null ? 'manual' : (api.count != null ? 'api' : 'none');
  const eliteOffVal = _eliteOffValue(prov.race, prov.sot?.personality);

  const warnings = [];
  let withheld = 0;
  if (elitePct < 100) {
    if (eliteCount == null)       warnings.push('elite count unknown — enter it manually');
    else if (eliteOffVal == null) warnings.push('unknown race — no elite off value');
    else withheld = Math.round(eliteCount * eliteOffVal * (1 - elitePct / 100) * ome);
    if (!prov.som?.ome) warnings.push('no SoM OME — withheld elites use raw values');
  }

  // Total province generals = home + in away armies (sot has no generals field;
  // standingArmy.generals is HOME ONLY — verified against real dump 2026-07-14)
  const homeGens  = prov.som?.standingArmy?.generals;
  const awayGens  = (prov.som?.armiesAway || []).reduce((s, a) => s + (a?.generals || 0), 0);
  const totalGens = homeGens != null ? homeGens + awayGens : 5;
  const sendableGens = Math.max(0, totalGens - 1);           // 1 general always home
  const genMult      = sendableGens > 0 ? 1 + 0.05 * (sendableGens - 1) : 0;

  const maxOff = sendableGens > 0
    ? Math.round(Math.max(0, baseOff - withheld) * genMult * FANATICISM_OFF_MULT)
    : 0;

  return { maxOff, baseOff, withheld, elitePct, eliteCount, eliteSrc, eliteOffVal, ome,
           totalGens, sendableGens, genMult, warnings };
}

// ── Army return / stray detection ────────────────────────────────────────────
// "Stray army": ≥2 armies away whose returns are spread more than 1 hour apart.
// The solver (stage 2) merges armies returning within 1h into one slot; a stray
// means the province never has its full offense home at once — the war leader
// may want that player to hold the stray home next time.
function _armyReturnInfo(prov) {
  const armies = (prov.som?.armiesAway || [])
    .map(a => a.secondsRemaining)
    .filter(s => s != null)
    .sort((a, b) => a - b);
  if (!armies.length) return { away: 0, returns: [], stray: false, allOverdue: false };
  const allOverdue = armies[armies.length - 1] <= 0;
  const stray = armies.length >= 2 && (armies[armies.length - 1] - armies[0]) > 3600;
  return { away: armies.length, returns: armies, stray, allOverdue };
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderKingdom() {
  renderTab('__wpc_kingdom', _buildKingdom);
}

function _buildKingdom() {
  if (!S.own) return '<div class="watk-noprov">Loading data...</div>';
  if (!S.atkSettingsLoaded) {
    loadAtkSettings().then(renderKingdom);
    return loadingHTML('Loading attacker settings...');
  }

  const provs = [...S.own.provinces].sort((a, b) => (b.networth || 0) - (a.networth || 0));

  let kdMaxOff = 0, unknownElites = 0, tunedCount = 0, strayCount = 0;
  const rows = provs.map(p => {
    const mo  = calcMaxOff(p);
    const ari = _armyReturnInfo(p);
    kdMaxOff += mo.maxOff;
    if (mo.eliteSrc === 'none') unknownElites++;
    if (mo.elitePct < 100)      tunedCount++;
    if (ari.stray)              strayCount++;
    return { p, mo, ari };
  });

  const thStyle = 'text-align:left;padding:5px 8px;font-size:15px;font-weight:700;color:#7a9090;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #617070';
  const inputStyle = 'background:#1a2828;border:1px solid #617070;color:#ffffff;font-family:monospace;font-size:17px;padding:3px 6px;border-radius:3px;width:64px;text-align:right';

  let h = `
    <div class="wsum">
      <div class="wscard"><div class="l">Attackers</div><div class="v">${provs.length}</div><div class="s">own provinces</div></div>
      <div class="wscard"><div class="l">KD Max Off</div><div class="v">${fK(kdMaxOff)}</div><div class="s">one-hit, all gens, fanaticism</div></div>
      <div class="wscard"><div class="l">Elites Tuned</div><div class="v">${tunedCount}</div><div class="s">provinces &lt;100% sent</div></div>
      <div class="wscard"><div class="l">Stray Armies</div><div class="v" style="${strayCount ? 'color:#e09040' : ''}">${strayCount}</div><div class="s">returns &gt;1h apart</div></div>
    </div>`;

  if (unknownElites > 0) {
    h += `<div style="margin-bottom:10px;padding:8px 14px;background:#201808;border:1px solid #805020;
        border-radius:3px;font-size:17px;color:#e09040;display:flex;align-items:center;gap:8px">
      <span style="font-size:19px">⚠</span>
      <span><b>${unknownElites} province${unknownElites > 1 ? 's' : ''} without an elite count from the API</b>
      (SoT/SoM missing or stale) — enter counts manually in the Elites column
      for provinces that keep elites home.</span>
    </div>`;
  }

  h += `<div class="wsech">// ATTACKER ROSTER — Age 116 unit values · fanaticism assumed cast</div>
    <table style="width:100%;border-collapse:collapse;font-size:17px">
      <thead><tr>
        <th style="${thStyle}">Province</th>
        <th style="${thStyle}">Race · Pers</th>
        <th style="${thStyle}">NW</th>
        <th style="${thStyle}" title="Own population % — <70% fat (raze/mass), ≥100% needs acres (TM)">Pop%</th>
        <th style="${thStyle}">Gens</th>
        <th style="${thStyle}">SoT Off</th>
        <th style="${thStyle}" title="Offensive Military Efficiency from SoM — already included in SoT Off">OME</th>
        <th style="${thStyle}">Elites</th>
        <th style="${thStyle}" title="Share of elites this province sends on attacks — shared setting, saved to Firebase">Elite % Sent</th>
        <th style="${thStyle}" title="One big hit: all sendable generals + fanaticism, minus withheld elites">Max Off (1 hit)</th>
        <th style="${thStyle}">Armies Away</th>
      </tr></thead>
      <tbody>`;

  rows.forEach(({ p, mo, ari }) => {
    const set = _atkSet(p.slot);
    // Elites cell: API value as text, or manual input (prefilled) when overridden/missing
    const eliteCell = mo.eliteSrc === 'api'
      ? `<span style="font-family:monospace">${fK(mo.eliteCount)}</span>
         <span style="font-size:13px;color:#7a9090">${p.sot?.elites != null ? 'SoT' : 'SoM'}</span>
         <input type="number" min="0" placeholder="fix" value=""
           style="${inputStyle};width:56px;margin-left:4px" title="Override the API elite count"
           onchange="__wpA.setEliteCount(${p.slot}, this.value)"
           onkeydown="if(event.key==='Enter')this.blur()">`
      : `<input type="number" min="0" value="${set.eliteCount != null ? set.eliteCount : ''}"
           placeholder="?" style="${inputStyle}"
           onchange="__wpA.setEliteCount(${p.slot}, this.value)"
           onkeydown="if(event.key==='Enter')this.blur()">
         <span style="font-size:13px;color:${mo.eliteSrc === 'manual' ? '#ffd400' : '#e09040'}">${mo.eliteSrc === 'manual' ? '✎ manual' : 'no API'}</span>`;

    const pctColor = mo.elitePct < 100 ? '#ffd400' : '#7a9090';
    const withheldNote = mo.withheld > 0
      ? `<div style="font-size:13px;color:#7a9090">−${fK(mo.withheld)} off held</div>` : '';

    const returnsHtml = ari.away === 0
      ? '<span style="color:#617070">—</span>'
      : ari.returns.map(s => s <= 0
          ? '<span style="color:#e09040;font-family:monospace">OVERDUE</span>'
          : `<span style="font-family:monospace">${fA(s)}</span>`
        ).join(' · ')
        + (ari.stray ? ' <span style="color:#e09040;font-weight:700" title="Armies return more than 1h apart — full offense is never home at once. Consider holding the stray army.">⚠ stray</span>' : '');

    const warnHtml = mo.warnings.length
      ? `<div style="font-size:13px;color:#e09040">⚠ ${esc(mo.warnings.join(' · '))}</div>` : '';

    h += `<tr style="border-bottom:1px solid #617070">
      <td style="padding:6px 8px;font-weight:600">${esc(p.name)}${warnHtml}</td>
      <td style="padding:6px 8px;color:#7a9090">${esc(p.race || '?')} · ${esc(p.sot?.personality || '?')}</td>
      <td style="padding:6px 8px;font-family:monospace">${fK(p.networth || 0)}</td>
      <td style="padding:6px 8px;font-family:monospace">${(() => {
        const pop = _ownPopPct(p);
        if (pop == null) return '<span style="color:#617070">—</span>';
        const flag = pop < 70 ? '<div style="font-size:13px;color:#e09040">fat — raze/mass</div>'
                   : pop >= 100 ? '<div style="font-size:13px;color:#60C040">needs acres</div>' : '';
        const col = pop < 70 ? '#e09040' : pop >= 100 ? '#60C040' : '#ffd400';
        return `<span style="color:${col}">${pop}%</span>${flag}`;
      })()}</td>
      <td style="padding:6px 8px;font-family:monospace" title="${mo.sendableGens} sendable (1 stays home) → ×${mo.genMult.toFixed(2)}">${mo.totalGens} <span style="color:#7a9090">(${mo.sendableGens}⚔)</span></td>
      <td style="padding:6px 8px;font-family:monospace">${fK(mo.baseOff)}</td>
      <td style="padding:6px 8px;font-family:monospace;color:#7a9090">${p.som?.ome ? p.som.ome + '%' : '—'}</td>
      <td style="padding:6px 8px;white-space:nowrap">${eliteCell}</td>
      <td style="padding:6px 8px">
        <input type="number" min="0" max="100" step="5" value="${mo.elitePct}"
          style="${inputStyle};border-color:${mo.elitePct < 100 ? '#ffd400' : '#617070'};color:${pctColor}"
          onchange="__wpA.setElitePct(${p.slot}, this.value)"
          onkeydown="if(event.key==='Enter')this.blur()"><span style="color:${pctColor}"> %</span>
        ${withheldNote}
      </td>
      <td style="padding:6px 8px;font-family:monospace;font-weight:700;color:${mo.maxOff > 0 ? '#ffd400' : '#E05050'}"
          title="(${fK(mo.baseOff)} − ${fK(mo.withheld)} withheld elites) × ${mo.genMult.toFixed(2)} gens × ${FANATICISM_OFF_MULT} fanaticism — OME already inside SoT off">
        ${fK(mo.maxOff)}</td>
      <td style="padding:6px 8px">${returnsHtml}</td>
    </tr>`;
  });

  h += `</tbody></table>
    <div style="margin-top:10px;font-size:15px;color:#617070">
      Max Off = (SoT off − withheld elites) × general bonus (+5%/extra gen, 1 kept home) × fanaticism (+5%).
      SoT off already includes OME (race, personality, science, honor); withheld elites are scaled by OME to match.
      Elite % and manual counts are shared kingdom-wide (Firebase) — set once per age, adjust when strategy changes.
    </div>`;
  return h;
}
