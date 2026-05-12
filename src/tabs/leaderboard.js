// ── TAB: LEADERBOARD ───────────────────────────────────────────────────────

// ── Date helpers ────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  '','January','February','March','April','May','June',
  'July','August','September','October','November','December'
];
const MONTH_MAP = Object.fromEntries(MONTH_NAMES.slice(1).map((m,i) => [m.toLowerCase(), i+1]));

/** Parse "February 21, YR1" or "July 18, YR1" → {month, day, year} or null */
function _parseUtoDate(s) {
  if (!s) return null;
  const m = s.match(/(\w+)\s+(\d+),?\s+YR(\d+)/i);
  if (!m) return null;
  const month = MONTH_MAP[m[1].toLowerCase()];
  if (!month) return null;
  return { month, day: parseInt(m[2]), year: parseInt(m[3]) };
}

/** Convert {year, month} to a single sortable integer: year*100 + month */
function _ym(year, month) { return (year || 0) * 100 + (month || 0); }

/** Get war period from IS kingdomNews as {fromYear, fromMonth, toYear, toMonth} or null */
function _getWarPeriod() {
  try {
    const IS   = JSON.parse(localStorage.getItem('IntelState') || '{}');
    const news = IS.kingdomNews;
    if (!news?.startDate || !news?.endDate) return null;
    const s = news.startDate, e = news.endDate;
    // kingdomNews dates have {year, month, day} directly as integers
    if (!s.year || !s.month) return null;
    return { fromYear: s.year, fromMonth: s.month, toYear: e.year, toMonth: e.month,
             fromLabel: s.fullDateString || '', toLabel: e.fullDateString || '' };
  } catch(e) { return null; }
}

// ── Filter state helpers ─────────────────────────────────────────────────────

function lbView(v) { S.lbView = v; renderLeaderboard(); }

function lbSetFilter(mode, opts) {
  S.lbFilter = { mode, ...opts };
  renderLeaderboard();
}

/** Apply current filter to raw ops array */
function _filterOps(ops) {
  const f = S.lbFilter;
  if (f.mode === 'all') return ops;

  const from = f.fromYear ? _ym(f.fromYear, f.fromMonth || 1) : 0;
  const to   = f.toYear   ? _ym(f.toYear,   f.toMonth   || 12) : 999999;

  return ops.filter(op => {
    const ym = _ym(op.utoYear || 0, op.utoMonth || 0);
    // Fall back to parsing utoDate string if numeric fields not stored yet
    if (!op.utoYear && op.utoDate) {
      const d = _parseUtoDate(op.utoDate);
      if (d) return _ym(d.year, d.month) >= from && _ym(d.year, d.month) <= to;
    }
    return ym >= from && ym <= to;
  });
}

// ── Render ───────────────────────────────────────────────────────────────────

async function renderLeaderboard() {
  const el = $id('__wpc_leaderboard');
  el.innerHTML = loadingHTML('LOADING LEADERBOARD...');
  try {
    const kdId = S.own?.location.replace(':', '_');
    const allOps = await fbQuery('ops', [{ field: 'kingdomId', value: kdId }]);
    if (!allOps.length) {
      el.innerHTML = `<div style="color:#4a6a88;font-family:monospace;font-size:12px;padding:20px 0">
        // No op data yet — data accumulates automatically as players use the tool during war.
      </div>`;
      return;
    }
    el.innerHTML = _buildLeaderboard(allOps);
  } catch (e) {
    el.innerHTML = `<div style="color:#ff4455;font-family:monospace;font-size:12px;padding:20px 0">
      Error loading leaderboard: ${esc(e.message)}
    </div>`;
  }
}

