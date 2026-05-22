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

  await fbWrite(`nw_snapshots/${kdId}_${tick}`, {
    kdId, tick, tickName, ownTotal, ownWarNW, eneTotal, eneWarNW, eneFresh,
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
  const isTotal = S.nwView !== 'war';

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
      <div style="display:flex;align-items:center;gap:6px;margin-top:10px">
        <span style="font-size:17px;color:#7a9090;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-right:4px">View</span>
        <button class="wb${isTotal ? ' g' : ''}" style="font-size:17px;padding:3px 9px" onclick="__wpA.nwView('total')">Total NW</button>
        <button class="wb${!isTotal ? ' g' : ''}" style="font-size:17px;padding:3px 9px" onclick="__wpA.nwView('war')">War NW</button>
        <span style="font-size:17px;color:#7a9090;margin-left:6px">War NW = Total − land×50 (per KD, approximate)</span>
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

    if (!docsA.length && !docsB.length) {
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

    area.innerHTML = oldDataBanner + _buildWorldGraph(docsA, docsB, S.nwLocA, S.nwLocB);

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

  // Build polyline segments — skip null gaps (KD only in one dataset for some ticks)
  function buildSegments(vals, color) {
    let result = '';
    let seg = [];
    vals.forEach((v, i) => {
      if (v != null) {
        seg.push(`${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`);
      } else {
        if (seg.length >= 2) result += `<polyline points="${seg.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
        seg = [];
      }
    });
    if (seg.length >= 2) result += `<polyline points="${seg.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    else if (seg.length === 1) result += `<circle cx="${seg[0].split(',')[0]}" cy="${seg[0].split(',')[1]}" r="4" fill="${color}"/>`;
    return result;
  }

  function buildDots(vals, color) {
    return vals.map((v, i) => {
      if (v == null) return '';
      const d = new Date(times[i]);
      const label = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:00 — ${fK(v)}`;
      return `<circle cx="${xPos(i).toFixed(1)}" cy="${yPos(v).toFixed(1)}" r="3" fill="${color}" opacity="0.85">
        <title>${label}</title></circle>`;
    }).join('');
  }

  // Summary stats
  const lastA  = [...valsA].reverse().find(v => v != null);
  const lastB  = [...valsB].reverse().find(v => v != null);
  const firstA = valsA.find(v => v != null);
  const firstB = valsB.find(v => v != null);
  const diffA  = lastA != null && firstA != null ? lastA - firstA : null;
  const diffB  = lastB != null && firstB != null ? lastB - firstB : null;
  const dc = v => v >= 0 ? '#60C040' : '#E05050';
  const ds = v => v >= 0 ? '+' : '';

  const svg = `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
      style="width:100%;height:auto;background:#3c4545;border-radius:4px;border:1px solid #617070">
      ${yAxisHtml}
      ${xAxisHtml}
      <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${H - PAD.bottom}" stroke="#617070" stroke-width="1"/>
      <line x1="${PAD.left}" y1="${H - PAD.bottom}" x2="${W - PAD.right}" y2="${H - PAD.bottom}" stroke="#617070" stroke-width="1"/>
      ${buildSegments(valsA, '#60C040')}
      ${buildDots(valsA, '#60C040')}
      ${buildSegments(valsB, '#ffd400')}
      ${buildDots(valsB, '#ffd400')}
      <!-- Legend -->
      <circle cx="${PAD.left + 10}" cy="${PAD.top + 10}" r="4" fill="#60C040"/>
      <text x="${PAD.left + 18}" y="${PAD.top + 10}" fill="#60C040" font-size="10" dominant-baseline="middle">${esc(nameA)} (${esc(locA)})</text>
      <circle cx="${PAD.left + 10}" cy="${PAD.top + 24}" r="4" fill="#ffd400"/>
      <text x="${PAD.left + 18}" y="${PAD.top + 24}" fill="#ffd400" font-size="10" dominant-baseline="middle">${esc(nameB)} (${esc(locB)})</text>
    </svg>`;

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
