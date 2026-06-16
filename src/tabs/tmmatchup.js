// ── TAB: T/M MATCHUP ─────────────────────────────────────────────────────────
// Grid of own T/M provinces (rows) vs enemy provinces (columns).
// Op selector buttons change colour thresholds; NW indicator shows gains range.

// ── Op config ────────────────────────────────────────────────────────────────
// high: ratio for green (great); acceptable: ratio for yellow; below = red.
// null high means no "great" tier — acceptable is the top colour (yellow).
const TM_OPS = [
  // ── Standard thievery ops ──────────────────────────────────────────────────
  { id: 'ns',         label: 'Nightstrike',      high: 3.0, acceptable: 2.0, type: 'tpa' },
  { id: 'kidnap',     label: 'Kidnap',           high: 3.0, acceptable: 2.0, type: 'tpa' },
  { id: 'riots',      label: 'Incite Riots',     high: null, acceptable: 3.0, type: 'tpa' },
  { id: 'rob_gran',   label: 'Rob Granaries',    high: 2.0, acceptable: 1.0, type: 'tpa' },
  { id: 'rob_tow',    label: 'Rob Towers',       high: 2.0, acceptable: 1.0, type: 'tpa' },
  { id: 'rob_vault',  label: 'Rob Vault',        high: 2.0, acceptable: 1.0, type: 'tpa' },
  { id: 'sab_wiz',    label: 'Sabotage Wizards', high: null, acceptable: 2.0, type: 'tpa' },
  { id: 'arson',      label: 'Arson',            high: null, acceptable: 3.0, type: 'tpa' },
  { id: 'bribe_gen',  label: 'Bribe Generals',   high: null, acceptable: 1.0, type: 'tpa' },
  { id: 'bribe_thi',  label: 'Bribe Thieves',    high: null, acceptable: 1.0, type: 'tpa' },
  { id: 'free_pris',  label: 'Free Prisoners',   high: null, acceptable: 2.0, type: 'tpa', note: 'low use' },
  // ── Rogue-only ops ────────────────────────────────────────────────────────
  { id: 'propaganda', label: 'Propaganda',       high: 3.0, acceptable: 2.0, type: 'tpa', rogue: true },
  { id: 'g_arson',    label: 'Greater Arson',    high: 2.0, acceptable: null, type: 'tpa', rogue: true },
  { id: 'ass_wiz',    label: 'Assassinate Wiz',  high: null, acceptable: 3.0, type: 'tpa', rogue: true },
  { id: 'steal_hors', label: 'Steal Horses',     high: 2.0, acceptable: null, type: 'tpa', rogue: true },
  // ── Magic (WPA) ───────────────────────────────────────────────────────────
  { id: 'spells',     label: 'Spells (general)', high: 2.0, acceptable: 1.0, type: 'wpa' },
];