function _buildLeaderboard(allOps) {
  const warPeriod = _getWarPeriod();
  const ops       = _filterOps(allOps);
  const f         = S.lbFilter;

  // ── Filter bar ──────────────────────────────────────────────────────────
  const filterBar = _buildFilterBar(f, warPeriod, allOps.length, ops.length);

  if (!ops.length) {
    return filterBar + `<div style="color:#4a6a88;font-family:monospace;font-size:12px;padding:20px 0">
      // No ops match the selected period.
    </div>`;
  }

  // ── Aggregate ───────────────────────────────────────────────────────────
  const byProv = {};
  ops.forEach(op => {
    if (!op.provinceName) return;
    if (!byProv[op.provinceName]) byProv[op.provinceName] = {
      name: op.provinceName, totalOps: 0, successOps: 0,
      totalDamage: 0, totalGain: 0, opCounts: {}, opNames: {}, lastSeen: '',
    };
    const p = byProv[op.provinceName];
    p.totalOps++;
    if (op.success) p.successOps++;
    p.totalDamage += (op.damage || 0);
    p.totalGain   += (op.gain   || 0);
    p.opCounts[op.opType] = (p.opCounts[op.opType] || 0) + 1;
    if (op.opName) p.opNames[op.opType] = op.opName;
    if (!p.lastSeen || op.utoDate > p.lastSeen) p.lastSeen = op.utoDate;
  });

  const sorted     = Object.values(byProv).sort((a, b) => b.totalDamage - a.totalDamage);
  const totalDmg   = sorted.reduce((s, p) => s + p.totalDamage, 0);
  const totalOps   = sorted.reduce((s, p) => s + p.totalOps, 0);
  const maxDmg     = sorted[0]?.totalDamage || 1;
  const successPct = totalOps > 0 ? Math.round(sorted.reduce((s, p) => s + p.successOps, 0) / totalOps * 100) : 0;

  const viewSorted = S.lbView === 'ops'  ? [...sorted].sort((a, b) => b.totalOps - a.totalOps)
                   : S.lbView === 'gain' ? [...sorted].sort((a, b) => b.totalGain - a.totalGain)
                   : sorted;

  // ── Sort/view toggle ────────────────────────────────────────────────────
  const viewToggle = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-family:monospace;font-size:10px;color:#4a6a88;letter-spacing:2px;text-transform:uppercase">
        ${ops.length} ops · ${sorted.length} provinces
      </div>
      <div style="display:flex;gap:6px">
        <button class="wb${S.lbView==='damage'?' g':''}" onclick="__wpA.lbView('damage')" style="font-size:10px;padding:3px 9px">Damage</button>
        <button class="wb${S.lbView==='ops'   ?' g':''}" onclick="__wpA.lbView('ops')"    style="font-size:10px;padding:3px 9px">Op Count</button>
        <button class="wb${S.lbView==='gain'  ?' g':''}" onclick="__wpA.lbView('gain')"   style="font-size:10px;padding:3px 9px">Gain</button>
      </div>
    </div>`;

  // ── Summary cards ───────────────────────────────────────────────────────
  const summaryCards = `
    <div class="wsum" style="margin-bottom:16px">
      <div class="wscard"><div class="l">Total Ops</div><div class="v">${fK(totalOps)}</div></div>
      <div class="wscard"><div class="l">Total Damage</div><div class="v">${fK(totalDmg)}</div></div>
      <div class="wscard"><div class="l">Provinces</div><div class="v">${sorted.length}</div></div>
      <div class="wscard"><div class="l">Success Rate</div><div class="v">${successPct}%</div></div>
    </div>`;

  // ── Province rows ───────────────────────────────────────────────────────
  const provRows = viewSorted.map((p, i) => {
    const pct     = p.totalOps > 0 ? Math.round(p.successOps / p.totalOps * 100) : 0;
    const topOp   = Object.entries(p.opCounts).sort((a, b) => b[1] - a[1])[0];
    const topName = topOp ? (p.opNames[topOp[0]] || topOp[0]) : '';
    const barW    = Math.round(p.totalDamage / maxDmg * 100);
    const medal   = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1);
    const pctCol  = pct >= 70 ? '#00ff88' : pct >= 50 ? '#ffaa00' : '#ff4455';
    return `<tr>
      <td style="font-family:monospace;font-size:12px">${medal}</td>
      <td style="font-weight:700">${esc(p.name)}</td>
      <td style="text-align:right;font-family:monospace">
        ${fK(p.totalDamage)}
        <div style="height:3px;background:#1e2d3d;border-radius:2px;margin-top:2px">
          <div style="height:100%;width:${barW}%;background:#00d4ff;border-radius:2px"></div>
        </div>
      </td>
      <td style="text-align:right;font-family:monospace">${p.totalOps}</td>
      <td style="text-align:right;font-family:monospace;color:${pctCol}">${pct}%</td>
      <td style="text-align:right;font-family:monospace">${fK(p.totalGain)}</td>
      <td><span class="wtag" style="cursor:default;font-size:9px">${topName}${topOp?' ×'+topOp[1]:''}</span></td>
      <td style="font-family:monospace;font-size:10px;color:#4a6a88">${esc(p.lastSeen || '')}</td>
    </tr>`;
  }).join('');

  const mainTable = `
    <table class="wtbl">
      <thead><tr>
        <th style="width:24px">#</th><th>Province</th>
        <th style="text-align:right">Damage</th><th style="text-align:right">Ops</th>
        <th style="text-align:right">Success%</th><th style="text-align:right">Gain</th>
        <th>Top Op</th><th>Last seen</th>
      </tr></thead>
      <tbody>${provRows}</tbody>
    </table>`;

  // ── Op breakdown ────────────────────────────────────────────────────────
  const byOp = {};
  ops.forEach(op => {
    if (!byOp[op.opType]) byOp[op.opType] = {
      count: 0, damage: 0, gain: 0,
      opName: op.opName || op.opType,
      category: op.category || (OP_SETS.THIEF_SAB.has(op.opType) ? 'thief_sabotage' : 'magic_offensive'),
    };
    byOp[op.opType].count++;
    byOp[op.opType].damage += op.damage || 0;
    byOp[op.opType].gain   += op.gain   || 0;
  });

  const opRows = Object.entries(byOp)
    .sort((a, b) => {
      if (a[1].category !== b[1].category) return a[1].category === 'thief_sabotage' ? -1 : 1;
      return b[1].damage - a[1].damage || b[1].count - a[1].count;
    })
    .map(([code, d]) => {
      const isThief  = d.category === 'thief_sabotage';
      const catLabel = isThief
        ? `<span style="font-family:monospace;font-size:9px;padding:1px 4px;border-radius:2px;background:rgba(0,212,255,.12);color:#00d4ff;border:1px solid rgba(0,212,255,.2)">THIEF</span>`
        : `<span style="font-family:monospace;font-size:9px;padding:1px 4px;border-radius:2px;background:rgba(170,102,255,.12);color:#aa66ff;border:1px solid rgba(170,102,255,.2)">SPELL</span>`;
      return `<tr>
        <td><span class="wtag" style="cursor:default">${esc(code)}</span></td>
        <td style="color:#7a9ab8">${esc(d.opName || code)}</td>
        <td>${catLabel}</td>
        <td style="text-align:right;font-family:monospace">${d.count}</td>
        <td style="text-align:right;font-family:monospace">${fK(d.damage) || '—'}</td>
        <td style="text-align:right;font-family:monospace">${fK(d.gain) || '—'}</td>
      </tr>`;
    }).join('');

  const opTable = `
    <div style="margin-top:20px" class="wsech">Op Breakdown by Type</div>
    <table class="wtbl">
      <thead><tr>
        <th>Op</th><th>Full Name</th><th>Type</th>
        <th style="text-align:right">Count</th>
        <th style="text-align:right">Total Damage</th>
        <th style="text-align:right">Total Gain</th>
      </tr></thead>
      <tbody>${opRows}</tbody>
    </table>`;

  return filterBar + viewToggle + summaryCards + mainTable + opTable;
}

// ── Filter bar HTML ──────────────────────────────────────────────────────────

function _buildFilterBar(f, warPeriod, totalCount, filteredCount) {
  const allActive  = f.mode === 'all';
  const warActive  = f.mode === 'war';
  const custActive = f.mode === 'custom';

  // War button — only shown if kingdomNews has usable dates
  const warBtn = warPeriod
    ? `<button class="wb${warActive?' g':''}" style="font-size:10px;padding:3px 9px"
        onclick="__wpA.lbSetFilter('war',{fromYear:${warPeriod.fromYear},fromMonth:${warPeriod.fromMonth},toYear:${warPeriod.toYear},toMonth:${warPeriod.toMonth}})">
        ⚔ Last War
        <span style="font-size:9px;color:#4a6a88;margin-left:4px">${esc(warPeriod.fromLabel)} – ${esc(warPeriod.toLabel)}</span>
      </button>`
    : '';

  // Month selects
  const monthOpts = MONTH_NAMES.slice(1).map((m, i) =>
    `<option value="${i+1}">${m}</option>`).join('');

  const fromMonthSel = `<select style="background:#151a22;border:1px solid #2a3f55;color:#c8d8e8;font-family:monospace;font-size:11px;padding:3px 5px;border-radius:3px;outline:none"
    onchange="__wpA._lbCustom('fromMonth',this.value)">
    ${MONTH_NAMES.slice(1).map((m,i)=>`<option value="${i+1}"${(f.fromMonth===i+1)?' selected':''}>${m}</option>`).join('')}
  </select>`;
  const toMonthSel = `<select style="background:#151a22;border:1px solid #2a3f55;color:#c8d8e8;font-family:monospace;font-size:11px;padding:3px 5px;border-radius:3px;outline:none"
    onchange="__wpA._lbCustom('toMonth',this.value)">
    ${MONTH_NAMES.slice(1).map((m,i)=>`<option value="${i+1}"${(f.toMonth===i+1)?' selected':''}>${m}</option>`).join('')}
  </select>`;

  const customPanel = `
    <div style="display:${custActive?'flex':'none'};align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;padding:10px 12px;background:#151a22;border:1px solid #1e2d3d;border-radius:3px">
      <span style="font-size:10px;color:#4a6a88;font-weight:700;letter-spacing:1px;text-transform:uppercase">From</span>
      ${fromMonthSel}
      <input type="number" min="1" placeholder="YR" value="${f.fromYear||''}"
        style="background:#151a22;border:1px solid #2a3f55;color:#c8d8e8;font-family:monospace;font-size:11px;padding:3px 6px;border-radius:3px;width:60px;outline:none"
        oninput="__wpA._lbCustom('fromYear',this.value)">
      <span style="font-size:10px;color:#4a6a88;font-weight:700;letter-spacing:1px;text-transform:uppercase">To</span>
      ${toMonthSel}
      <input type="number" min="1" placeholder="YR" value="${f.toYear||''}"
        style="background:#151a22;border:1px solid #2a3f55;color:#c8d8e8;font-family:monospace;font-size:11px;padding:3px 6px;border-radius:3px;width:60px;outline:none"
        oninput="__wpA._lbCustom('toYear',this.value)">
      <button class="wb g" style="font-size:10px;padding:3px 9px" onclick="__wpA._lbApplyCustom()">Apply</button>
    </div>`;

  const filterInfo = !allActive
    ? `<span style="font-family:monospace;font-size:10px;color:#4a6a88;margin-left:8px">${filteredCount} of ${totalCount} ops</span>`
    : '';

  return `
    <div style="background:#0f1218;border:1px solid #1e2d3d;border-radius:4px;padding:10px 14px;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:10px;color:#4a6a88;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-right:4px">Period:</span>
        <button class="wb${allActive?' g':''}" style="font-size:10px;padding:3px 9px"
          onclick="__wpA.lbSetFilter('all',{})">All Time</button>
        ${warBtn}
        <button class="wb${custActive?' g':''}" style="font-size:10px;padding:3px 9px"
          onclick="__wpA.lbSetFilter('custom',{fromYear:${f.fromYear||1},fromMonth:${f.fromMonth||1},toYear:${f.toYear||1},toMonth:${f.toMonth||12}})">
          Custom…</button>
        ${filterInfo}
      </div>
      ${customPanel}
    </div>`;
}

// ── Backfill missing utoYear/utoMonth on old Firebase ops ───────────────────────
// Run once — patches existing docs that were stored before date fields were added.
// Safe to run multiple times; skips docs that already have utoYear set.

async function backfillOpDates() {
  const kdId = S.own?.location.replace(':', '_');
  if (!kdId) return;
  try {
    const ops = await fbQuery('ops', [{ field: 'kingdomId', value: kdId }]);
    const needsFill = ops.filter(op => !op.utoYear && op.utoDate);
    if (!needsFill.length) {
      console.log('[WavePlanner] Backfill: all ops already have date fields');
      return;
    }
    console.log(`[WavePlanner] Backfill: patching ${needsFill.length} ops...`);
    let patched = 0;
    for (const op of needsFill) {
      const d = _parseUtoDate(op.utoDate);
      if (!d) continue;
      await fbWrite(`ops/${kdId}_${op.opId}`, {
        ...op,
        utoYear:  d.year,
        utoMonth: d.month,
      });
      patched++;
    }
    console.log(`[WavePlanner] Backfill: patched ${patched} ops`);
  } catch(e) {
    console.log('[WavePlanner] Backfill failed:', e.message);
  }
}

// ── Silent op sync ───────────────────────────────────────────────────────────

async function syncOps() {
  if (!S.own) return;
  try {
    const ops = await fetchKingdomOps();
    if (!Array.isArray(ops) || !ops.length) return;

    const kdId   = S.own.location.replace(':', '_');
    const kdName = S.own.kingdomName || '';

    const metaPath = `meta/${kdId}_watermark`;
    const metaDoc  = await fbGet(metaPath);
    let lastId     = 0;
    try { if (metaDoc?.fields?.lastSyncedId) lastId = parseInt(metaDoc.fields.lastSyncedId.integerValue || 0); } catch (e) {}

    const newOps = ops.filter(op => op.id && op.id > lastId);
    if (!newOps.length) {
      console.log(`[WavePlanner] Op sync — nothing new (watermark: ${lastId})`);
      return;
    }

    let synced = 0;
    let maxId  = lastId;

    for (const op of newOps) {
      if (!op.provinceName) continue;

      const isSelf      = op.provinceName === op.targetName;
      const isEspionage = OP_SETS.ESPIONAGE.has(op.opType);
      const isBuff      = OP_SETS.SELF_BUFF.has(op.opType) || isSelf;
      const isTracked   = TRACKED_OPS.has(op.opType);

      if (op.id > maxId) maxId = op.id;
      if (!isTracked) continue;

      const category = OP_SETS.THIEF_SAB.has(op.opType) ? 'thief_sabotage' : 'magic_offensive';
      const _dp      = _parseUtoDate(op.utoDate || '');

      const written = await fbWrite(`ops/${kdId}_${op.id}`, {
        opId:         op.id,
        kingdomId:    kdId,
        kingdomName:  kdName,
        server:       S.server,
        utoDate:      op.utoDate     || '',
        utoYear:      _dp?.year      || 0,
        utoMonth:     _dp?.month     || 0,
        lastUpdated:  op.lastUpdated || '',
        slot:         op.slot        || 0,
        provinceName: op.provinceName || '',
        targetName:   op.targetName   || '',
        opType:       op.opType       || '',
        opName:       op.name || op.opType || '',
        category,
        result:       op.result  || 0,
        success:      op.result  === 1,
        damage:       op.damage  || 0,
        gain:         op.gain    || 0,
        syncedAt:     Date.now(),
      });

      if (written && !written.error) synced++;
    }

    if (maxId > lastId) {
      await fbWrite(metaPath, { kingdomId: kdId, lastSyncedId: maxId, updatedAt: Date.now() });
      console.log(`[WavePlanner] Synced ${synced} new ops (new watermark: ${maxId})`);
    }
  } catch (e) {
    console.log('[WavePlanner] Op sync failed:', e.message);
  }
}
