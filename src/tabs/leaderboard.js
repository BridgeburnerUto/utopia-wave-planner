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

/**
 * Derive war period by scanning IS kingdomNews.parseString for war declaration
 * and peace events. Returns {fromYear, fromMonth, toYear, toMonth, fromLabel, toLabel}
 * or null if no war events found in the news.
 *
 * We intentionally do NOT use kingdomNews.startDate/endDate — those are merely
 * the date boundaries of the news feed that was loaded, not war dates, and can
 * be stale from a previous age.
 *
 * NOTE — stance-based war detection:
 * The world dump stores kd.stance = ["war","X:Y"] when at war.
 * The snapshot script stores this as stanceLoc on kd_nw_history docs, enabling
 * war period detection for any KD pair via nwFindWar() in app.js.
 * For own-KD leaderboard filtering, scanning kingdomNews is more reliable since
 * it gives exact in-game dates from the intel API.
 */
function _getWarPeriod() {
  try {
    const IS      = JSON.parse(localStorage.getItem('IntelState') || '{}');
    const news    = IS.kingdomNews?.parseString;
    const curDate = _parseUtoDate(IS.currentTick?.tickName || '');
    if (!news || !curDate) return null;

    const curAbs = _utoToAbs(curDate.month, curDate.day, curDate.year);

    // Scan every news line for war/peace keywords
    const events = []; // { abs, date, type: 'war'|'peace' }
    news.split('\n').forEach(line => {
      const parts = line.split('\t');
      if (parts.length < 2) return;
      const d = _parseUtoDate(parts[0].trim());
      if (!d) return;
      // Skip future dates — guards against stale IS data from a previous age
      const abs = _utoToAbs(d.month, d.day, d.year);
      if (abs > curAbs) return;
      const text = parts[1].toLowerCase();
      if (text.includes('declared war') || text.includes('war has been declared') || text.includes('at war with')) {
        events.push({ abs, date: d, type: 'war' });
      } else if (text.includes('peace') || text.includes('ceasefire') || text.includes('white peace')) {
        events.push({ abs, date: d, type: 'peace' });
      }
    });

    if (!events.length) return null;
    // Sort descending so we find the most recent war declaration first
    events.sort((a, b) => b.abs - a.abs);

    const lastWar = events.find(e => e.type === 'war');
    if (!lastWar) return null;

    // Find the most recent peace event that came after this war declaration
    const peace = events.find(e => e.type === 'peace' && e.abs >= lastWar.abs);

    const start  = lastWar.date;
    const end    = peace ? peace.date : curDate;
    const fmt    = d => `${MONTH_NAMES[d.month]} ${d.day}, YR${d.year}`;

    return {
      fromYear:  start.year,  fromMonth: start.month,
      toYear:    end.year,    toMonth:   end.month,
      fromLabel: fmt(start),
      toLabel:   peace ? fmt(end) : `${MONTH_NAMES[end.month]} YR${end.year} (ongoing)`,
    };
  } catch(e) { return null; }
}

// ── Ops loading ──────────────────────────────────────────────────────────────
// QUOTA — same rule as the dragon board (see dragon.js). `ops` accumulates for a
// whole age and Firestore bills one read PER DOCUMENT, so every filter click
// used to re-read the entire collection. It is now read AT MOST ONCE per
// session through _lbLoadOps; the view helpers below re-aggregate the cached
// rows, and syncOps folds in the new ops it fetched from the IS API for free.

const OPS_CACHE = 'ops';

/**
 * Lower bound for the ops query: the start of this age.
 * `syncedAt` is used because every doc written by syncOps carries it — and
 * unlike the in-game date fields it is a real timestamp, so it sorts. Ops from
 * previous ages stay in Firestore but are not loaded: the leaderboard's own
 * filters are in-game YR dates, which reset every age, so cross-age rows could
 * not be told apart anyway.
 * Returns 0 when the age start is unknown, which means "no bound".
 */
function _lbAgeFloor() {
  return S.ageStartDate > 0 ? S.ageStartDate : 0;
}

/**
 * The ops list — the ONLY place `ops` is read.
 * opts.cached — reuse whatever is cached regardless of age (filter switches).
 * opts.force  — re-read (the ⟳ Refresh button).
 * Returns {rows, at, src, partial, error, warn}.
 */
