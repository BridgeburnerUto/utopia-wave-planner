// ── TAB: BOARD ─────────────────────────────────────────────────────────────
// Kanban war board. Drag provinces into wave columns, assign ops.
// All functions that modify S.cols call renderBoard() to keep display in sync.

function renderBoard() {
  renderTab('__wpc_board', _buildBoard);
  // Restore enemy stats text if enemy is loaded
  if (S.enemy) {
    const tl = S.enemy.provinces.reduce((s, p) => s + (p.land || 0), 0);
    const es = $id('__wpestats');
    if (es) es.textContent = `${S.enemy.provinces.length} provs · ${fK(tl)} land`;
  }
}

function _buildBoard() {
  const enemyBar = `
    <div class="webar">
      <label>ENEMY:</label>
      <input id="__wpeloc" value="${esc(S.eLoc)}" placeholder="5:3">
      <button class="wb" style="font-size:11px"
        onclick="__wpA.loadEnemy($id('__wpeloc').value);__wpA.initCols();renderBoard();renderAlerts();renderSummary();renderPlayer()">
        LOAD
      </button>
      <div style="color:#00d4ff;font-weight:700;font-size:13px">${esc(S.enemy?.kingdomName || '—')}</div>
      <div style="font-size:11px;color:#4a6a88;margin-left:auto" id="__wpestats"></div>
    </div>`;

  let board = '<div class="weboard">';
  S.cols.forEach((col, ci) => {
    const ua = ci === 0; // Unassigned column is always index 0
    board += `
      <div class="wcol"
        ondragover="event.preventDefault();$id('__wpcb${ci}').classList.add('dov')"
        ondragleave="$id('__wpcb${ci}').classList.remove('dov')"
        ondrop="__wpA.drop(event,${ci})">
        <div class="wcolh">
          <input class="${ua ? 'ua' : ''}" value="${esc(col.title)}" ${ua ? 'readonly' : ''}
            onchange="S.cols[${ci}].title=this.value">
          <span class="wcnt">${col.items.length}</span>
          ${!ua ? `<button class="wdel" onclick="__wpA.delCol(${ci})">✕</button>` : ''}
        </div>
        <div class="wcolb" id="__wpcb${ci}">
          ${col.items.map((item, ii) => _buildCard(item, ci, ii)).join('')}
        </div>
      </div>`;
  });
  board += '<div class="waddcol" onclick="__wpA.addCol()">+</div></div>';

  return enemyBar + board;
}

function _buildCard(item, ci, ii) {
  const p   = pd(item.province.slot);
  const def = p?.calcs?.defPointsSummary?.defPointsHome || 0;
  const da  = p?.calcs?.defPointsSummary?.ageSeconds;
  const away = p?.som?.armiesAway?.length > 0;
  const ops  = item.province.requiredOps || [];

  return `
    <div class="wcard${ops.length ? ' hop' : ''}" draggable="true"
      ondragstart="__wpA.ds(event,${ci},${ii})"
      ondragend="this.classList.remove('wdrag')"
      onclick="__wpA.openOps(${ci},${ii})">
      <div class="wct">
        <div class="wcn">${esc(item.province.name)}</div>
        <div class="wcr">${esc(item.province.race || '')}</div>
      </div>
      <div class="wcs">
        ${def ? `<span class="def">${fK(def)}</span>` : ''}
        ${away ? '<span class="away">↗away</span>' : ''}
        ${da != null ? `<span class="${aC(da)}">${fA(da)}</span>` : ''}
      </div>
      ${ops.length ? `<div style="margin-top:4px">${ops.map(o =>
        `<span class="wtag" onclick="event.stopPropagation();__wpA.rmOp(${ci},${ii},'${o}')">${o}</span>`
      ).join('')}</div>` : ''}
    </div>`;
}

// ── Drag & drop ──
function boardDragStart(e, ci, ii) {
  S.drag = { ci, ii };
  e.currentTarget.classList.add('wdrag');
  e.dataTransfer.effectAllowed = 'move';
}

function boardDrop(e, ci) {
  e.preventDefault();
  $id('__wpcb' + ci)?.classList.remove('dov');
  if (!S.drag || S.drag.ci === ci) return;
  const item = S.cols[S.drag.ci].items.splice(S.drag.ii, 1)[0];
  S.cols[ci].items.push(item);
  S.drag = null;
  renderBoard();
  renderSummary();
}

// ── Column management ──
function addCol() {
  S.cols.push({ title: 'Wave ' + S.cols.length, items: [] });
  renderBoard();
}

function delCol(ci) {
  // Return items to unassigned before deleting
  S.cols[0].items.push(...S.cols[ci].items);
  S.cols.splice(ci, 1);
  renderBoard();
  renderSummary();
}

