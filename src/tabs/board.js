// ── TAB: BOARD ─────────────────────────────────────────────────────────────
// War board — sortable table of enemy provinces with wave assignment,
// ops panel, raze/massacre tracking, and notes.
// Replaces the old kanban drag-and-drop interface.

// ── Sort state ────────────────────────────────────────────────────────────────
// S.boardSort = { col: 'slot', dir: 1 }

function boardSort(col) {
  if (!S.boardSort) S.boardSort = { col: 'slot', dir: 1 };
  if (S.boardSort.col === col) { S.boardSort.dir *= -1; }
  else { S.boardSort.col = col; S.boardSort.dir = -1; }
  renderBoard();
}

// ── Province plan helpers ─────────────────────────────────────────────────────

/** Get or create the plan entry for a province slot */
function _pp(slot) {
  if (!S.provinces[slot]) {
    S.provinces[slot] = { wave: null, needsRaze: false, needsMassacre: false, requiredOps: [], notes: '' };
  }
  return S.provinces[slot];
}

function setProvWave(slot, wave) {
  _pp(slot).wave = wave || null;
  renderBoard();
  renderSummary();
  renderPlayer();
}

function setProvNeedsRaze(slot, val) {
  _pp(slot).needsRaze = val;
  renderBoard();
}

function setProvNeedsMassacre(slot, val) {
  _pp(slot).needsMassacre = val;
  renderBoard();
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderBoard() {
  renderTab('__wpc_board', _buildBoard);
}

function _buildBoard() {
  if (!S.enemy) return `
    <div class="webar">
      <label>ENEMY:</label>
      <input id="__wpeloc" value="${esc(S.eLoc)}" placeholder="5:3">
      <button class="wb" style="font-size:11px"
        onclick="__wpA.loadEnemy(document.getElementById('__wpeloc').value);__wpA.refresh()">
        LOAD
      </button>
    </div>
    <div class="wload">NO ENEMY LOADED</div>`;

  if (!S.boardSort) S.boardSort = { col: 'slot', dir: 1 };

  // Build row data from enemy provinces
  const rows = S.enemy.provinces.map(p => {
    const sot  = p.sot || {};
    const surv = p.survey;
    const plan = _pp(p.slot);
    const da   = p.calcs?.defPointsSummary?.ageSeconds;
    const ppa  = sot.ppa || 0;
    const popPct = Math.min(Math.round(ppa / 25 * 100), 150); // cap display at 150%
    const nwpa   = p.land > 0 ? Math.round((p.networth || 0) / p.land) : 0;
    const rtpa   = p.land > 0 && sot.rTpa != null ? sot.rTpa
                 : p.land > 0 && sot.thieves != null ? +(sot.thieves / p.land).toFixed(2)
                 : null;
    const castles = surv?.buildings?.find(b => b.name === 'Castles')?.pctTot || null;
    const wt      = surv?.buildings?.find(b => b.name === 'Watch Towers')?.pctTot || null;
    return {
      slot: p.slot, name: p.name, race: p.race || '—',
      nw: p.networth || 0, land: p.land || 0, nwpa,
      popPct, off: sot.offPoints || 0,
      def: p.calcs?.defPointsSummary?.defPointsHome || sot.defPoints || 0,
      rtpa, castles, wt,
      intelAge: da,
      wave:          plan.wave,
      needsRaze:     plan.needsRaze,
      needsMassacre: plan.needsMassacre,
      requiredOps:   plan.requiredOps || [],
      notes:         plan.notes || '',
    };
  });

  // Sort
  const { col, dir } = S.boardSort;
  rows.sort((a, b) => {
    let av = a[col], bv = b[col];
    // Nulls to bottom regardless of sort direction
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') return dir * av.localeCompare(bv);
    return dir * (av - bv);
  });

  // Sort indicator
  const si = c => S.boardSort.col === c
    ? `<span style="color:#D4A017;margin-left:3px;">${S.boardSort.dir === -1 ? '↓' : '↑'}</span>`
    : `<span style="color:#3a2810;margin-left:3px;">⇅</span>`;

  const thStyle = (c, right=false) => `cursor:pointer;user-select:none;white-space:nowrap;padding:8px 10px;
    text-align:${right?'right':'left'};background:#120d04;font-size:9px;font-weight:700;
    letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #4a3010;
    color:${S.boardSort.col===c?'#D4A017':'#7a5a2a'};`;

  const th  = (c, l, right=false) => `<th onclick="__wpA.boardSort('${c}')" style="${thStyle(c,right)}">${l}${si(c)}</th>`;
  const thS = (l) => `<th style="${thStyle('',false)}color:#7a5a2a;">${l}</th>`; // static header

  // Wave badge colours
  const waveBadge = (wave) => {
    if (wave === 'current') return `<span style="background:rgba(224,80,80,.15);color:#E05050;border:1px solid #8B1414;font-size:9px;padding:2px 7px;border-radius:2px;white-space:nowrap;">Current Wave</span>`;
    if (wave === 'preplan') return `<span style="background:rgba(212,160,23,.12);color:#D4A017;border:1px solid #8B6914;font-size:9px;padding:2px 7px;border-radius:2px;white-space:nowrap;">Pre-Plan</span>`;
    return `<span style="color:#3a2810;font-size:10px;">—</span>`;
  };

  const isLeader = S.role === 'leader';

  const tableRows = rows.map(r => {
    const ageCol = r.intelAge == null ? '#3a2810'
                 : r.intelAge < 3600  ? '#60C040'
                 : r.intelAge < 14400 ? '#D4A017'
                 : r.intelAge < 28800 ? '#e09040' : '#E05050';

    const popCol = r.popPct >= 100 ? '#60C040' : r.popPct >= 75 ? '#D4A017' : '#E05050';

    const waveSelect = isLeader ? `
      <select onchange="__wpA.setProvWave(${r.slot},this.value)"
        style="background:#120d04;border:1px solid #3a2810;color:#c8a060;font-size:11px;
               padding:3px 6px;border-radius:3px;outline:none;cursor:pointer;max-width:110px;">
        <option value="" ${!r.wave?'selected':''}>—</option>
        <option value="current" ${r.wave==='current'?'selected':''}>Current Wave</option>
        <option value="preplan" ${r.wave==='preplan'?'selected':''}>Pre-Plan</option>
      </select>` : waveBadge(r.wave);

    const razeCheck = isLeader
      ? `<input type="checkbox" ${r.needsRaze?'checked':''} onchange="__wpA.setProvNeedsRaze(${r.slot},this.checked)"
           style="cursor:pointer;width:14px;height:14px;accent-color:#D4A017;">`
      : r.needsRaze ? '✓' : '—';

    const massCheck = isLeader
      ? `<input type="checkbox" ${r.needsMassacre?'checked':''} onchange="__wpA.setProvNeedsMassacre(${r.slot},this.checked)"
           style="cursor:pointer;width:14px;height:14px;accent-color:#D4A017;">`
      : r.needsMassacre ? '✓' : '—';

    const opTags = r.requiredOps.length
      ? r.requiredOps.map(o => `<span class="wtag" style="cursor:default;font-size:9px;">${o}</span>`).join('')
      : '';

    return `<tr style="border-bottom:1px solid #2a1a08;${r.wave==='current'?'background:rgba(224,80,80,.04);':r.wave==='preplan'?'background:rgba(212,160,23,.03);':''}"
      onmouseover="this.style.background='#1a1208'" onmouseout="this.style.background='${r.wave==='current'?'rgba(224,80,80,.04)':r.wave==='preplan'?'rgba(212,160,23,.03)':''}'">
      <td style="padding:7px 10px;font-weight:700;color:#c8a060;">${r.slot}</td>
      <td style="padding:7px 10px;color:#c8a060;font-weight:500;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        <span onclick="__wpA.openOps(${r.slot})" style="cursor:pointer;" title="Click to assign ops">${esc(r.name)}</span>
        ${opTags ? `<div style="margin-top:2px;">${opTags}</div>` : ''}
        ${r.notes ? `<div style="font-size:10px;color:#7a5a2a;font-style:italic;margin-top:1px;">${esc(r.notes.substring(0,40))}${r.notes.length>40?'…':''}</div>` : ''}
      </td>
      <td style="padding:7px 10px;color:#7a5a2a;font-size:11px;">${esc(r.race)}</td>
      <td style="padding:7px 10px;text-align:right;">${fK(r.nw)}</td>
      <td style="padding:7px 10px;text-align:right;">${fK(r.land)}</td>
      <td style="padding:7px 10px;text-align:right;">${fK(r.nwpa)}</td>
      <td style="padding:7px 10px;text-align:right;color:${popCol};font-weight:600;">${r.popPct}%</td>
      <td style="padding:7px 10px;text-align:right;">${fK(r.off)}</td>
      <td style="padding:7px 10px;text-align:right;">${fK(r.def)}</td>
      <td style="padding:7px 10px;text-align:right;">${r.rtpa != null ? r.rtpa.toFixed(2) : '—'}</td>
      <td style="padding:7px 10px;text-align:right;">${r.castles != null ? r.castles.toFixed(1)+'%' : '—'}</td>
      <td style="padding:7px 10px;text-align:right;">${r.wt != null ? r.wt.toFixed(1)+'%' : '—'}</td>
      <td style="padding:7px 10px;text-align:right;font-size:10px;color:${ageCol};">${r.intelAge != null ? fA(r.intelAge) : '—'}</td>
      <td style="padding:7px 10px;text-align:center;">${waveSelect}</td>
      <td style="padding:7px 10px;text-align:center;color:${r.needsRaze?'#D4A017':'#7a5a2a'};">${razeCheck}</td>
      <td style="padding:7px 10px;text-align:center;color:${r.needsMassacre?'#D4A017':'#7a5a2a'};">${massCheck}</td>
    </tr>`;
  }).join('');

  // Summary row
  const assigned = rows.filter(r => r.wave === 'current').length;
  const preplanned = rows.filter(r => r.wave === 'preplan').length;

  const enemyBar = `
    <div class="webar">
      <label>ENEMY:</label>
      <input id="__wpeloc" value="${esc(S.eLoc)}" placeholder="5:3">
      <button class="wb" style="font-size:11px"
        onclick="__wpA.loadEnemy(document.getElementById('__wpeloc').value);__wpA.refresh()">
        LOAD
      </button>
      <div style="color:#D4A017;font-weight:700;font-size:13px">${esc(S.enemy?.kingdomName || '—')}</div>
      <div style="font-size:11px;color:#7a5a2a;margin-left:auto">
        ${rows.length} provinces ·
        <span style="color:#E05050;">${assigned} current wave</span> ·
        <span style="color:#D4A017;">${preplanned} pre-plan</span>
      </div>
    </div>`;

  const table = `
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;background:#1a1208;border:1px solid #3a2810;border-radius:4px;overflow:hidden;">
        <thead><tr>
          ${th('slot','#')}
          ${th('name','Province')}
          ${th('race','Race')}
          ${th('nw','NW',true)}
          ${th('land','Acres',true)}
          ${th('nwpa','NW/Ac',true)}
          ${th('popPct','Pop%',true)}
          ${th('off','Off',true)}
          ${th('def','Def',true)}
          ${th('rtpa','rTPA',true)}
          ${th('castles','Castle%',true)}
          ${th('wt','WT%',true)}
          ${th('intelAge','Intel',true)}
          ${thS('Wave')}
          ${thS('Raze')}
          ${thS('Mass.')}
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`;

  return enemyBar + table + _buildOpsPanel();
}

// ── Ops panel (modal overlay) ──────────────────────────────────────────────────

function _buildOpsPanel() {
  return `<div class="wops" id="__wpops"></div>`;
}

function openOps(slot) {
  S.openSlot = slot;
  const p    = S.enemy?.provinces?.find(p => p.slot === slot);
  const plan = _pp(slot);
  const ops  = plan.requiredOps || [];
  const sot  = p?.sot || {};
  const da   = p?.calcs?.defPointsSummary?.ageSeconds;

  const html = `
    <div class="wopsh">
      <h3>// OPS — Slot ${slot}</h3>
      <button onclick="__wpA.closeOps()" style="background:none;border:none;color:#7a5a2a;cursor:pointer;font-size:16px">✕</button>
    </div>
    <div class="wopsb">
      <div style="font-size:15px;font-weight:700;margin-bottom:3px;color:#c8a060;">${esc(p?.name || 'Unknown')}</div>
      <div style="font-size:10px;color:#7a5a2a;margin-bottom:12px;">
        ${esc(p?.race || '')} · ${esc(sot.personality || '')} · Slot ${slot}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">
        <div class="wsb"><div class="l">OPA</div><div class="v">${sot.opa || '—'}</div></div>
        <div class="wsb"><div class="l">DPA</div><div class="v">${sot.dpa || '—'}</div></div>
        <div class="wsb"><div class="l">Def Home</div><div class="v">${fK(p?.calcs?.defPointsSummary?.defPointsHome)}</div></div>
        <div class="wsb"><div class="l">Intel Age</div><div class="v"><span class="${aC(da)}">${fA(da)}</span></div></div>
      </div>
      ${sot.badSpells?.length ? `<div style="font-size:10px;color:#E05050;margin-bottom:8px;">⚠ ${sot.badSpells.map(s=>s.name).join(', ')}</div>` : ''}
      ${p?.som?.armiesAway?.length ? `<div style="font-size:10px;color:#60C040;margin-bottom:8px;">↗ Army away — ${fA(p.som.armiesAway[0].secondsRemaining)} to return</div>` : ''}
      <div class="wopsec">Duration Ops</div>
      <div class="wopsg">
        ${DOPS.map(o => `<div class="wop${ops.includes(o.c)?' sel':''}" onclick="__wpA.togOp(${slot},'${o.c}')" title="${esc(o.l)}">${esc(o.c)}</div>`).join('')}
      </div>
      <div class="wopsec">Instant Ops</div>
      <div class="wopsg">
        ${IOPS.map(o => `<div class="wop i${ops.includes(o.c)?' sel':''}" onclick="__wpA.togOp(${slot},'${o.c}')" title="${esc(o.l)}">${esc(o.c)}</div>`).join('')}
      </div>
      <div class="wopsec">Notes</div>
      <textarea style="width:100%;background:#120d04;border:1px solid #3a2810;color:#c8a060;font-size:11px;padding:6px;border-radius:2px;resize:vertical;min-height:60px;outline:none;"
        onblur="__wpA.setNote(${slot},this.value)">${esc(plan.notes || '')}</textarea>
    </div>`;

  const panel = $id('__wpops');
  if (panel) { panel.innerHTML = html; panel.classList.add('open'); }
}

function closeOps() {
  const panel = $id('__wpops');
  if (panel) panel.classList.remove('open');
  S.openSlot = null;
}

function togOp(slot, c) {
  const plan = _pp(slot);
  if (!plan.requiredOps) plan.requiredOps = [];
  const idx = plan.requiredOps.indexOf(c);
  if (idx >= 0) plan.requiredOps.splice(idx, 1);
  else          plan.requiredOps.push(c);
  // Update button state in panel without full re-render
  document.querySelectorAll('#__wpops .wop').forEach(btn => {
    const bc = btn.getAttribute('onclick')?.match(/,'([^']+)'\)/)?.[1];
    if (bc) btn.classList.toggle('sel', plan.requiredOps.includes(bc));
  });
  renderBoard();
}

