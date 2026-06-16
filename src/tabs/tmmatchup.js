// ── TAB: T/M MATCHUP ─────────────────────────────────────────────────────────
// Grid of own T/M provinces (rows) vs enemy provinces (columns).
// Shows thievery and magic matchup ratios, colour-coded by success threshold,
// with an NW range indicator so you can see which ops are in the gains sweet spot.

function renderTmMatchup() {
  renderTab('__wpc_tmmatchup', _buildTmMatchup);
}

function _buildTmMatchup() {
  if (!S.own || !S.enemy) {
    return `<div class="wsech"><div class="walt wau"><div class="wabg">NO DATA</div>
      <div>Load both your kingdom and an enemy kingdom first.</div></div></div>`;
  }

  const ownProvs   = (S.own.provinces   || []).filter(p => p && p.land > 0);
  const enemyProvs = (S.enemy.provinces || []).filter(p => p && p.land > 0);

  if (!ownProvs.length || !enemyProvs.length) {
    return `<div class="wsech"><div style="color:#7a9090">No province data available.</div></div>`;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  // modOffTpa / modDefTpa / modOffWpa / modDefWpa come from calcs (pre-computed by IS)
  function _oTpa(p)  { return p?.calcs?.modOffTpa ?? null; }
  function _dTpa(p)  { return p?.calcs?.modDefTpa ?? null; }
  function _oWpa(p)  { return p?.calcs?.modOffWpa ?? null; }
  function _dWpa(p)  { return p?.calcs?.modDefWpa ?? null; }

  // RPNW: TargetNW / SelfNW — same breakpoints as combat gains
  // Returns { label, color } for display
  function _nwBand(ownNw, enemyNw) {
    if (!ownNw || !enemyNw) return { label: '?', col: '#555' };
    const r = enemyNw / ownNw;
    if (r < 0.567)        return { label: '✗', col: '#b94040' };   // dead zone — no gains
    if (r < 0.9)          return { label: '↓', col: '#c8843a' };   // below sweet spot
    if (r <= 1.1)         return { label: '✓', col: '#5fcf9f' };   // sweet spot
    if (r <= 1.6)         return { label: '↑', col: '#c8c03a' };   // above — declining
    return                       { label: '✗', col: '#b94040' };   // dead zone — too high
  }

  // Ratio → colour
  // NS thresholds: 3:1 great, 2:1 good, 1:1 ok, <1 bad
  // Rob/Kidnap: 2:1 great, 1:1 ok, <1 bad
  // We use NS as the primary scale (most demanding).
  function _ratioCol(ratio) {
    if (ratio == null) return '#555';
    if (ratio >= 3.0)  return '#5fcf9f';   // great (green)
    if (ratio >= 2.0)  return '#8bcf6f';   // good
    if (ratio >= 1.0)  return '#c8c03a';   // marginal (yellow)
    return '#b94040';                       // bad (red)
  }

  function _fmt(v) { return v != null ? v.toFixed(2) : '—'; }

  // ── Classify own provinces ────────────────────────────────────────────────────
  // "T/M" = province with meaningful modOffTpa or modOffWpa, typically lower aOff.
  // We show ALL own provinces but highlight T/M ones.
  // User can toggle to show only T/M.
  const showAll = S.tmMatchupShowAll ?? false;

  function _isTm(p) {
    const aOff = p.som?.offPointsHome ?? p.sot?.offPoints ?? 0;
    const oT   = _oTpa(p);
    const oW   = _oWpa(p);
    // T/M if: meaningful TPA or WPA AND low offense
    return (oT != null && oT > 0.5) || (oW != null && oW > 0.5);
  }

  const rows = showAll ? ownProvs : ownProvs.filter(_isTm);

  if (!rows.length) {
    return `<div class="wsech"><div style="color:#7a9090">No T/M provinces detected — try toggling "Show all".</div></div>`;
  }

  // ── Build table ───────────────────────────────────────────────────────────────

  // Column headers: enemy province names
  const colHeaders = enemyProvs.map(ep => {
    const nw = ep.networth || 0;
    return `<th style="padding:6px 8px;font-size:13px;color:#9ab;white-space:nowrap;border-bottom:1px solid #2a3a3a;">
      <div style="font-weight:700;color:#cde">${esc(ep.name || '?')}</div>
      <div style="color:#7a9090;font-size:11px">${ep.race ? esc(ep.race) : ''} · ${fK(nw)} NW</div>
    </th>`;
  }).join('');

  // Rows: own T/M provinces
  const tableRows = rows.map(op => {
    const oTpa  = _oTpa(op);
    const oWpa  = _oWpa(op);
    const ownNw = op.networth || 0;

    const cells = enemyProvs.map(ep => {
      const dTpa  = _dTpa(ep);
      const dWpa  = _dWpa(ep);
      const tRatio = (oTpa != null && dTpa != null && dTpa > 0) ? oTpa / dTpa : null;
      const wRatio = (oWpa != null && dWpa != null && dWpa > 0) ? oWpa / dWpa : null;
      const nw    = _nwBand(ownNw, ep.networth || 0);

      const tCol  = _ratioCol(tRatio);
      const wCol  = _ratioCol(wRatio);

      return `<td style="padding:6px 8px;text-align:center;border-bottom:1px solid #1a2a2a;border-right:1px solid #1a2a2a;">
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
          <div style="font-size:13px;font-weight:700;color:${tCol}" title="TPA ratio: ${_fmt(oTpa)} / ${_fmt(dTpa)}">
            T ${tRatio != null ? tRatio.toFixed(1) : '—'}
          </div>
          <div style="font-size:13px;color:${wCol}" title="WPA ratio: ${_fmt(oWpa)} / ${_fmt(dWpa)}">
            W ${wRatio != null ? wRatio.toFixed(1) : '—'}
          </div>
          <div style="font-size:11px;font-weight:700;color:${nw.col}" title="RPNW = ${ownNw && ep.networth ? (ep.networth/ownNw).toFixed(2) : '?'}">
            ${nw.label} NW
          </div>
        </div>
      </td>`;
    }).join('');

    const aOff = op.som?.offPointsHome ?? op.sot?.offPoints ?? 0;
    return `<tr>
      <td style="padding:6px 10px;white-space:nowrap;border-bottom:1px solid #1a2a2a;border-right:2px solid #2a4a4a;position:sticky;left:0;background:#0e1a1a;z-index:1;">
        <div style="font-weight:700;color:#cde;font-size:14px">${esc(op.name || '?')}</div>
        <div style="font-size:11px;color:#7a9090">${op.race ? esc(op.race) : ''} · ${fK(ownNw)} NW</div>
        <div style="font-size:11px;margin-top:2px;display:flex;gap:6px;">
          ${oTpa != null ? `<span style="color:#9ab">TPA <b style="color:#cde">${oTpa.toFixed(2)}</b></span>` : ''}
          ${oWpa != null ? `<span style="color:#9ab">WPA <b style="color:#cde">${oWpa.toFixed(2)}</b></span>` : ''}
        </div>
      </td>
      ${cells}
    </tr>`;
  }).join('');

  // ── Legend ────────────────────────────────────────────────────────────────────
  const legend = `
    <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;margin-bottom:12px;font-size:13px;">
      <b style="color:#7a9090;text-transform:uppercase;letter-spacing:1px">Ratio key:</b>
      <span><b style="color:#5fcf9f">≥3.0</b> Great (NS / Rob safe)</span>
      <span><b style="color:#8bcf6f">≥2.0</b> Good</span>
      <span><b style="color:#c8c03a">≥1.0</b> Marginal</span>
      <span><b style="color:#b94040">&lt;1.0</b> Risky</span>
      <span style="margin-left:8px;border-left:1px solid #2a3a3a;padding-left:8px">
        <b style="color:#5fcf9f">✓ NW</b> sweet spot &nbsp;
        <b style="color:#c8c03a">↑↓</b> partial gains &nbsp;
        <b style="color:#b94040">✗</b> dead zone
      </span>
    </div>`;

  // ── Enemy def stats row at bottom ─────────────────────────────────────────────
  const defRow = `<tr style="background:#0a1414;">
    <td style="padding:6px 10px;font-size:12px;color:#7a9090;border-right:2px solid #2a4a4a;position:sticky;left:0;background:#0a1414;">
      Enemy def TPA / WPA
    </td>
    ${enemyProvs.map(ep => `<td style="padding:6px 8px;text-align:center;font-size:12px;color:#7a9090;">
      <div>T <b style="color:#9ab">${_fmt(_dTpa(ep))}</b></div>
      <div>W <b style="color:#9ab">${_fmt(_dWpa(ep))}</b></div>
    </td>`).join('')}
  </tr>`;

  const toggleLabel = showAll ? 'Show T/M only' : 'Show all own';

  return `<div class="wsech" style="padding-bottom:20px;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
      <div class="wthr-title" style="margin:0">T/M Matchup</div>
      <button class="wb" onclick="__wpA.tmMatchupToggle()" style="font-size:13px;padding:3px 10px;">${toggleLabel}</button>
    </div>
    <div style="font-size:14px;color:#7a9090;margin-bottom:12px;">
      Thievery (T) and magic (W) ratios — own offensive TPA/WPA vs each enemy's defensive TPA/WPA.
      NW indicator shows whether the target is in your gains range.
    </div>
    ${legend}
    <div style="overflow-x:auto;">
      <table style="border-collapse:collapse;min-width:100%;">
        <thead>
          <tr>
            <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #2a3a3a;border-right:2px solid #2a4a4a;position:sticky;left:0;background:#0e1a1a;z-index:2;">
              <span style="color:#7a9090;font-size:12px;text-transform:uppercase">Own Province</span>
            </th>
            ${colHeaders}
          </tr>
        </thead>
        <tbody>
          ${tableRows}
          ${defRow}
        </tbody>
      </table>
    </div>
  </div>`;
}