async function _lbLoadOps(opts = {}) {
  const kdId = S.own?.location?.replace(':', '_') || '';
  if (!kdId) return { rows: [], at: 0, error: 'Own kingdom not loaded yet.' };

  if (opts.force) fbCacheDrop(OPS_CACHE);
  const hit = fbCacheGet(OPS_CACHE, kdId, opts.cached ? null : FB_QUOTA.CACHE_TTL_MS);
  if (hit) return { rows: hit.rows, at: hit.at, readAt: hit.readAt, src: hit.src, partial: hit.partial };

  const filters = [{ field: 'kingdomId', value: kdId }];
  const floor   = _lbAgeFloor();
  if (floor) filters.push({ field: 'syncedAt', op: 'GREATER_THAN_OR_EQUAL', value: floor, type: 'integer' });

  const rows = await fbQueryOrdered('ops', filters, {
    orderBy: 'syncedAt', dir: 'DESCENDING', limit: FB_QUOTA.OPS_LIMIT, what: 'ops',
  });

  // null = the read FAILED — never "no ops". The IS API still has the recent
  // window and costs no quota, so the board degrades to that rather than
  // reporting everyone as having done nothing.
  if (!rows) {
    const live = await fetchKingdomOps().catch(() => null);
    const kdName = S.own?.kingdomName || '';
    const fallback = Array.isArray(live)
      ? live.filter(op => op.provinceName && TRACKED_OPS.has(op.opType)).map(op => _lbOpDoc(op, kdId, kdName))
      : [];
    if (fallback.length) {
      const c = fbCachePut(OPS_CACHE, kdId, fallback, { src: 'is-api', partial: true });
      return { rows: c.rows, at: c.at, readAt: c.readAt, src: 'is-api', partial: true,
               warn: `${S.fbLastError || 'Firestore read failed'} — showing only the IS API's recent window (about 24h).` };
    }
    return { rows: [], at: 0, error: S.fbLastError || 'Firestore read failed' };
  }

  const partial = rows.length >= FB_QUOTA.OPS_LIMIT;
  const c = fbCachePut(OPS_CACHE, kdId, rows, { partial });
  return { rows: c.rows, at: c.at, readAt: c.readAt, src: 'firestore', partial };
}

// ── Filter state helpers ─────────────────────────────────────────────────────
// All of these re-aggregate rows already in memory — {cached:true} keeps a
// filter click from costing a full collection read.

function lbView(v) { S.lbView = v; renderLeaderboard({ cached: true }); }

function lbSetFilter(mode, opts) {
  S.lbFilter = { mode, ...opts };
  renderLeaderboard({ cached: true });
}

function lbOpFilter(type) {
  S.lbOpFilter = type || 'all';
  renderLeaderboard({ cached: true });
}

/** Explicit re-read — the only control here that spends quota on purpose */
function lbRefresh() { renderLeaderboard({ force: true }); }

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

/**
 * opts.cached — re-render from what is already loaded (view/filter switches)
 * opts.force  — re-read from Firestore (the ⟳ Refresh button)
 * Neither is set when the tab is opened, so the cache TTL decides.
 */
async function renderLeaderboard(opts = {}) {
  const el = $id('__wpc_leaderboard');
  // The tab holds two independent top lists: ops (Firestore `ops`, written by
  // the tool itself) and dragon contributions (`dragon_events`, pulled from the
  // utopiabot Discord feed — see dragon.js).
  if (S.lbSection === 'dragon') return renderDragonBoard(el, opts);

  const kdId = S.own?.location?.replace(':', '_') || '';
  if (!fbCacheGet(OPS_CACHE, kdId, null)) el.innerHTML = loadingHTML('LOADING LEADERBOARD...');
  try {
    const info = await _lbLoadOps(opts);
    // A failed read must not render as "nobody has done anything".
    if (info.error && !info.rows.length) {
      el.innerHTML = _drgSectionSwitch() + `<div style="color:#ff4455;font-family:monospace;font-size:19px;padding:20px 0">
        Error loading leaderboard: ${esc(info.error)}
        <div style="font-size:15px;color:#7a9090;margin-top:6px">
          // The stored ops are untouched — this is a read failure, not missing data.
        </div>
      </div>
      <div><button class="wb" onclick="__wpA.lbRefresh()" style="font-size:17px;padding:3px 12px">⟳ Try again</button></div>`;
      return;
    }
    if (!info.rows.length) {
      el.innerHTML = _drgSectionSwitch() + `<div style="color:#7a9090;font-family:monospace;font-size:19px;padding:20px 0">
        // No op data yet — data accumulates automatically as players use the tool during war.
      </div>`;
      return;
    }
    el.innerHTML = _drgSectionSwitch() + _lbDataStrip(info) + _buildLeaderboard(info.rows);
  } catch (e) {
    el.innerHTML = `<div style="color:#ff4455;font-family:monospace;font-size:19px;padding:20px 0">
      Error loading leaderboard: ${esc(e.message)}
    </div>`;
  }
}

