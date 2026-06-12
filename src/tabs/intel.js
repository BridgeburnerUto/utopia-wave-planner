// ── TAB: INTEL ─────────────────────────────────────────────────────────────
// Enemy province intel table with sortable columns.
// Acre gain/loss, attacks, razes and massacres come from the Cloud Run
// backend's `?news` endpoint, which is populated by the
// kingdom-news-scraper.user.js Tampermonkey script running on
// utopia-game.com/wol/game/kingdom_news/* pages (the IS provides no
// news data via its own API or localStorage).

// ── News data ────────────────────────────────────────────────────────────────

/**
 * Kick off (or return cached) fetch of the latest kd_news record from the
 * backend. Caches in S._kdNewsCache. Triggers a re-render of the Intel tab
 * once the fetch completes.
 */
function _ensureKdNewsLoaded() {
  if (S._kdNewsCache !== null || S._kdNewsLoading) return;
  if (!S.apiEndpoint) { S._kdNewsCache = false; return; } // no backend configured
  S._kdNewsLoading = true;
  fetchBackendNews().then(records => {
    S._kdNewsLoading = false;
    if (!records.length) { S._kdNewsCache = false; renderIntel(); return; }
    // Most recent record (records are sorted newest-first by the backend)
    S._kdNewsCache = records[0];
    renderIntel();
  }).catch(() => {
    S._kdNewsLoading = false;
    S._kdNewsCache = false;
    renderIntel();
  });
}

/**
 * Force a re-fetch of the latest kd_news record from the backend, discarding
 * any cached copy. Triggered by the "Refresh" button on the Intel tab.
 */
function refreshKdNews() {
  S._kdNewsCache = null;
  S._kdNewsLoading = false;
  _ensureKdNewsLoaded();
  renderIntel();
}

/**
 * Build per-enemy-slot stats from the cached kd_news record.
 * Returns { [enemySlot]: { acresGained, acresLost, attacksMade, razes, razeAcres, massacres } }
 */
function _buildNewsStats() {
  const stats = {};
  const rec = S._kdNewsCache;
  if (!rec || !rec.parsed) return stats;

  const eLoc = S.eLoc;
  const nameToSlot = {};
  (S.enemy?.provinces || []).forEach(p => { nameToSlot[p.name] = p.slot; });

  // Filter events to those within S.intelInterval ticks of the most recent
  // event in the news (the scraped edition may lag behind the live current
  // tick, so anchor the window to the news data itself rather than "now").
  let minAbs = -Infinity;
  if (S.intelInterval) {
    let maxAbs = -Infinity;
    ['attacks','razes','massacres'].forEach(k => {
      (rec.parsed[k] || []).forEach(ev => {
        const d = ev.date && _parseNewsDate(ev.date);
        if (d) {
          const abs = _utoToAbs(d.month, d.day, d.year);
          if (abs > maxAbs) maxAbs = abs;
        }
      });
    });
    if (maxAbs > -Infinity) minAbs = maxAbs - S.intelInterval;
  }
  function inWindow(ev) {
    if (minAbs === -Infinity || !ev.date) return true;
    const d = _parseNewsDate(ev.date);
    if (!d) return true;
    return _utoToAbs(d.month, d.day, d.year) >= minAbs;
  }

  function getOrCreate(slot) {
    if (!stats[slot]) stats[slot] = { acresGained: 0, acresLost: 0, attacksMade: 0, razes: 0, razeAcres: 0, massacres: 0 };
    return stats[slot];
  }

  (rec.parsed.attacks || []).forEach(a => {
    if (!inWindow(a)) return;
    if (a.attacker_kd === eLoc) {
      const slot = nameToSlot[a.attacker];
      if (slot != null) {
        getOrCreate(slot).acresGained += a.acres_captured || 0;
        getOrCreate(slot).attacksMade++;
      }
    } else if (a.defender_kd === eLoc) {
      const slot = nameToSlot[a.defender];
      if (slot != null) getOrCreate(slot).acresLost += a.acres_captured || 0;
    }
  });

  (rec.parsed.razes || []).forEach(r => {
    if (!inWindow(r)) return;
    if (r.defender_kd === eLoc) {
      const slot = nameToSlot[r.defender];
      if (slot != null) {
        getOrCreate(slot).razes++;
        getOrCreate(slot).razeAcres += r.acres_razed || 0;
      }
    }
  });

  (rec.parsed.massacres || []).forEach(m => {
    if (!inWindow(m)) return;
    if (m.defender_kd === eLoc) {
      const slot = nameToSlot[m.defender];
      if (slot != null) getOrCreate(slot).massacres++;
    }
  });

  return stats;
}

