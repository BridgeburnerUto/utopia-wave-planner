// ── TAB: NW GRAPH ──────────────────────────────────────────────────────────
// Snapshots kingdom NW to Firebase once per tick (when at war).
// Renders a line graph of own vs enemy NW over the war period.
// Formula: warNW = totalNW - (acres * 50)

// ── NW calculation ───────────────────────────────────────────────────────────

function _calcKdNW(provinces) {
  return provinces.reduce((sum, p) => {
    const nw   = p.networth || p.sot?.networth || 0;
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

/** True if all enemy provinces with SoT have intel under 60 minutes old */
function _enemyFresh(provinces) {
  const withSot = provinces.filter(p => p.sot);
  if (!withSot.length) return false;
  return withSot.every(p => {
    const age = p.calcs?.defPointsSummary?.ageSeconds ?? p.sot?.ageSeconds;
    return age != null && age < 3600;
  });
}

// ── Firebase snapshot helpers ────────────────────────────────────────────────

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
    kdId,
    tick,
    tickName,
    ownTotal,
    ownWarNW,
    eneTotal,
    eneWarNW,
    eneFresh,
    storedAt: Date.now(),
  });

  console.log(`[WavePlanner] NW snapshot tick ${tick}: own=${Math.round(ownTotal/1000)}k war=${Math.round(ownWarNW/1000)}k ene=${Math.round(eneTotal/1000)}k`);
}

/** Delete nw_snapshots older than 30 real days — runs silently on init */
async function cleanOldSnapshots() {
  const kdId = S.own?.location.replace(':', '_');
  if (!kdId) return;
  try {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const docs   = await fbQuery('nw_snapshots', [{ field: 'kdId', value: kdId }]);
    if (!docs?.length) return; // no snapshots yet — nothing to clean
    let deleted = 0;
    for (const doc of docs) {
      if ((doc.storedAt || 0) < cutoff && doc.tick) {
        const ok = await fbDelete(`nw_snapshots/${kdId}_${doc.tick}`);
        if (ok) deleted++;
      }
    }
    if (deleted) console.log(`[WavePlanner] Cleaned ${deleted} old NW snapshots`);
  } catch(e) {
    console.log('[WavePlanner] Snapshot cleanup skipped:', e.message);
  }
}

// ── Render ───────────────────────────────────────────────────────────────────

async function renderNwGraph() {
  const el = $id('__wpc_nwgraph');
  el.innerHTML = loadingHTML('LOADING NW DATA...');

  try {
    const kdId = S.own?.location.replace(':', '_');
    const docs  = await fbQuery('nw_snapshots', [{ field: 'kdId', value: kdId }]);

    if (!docs.length) {
      el.innerHTML = `<div style="color:#7a5a2a;font-family:monospace;font-size:12px;padding:30px 0;text-align:center">
        // No NW data yet.<br>
        <span style="font-size:11px">Data is collected automatically each time the tool is opened during war.</span>
        ${!S.own?.war ? '<br><br><span style="color:#E05050">Not currently at war — showing historical data only.</span>' : ''}
      </div>`;
      return;
    }

    // Sort by tick ascending
    const points = docs.sort((a, b) => a.tick - b.tick);
    el.innerHTML = _buildGraph(points);

  } catch(e) {
    el.innerHTML = `<div style="color:#E05050;font-family:monospace;font-size:12px;padding:20px 0">
      Error loading NW data: ${esc(e.message)}
    </div>`;
  }
}

/**
 * Build solid polyline segments for contiguous runs of fresh enemy data points.
 * Each unbroken run of eneFresh=true points becomes its own <polyline>.
 * This correctly handles mixed fresh/stale sequences without index mapping bugs.
 */
function _buildFreshSegments(vals, points, xPos, yPos) {
  const segments = [];
  let current = [];

  points.forEach((p, i) => {
    if (p.eneFresh) {
      current.push(`${xPos(i).toFixed(1)},${yPos(vals[i]).toFixed(1)}`);
    } else {
      if (current.length >= 2) segments.push(current.join(' '));
      else if (current.length === 1) segments.push(current[0]); // isolated fresh point — dot handles it
      current = [];
    }
  });
  if (current.length >= 2) segments.push(current.join(' '));

  return segments.map(pts =>
    `<polyline points="${pts}" fill="none" stroke="#D4A017" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`
  ).join('\n      ');
}