/** Provenance line — same contract as the dragon board's _drgDataStrip */
function _lbDataStrip(info) {
  const when = info.at ? new Date(info.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—';
  const src  = info.src === 'is-api' ? 'from the IS API' : 'from the op store';
  const warn = info.warn
    ? `<div style="font-family:monospace;font-size:15px;color:#ffaa00;margin-top:4px">// ${esc(info.warn)}</div>` : '';
  const trunc = info.partial && info.src !== 'is-api'
    ? `<div style="font-family:monospace;font-size:15px;color:#ffaa00;margin-top:4px">
         // Hit the ${FB_QUOTA.OPS_LIMIT}-document read limit — the oldest ops in this age are not shown.
       </div>` : '';
  return `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
      <span style="font-family:monospace;font-size:15px;color:#617070">
        // data as of ${esc(when)} ${esc(src)} — new ops are folded in as they sync
      </span>
      <button class="wb" onclick="__wpA.lbRefresh()" style="font-size:15px;padding:2px 8px"
        title="Re-read the op store from Firestore. Filters and views re-use what is already loaded, so they cost no quota.">⟳ Refresh</button>
    </div>${warn}${trunc}`;
}

function _buildLeaderboard(allOps) {
  const warPeriod = _getWarPeriod();
  const ops       = _filterOps(allOps);
  const f         = S.lbFilter;
  if (!S.lbOpFilter) S.lbOpFilter = 'all';
  const opf       = S.lbOpFilter; // 'all' or an opType string

  // ── Filter bar ──────────────────────────────────────────────────────────
  const filterBar = _buildFilterBar(f, warPeriod, allOps.length, ops.length);

  if (!ops.length) {
    return filterBar + `<div style="color:#7a9090;font-family:monospace;font-size:19px;padding:20px 0">
      // No ops match the selected period.
    </div>`;
  }

  // ── Build per-op-type index (always over full period, for pill row) ─────
  const byOp = {};
  ops.forEach(op => {
    if (!op.opType) return;
    if (!byOp[op.opType]) byOp[op.opType] = {
      count: 0, successCount: 0, damage: 0, gain: 0,
      opName:   op.opName || op.opType,
      category: op.category || (OP_SETS.THIEF_SAB.has(op.opType) ? 'thief_sabotage' : 'magic_offensive'),
    };
    byOp[op.opType].count++;
    if (op.success) byOp[op.opType].successCount++;
    byOp[op.opType].damage += op.damage || 0;
    byOp[op.opType].gain   += op.gain   || 0;
  });

  // ── Op-type pill row ─────────────────────────────────────────────────────
  const opPills = _buildOpPillRow(byOp, opf);

  // ── Ops scoped to the op filter ──────────────────────────────────────────
  const scopedOps = opf === 'all' ? ops : ops.filter(op => op.opType === opf);
  const opMeta    = opf !== 'all' ? byOp[opf] : null; // {opName, category, count, …}

  // Label used in column headers & cards when a specific op is selected
  const opLabel   = opMeta ? (opMeta.opName || opf).split(' ').map(w => w[0]).join('').toUpperCase().slice(0,4) : '';
  const isThiefOp = opMeta?.category === 'thief_sabotage';

  // ── Aggregate by province (scoped) ──────────────────────────────────────
  const byProv = {};
  scopedOps.forEach(op => {
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
  const totalGain  = sorted.reduce((s, p) => s + p.totalGain, 0);
  const totalSucc  = sorted.reduce((s, p) => s + p.successOps, 0);
  const maxDmg     = sorted[0]?.totalDamage || 1;
  const successPct = totalOps > 0 ? Math.round(totalSucc / totalOps * 100) : 0;

  const viewSorted = S.lbView === 'ops'     ? [...sorted].sort((a, b) => b.totalOps    - a.totalOps)
                   : S.lbView === 'gain'    ? [...sorted].sort((a, b) => b.totalGain   - a.totalGain)
                   : S.lbView === 'success' ? [...sorted].sort((a, b) => {
                       const pa = a.totalOps > 0 ? a.successOps / a.totalOps : 0;
                       const pb = b.totalOps > 0 ? b.successOps / b.totalOps : 0;
                       return pb - pa;
                     })
                   : sorted; // default: damage

  // ── Context bar (only when op filter active) ─────────────────────────────
  const opContextBar = opf !== 'all' ? (() => {
    const catBadge = isThiefOp
      ? `<span style="font-family:monospace;font-size:15px;padding:1px 5px;border-radius:2px;background:rgba(0,212,255,.12);color:#00d4ff;border:1px solid rgba(0,212,255,.25)">THIEF</span>`
      : `<span style="font-family:monospace;font-size:15px;padding:1px 5px;border-radius:2px;background:rgba(170,102,255,.12);color:#aa66ff;border:1px solid rgba(170,102,255,.25)">SPELL</span>`;
    const accentCol = isThiefOp ? '#00d4ff' : '#aa66ff';
    const accentBg  = isThiefOp ? 'rgba(0,212,255,.12)' : 'rgba(170,102,255,.12)';
    const accentBrd = isThiefOp ? 'rgba(0,212,255,.35)' : 'rgba(170,102,255,.35)';
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding:8px 12px;background:#2b3333;border:1px solid #617070;border-radius:4px;flex-wrap:wrap">
      <span style="font-size:17px;color:#7a9090;font-weight:700;text-transform:uppercase;letter-spacing:1px">Showing:</span>
      <span style="font-size:17px;font-weight:700;padding:3px 12px;border-radius:3px;background:${accentBg};border:1px solid ${accentBrd};color:${accentCol}">${esc(opMeta?.opName || opf)} (${esc(opf)})</span>
      ${catBadge}
      <span style="font-size:17px;color:#7a9090">${scopedOps.length} ops &middot; ${sorted.length} provinces</span>
    </div>`;
  })() : '';

  // ── Sort/view toggle ─────────────────────────────────────────────────────
  const viewToggle = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <div style="font-family:monospace;font-size:17px;color:#7a9090;letter-spacing:2px;text-transform:uppercase">
        ${scopedOps.length} ops &middot; ${sorted.length} provinces
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="wb${S.lbView==='damage' ?' g':''}" onclick="__wpA.lbView('damage')"  style="font-size:17px;padding:3px 9px">Damage</button>
        <button class="wb${S.lbView==='ops'    ?' g':''}" onclick="__wpA.lbView('ops')"     style="font-size:17px;padding:3px 9px">Op Count</button>
        <button class="wb${S.lbView==='success'?' g':''}" onclick="__wpA.lbView('success')" style="font-size:17px;padding:3px 9px">Success%</button>
        <button class="wb${S.lbView==='gain'   ?' g':''}" onclick="__wpA.lbView('gain')"    style="font-size:17px;padding:3px 9px">Gain</button>
      </div>
    </div>`;

  // ── Summary cards ────────────────────────────────────────────────────────
  const opsLabel = opf === 'all' ? 'Total Ops' : `${esc(opLabel)} Ops`;
  const dmgLabel = opf === 'all' ? 'Total Damage' : `${esc(opLabel)} Damage`;
  const gainLabel= opf === 'all' ? 'Total Gain'   : `${esc(opLabel)} Gain`;
  const avgDmg   = totalOps > 0 && totalDmg > 0 ? `avg ${fK(Math.round(totalDmg/totalOps))} / op` : '';
  const succSub  = totalOps > 0 ? `${totalSucc} of ${totalOps}` : '';

  const summaryCards = `
    <div class="wsum" style="margin-bottom:16px">
      <div class="wscard"><div class="l">${opsLabel}</div><div class="v">${fK(totalOps)}</div><div class="s">${sorted.length} provinces</div></div>
      <div class="wscard"><div class="l">${dmgLabel}</div><div class="v">${fK(totalDmg)}</div><div class="s">${avgDmg}</div></div>
      <div class="wscard"><div class="l">${gainLabel}</div><div class="v">${fK(totalGain)}</div></div>
      <div class="wscard"><div class="l">Success Rate</div><div class="v" style="color:${successPct>=70?'#00ff88':successPct>=50?'#ffaa00':'#ff4455'}">${successPct}%</div><div class="s">${succSub}</div></div>
    </div>`;

  // ── Province rows ────────────────────────────────────────────────────────
  const dmgColLabel  = opf === 'all' ? 'Damage'   : `${esc(opLabel)} Dmg`;
  const opsColLabel  = opf === 'all' ? 'Ops'      : `${esc(opLabel)} Ops`;
  const gainColLabel = opf === 'all' ? 'Gain'     : `${esc(opLabel)} Gain`;
  const topOpCol     = opf === 'all'; // only show "Top Op" col in all-mode

  const provRows = viewSorted.map((p, i) => {
    const pct     = p.totalOps > 0 ? Math.round(p.successOps / p.totalOps * 100) : 0;
    const barW    = maxDmg > 0 ? Math.round(p.totalDamage / maxDmg * 100) : 0;
    const barCol  = opf === 'all' ? '#00d4ff' : (isThiefOp ? '#00d4ff' : '#aa66ff');
    const medal   = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1);
    const pctCol  = pct >= 70 ? '#00ff88' : pct >= 50 ? '#ffaa00' : '#ff4455';
    const avgDmgP = p.totalOps > 0 && p.totalDamage > 0 ? fK(Math.round(p.totalDamage / p.totalOps)) : '—';

    const topOpCell = topOpCol ? (() => {
      const topOp   = Object.entries(p.opCounts).sort((a, b) => b[1] - a[1])[0];
      const topName = topOp ? (p.opNames[topOp[0]] || topOp[0]) : '';
      return `<td><span class="wtag" style="cursor:default;font-size:15px">${topName}${topOp?' ×'+topOp[1]:''}</span></td>`;
    })() : '';

    return `<tr>
      <td style="font-family:monospace;font-size:19px">${medal}</td>
      <td style="font-weight:700">${esc(pnum(_ownSlotByName(p.name), p.name))}</td>
      <td style="text-align:right;font-family:monospace">
        ${fK(p.totalDamage)}
        <div style="height:3px;background:#617070;border-radius:2px;margin-top:2px">
          <div style="height:100%;width:${barW}%;background:${barCol};border-radius:2px"></div>
        </div>
      </td>
      <td style="text-align:right;font-family:monospace">${p.totalOps}</td>
      <td style="text-align:right;font-family:monospace;color:${pctCol}">${pct}%</td>
      <td style="text-align:right;font-family:monospace">${fK(p.totalGain)}</td>
      ${opf !== 'all' ? `<td style="text-align:right;font-family:monospace;color:#7a9090">${avgDmgP}</td>` : ''}
      ${topOpCell}
      <td style="font-family:monospace;font-size:17px;color:#7a9090">${esc(p.lastSeen || '')}</td>
    </tr>`;
  }).join('');

  const avgDmgTh  = opf !== 'all' ? `<th style="text-align:right">Avg Dmg</th>` : '';
  const topOpTh   = opf === 'all' ? `<th>Top Op</th>` : '';
  const mainTable = `
    <table class="wtbl">
      <thead><tr>
        <th style="width:24px">#</th><th>Province</th>
        <th style="text-align:right">${dmgColLabel}</th>
        <th style="text-align:right">${opsColLabel}</th>
        <th style="text-align:right">Success%</th>
        <th style="text-align:right">${gainColLabel}</th>
        ${avgDmgTh}${topOpTh}
        <th>Last seen</th>
      </tr></thead>
      <tbody>${provRows}</tbody>
    </table>`;

  // ── Op breakdown table (always full period, selected op highlighted) ──────
  const opRows = Object.entries(byOp)
    .sort((a, b) => {
      if (a[1].category !== b[1].category) return a[1].category === 'thief_sabotage' ? -1 : 1;
      return b[1].damage - a[1].damage || b[1].count - a[1].count;
    })
    .map(([code, d]) => {
      const isThief   = d.category === 'thief_sabotage';
      const isActive  = code === opf;
      const catLabel  = isThief
        ? `<span style="font-family:monospace;font-size:15px;padding:1px 4px;border-radius:2px;background:rgba(0,212,255,.12);color:#00d4ff;border:1px solid rgba(0,212,255,.2)">THIEF</span>`
        : `<span style="font-family:monospace;font-size:15px;padding:1px 4px;border-radius:2px;background:rgba(170,102,255,.12);color:#aa66ff;border:1px solid rgba(170,102,255,.2)">SPELL</span>`;
      const accentCol  = isThief ? '#00d4ff' : '#aa66ff';
      const rowStyle   = isActive
        ? `background:${isThief?'rgba(0,212,255,.08)':'rgba(170,102,255,.08)'};outline:1px solid ${isThief?'rgba(0,212,255,.3)':'rgba(170,102,255,.3)'}`
        : '';
      const succPct    = d.count > 0 ? Math.round(d.successCount / d.count * 100) : 0;
      const succCol    = succPct >= 70 ? '#00ff88' : succPct >= 50 ? '#ffaa00' : '#ff4455';
      const codeStyle  = isActive ? `border-color:${accentCol};color:${accentCol}` : '';
      const nameStyle  = isActive ? `font-weight:700;color:${accentCol}` : 'color:#b8c8c8';
      return `<tr style="${rowStyle}" onclick="__wpA.lbOpFilter('${esc(isActive ? 'all' : code)}')" style="cursor:pointer">
        <td><span class="wtag" style="cursor:pointer;${codeStyle}">${esc(code)}</span></td>
        <td style="${nameStyle};cursor:pointer">${esc(d.opName || code)}</td>
        <td>${catLabel}</td>
        <td style="text-align:right;font-family:monospace;${isActive?'font-weight:700':''}">${d.count}</td>
        <td style="text-align:right;font-family:monospace">${fK(d.damage) || '—'}</td>
        <td style="text-align:right;font-family:monospace">${fK(d.gain) || '—'}</td>
        <td style="text-align:right;font-family:monospace;color:${succCol}">${succPct}%</td>
      </tr>`;
    }).join('');

  const opTable = `
    <div style="margin-top:20px" class="wsech">Op Breakdown by Type ${opf !== 'all' ? '<span style="font-size:15px;font-weight:400;letter-spacing:0;text-transform:none;color:#617070">— click a row to filter, click again to clear</span>' : '<span style="font-size:15px;font-weight:400;letter-spacing:0;text-transform:none;color:#617070">— click a row to filter by that op</span>'}</div>
    <table class="wtbl">
      <thead><tr>
        <th>Op</th><th>Full Name</th><th>Type</th>
        <th style="text-align:right">Count</th>
        <th style="text-align:right">Total Damage</th>
        <th style="text-align:right">Total Gain</th>
        <th style="text-align:right">Success%</th>
      </tr></thead>
      <tbody>${opRows}</tbody>
    </table>`;

  return filterBar + opPills + opContextBar + viewToggle + summaryCards + mainTable + opTable;
}

// ── Op type pill row ─────────────────────────────────────────────────────────

function _buildOpPillRow(byOp, activeOpf) {
  // Sort: thieves first, then spells; within each group by count desc
  const sorted = Object.entries(byOp).sort((a, b) => {
    const ac = a[1].category, bc = b[1].category;
    if (ac !== bc) return ac === 'thief_sabotage' ? -1 : 1;
    return b[1].count - a[1].count;
  });

  const allActive = activeOpf === 'all';

  const pills = sorted.map(([code, d]) => {
    const isThief  = d.category === 'thief_sabotage';
    const isActive = code === activeOpf;
    const accentCol = isThief ? '#00d4ff' : '#aa66ff';
    const accentBg  = isThief ? 'rgba(0,212,255,.15)' : 'rgba(170,102,255,.15)';
    const accentBrd = isThief ? 'rgba(0,212,255,.45)' : 'rgba(170,102,255,.45)';
    const badge     = isThief
      ? `<span style="font-size:13px;padding:0 4px;border-radius:2px;background:rgba(0,212,255,.18);color:#00d4ff;font-weight:700;font-family:monospace">T</span>`
      : `<span style="font-size:13px;padding:0 4px;border-radius:2px;background:rgba(170,102,255,.18);color:#aa66ff;font-weight:700;font-family:monospace">S</span>`;

    const baseStyle  = `display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:3px;cursor:pointer;font-size:17px;border:1px solid;transition:all .12s`;
    const activeStyle= `background:${accentBg};border-color:${accentBrd};color:${accentCol};font-weight:700`;
    const idleStyle  = `background:#2b3333;border-color:#617070;color:#b8c8c8`;
    const countStyle = isActive ? `color:${accentCol};opacity:.7;font-size:15px` : `color:#617070;font-size:15px`;

    return `<button style="${baseStyle};${isActive ? activeStyle : idleStyle}"
      onclick="__wpA.lbOpFilter('${isActive ? 'all' : esc(code)}')"
      title="${esc(d.opName || code)} — click to ${isActive ? 'clear filter' : 'filter by this op'}">
      ${badge} ${esc(d.opName || code)} <span style="${countStyle}">&times;${d.count}</span>
    </button>`;
  }).join('');

  const allStyle = allActive
    ? `background:#ffd400;border-color:#ffd400;color:#1e2828;font-weight:700`
    : `background:#2b3333;border-color:#617070;color:#b8c8c8`;

  return `
    <div style="background:#2b3333;border:1px solid #617070;border-radius:4px;padding:10px 14px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:17px;color:#7a9090;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-right:4px;white-space:nowrap">Op Type:</span>
        <button style="display:inline-flex;align-items:center;padding:3px 9px;border-radius:3px;cursor:pointer;font-size:17px;border:1px solid;${allStyle}"
          onclick="__wpA.lbOpFilter('all')">ALL <span style="font-size:15px;margin-left:5px;opacity:.6">&times;${Object.values(byOp).reduce((s,d)=>s+d.count,0)}</span>
        </button>
        ${pills}
      </div>
    </div>`;
}

// ── Filter bar HTML ──────────────────────────────────────────────────────────

function _buildFilterBar(f, warPeriod, totalCount, filteredCount) {
  const allActive  = f.mode === 'all';
  const warActive  = f.mode === 'war';
  const custActive = f.mode === 'custom';

  // War button — only shown if kingdomNews has usable dates
  const warBtn = warPeriod
    ? `<button class="wb${warActive?' g':''}" style="font-size:17px;padding:3px 9px"
        onclick="__wpA.lbSetFilter('war',{fromYear:${warPeriod.fromYear},fromMonth:${warPeriod.fromMonth},toYear:${warPeriod.toYear},toMonth:${warPeriod.toMonth}})">
        ⚔ Last War
        <span style="font-size:15px;color:#7a9090;margin-left:4px">${esc(warPeriod.fromLabel)} – ${esc(warPeriod.toLabel)}</span>
      </button>`
    : '';

  // Month selects
  const monthOpts = MONTH_NAMES.slice(1).map((m, i) =>
    `<option value="${i+1}">${m}</option>`).join('');

  const fromMonthSel = `<select style="background:#3c4545;border:1px solid #617070;color:#ffffff;font-family:monospace;font-size:17px;padding:3px 5px;border-radius:3px;outline:none"
    onchange="__wpA._lbCustom('fromMonth',this.value)">
    ${MONTH_NAMES.slice(1).map((m,i)=>`<option value="${i+1}"${(f.fromMonth===i+1)?' selected':''}>${m}</option>`).join('')}
  </select>`;
  const toMonthSel = `<select style="background:#3c4545;border:1px solid #617070;color:#ffffff;font-family:monospace;font-size:17px;padding:3px 5px;border-radius:3px;outline:none"
    onchange="__wpA._lbCustom('toMonth',this.value)">
    ${MONTH_NAMES.slice(1).map((m,i)=>`<option value="${i+1}"${(f.toMonth===i+1)?' selected':''}>${m}</option>`).join('')}
  </select>`;

  const customPanel = `
    <div style="display:${custActive?'flex':'none'};align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;padding:10px 12px;background:#3c4545;border:1px solid #617070;border-radius:3px">
      <span style="font-size:17px;color:#7a9090;font-weight:700;letter-spacing:1px;text-transform:uppercase">From</span>
      ${fromMonthSel}
      <input type="number" min="1" placeholder="YR" value="${f.fromYear||''}"
        style="background:#3c4545;border:1px solid #617070;color:#ffffff;font-family:monospace;font-size:17px;padding:3px 6px;border-radius:3px;width:60px;outline:none"
        oninput="__wpA._lbCustom('fromYear',this.value)">
      <span style="font-size:17px;color:#7a9090;font-weight:700;letter-spacing:1px;text-transform:uppercase">To</span>
      ${toMonthSel}
      <input type="number" min="1" placeholder="YR" value="${f.toYear||''}"
        style="background:#3c4545;border:1px solid #617070;color:#ffffff;font-family:monospace;font-size:17px;padding:3px 6px;border-radius:3px;width:60px;outline:none"
        oninput="__wpA._lbCustom('toYear',this.value)">
      <button class="wb g" style="font-size:17px;padding:3px 9px" onclick="__wpA._lbApplyCustom()">Apply</button>
    </div>`;

  const filterInfo = !allActive
    ? `<span style="font-family:monospace;font-size:17px;color:#7a9090;margin-left:8px">${filteredCount} of ${totalCount} ops</span>`
    : '';

  return `
    <div style="background:#2b3333;border:1px solid #617070;border-radius:4px;padding:10px 14px;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:17px;color:#7a9090;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-right:4px">Period:</span>
        <button class="wb${allActive?' g':''}" style="font-size:17px;padding:3px 9px"
          onclick="__wpA.lbSetFilter('all',{})">All Time</button>
        ${warBtn}
        <button class="wb" style="font-size:17px;padding:3px 9px;border-color:#617070;color:#e09040"
          onclick="__wpA.lbFindWar()"
          title="Scan stored NW snapshots for when own and enemy KD were mutually at war (works further back than Last War)">
          ⚔ Find War</button>
        <button class="wb${custActive?' g':''}" style="font-size:17px;padding:3px 9px"
          onclick="__wpA.lbSetFilter('custom',{fromYear:${f.fromYear||1},fromMonth:${f.fromMonth||1},toYear:${f.toYear||1},toMonth:${f.toMonth||12}})">
          Custom…</button>
        ${filterInfo}
        <button class="wb" style="font-size:17px;padding:3px 9px;margin-left:auto;border-color:#617070;color:#7a9090"
          onclick="__wpA.resyncOps()"
          title="Reset the op sync watermark and re-pull all ops from the IS API. Use if ops are missing (e.g. after adding a new op type to the tracked set).">
          ↺ Re-sync ops</button>
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
    // Shares the leaderboard's session cache — this runs once per kingdom, but
    // it must not be the thing that pays for a second full read.
    const info = await _lbLoadOps({ cached: true });
    if (info.error) { console.warn('[WavePlanner] Backfill skipped —', info.error); return; }
    const ops = info.rows;
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

/**
 * One IS op in the shape the `ops` collection stores.
 * Shared by syncOps (what it writes) and _lbLoadOps (its IS-API fallback), so
 * the two can never drift into disagreeing about a field name.
 */
function _lbOpDoc(op, kdId, kdName) {
  const _dp = _parseUtoDate(op.utoDate || '');
  return {
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
    category:     OP_SETS.THIEF_SAB.has(op.opType) ? 'thief_sabotage' : 'magic_offensive',
    result:       op.result  || 0,
    success:      op.result  === 1,
    damage:       op.damage  || 0,
    gain:         op.gain    || 0,
    syncedAt:     Date.now(),
  };
}

async function syncOps() {
  if (!S.own) return;
  try {
    const ops = await fetchKingdomOps();
    if (!Array.isArray(ops) || !ops.length) return;

    // Hand the raw window to the Economy tab before doing anything else with
    // it: riots on the enemy are read out of this list (economy.js
    // `_riotsFromOps`), and this is the fetch that already pays for it. The
    // re-render is what makes them appear — syncOps runs after the first paint,
    // so without it the riots stay invisible until the next refresh.
    S.recentOps   = ops;
    S.recentOpsAt = Date.now();
    renderEconBadges();
    if (S.tab === 'economy') renderEconomy();

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
    const wrote = [];

    for (const op of newOps) {
      if (!op.provinceName) continue;

      const isSelf      = op.provinceName === op.targetName;
      const isEspionage = OP_SETS.ESPIONAGE.has(op.opType);
      const isBuff      = OP_SETS.SELF_BUFF.has(op.opType) || isSelf;
      const isTracked   = TRACKED_OPS.has(op.opType);

      // Advance watermark for all ops (tracked or not) so we never re-process
      // espionage / self-buff ops. For untracked ops we skip writing to Firebase
      // but still record the ID — this is intentional for spy/buff ops.
      // Exception: if the op type is completely unrecognised (not in any set),
      // do NOT advance the watermark so a future TRACKED_OPS addition can pick it up.
      const isKnown = isTracked || isEspionage || isBuff;
      if (isKnown && op.id > maxId) maxId = op.id;
      if (!isTracked) continue;

      const doc     = _lbOpDoc(op, kdId, kdName);
      const written = await fbWrite(`ops/${kdId}_${op.id}`, doc);

      if (written && !written.error) { synced++; wrote.push(doc); }
    }

    // The leaderboard's cache gets these for free — we built them here from the
    // IS API, so it must not pay Firestore to read back what we just wrote.
    fbCacheMerge(OPS_CACHE, kdId, wrote, r => r.opId);

    if (maxId > lastId) {
      await fbWrite(metaPath, { kingdomId: kdId, lastSyncedId: maxId, updatedAt: Date.now() });
      console.log(`[WavePlanner] Synced ${synced} new ops (new watermark: ${maxId})`);
    }
  } catch (e) {
    console.log('[WavePlanner] Op sync failed:', e.message);
  }
}

/**
 * Reset the op sync watermark to 0 and re-run syncOps.
 * Use when ops are missing from the leaderboard — e.g. after adding a new
 * op type to TRACKED_OPS (skipped ops advance the watermark so they are
 * otherwise never re-processed).
 * All fbWrite calls are upserts, so re-syncing existing ops is harmless.
 */
async function resyncOps() {
  if (!S.own) return;
  const kdId      = S.own.location.replace(':', '_');
  const metaPath  = `meta/${kdId}_watermark`;
  const el        = $id('__wpc_leaderboard');
  if (el) el.innerHTML = loadingHTML('RESETTING WATERMARK AND RE-SYNCING...');
  try {
    await fbWrite(metaPath, { kingdomId: kdId, lastSyncedId: 0, updatedAt: Date.now() });
    console.log('[WavePlanner] Op watermark reset to 0 — running full re-sync');
    await syncOps();   // folds everything it re-wrote into the cache
    renderLeaderboard({ cached: true });
  } catch(e) {
    console.error('[WavePlanner] resyncOps failed:', e.message);
    if (el) el.innerHTML = `<div style="color:#E05050;padding:20px">Re-sync failed: ${esc(e.message)}</div>`;
  }
}
