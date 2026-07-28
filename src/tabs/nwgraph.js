// ── TAB: NW GRAPH ──────────────────────────────────────────────────────────
// World dump NW history for any two KD locations.
// Data is written hourly to kd_nw_history by GitHub Actions (scripts/snapshot.js).
// Requires a Firestore composite index on (loc ASC, storedAt ASC).
//
// Also maintains own war-tick snapshots in nw_snapshots (used for detailed
// per-province war NW tracking — kept for compatibility and future use).

// ── Per-province war NW helpers (own war snapshots) ──────────────────────────

function _calcKdNW(provinces) {
  return provinces.reduce((sum, p) => {
    const nw = p.networth || p.sot?.networth || 0;
    return sum + nw;
  }, 0);
}

function _calcKdWarNW(provinces) {
  return provinces.reduce((sum, p) => {
    const nw   = p.networth || p.sot?.networth || 0;
    const land = p.land     || p.sot?.land     || 0;
    return sum + Math.max(0, nw - land * 50);
  }, 0);
}

/** KD-level popspace: sums _provLivingSpace / _provCurrentPop over provinces.
 *  surveyed = provinces whose capacity came from a real survey. */
function _calcKdPopspace(provinces) {
  let cap = 0, pop = 0, surveyed = 0;
  for (const p of provinces) {
    const ls = _provLivingSpace(p);
    if (ls) { cap += ls.cap; if (ls.precise) surveyed++; }
    const cp = _provCurrentPop(p);
    if (cp != null) pop += cp;
  }
  return { cap: Math.round(cap), pop: Math.round(pop), surveyed, n: provinces.length };
}

function _enemyFresh(provinces) {
  const withSot = provinces.filter(p => p.sot);
  if (!withSot.length) return false;
  return withSot.every(p => {
    const age = p.calcs?.defPointsSummary?.ageSeconds ?? p.sot?.ageSeconds;
    return age != null && age < 3600;
  });
}

// ── Own war snapshot (kept for war-period detail tracking) ───────────────────

async function snapshotNW() {
  if (!S.own?.war)   return; // only during war
  if (!S.own || !S.enemy) return;

  const kdId    = S.own.location.replace(':', '_');
  const tick    = S.own.currentTick?.tickNumber ?? parseInt(JSON.parse(localStorage.getItem('IntelState') || '{}').currentTick?.tickNumber || 0);
  const tickName = S.currentTickName || '';
  if (!tick) return;

  const ownTotal  = _calcKdNW(S.own.provinces);
  const ownWarNW  = _calcKdWarNW(S.own.provinces);
  const eneTotal  = _calcKdNW(S.enemy.provinces);
  const eneWarNW  = _calcKdWarNW(S.enemy.provinces);
  const eneFresh  = _enemyFresh(S.enemy.provinces);

  // Popspace (survey/race/science-precise where intel exists) — eneLoc is
  // stored so the Popspace graph never overlays a PREVIOUS war's enemy values
  // onto a different KD B.
  const ownPS = _calcKdPopspace(S.own.provinces);
  const enePS = _calcKdPopspace(S.enemy.provinces);

  await fbWrite(`nw_snapshots/${kdId}_${tick}`, {
    kdId, tick, tickName, ownTotal, ownWarNW, eneTotal, eneWarNW, eneFresh,
    eneLoc: S.eLoc || '',
    ownCap: ownPS.cap, ownPop: ownPS.pop, ownSurveyed: ownPS.surveyed, ownN: ownPS.n,
    eneCap: enePS.cap, enePop: enePS.pop, eneSurveyed: enePS.surveyed, eneN: enePS.n,
    storedAt: Date.now(),
  });
}

async function cleanOldSnapshots() {
  const kdId = S.own?.location.replace(':', '_');
  if (!kdId) return;
  try {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const docs   = await fbQuery('nw_snapshots', [{ field: 'kdId', value: kdId }]);
    if (!docs?.length) return;
    let deleted = 0;
    for (const doc of docs) {
      if ((doc.storedAt || 0) < cutoff && doc.tick) {
        const ok = await fbDelete(`nw_snapshots/${kdId}_${doc.tick}`);
        if (ok) deleted++;
      }
    }
    if (deleted) console.log(`[WavePlanner] Cleaned ${deleted} old war NW snapshots`);
  } catch(e) {
    console.log('[WavePlanner] Snapshot cleanup skipped:', e.message);
  }
}