function _buildGraph(points) {
  if (!S.nwView) S.nwView = 'total';
  const isTotal = S.nwView === 'total';

  const ownVals = points.map(p => isTotal ? p.ownTotal : p.ownWarNW);
  const eneVals = points.map(p => isTotal ? p.eneTotal : p.eneWarNW);
  const allVals = [...ownVals, ...eneVals].filter(v => v > 0);

  if (!allVals.length) return '<div style="color:#7a5a2a;font-family:monospace;font-size:12px;padding:20px 0">// No valid data points.</div>';

  const minV  = Math.min(...allVals) * 0.95;
  const maxV  = Math.max(...allVals) * 1.05;
  const range = maxV - minV || 1;

  // SVG dimensions
  const W = 760, H = 280;
  const PAD = { top: 20, right: 20, bottom: 40, left: 70 };
  const gW  = W - PAD.left - PAD.right;
  const gH  = H - PAD.top  - PAD.bottom;
  const n   = points.length;

  function xPos(i)  { return PAD.left + (n > 1 ? i / (n - 1) : 0.5) * gW; }
  function yPos(v)  { return PAD.top  + (1 - (v - minV) / range) * gH; }

  // Build polyline points
  function polyline(vals, skipStale) {
    return vals.map((v, i) => {
      if (skipStale && !points[i].eneFresh) return null;
      return `${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`;
    }).filter(Boolean).join(' ');
  }

  // Y axis labels
  const yTicks = 5;
  let yAxisHtml = '';
  for (let i = 0; i <= yTicks; i++) {
    const v = minV + (range * i / yTicks);
    const y = yPos(v);
    yAxisHtml += `<text x="${PAD.left - 8}" y="${y.toFixed(1)}" text-anchor="end" fill="#7a5a2a" font-size="10" dominant-baseline="middle">${fK(v)}</text>`;
    yAxisHtml += `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${W - PAD.right}" y2="${y.toFixed(1)}" stroke="#3a2810" stroke-width="1"/>`;
  }

  // X axis labels — show every Nth tick label to avoid crowding
  const step = Math.max(1, Math.floor(n / 8));
  let xAxisHtml = '';
  points.forEach((p, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    const x = xPos(i);
    const label = p.tickName ? p.tickName.replace(', YR', '/YR') : `T${p.tick}`;
    xAxisHtml += `<text x="${x.toFixed(1)}" y="${H - PAD.bottom + 14}" text-anchor="middle" fill="#7a5a2a" font-size="9">${esc(label)}</text>`;
  });

  // Stale enemy points — dashed line + dim dots
  const eneStalePoints = points.map((p, i) => !p.eneFresh ? i : null).filter(i => i !== null);
  const eneFreshPoints = points.map((p, i) =>  p.eneFresh ? i : null).filter(i => i !== null);

  // Build paths — own always solid, enemy fresh=solid stale=dashed
  function buildPath(vals, indices, color, dashed) {
    if (!indices.length) return '';
    const pts = indices.map(i => `${xPos(i).toFixed(1)},${yPos(vals[i]).toFixed(1)}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" ${dashed ? 'stroke-dasharray="4,3"' : ''} stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  // Data point dots
  function buildDots(vals, points_, color, stale) {
    return points_.map((p, i) => {
      const x = xPos(i), y = yPos(vals[i]);
      const fresh = p.eneFresh;
      const r = 3;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"
        fill="${stale && !fresh ? 'none' : color}"
        stroke="${color}" stroke-width="${stale && !fresh ? 1.5 : 0}"
        opacity="${stale && !fresh ? 0.5 : 1}">
        <title>${esc(p.tickName || 'Tick ' + p.tick)}: ${fK(stale ? (isTotal ? p.eneTotal : p.eneWarNW) : (isTotal ? p.ownTotal : p.ownWarNW))}${!fresh && stale ? ' (stale intel)' : ''}</title>
      </circle>`;
    }).join('');
  }

  // Latest values for summary
  const last     = points[points.length - 1];
  const ownLast  = isTotal ? last.ownTotal  : last.ownWarNW;
  const eneLast  = isTotal ? last.eneTotal  : last.eneWarNW;
  const ownFirst = isTotal ? points[0].ownTotal : points[0].ownWarNW;
  const eneFirst = isTotal ? points[0].eneTotal : points[0].eneWarNW;
  const ownDiff  = ownLast - ownFirst;
  const eneDiff  = eneLast - eneFirst;
  const diffColor = (v) => v >= 0 ? '#60C040' : '#E05050';
  const diffSign  = (v) => v >= 0 ? '+' : '';

  const svg = `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
      style="width:100%;height:auto;background:#1a1208;border-radius:4px;border:1px solid #3a2810">
      <!-- Grid -->
      ${yAxisHtml}
      ${xAxisHtml}
      <!-- Axis lines -->
      <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${H - PAD.bottom}" stroke="#4a3010" stroke-width="1"/>
      <line x1="${PAD.left}" y1="${H - PAD.bottom}" x2="${W - PAD.right}" y2="${H - PAD.bottom}" stroke="#4a3010" stroke-width="1"/>
      <!-- Own line (always solid green) -->
      <polyline points="${ownVals.map((v,i) => `${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`).join(' ')}"
        fill="none" stroke="#60C040" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${buildDots(ownVals, points, '#60C040', false)}
      <!-- Enemy line — full dashed baseline, solid segments over fresh points -->
      <polyline points="${eneVals.map((v,i) => `${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`).join(' ')}"
        fill="none" stroke="#D4A017" stroke-width="1.5" stroke-dasharray="4,3" stroke-linecap="round" stroke-linejoin="round" opacity="0.35"/>
      ${_buildFreshSegments(eneVals, points, xPos, yPos)}
      ${buildDots(eneVals, points, '#D4A017', true)}
      <!-- Legend -->
      <circle cx="${PAD.left + 10}" cy="${PAD.top + 10}" r="4" fill="#60C040"/>
      <text x="${PAD.left + 18}" y="${PAD.top + 10}" fill="#60C040" font-size="10" dominant-baseline="middle">Own KD</text>
      <circle cx="${PAD.left + 80}" cy="${PAD.top + 10}" r="4" fill="#D4A017"/>
      <text x="${PAD.left + 88}" y="${PAD.top + 10}" fill="#D4A017" font-size="10" dominant-baseline="middle">Enemy (● fresh ○ stale)</text>
    </svg>`;

  // View toggle + summary stats
  const header = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="font-family:monospace;font-size:10px;color:#7a5a2a;letter-spacing:2px;text-transform:uppercase">
        ${points.length} snapshots · ${esc(points[0].tickName||'')} → ${esc(last.tickName||'')}
        ${!S.own?.war ? ' · <span style="color:#e09040">War ended</span>' : ''}
      </div>
      <div style="display:flex;gap:6px">
        <button class="wb${isTotal ? ' g' : ''}" style="font-size:10px;padding:3px 9px" onclick="__wpA.nwView('total')">Total NW</button>
        <button class="wb${!isTotal ? ' g' : ''}" style="font-size:10px;padding:3px 9px" onclick="__wpA.nwView('war')">War NW</button>
      </div>
    </div>
    <div class="wsum" style="margin-bottom:12px">
      <div class="wscard"><div class="l">Own Current</div><div class="v">${fK(ownLast)}</div><div class="s" style="color:${diffColor(ownDiff)}">${diffSign(ownDiff)}${fK(ownDiff)} since start</div></div>
      <div class="wscard"><div class="l">Enemy Current</div><div class="v">${fK(eneLast)}</div><div class="s" style="color:${diffColor(eneDiff)}">${diffSign(eneDiff)}${fK(eneDiff)} since start</div></div>
      <div class="wscard"><div class="l">Difference</div><div class="v" style="color:${diffColor(ownLast-eneLast)}">${fK(Math.abs(ownLast-eneLast))}</div><div class="s">${ownLast >= eneLast ? 'Own leads' : 'Enemy leads'}</div></div>
      <div class="wscard"><div class="l">Data Points</div><div class="v">${points.length}</div><div class="s">${last.eneFresh ? '✓ fresh intel' : '⚠ stale intel'}</div></div>
    </div>`;

  return header + svg;
}