const TM_OP_MAP = Object.fromEntries(TM_OPS.map(o => [o.id, o]));

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

  const activeId = S.tmMatchupOp || 'ns';
  const activeOp = TM_OP_MAP[activeId] || TM_OPS[0];
  const showAll  = S.tmMatchupShowAll || false;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function _oTpa(p) { return p?.calcs?.modOffTpa ?? null; }
  function _dTpa(p) { return p?.calcs?.modDefTpa ?? null; }
  function _oWpa(p) { return p?.calcs?.modOffWpa ?? null; }
  function _dWpa(p) { return p?.calcs?.modDefWpa ?? null; }

  function _ratio(op, ownP, enemyP) {
    if (op.type === 'wpa') {
      const o = _oWpa(ownP), d = _dWpa(enemyP);
      return (o != null && d != null && d > 0) ? o / d : null;
    }
    const o = _oTpa(ownP), d = _dTpa(enemyP);
    return (o != null && d != null && d > 0) ? o / d : null;
  }

  function _ratioCol(ratio, op) {
    if (ratio == null) return '#555';
    if (op.high      != null && ratio >= op.high)       return '#5fcf9f'; // great
    if (op.acceptable != null && ratio >= op.acceptable) return '#c8c03a'; // acceptable
    if (op.high      != null && op.acceptable == null && ratio >= op.high) return '#5fcf9f';
    return '#b94040'; // risky
  }

  function _ratioLabel(op) {
    const parts = [];
    if (op.high)       parts.push(`≥${op.high}:1 <span style="color:#5fcf9f">great</span>`);
    if (op.acceptable) parts.push(`≥${op.acceptable}:1 <span style="color:#c8c03a">acceptable</span>`);
    parts.push(`<span style="color:#b94040">below = risky</span>`);
    return parts.join(' &nbsp;·&nbsp; ');
  }

  // RPNW band
  function _nwBand(ownNw, enemyNw) {
    if (!ownNw || !enemyNw) return { label: '?', col: '#555' };
    const r = enemyNw / ownNw;
    if (r < 0.567)  return { label: '✗', col: '#b94040' };
    if (r < 0.9)    return { label: '↓', col: '#c8843a' };
    if (r <= 1.1)   return { label: '✓', col: '#5fcf9f' };
    if (r <= 1.6)   return { label: '↑', col: '#c8c03a' };
    return                  { label: '✗', col: '#b94040' };
  }

  function _fmt(v) { return v != null ? v.toFixed(2) : '—'; }

  // Own province filter — T/M = meaningful TPA or WPA
  function _isTm(p) {
    return (_oTpa(p) != null && _oTpa(p) > 0.5) || (_oWpa(p) != null && _oWpa(p) > 0.5);
  }
  const rows = showAll ? ownProvs : ownProvs.filter(_isTm);

  // ── Op selector ───────────────────────────────────────────────────────────────
  function _opBtn(op) {
    const active = op.id === activeId;
    const isWpa  = op.type === 'wpa';
    const style  = active
      ? 'border-color:#5fcf9f;color:#5fcf9f;background:#0a2020;'
      : isWpa ? 'border-color:#7a5f9f;color:#a080c0;' : '';
    const noteStr = op.note ? ` <span style="font-size:10px;opacity:.6">(${op.note})</span>` : '';
    const rogueStr = op.rogue ? ' <span style="font-size:10px;color:#c8843a">R</span>' : '';
    return `<button class="wb" style="font-size:12px;padding:3px 8px;${style}"
      onclick="__wpA.tmMatchupSetOp('${op.id}')">${esc(op.label)}${rogueStr}${noteStr}</button>`;
  }

  const stdOps   = TM_OPS.filter(o => o.type === 'tpa' && !o.rogue);
  const rogueOps = TM_OPS.filter(o => o.rogue);
  const wpaOps   = TM_OPS.filter(o => o.type === 'wpa');

  const opSelector = `
    <div style="margin-bottom:12px;">
      <div style="font-size:11px;color:#7a9090;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">Standard ops</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;">${stdOps.map(_opBtn).join('')}</div>
      <div style="font-size:11px;color:#c8843a;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">Rogue-only <span style="color:#7a9090;font-size:10px">(R)</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;">${rogueOps.map(_opBtn).join('')}</div>
      <div style="font-size:11px;color:#a080c0;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">Magic</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;">${wpaOps.map(_opBtn).join('')}</div>
    </div>`;

  // ── Grid ─────────────────────────────────────────────────────────────────────

  const colKey  = activeOp.type === 'wpa' ? 'WPA' : 'TPA';

  const colHeaders = enemyProvs.map(ep => `
    <th style="padding:6px 8px;font-size:13px;color:#9ab;white-space:nowrap;border-bottom:1px solid #2a3a3a;min-width:90px;">
      <div style="font-weight:700;color:#cde">${esc(ep.name || '?')}</div>
      <div style="color:#7a9090;font-size:11px">${ep.race ? esc(ep.race) : ''} · ${fK(ep.networth||0)} NW</div>
      <div style="font-size:11px;color:#9ab;margin-top:2px;">
        def ${colKey}: <b style="color:#cde">${activeOp.type === 'wpa' ? _fmt(_dWpa(ep)) : _fmt(_dTpa(ep))}</b>
      </div>
    </th>`).join('');

  const tableRows = rows.map(op => {
    const ownNw  = op.networth || 0;
    const ownVal = activeOp.type === 'wpa' ? _oWpa(op) : _oTpa(op);

    const cells = enemyProvs.map(ep => {
      const ratio = _ratio(activeOp, op, ep);
      const col   = _ratioCol(ratio, activeOp);
      const nw    = _nwBand(ownNw, ep.networth || 0);
      const rpnw  = ownNw && ep.networth ? (ep.networth / ownNw).toFixed(2) : '?';

      return `<td style="padding:6px 8px;text-align:center;border-bottom:1px solid #1a2a2a;border-right:1px solid #1a2a2a;">
        <div style="font-size:15px;font-weight:700;color:${col}">${ratio != null ? ratio.toFixed(1) : '—'}</div>
        <div style="font-size:11px;font-weight:700;color:${nw.col};margin-top:2px" title="RPNW ${rpnw}">
          ${nw.label} NW
        </div>
      </td>`;
    }).join('');

    return `<tr>
      <td style="padding:6px 10px;white-space:nowrap;border-bottom:1px solid #1a2a2a;border-right:2px solid #2a4a4a;position:sticky;left:0;background:#0e1a1a;z-index:1;">
        <div style="font-weight:700;color:#cde;font-size:14px">${esc(op.name || '?')}</div>
        <div style="font-size:11px;color:#7a9090">${op.race ? esc(op.race) : ''} · ${fK(ownNw)} NW</div>
        <div style="font-size:12px;color:#9ab;margin-top:2px;">
          off ${colKey}: <b style="color:#cde">${_fmt(ownVal)}</b>
        </div>
      </td>
      ${cells}
    </tr>`;
  }).join('');

  const toggleLabel = showAll ? 'Show T/M only' : 'Show all own';

  return `<div class="wsech" style="padding-bottom:20px;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
      <div class="wthr-title" style="margin:0">T/M Matchup</div>
      <button class="wb" onclick="__wpA.tmMatchupToggle()" style="font-size:13px;padding:3px 10px;">${toggleLabel}</button>
    </div>

    ${opSelector}

    <div style="font-size:13px;color:#7a9090;margin-bottom:8px;">
      <b style="color:#cde">${esc(activeOp.label)}</b>
      ${activeOp.rogue ? '<span style="color:#c8843a"> · Rogue only</span>' : ''}
      &nbsp;·&nbsp; ${_ratioLabel(activeOp)}
      &nbsp;·&nbsp;
      <b style="color:#5fcf9f">✓</b> NW sweet spot &nbsp;
      <b style="color:#c8c03a">↑↓</b> partial &nbsp;
      <b style="color:#b94040">✗</b> dead zone
    </div>

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
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  </div>`;
}