// ── In-game date ↔ real timestamp conversion ─────────────────────────────────
// Since 1 tick = 1 real hour, any in-game date is just N hours from now.

/** Parse "July 18, YR1" or "July 18 YR1" → { month, day, year } */
function _nwParseTickName(s) {
  if (!s) return null;
  const m = s.match(/(\w+)\s+(\d+),?\s*YR(\d+)/i);
  if (!m) return null;
  const idx = MONTHS_LIST.findIndex(n => n.toLowerCase() === m[1].toLowerCase());
  if (idx < 0) return null;
  return { month: idx + 1, day: parseInt(m[2]), year: parseInt(m[3]) };
}

/**
 * Convert a real Unix ms timestamp back to an in-game { month, day, year }.
 * Inverse of _utoDateToTs — uses the current tick as anchor.
 * Returns null if S.currentTickName is not available.
 */
function _tsToUtoDate(ts) {
  const cur = _nwParseTickName(S.currentTickName);
  if (!cur) return null;
  const currentAbs = _utoToAbs(cur.month, cur.day, cur.year);
  const hoursAgo   = (Date.now() - ts) / 3_600_000;
  const targetAbs  = Math.round(currentAbs - hoursAgo);
  return _absToUto(Math.max(1, targetAbs));
}

/**
 * Convert an in-game { month, day, year } to a real Unix ms timestamp.
 * Uses the current tick as anchor: 1 tick difference = 1 real hour difference.
 * Returns null if S.currentTickName is not available.
 */
function _utoDateToTs(month, day, year) {
  const cur = _nwParseTickName(S.currentTickName);
  if (!cur) return null;
  const targetAbs  = _utoToAbs(month, day, year);
  const currentAbs = _utoToAbs(cur.month, cur.day, cur.year);
  const hoursDiff  = currentAbs - targetAbs;   // positive = target is in the past
  return Date.now() - hoursDiff * 3_600_000;
}

/** Build a month <select> element string */
function _monthSelect(id, selected) {
  const opts = MONTHS_LIST.map((name, i) =>
    `<option value="${i+1}"${selected === i+1 ? ' selected' : ''}>${name}</option>`
  ).join('');
  return `<select id="${id}" class="wpick" style="width:108px;font-size:17px;padding:4px 6px">${opts}</select>`;
}

// ── Controls builder ──────────────────────────────────────────────────────────