// ── Sort state ────────────────────────────────────────────────────────────────

// S.intelSort = { col: 'slot', dir: 1 }  (dir: 1=asc, -1=desc)

function intelSort(col) {
  if (!S.intelSort) S.intelSort = { col: 'slot', dir: 1 };
  if (S.intelSort.col === col) {
    S.intelSort.dir *= -1; // toggle
  } else {
    S.intelSort.col = col;
    S.intelSort.dir = -1; // default new col to descending
  }
  renderIntel();
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderIntel() {
  renderTab('__wpc_intel', _buildIntel);
}

function _buildIntel() {
  if (!S.enemy) return loadingHTML('NO ENEMY LOADED');
  if (!S.intelSort) S.intelSort = { col: 'slot', dir: 1 };

  _ensureKdNewsLoaded();
  const newsStats = _buildNewsStats();

  // Build row data
  const rows = S.enemy.provinces.map(p => {
    const sot  = p.sot || {};
    const ns   = newsStats[p.slot] || { acresGained: 0, acresLost: 0, attacksMade: 0, razes: 0, razeAcres: 0, massacres: 0 };
    const nwpa = p.land > 0 ? Math.round((p.networth || 0) / p.land) : 0;
    const da   = p.calcs?.defPointsSummary?.ageSeconds;
    const armiesAway = (p.som?.armiesAway || []).map(a => ({
      oSpecs:           a.oSpecs || 0,
      land:             a.land   || 0,
      secondsRemaining: typeof a.secondsRemaining === 'number' ? a.secondsRemaining : null,
    }));
    // For sorting: overdue/unknown = 0 (sorted first asc), no armies = 9e9 (sorted last)
    const awayEarliest = armiesAway.length > 0
      ? Math.min(...armiesAway.map(a => a.secondsRemaining != null ? a.secondsRemaining : 0))
      : 9e9;
    return {
      slot:         p.slot,
      name:         p.name,
      race:         p.race || '—',
      nw:           p.networth || 0,
      land:         p.land || 0,
      off:          sot.offPoints || 0,
      def:          sot.defPoints || p.calcs?.defPointsSummary?.defPointsHome || 0,
      nwpa,
      peons:        sot.peasants || 0,
      acresGained:  ns.acresGained,
      acresLost:    ns.acresLost,
      attacksMade:  ns.attacksMade,
      razes:        ns.razes,
      razeAcres:    ns.razeAcres,
      massacres:    ns.massacres,
      armiesAway,
      awayEarliest,
      intelAge:     da,
      stale:        da != null && da > 28800,
    };
  });

  // Sort
  const { col, dir } = S.intelSort;
  rows.sort((a, b) => {
    const av = a[col] ?? 0, bv = b[col] ?? 0;
    if (typeof av === 'string') return dir * av.localeCompare(bv);
    return dir * (av - bv);
  });

  // News status line
  let newsStatus;
  if (!S.apiEndpoint) {
    newsStatus = 'No backend endpoint configured (Alerts tab) — gain/loss/raze/massacre columns unavailable';
  } else if (S._kdNewsLoading || S._kdNewsCache === null) {
    newsStatus = 'Loading kingdom news from backend…';
  } else if (S._kdNewsCache === false) {
    newsStatus = 'No kingdom news data yet — visit a Kingdom News page in-game with the news scraper userscript installed';
  } else {
    const rec = S._kdNewsCache;
    const edition = rec.parsed?.news_edition || '?';
    const ago = rec.received_at ? Math.round((Date.now() - new Date(rec.received_at).getTime()) / 60000) : null;
    newsStatus = `News: ${esc(edition)}${ago != null ? ` · scraped ${ago}m ago` : ''}`;
  }
  const newsStatusEl = `<div style="font-size:17px;color:#7a9090;font-style:italic;display:flex;align-items:center;gap:8px;">
      ${newsStatus}
      <button onclick="__wpA.refreshKdNews()" title="Re-fetch latest kingdom news from backend"
        style="background:#2b3333;color:#7a9090;border:1px solid #617070;border-radius:4px;padding:2px 8px;font-size:13px;cursor:pointer;">⟳ Refresh</button>
    </div>`;

  const intervalOpts = [4, 6, 8, 12, 24, 36, 48, 60, 72];
  const intervalEl = `<div style="display:flex;align-items:center;gap:6px;">
      <label style="font-size:14px;color:#7a9090;">News window:</label>
      <select onchange="__wpA.setIntelInterval(this.value)" style="background:#2b3333;color:#e0e8e8;border:1px solid #617070;border-radius:4px;padding:3px 6px;font-size:14px;">
        ${intervalOpts.map(o => `<option value="${o}" ${S.intelInterval===o?'selected':''}>${o} ticks</option>`).join('')}
      </select>
    </div>`;

  // Sort indicator helper
  const si = (c) => {
    if (S.intelSort.col !== c) return '<span style="color:#617070;margin-left:3px;">⇅</span>';
    return S.intelSort.dir === -1
      ? '<span style="color:#ffd400;margin-left:3px;">↓</span>'
      : '<span style="color:#ffd400;margin-left:3px;">↑</span>';
  };

  // Column header helper
  const _thBase = `cursor:pointer;user-select:none;white-space:nowrap;padding:5px 7px;background:#2b3333;font-size:13px;font-weight:700;color:#7a9090;letter-spacing:.5px;text-transform:uppercase;border-bottom:1px solid #617070;`;

  const th = (col, label, title='') =>
    `<th onclick="__wpA.intelSort('${col}')" title="${esc(title)}"
      style="${_thBase}text-align:right;${S.intelSort.col===col?'color:#ffd400;':''}"
    >${label}${si(col)}</th>`;

  const thLeft = (col, label) =>
    `<th onclick="__wpA.intelSort('${col}')"
      style="${_thBase}text-align:left;${S.intelSort.col===col?'color:#ffd400;':''}"
    >${label}${si(col)}</th>`;

  const _td  = 'padding:5px 7px;text-align:right;font-size:17px;';
  const _tdl = 'padding:5px 7px;font-size:17px;';

  const tableRows = rows.map(r => {
    const ageCol = r.stale ? '#E05050' : r.intelAge != null ? (r.intelAge < 3600 ? '#60C040' : r.intelAge < 14400 ? '#ffd400' : '#e09040') : '#7a9090';
    const gainCol  = r.acresGained > 0 ? '#60C040' : '#617070';
    const lossCol  = r.acresLost   > 0 ? '#E05050' : '#617070';
    const atkCol   = r.attacksMade >= 4 ? '#E05050' : r.attacksMade >= 2 ? '#e09040' : r.attacksMade > 0 ? '#ffd400' : '#617070';

    return `<tr style="border-bottom:1px solid rgba(97,112,112,.2);">
      <td style="${_tdl}font-weight:700;color:#ffffff;">${r.slot}</td>
      <td style="${_tdl}color:#ffffff;font-weight:500;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.name)}</td>
      <td style="${_tdl}color:#7a9090;">${esc(r.race)}</td>
      <td style="${_td}">${fK(r.nw)}</td>
      <td style="${_td}">${fK(r.land)}</td>
      <td style="${_td}">${fK(r.off)}</td>
      <td style="${_td}">${fK(r.def)}</td>
      <td style="${_td}">${fK(r.nwpa)}</td>
      <td style="${_td}">${fK(r.peons)}</td>
      <td style="${_td}color:${gainCol};font-weight:${r.acresGained>0?'700':'400'};">${r.acresGained > 0 ? '+'+fK(r.acresGained) : '—'}</td>
      <td style="${_td}color:${lossCol};font-weight:${r.acresLost>0?'700':'400'};">${r.acresLost > 0 ? '-'+fK(r.acresLost) : '—'}</td>
      <td style="${_td}color:${atkCol};font-weight:${r.attacksMade>0?'700':'400'};">${r.attacksMade || '—'}</td>
      <td style="${_td}color:${r.razes>0?'#E05050':'#617070'};font-weight:${r.razes>0?'700':'400'};">${r.razes > 0 ? r.razes+'×' : '—'}</td>
      <td style="${_td}color:${r.razeAcres>0?'#E05050':'#617070'};font-weight:${r.razeAcres>0?'700':'400'};">${r.razeAcres > 0 ? '-'+fK(r.razeAcres) : '—'}</td>
      <td style="${_td}color:${r.massacres>0?'#E05050':'#617070'};font-weight:${r.massacres>0?'700':'400'};">${r.massacres > 0 ? r.massacres+'×' : '—'}</td>
      <td style="${_td}vertical-align:top;line-height:1.5;">${
        r.armiesAway.length === 0
          ? '<span style="color:#617070">—</span>'
          : r.armiesAway.map(a => {
              const t = a.secondsRemaining != null && a.secondsRemaining > 0
                ? `<span style="color:#ffd400">${fA(a.secondsRemaining)}</span>`
                : `<span style="color:#E05050;font-weight:700">OVER</span>`;
              return `<span style="white-space:nowrap">${fK(a.oSpecs)}&nbsp;·&nbsp;${t}</span>`;
            }).join('<br>')
      }</td>
      <td style="${_td}color:${ageCol};">${r.intelAge != null ? fA(r.intelAge) : '—'}</td>
    </tr>`;
  }).join('');

  // Kingdom totals row
  const totals = rows.reduce((s, r) => ({
    nw: s.nw + r.nw, land: s.land + r.land,
    off: s.off + r.off, def: s.def + r.def,
    peons: s.peons + r.peons,
    gained: s.gained + r.acresGained,
    lost: s.lost + r.acresLost,
    attacks: s.attacks + r.attacksMade,
    razes: s.razes + r.razes, razeAcres: s.razeAcres + r.razeAcres,
    massacres: s.massacres + r.massacres,
  }), { nw:0, land:0, off:0, def:0, peons:0, gained:0, lost:0, attacks:0, razes:0, razeAcres:0, massacres:0 });

  const _tt = 'padding:5px 7px;text-align:right;font-size:17px;font-weight:700;';
  const totRow = `<tr style="border-top:2px solid #617070;background:#2b3333;">
    <td colspan="3" style="padding:5px 7px;font-size:15px;font-weight:700;color:#7a9090;text-transform:uppercase;letter-spacing:.5px;">KD Total</td>
    <td style="${_tt}color:#ffd400;">${fK(totals.nw)}</td>
    <td style="${_tt}color:#ffd400;">${fK(totals.land)}</td>
    <td style="${_tt}color:#ffd400;">${fK(totals.off)}</td>
    <td style="${_tt}color:#ffd400;">${fK(totals.def)}</td>
    <td style="padding:5px 7px;"></td>
    <td style="${_tt}color:#ffd400;">${fK(totals.peons)}</td>
    <td style="${_tt}color:#60C040;">${totals.gained > 0 ? '+'+fK(totals.gained) : '—'}</td>
    <td style="${_tt}color:#E05050;">${totals.lost > 0 ? '-'+fK(totals.lost) : '—'}</td>
    <td style="${_tt}color:#ffd400;">${totals.attacks || '—'}</td>
    <td style="${_tt}color:${totals.razes>0?'#E05050':'#7a9090'};">${totals.razes > 0 ? totals.razes+'×' : '—'}</td>
    <td style="${_tt}color:${totals.razeAcres>0?'#E05050':'#7a9090'};">${totals.razeAcres > 0 ? '-'+fK(totals.razeAcres) : '—'}</td>
    <td style="${_tt}color:${totals.massacres>0?'#E05050':'#7a9090'};">${totals.massacres > 0 ? totals.massacres+'×' : '—'}</td>
    <td></td><td></td>
  </tr>`;

  const table = `
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:19px;background:#3c4545;border:1px solid #617070;border-radius:4px;overflow:hidden;">
        <thead><tr>
          ${thLeft('slot','#')}
          ${thLeft('name','Province')}
          ${thLeft('race','Race')}
          ${th('nw','NW','Networth')}
          ${th('land','Acres')}
          ${th('off','Off','Offence points')}
          ${th('def','Def','Defence points')}
          ${th('nwpa','NW/Ac','Networth per acre')}
          ${th('peons','Peons','Peasant population')}
          ${th('acresGained','+Ac','Acres gained (current news edition)')}
          ${th('acresLost','-Ac','Acres lost (current news edition)')}
          ${th('attacksMade','Atks','Attacks made (current news edition)')}
          ${th('razes','Rz','Razes (current news edition)')}
          ${th('razeAcres','RzAc','Raze acres (current news edition)')}
          ${th('massacres','Ms','Massacres (current news edition)')}
          ${th('awayEarliest','Away','Enemy armies away — oSpecs · time to return')}
          ${th('intelAge','Age','Intel age')}
        </tr></thead>
        <tbody>${tableRows}</tbody>
        <tfoot>${totRow}</tfoot>
      </table>
    </div>`;

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:14px;flex-wrap:wrap;">
      ${newsStatusEl}
      <div style="display:flex;align-items:center;gap:14px;">
        ${intervalEl}
        <div style="font-size:17px;color:#7a9090;">${rows.length} provinces · ${esc(S.enemy.kingdomName || S.eLoc)}</div>
      </div>
    </div>
    ${table}`;
}