function setNote(slot, v) {
  _pp(slot).notes = v;
}

/** Legacy: seed from old kanban cols format on first load */
function initCols() {
  if (!S.enemy) return;
  // If we have old kanban data, migrate it
  if (S.cols?.length > 0) {
    S.cols.forEach((col, ci) => {
      col.items?.forEach(item => {
        const slot = parseInt((item.province.slot + '').replace(/\[|\]/g, ''));
        if (!slot) return;
        const plan = _pp(slot);
        if (ci > 0 && !plan.wave) plan.wave = ci === 1 ? 'current' : 'preplan';
        if (item.province.requiredOps?.length) plan.requiredOps = item.province.requiredOps;
        if (item.province.notes) plan.notes = item.province.notes;
      });
    });
    S.cols = []; // clear legacy data
  }
  // Ensure all enemy provinces have a plan entry
  S.enemy.provinces.forEach(p => _pp(p.slot));
}

// ── Legacy stubs (kept so old save format doesn't crash) ────────────────────
function boardDragStart() {}
function boardDrop() {}
function addCol() {}
function delCol() {}
function rmOp(ci, ii, c) {
  // Legacy — find by position in old cols
  const item = S.cols[ci]?.items[ii];
  if (!item) return;
  const slot = parseInt((item.province.slot+'').replace(/\[|\]/g,''));
  const ops  = _pp(slot).requiredOps || [];
  const i    = ops.indexOf(c);
  if (i >= 0) ops.splice(i, 1);
  renderBoard();
}