function _buildNwControls() {
  const presets = [6, 12, 24, 48];
  const view    = S.nwView === 'war' || S.nwView === 'pop' ? S.nwView : 'total';
  const viewHints = {
    total: '',
    war:   'War NW = Total − land×50 (per KD, approximate)',
    pop:   'Popspace = living space (acres×25 baseline; survey/race/science-precise + current pop where war snapshots exist)',
  };

  const presetBtns = presets.map(t =>
    `<button class="wb${!S.nwCustom && S.nwLookback === t ? ' g' : ''}" style="font-size:17px;padding:3px 10px"
      onclick="__wpA.nwPreset(${t})">Last ${t}t</button>`
  ).join('');

  const customBtn = `<button class="wb${S.nwCustom ? ' g' : ''}" style="font-size:17px;padding:3px 10px"
    onclick="__wpA.nwToggleCustom()">Custom</button>`;

  // Custom date row — only shown when S.nwCustom is true
  let customRow = '';
  if (S.nwCustom) {
    // Default from/to: 24 ticks ago → now (in in-game dates if we can compute them)
    const cur = _nwParseTickName(S.currentTickName);
    const defFrom = S.nwCustomFrom || (cur ? (() => {
      const a = _utoToAbs(cur.month, cur.day, cur.year) - 24;
      return _absToUto(Math.max(1, a));
    })() : { month: 1, day: 1, year: 1 });
    const defTo = S.nwCustomTo || cur || { month: 7, day: 24, year: 1 };

    customRow = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid #617070">
        <span style="font-size:17px;font-weight:700;color:#7a9090;letter-spacing:1px;text-transform:uppercase;width:36px">From</span>
        ${_monthSelect('__wpnw_fromM', defFrom.month)}
        <input id="__wpnw_fromD" type="number" min="1" max="24" value="${defFrom.day}"
          style="width:52px;background:#2b3333;border:1px solid #617070;color:#ffffff;font-size:17px;padding:4px 6px;border-radius:3px;outline:none;text-align:center">
        <span style="font-size:17px;color:#7a9090">YR</span>
        <input id="__wpnw_fromY" type="number" min="1" value="${defFrom.year}"
          style="width:48px;background:#2b3333;border:1px solid #617070;color:#ffffff;font-size:17px;padding:4px 6px;border-radius:3px;outline:none;text-align:center">

        <span style="font-size:19px;color:#617070;margin:0 4px">→</span>

        <span style="font-size:17px;font-weight:700;color:#7a9090;letter-spacing:1px;text-transform:uppercase;width:16px">To</span>
        ${_monthSelect('__wpnw_toM', defTo.month)}
        <input id="__wpnw_toD" type="number" min="1" max="24" value="${defTo.day}"
          style="width:52px;background:#2b3333;border:1px solid #617070;color:#ffffff;font-size:17px;padding:4px 6px;border-radius:3px;outline:none;text-align:center">
        <span style="font-size:17px;color:#7a9090">YR</span>
        <input id="__wpnw_toY" type="number" min="1" value="${defTo.year}"
          style="width:48px;background:#2b3333;border:1px solid #617070;color:#ffffff;font-size:17px;padding:4px 6px;border-radius:3px;outline:none;text-align:center">

        <button class="wb g" style="font-size:17px;padding:3px 14px;margin-left:4px" onclick="__wpA.nwLoad()">Load ▶</button>
        ${!S.currentTickName ? '<span style="font-size:17px;color:#e09040">⚠ Current tick not loaded — refresh first</span>' : ''}
      </div>`;
  }

  return `
    <div style="background:#3c4545;border:1px solid #617070;border-radius:4px;padding:12px 16px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:7px">
          <span style="font-size:17px;font-weight:700;color:#60C040;letter-spacing:1px;text-transform:uppercase">KD A</span>
          <input id="__wpnw_locA" type="text" value="${esc(S.nwLocA)}" placeholder="e.g. 5:3"
            style="width:72px;background:#2b3333;border:1px solid #617070;color:#ffffff;font-size:19px;padding:5px 8px;border-radius:3px;outline:none;font-family:monospace"
            onfocus="this.style.borderColor='#60C040'" onblur="this.style.borderColor='#617070'"
            onkeydown="if(event.key==='Enter')__wpA.nwLoad()">
        </div>
        <span style="color:#7a9090;font-size:17px;font-weight:700">vs</span>
        <div style="display:flex;align-items:center;gap:7px">
          <span style="font-size:17px;font-weight:700;color:#ffd400;letter-spacing:1px;text-transform:uppercase">KD B</span>
          <input id="__wpnw_locB" type="text" value="${esc(S.nwLocB)}" placeholder="e.g. 7:2"
            style="width:72px;background:#2b3333;border:1px solid #617070;color:#ffffff;font-size:19px;padding:5px 8px;border-radius:3px;outline:none;font-family:monospace"
            onfocus="this.style.borderColor='#ffd400'" onblur="this.style.borderColor='#617070'"
            onkeydown="if(event.key==='Enter')__wpA.nwLoad()">
        </div>
        <div style="display:flex;gap:4px;margin-left:4px">${presetBtns}${customBtn}</div>
        <button class="wb" style="font-size:17px;padding:3px 10px;border-color:#617070;color:#e09040" onclick="__wpA.nwFindWar()" title="Scan stored snapshots for when these two KDs were mutually at war">⚔ Find War</button>
        ${!S.nwCustom ? `<button class="wb g" style="font-size:17px;padding:3px 14px" onclick="__wpA.nwLoad()">Load ▶</button>` : ''}
      </div>
      ${customRow}
      <div style="display:flex;align-items:center;gap:6px;margin-top:10px;flex-wrap:wrap">
        <span style="font-size:17px;color:#7a9090;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-right:4px">View</span>
        <button class="wb${view === 'total' ? ' g' : ''}" style="font-size:17px;padding:3px 9px" onclick="__wpA.nwView('total')">Total NW</button>
        <button class="wb${view === 'war' ? ' g' : ''}" style="font-size:17px;padding:3px 9px" onclick="__wpA.nwView('war')">War NW</button>
        <button class="wb${view === 'pop' ? ' g' : ''}" style="font-size:17px;padding:3px 9px" onclick="__wpA.nwView('pop')">Popspace</button>
        ${viewHints[view] ? `<span style="font-size:17px;color:#7a9090;margin-left:6px">${viewHints[view]}</span>` : ''}
      </div>
    </div>`;
}

// ── Render entry point ────────────────────────────────────────────────────────

async function renderNwGraph() {
  const el = $id('__wpc_nwgraph');
  if (!el) return;

  // Set defaults from current war on first open
  if (!S.nwLocA) S.nwLocA = S.own?.location || '';
  if (!S.nwLocB) S.nwLocB = S.eLoc || '';
  if (!S.nwLookback) S.nwLookback = 24;

  // Render controls immediately, then async-fill the graph area
  el.innerHTML = _buildNwControls() + `<div id="__wpnwgraph_area">${loadingHTML('LOADING NW DATA...')}</div>`;

  await _loadAndRenderNwGraph();
}

async function _loadAndRenderNwGraph() {
  const area = $id('__wpnwgraph_area');
  if (!area) return;

  if (!S.nwLocA || !S.nwLocB) {
    area.innerHTML = `<div style="color:#7a9090;font-size:19px;padding:20px 0;font-style:italic">
      Enter two KD locations above (e.g. <span style="font-family:monospace;color:#b8c8c8">5:3</span>) and click Load.
    </div>`;
    return;
  }

  // Determine time range — preset or custom in-game dates
  let fromTs, toTs;
  if (S.nwCustom && S.nwCustomFrom && S.nwCustomTo) {
    fromTs = _utoDateToTs(S.nwCustomFrom.month, S.nwCustomFrom.day, S.nwCustomFrom.year);
    toTs   = _utoDateToTs(S.nwCustomTo.month,   S.nwCustomTo.day,   S.nwCustomTo.year);
    if (!fromTs || !toTs) {
      area.innerHTML = `<div style="color:#e09040;font-size:19px;padding:20px 0">
        ⚠ Cannot convert dates — current tick not loaded. Try refreshing the tool first.
      </div>`;
      return;
    }
    // Clamp to present — can't query snapshots that don't exist yet
    toTs = Math.min(toTs, Date.now());
    if (fromTs >= toTs) {
      area.innerHTML = `<div style="color:#E05050;font-size:19px;padding:20px 0">
        From date must be earlier than To date.
      </div>`;
      return;
    }
  } else {
    toTs   = Date.now();
    fromTs = toTs - (S.nwLookback * 3_600_000);
  }

  try {
    const [docsA, docsB] = await Promise.all([
      fbQueryNWHistory(S.nwLocA, fromTs, toTs),
      fbQueryNWHistory(S.nwLocB, fromTs, toTs),
    ]);

    // Popspace view: also load own war-tick snapshots (precise capacity +
    // current pop) when one of the graphed KDs is our own kingdom.
    let snaps = [];
    if (S.nwView === 'pop' && S.own?.location
        && [S.nwLocA, S.nwLocB].includes(S.own.location)) {
      const kdId = S.own.location.replace(':', '_');
      try {
        const all = await fbQuery('nw_snapshots', [{ field: 'kdId', value: kdId }]);
        snaps = (all || [])
          .filter(d => d.ownCap != null && d.storedAt >= fromTs && d.storedAt <= toTs)
          .sort((a, b) => a.storedAt - b.storedAt);
      } catch(e) { /* precise overlay is optional — baseline still renders */ }
    }

    if (!docsA.length && !docsB.length && !snaps.length) {
      area.innerHTML = `<div style="color:#7a9090;font-family:monospace;font-size:19px;padding:30px 0;text-align:center">
        // No data found for this period.<br>
        <span style="font-size:17px">Snapshots are written hourly by GitHub Actions.<br>
        Data appears ~1 hour after the workflow is set up and running.</span>
      </div>`;
      return;
    }

    // Old age data reminder — shown if any snapshot pre-dates the age start date
    let oldDataBanner = '';
    if (S.ageStartDate > 0) {
      const hasOld = [...docsA, ...docsB].some(d => d.storedAt < S.ageStartDate);
      if (hasOld) {
        oldDataBanner = `<div style="background:rgba(224,144,64,.08);border:1px solid rgba(224,144,64,.3);border-radius:3px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:12px">
          <span style="font-size:19px">📦</span>
          <span style="font-size:17px;color:#e09040">This range includes data from the previous age.
            <span onclick="__wpA.tab('alerts')" style="color:#ffd400;cursor:pointer;text-decoration:underline;margin-left:6px">Update age start date in Alerts tab</span>
            to schedule cleanup — GitHub Actions handles deletion on its next run.
          </span>
        </div>`;
      }
    }

    area.innerHTML = oldDataBanner + (S.nwView === 'pop'
      ? _buildPopGraph(docsA, docsB, snaps, S.nwLocA, S.nwLocB)
      : _buildWorldGraph(docsA, docsB, S.nwLocA, S.nwLocB));

  } catch(e) {
    area.innerHTML = `<div style="color:#E05050;font-family:monospace;font-size:19px;padding:20px 0">
      Error loading NW data: ${esc(e.message)}
    </div>`;
  }
}

// ── World graph renderer ──────────────────────────────────────────────────────

function _buildWorldGraph(docsA, docsB, locA, locB) {
  const isTotal = S.nwView !== 'war';
  const nameA   = docsA[0]?.name || locA;
  const nameB   = docsB[0]?.name || locB;

  // Merge all timestamps into a sorted unified timeline
  const tsSet = new Set([...docsA.map(d => d.storedAt), ...docsB.map(d => d.storedAt)]);
  const times  = [...tsSet].sort((a, b) => a - b);

  if (!times.length) return '<div style="color:#7a9090;font-family:monospace;font-size:19px;padding:20px 0">// No valid data points.</div>';

  const mapA = new Map(docsA.map(d => [d.storedAt, d]));
  const mapB = new Map(docsB.map(d => [d.storedAt, d]));

  function kdNW(doc) {
    if (!doc) return null;
    if (isTotal) return doc.nw || 0;
    // War NW approximation at KD level (per-province floored at 0 not possible here)
    return Math.max(0, (doc.nw || 0) - (doc.land || 0) * 50);
  }

  const valsA = times.map(t => kdNW(mapA.get(t)));
  const valsB = times.map(t => kdNW(mapB.get(t)));

  const allVals = [...valsA, ...valsB].filter(v => v != null && v > 0);
  if (!allVals.length) return '<div style="color:#7a9090;font-family:monospace;font-size:19px;padding:20px 0">// No valid data points.</div>';

  // Summary stats
  const lastA  = [...valsA].reverse().find(v => v != null);
  const lastB  = [...valsB].reverse().find(v => v != null);
  const firstA = valsA.find(v => v != null);
  const firstB = valsB.find(v => v != null);
  const diffA  = lastA != null && firstA != null ? lastA - firstA : null;
  const diffB  = lastB != null && firstB != null ? lastB - firstB : null;
  const dc = v => v >= 0 ? '#60C040' : '#E05050';
  const ds = v => v >= 0 ? '+' : '';

  const svg = _nwSvgGraph(times, [
    { vals: valsA, color: '#60C040', label: `${nameA} (${locA})` },
    { vals: valsB, color: '#ffd400', label: `${nameB} (${locB})` },
  ]);

  const summary = `
    <div class="wsum" style="margin-bottom:12px">
      <div class="wscard">
        <div class="l" style="color:#60C040">${esc(nameA)}</div>
        <div class="v">${lastA != null ? fK(lastA) : '—'}</div>
        ${diffA != null ? `<div class="s" style="color:${dc(diffA)}">${ds(diffA)}${fK(diffA)} over ${S.nwLookback}t</div>` : '<div class="s">—</div>'}
      </div>
      <div class="wscard">
        <div class="l" style="color:#ffd400">${esc(nameB)}</div>
        <div class="v">${lastB != null ? fK(lastB) : '—'}</div>
        ${diffB != null ? `<div class="s" style="color:${dc(diffB)}">${ds(diffB)}${fK(diffB)} over ${S.nwLookback}t</div>` : '<div class="s">—</div>'}
      </div>
      <div class="wscard">
        <div class="l">Lead</div>
        <div class="v" style="color:${lastA != null && lastB != null ? dc(lastA - lastB) : '#7a9090'}">${lastA != null && lastB != null ? fK(Math.abs(lastA - lastB)) : '—'}</div>
        <div class="s">${lastA != null && lastB != null ? (lastA >= lastB ? esc(nameA) + ' leads' : esc(nameB) + ' leads') : ''}</div>
      </div>
      <div class="wscard">
        <div class="l">Snapshots</div>
        <div class="v" style="font-size:21px">${Math.max(docsA.length, docsB.length)}</div>
        <div class="s">${S.nwLookback}t window</div>
      </div>
    </div>`;

  return summary + svg;
}

// ── Generic multi-series SVG line graph ──────────────────────────────────────
// times: sorted real timestamps; series: [{ vals, color, label, dash?,
// opacity?, width? }] with vals aligned to times (null = no data there).
// opts.connectGaps draws one continuous line through nulls (sparse series)
// instead of breaking segments at every gap.
function _nwSvgGraph(times, series, opts = {}) {
  const allVals = series.flatMap(s => s.vals).filter(v => v != null && v > 0);
  if (!allVals.length) return '<div style="color:#7a9090;font-family:monospace;font-size:19px;padding:20px 0">// No valid data points.</div>';

  const minV  = Math.min(...allVals) * 0.95;
  const maxV  = Math.max(...allVals) * 1.05;
  const range = maxV - minV || 1;

  const W = 760, H = 280;
  const PAD = { top: 20, right: 20, bottom: 50, left: 70 };
  const gW  = W - PAD.left - PAD.right;
  const gH  = H - PAD.top  - PAD.bottom;
  const n   = times.length;

  function xPos(i) { return PAD.left + (n > 1 ? i / (n - 1) : 0.5) * gW; }
  function yPos(v) { return PAD.top  + (1 - (v - minV) / range) * gH; }

  // Y axis grid
  let yAxisHtml = '';
  for (let i = 0; i <= 5; i++) {
    const v = minV + (range * i / 5);
    const y = yPos(v);
    yAxisHtml += `<text x="${PAD.left - 8}" y="${y.toFixed(1)}" text-anchor="end" fill="#7a9090" font-size="10" dominant-baseline="middle">${fK(v)}</text>`;
    yAxisHtml += `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${W - PAD.right}" y2="${y.toFixed(1)}" stroke="#617070" stroke-width="1"/>`;
  }

  // X axis labels — real timestamps, every Nth point to avoid crowding
  const step = Math.max(1, Math.floor(n / 8));
  let xAxisHtml = '';
  times.forEach((ts, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    const d = new Date(ts);
    const label = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:00`;
    xAxisHtml += `<text x="${xPos(i).toFixed(1)}" y="${H - PAD.bottom + 14}" text-anchor="middle" fill="#7a9090" font-size="9">${label}</text>`;
  });

  function lineFor(s) {
    const attrs = `fill="none" stroke="${s.color}" stroke-width="${s.width || 2.5}" stroke-linecap="round" stroke-linejoin="round"`
      + (s.dash    ? ` stroke-dasharray="${s.dash}"` : '')
      + (s.opacity ? ` opacity="${s.opacity}"`       : '');
    if (opts.connectGaps) {
      const pts = [];
      s.vals.forEach((v, i) => { if (v != null) pts.push(`${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`); });
      if (pts.length >= 2)  return `<polyline points="${pts.join(' ')}" ${attrs}/>`;
      if (pts.length === 1) return `<circle cx="${pts[0].split(',')[0]}" cy="${pts[0].split(',')[1]}" r="4" fill="${s.color}"/>`;
      return '';
    }
    // Break segments at null gaps (KD only in one dataset for some ticks)
    let result = '', seg = [];
    const flush = () => {
      if (seg.length >= 2)       result += `<polyline points="${seg.join(' ')}" ${attrs}/>`;
      else if (seg.length === 1) result += `<circle cx="${seg[0].split(',')[0]}" cy="${seg[0].split(',')[1]}" r="4" fill="${s.color}"/>`;
      seg = [];
    };
    s.vals.forEach((v, i) => {
      if (v != null) seg.push(`${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`);
      else flush();
    });
    flush();
    return result;
  }

  function dotsFor(s) {
    return s.vals.map((v, i) => {
      if (v == null) return '';
      const d = new Date(times[i]);
      const label = `${s.label} · ${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:00 — ${fK(v)}`;
      return `<circle cx="${xPos(i).toFixed(1)}" cy="${yPos(v).toFixed(1)}" r="3" fill="${s.color}" opacity="0.85">
        <title>${esc(label)}</title></circle>`;
    }).join('');
  }

  const legend = series.map((s, i) => `
    <circle cx="${PAD.left + 10}" cy="${PAD.top + 10 + i * 14}" r="4" fill="${s.color}"${s.opacity ? ` opacity="${s.opacity}"` : ''}/>
    <text x="${PAD.left + 18}" y="${PAD.top + 10 + i * 14}" fill="${s.color}" font-size="10" dominant-baseline="middle">${esc(s.label)}</text>`
  ).join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
      style="width:100%;height:auto;background:#3c4545;border-radius:4px;border:1px solid #617070">
      ${yAxisHtml}
      ${xAxisHtml}
      <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${H - PAD.bottom}" stroke="#617070" stroke-width="1"/>
      <line x1="${PAD.left}" y1="${H - PAD.bottom}" x2="${W - PAD.right}" y2="${H - PAD.bottom}" stroke="#617070" stroke-width="1"/>
      ${series.map(lineFor).join('')}
      ${series.map(dotsFor).join('')}
      ${legend}
    </svg>`;
}

// ── Popspace graph renderer ──────────────────────────────────────────────────
// Capacity per KD: acres×25 baseline from the hourly world dump, replaced by
// the survey/race/science-precise value from own war snapshots in any hour
// where one exists (mixing both in the same hour would zigzag by the race
// multiplier). Current-pop lines exist only where war snapshots do — the
// world dump carries no population.
function _buildPopGraph(docsA, docsB, snaps, locA, locB) {
  const nameA  = docsA[0]?.name || locA;
  const nameB  = docsB[0]?.name || locB;
  const ownLoc = S.own?.location;
  const hourOf = ts => Math.floor(ts / 3_600_000);

  // Which snapshot fields apply to a graphed KD — own side always; the other
  // side only when the snapshot's recorded war enemy IS that KD.
  const snapVals = (s, loc) => {
    if (loc === ownLoc)   return { cap: s.ownCap, pop: s.ownPop };
    if (s.eneLoc === loc) return { cap: s.eneCap, pop: s.enePop };
    return null;
  };

  function capMap(docs, loc) {
    const m = new Map();
    docs.forEach(d => { if (d.land) m.set(hourOf(d.storedAt), (d.land || 0) * 25); });
    snaps.forEach(s => {
      const v = snapVals(s, loc);
      if (v?.cap) m.set(hourOf(s.storedAt), v.cap); // precise wins over baseline
    });
    return m;
  }
  function popMap(loc) {
    const m = new Map();
    snaps.forEach(s => {
      const v = snapVals(s, loc);
      if (v?.pop) m.set(hourOf(s.storedAt), v.pop);
    });
    return m;
  }

  const capA = capMap(docsA, locA), capB = capMap(docsB, locB);
  const popA = popMap(locA),        popB = popMap(locB);

  const hours = [...new Set([...capA.keys(), ...capB.keys(), ...popA.keys(), ...popB.keys()])].sort((a, b) => a - b);
  if (!hours.length) return '<div style="color:#7a9090;font-family:monospace;font-size:19px;padding:20px 0">// No valid data points.</div>';
  const times = hours.map(h => h * 3_600_000);

  const seriesOf = m => hours.map(h => m.get(h) ?? null);
  const cA = seriesOf(capA), cB = seriesOf(capB);
  const pA = seriesOf(popA), pB = seriesOf(popB);

  const series = [
    { vals: cA, color: '#60C040', label: `${nameA} capacity` },
    { vals: pA, color: '#60C040', label: `${nameA} current pop`, dash: '6,5', width: 2, opacity: 0.65 },
    { vals: cB, color: '#ffd400', label: `${nameB} capacity` },
    { vals: pB, color: '#ffd400', label: `${nameB} current pop`, dash: '6,5', width: 2, opacity: 0.65 },
  ].filter(s => s.vals.some(v => v != null));

  // Summary cards
  const last  = vals => [...vals].reverse().find(v => v != null) ?? null;
  const first = vals => vals.find(v => v != null) ?? null;
  const lastCapA = last(cA), lastCapB = last(cB);
  const diffA = lastCapA != null && first(cA) != null ? lastCapA - first(cA) : null;
  const diffB = lastCapB != null && first(cB) != null ? lastCapB - first(cB) : null;
  const lastPopA = last(pA), lastPopB = last(pB);
  const dc = v => v >= 0 ? '#60C040' : '#E05050';
  const ds = v => v >= 0 ? '+' : '';

  // Precision note — how many provinces the latest snapshot had real surveys for
  let precLabel = 'acres ×25', precSub = 'no war snapshots in range';
  const latestSnap = snaps.length ? snaps[snaps.length - 1] : null;
  if (latestSnap) {
    const bits = [];
    if (ownLoc && [locA, locB].includes(ownLoc)) bits.push(`own ${latestSnap.ownSurveyed ?? '?'}/${latestSnap.ownN ?? '?'}`);
    const other = locA === ownLoc ? locB : locA;
    if (latestSnap.eneLoc === other) bits.push(`eny ${latestSnap.eneSurveyed ?? '?'}/${latestSnap.eneN ?? '?'}`);
    if (bits.length) { precLabel = bits.join(' · '); precSub = 'provs surveyed (latest snap)'; }
  }

  const summary = `
    <div class="wsum" style="margin-bottom:12px">
      <div class="wscard">
        <div class="l" style="color:#60C040">${esc(nameA)} cap</div>
        <div class="v">${lastCapA != null ? fK(lastCapA) : '—'}</div>
        ${diffA != null ? `<div class="s" style="color:${dc(diffA)}">${ds(diffA)}${fK(diffA)} in window</div>` : '<div class="s">—</div>'}
      </div>
      <div class="wscard">
        <div class="l" style="color:#ffd400">${esc(nameB)} cap</div>
        <div class="v">${lastCapB != null ? fK(lastCapB) : '—'}</div>
        ${diffB != null ? `<div class="s" style="color:${dc(diffB)}">${ds(diffB)}${fK(diffB)} in window</div>` : '<div class="s">—</div>'}
      </div>
      <div class="wscard">
        <div class="l">Current Pop</div>
        <div class="v" style="font-size:21px">
          <span style="color:#60C040">${lastPopA != null ? fK(lastPopA) : '—'}</span>
          <span style="color:#7a9090"> vs </span>
          <span style="color:#ffd400">${lastPopB != null ? fK(lastPopB) : '—'}</span>
        </div>
        <div class="s">from war snapshots</div>
      </div>
      <div class="wscard">
        <div class="l">Precision</div>
        <div class="v" style="font-size:21px">${esc(precLabel)}</div>
        <div class="s">${esc(precSub)}</div>
      </div>
    </div>`;

  return summary + _nwSvgGraph(times, series, { connectGaps: true });
}