// ── Ops panel ──
function openOps(ci, ii) {
  S.openSlot = { ci, ii };
  const item = S.cols[ci].items[ii];
  const p    = pd(item.province.slot);
  const ops  = item.province.requiredOps || [];
  const def  = p?.calcs?.defPointsSummary?.defPointsHome;
  const da   = p?.calcs?.defPointsSummary?.ageSeconds;

  const html = `
    <div class="wopsh">
      <h3>// OPS</h3>
      <button onclick="__wpA.closeOps()" style="background:none;border:none;color:#4a6a88;cursor:pointer;font-size:16px">✕</button>
    </div>
    <div class="wopsb">
      <div style="font-size:15px;font-weight:700;margin-bottom:3px">${esc(item.province.name)}</div>
      <div style="font-family:monospace;font-size:10px;color:#4a6a88;margin-bottom:12px">
        ${esc(item.province.race || '')} · ${esc(p?.sot?.personality || '')} · Slot ${esc(item.province.slot)}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">
        <div class="wsb"><div class="l">OPA</div><div class="v">${p?.sot?.opa || '—'}</div></div>
        <div class="wsb"><div class="l">DPA</div><div class="v">${p?.sot?.dpa || '—'}</div></div>
        <div class="wsb"><div class="l">Def Home</div><div class="v">${fK(def)}</div></div>
        <div class="wsb"><div class="l">Intel Age</div><div class="v"><span class="${aC(da)}">${fA(da)}</span></div></div>
      </div>
      ${p?.sot?.badSpells?.length ? `<div style="font-size:10px;color:#ff4455;margin-bottom:8px">⚠ ${p.sot.badSpells.map(s => s.name).join(', ')}</div>` : ''}
      ${p?.som?.armiesAway?.length ? `<div style="font-size:10px;color:#00ff88;margin-bottom:8px">↗ Army away — ${fA(p.som.armiesAway[0].secondsRemaining)} to return</div>` : ''}
      <div class="wopsec">Duration Ops</div>
      <div class="wopsg">
        ${DOPS.map(o => `<div class="wop${ops.includes(o.c) ? ' sel' : ''}" onclick="__wpA.togOp('${o.c}')" title="${esc(o.l)}">${esc(o.c)}</div>`).join('')}
      </div>
      <div class="wopsec">Instant Ops</div>
      <div class="wopsg">
        ${IOPS.map(o => `<div class="wop i${ops.includes(o.c) ? ' sel' : ''}" onclick="__wpA.togOp('${o.c}')" title="${esc(o.l)}">${esc(o.c)}</div>`).join('')}
      </div>
      <div class="wopsec">Notes</div>
      <textarea style="width:100%;background:#151a22;border:1px solid #2a3f55;color:#c8d8e8;font-family:monospace;font-size:10px;padding:6px;border-radius:2px;resize:vertical;min-height:50px;outline:none"
        onchange="__wpA.setNote(this.value)">${esc(item.province.notes || '')}</textarea>
    </div>`;

  $id('__wpops').innerHTML = html;
  $id('__wpops').classList.add('open');
}

function closeOps() {
  $id('__wpops').classList.remove('open');
  S.openSlot = null;
}

function togOp(c) {
  if (!S.openSlot) return;
  const { ci, ii } = S.openSlot;
  const item = S.cols[ci].items[ii];
  if (!item.province.requiredOps) item.province.requiredOps = [];
  const idx = item.province.requiredOps.indexOf(c);
  if (idx >= 0) item.province.requiredOps.splice(idx, 1);
  else          item.province.requiredOps.push(c);
  // Update button state in the already-open panel without full re-render
  document.querySelectorAll('#__wpops .wop').forEach(btn => {
    const bc = btn.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
    if (bc) btn.classList.toggle('sel', item.province.requiredOps.includes(bc));
  });
  renderBoard();
}

function rmOp(ci, ii, c) {
  const ops = S.cols[ci].items[ii].province.requiredOps || [];
  const i   = ops.indexOf(c);
  if (i >= 0) ops.splice(i, 1);
  renderBoard();
}

function setNote(v) {
  if (S.openSlot) S.cols[S.openSlot.ci].items[S.openSlot.ii].province.notes = v;
}

/** Seed initial columns from the loaded enemy kingdom */
function initCols() {
  if (!S.enemy) return;
  S.cols = [
    {
      title: 'Unassigned',
      items: S.enemy.provinces.map(p => ({
        id: Math.random().toString(36).slice(2),
        province: { id: p.id, name: p.name, race: p.race, slot: '[' + p.slot + ']' },
      })),
    },
    { title: 'Wave 1', items: [] },
    { title: 'Wave 2', items: [] },
  ];
}
