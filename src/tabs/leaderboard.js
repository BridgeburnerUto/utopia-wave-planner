// ── TAB: LEADERBOARD ───────────────────────────────────────────────────────

function lbView(v) {
  S.lbView = v;
  renderLeaderboard();
}

async function renderLeaderboard() {
  const el = $id('__wpc_leaderboard');
  el.innerHTML = loadingHTML('LOADING LEADERBOARD...');

  try {
    const kdId = S.own?.location.replace(':', '_');
    const ops  = await fbQuery('ops', [{ field: 'kingdomId', value: kdId }]);

    if (!ops.length) {
      el.innerHTML = `<div style="color:#4a6a88;font-family:monospace;font-size:12px;padding:20px 0">
        // No op data yet — data accumulates automatically as players use the tool during war.
      </div>`;
      return;
    }

    el.innerHTML = _buildLeaderboard(ops);
  } catch (e) {
    el.innerHTML = `<div style="color:#ff4455;font-family:monospace;font-size:12px;padding:20px 0">
      Error loading leaderboard: ${esc(e.message)}
    </div>`;
  }
}

function _buildLeaderboard(ops) {
  // Aggregate by province
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
    p.totalGain   += (op.gain || 0);
    p.opCounts[op.opType] = (p.opCounts[op.opType] || 0) + 1;
    if (op.opName) p.opNames[op.opType] = op.opName;
    if (!p.lastSeen || op.utoDate > p.lastSeen) p.lastSeen = op.utoDate;
  });

  const sorted     = Object.values(byProv).sort((a, b) => b.totalDamage - a.totalDamage);
  const totalDmg   = sorted.reduce((s, p) => s + p.totalDamage, 0);
  const totalOps   = sorted.reduce((s, p) => s + p.totalOps, 0);
  const maxDmg     = sorted[0]?.totalDamage || 1;
  const successPct = totalOps > 0 ? Math.round(sorted.reduce((s, p) => s + p.successOps, 0) / totalOps * 100) : 0;

  const viewSorted = S.lbView === 'ops'   ? [...sorted].sort((a, b) => b.totalOps - a.totalOps)
                   : S.lbView === 'gain'  ? [...sorted].sort((a, b) => b.totalGain - a.totalGain)
                   : sorted;

  const header = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-family:monospace;font-size:10px;color:#4a6a88;letter-spacing:2px;text-transform:uppercase">
        Kingdom Op Leaderboard — ${ops.length} ops logged
      </div>
      <div style="display:flex;gap:6px">
        <button class="wb${S.lbView === 'damage' ? ' g' : ''}" onclick="__wpA.lbView('damage')" style="font-size:10px;padding:3px 9px">Damage</button>
        <button class="wb${S.lbView === 'ops'    ? ' g' : ''}" onclick="__wpA.lbView('ops')"    style="font-size:10px;padding:3px 9px">Op Count</button>
        <button class="wb${S.lbView === 'gain'   ? ' g' : ''}" onclick="__wpA.lbView('gain')"   style="font-size:10px;padding:3px 9px">Gain</button>
      </div>
    </div>
    <div class="wsum" style="margin-bottom:16px">
      <div class="wscard"><div class="l">Total Ops Logged</div><div class="v">${fK(totalOps)}</div></div>
      <div class="wscard"><div class="l">Total Damage</div><div class="v">${fK(totalDmg)}</div></div>
      <div class="wscard"><div class="l">Active Provinces</div><div class="v">${sorted.length}</div></div>
      <div class="wscard"><div class="l">Success Rate</div><div class="v">${successPct}%</div></div>
    </div>`;

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
      <td><span class="wtag" style="cursor:default;font-size:9px">${topName}${topOp ? ' ×' + topOp[1] : ''}</span></td>
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

  // Op breakdown table — grouped by category
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

  // Sort: thievery first then spells, within each by damage desc
  const opRows = Object.entries(byOp)
    .sort((a, b) => {
      if (a[1].category !== b[1].category) return a[1].category === 'thief_sabotage' ? -1 : 1;
      return b[1].damage - a[1].damage || b[1].count - a[1].count;
    })
    .map(([code, d]) => {
      const isThief = d.category === 'thief_sabotage';
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

  return header + mainTable + opTable;
}

// ── Silent op sync to Firebase ──────────────────────────────────────────────

/** Run on every init — silently syncs new ops since last watermark. Never blocks UI. */
async function syncOps() {
  if (!S.own) return;
  try {
    const ops = await fetchKingdomOps();
    if (!Array.isArray(ops) || !ops.length) return;

    const kdId   = S.own.location.replace(':', '_');
    const kdName = S.own.kingdomName || '';

    // Read the watermark
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

      // Classify the op
      const isSelf      = op.provinceName === op.targetName;
      const isEspionage = OP_SETS.ESPIONAGE.has(op.opType);
      const isBuff      = OP_SETS.SELF_BUFF.has(op.opType) || isSelf;
      const isTracked   = TRACKED_OPS.has(op.opType);

      // Always advance the watermark so we don't re-process, but only
      // write to Firestore for ops we actually want on the leaderboard
      if (op.id > maxId) maxId = op.id;
      if (!isTracked) continue;

      const category = OP_SETS.THIEF_SAB.has(op.opType) ? 'thief_sabotage' : 'magic_offensive';

      const written = await fbWrite(`ops/${kdId}_${op.id}`, {
        opId:         op.id,
        kingdomId:    kdId,
        kingdomName:  kdName,
        server:       S.server,
        utoDate:      op.utoDate   || '',
        lastUpdated:  op.lastUpdated || '',
        slot:         op.slot      || 0,
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

      if (written && !written.error) {
        synced++;
      }
    }

    if (maxId > lastId) {
      await fbWrite(metaPath, { kingdomId: kdId, lastSyncedId: maxId, updatedAt: Date.now() });
      console.log(`[WavePlanner] Synced ${synced} new ops (new watermark: ${maxId})`);
    }
  } catch (e) {
    console.log('[WavePlanner] Op sync failed:', e.message);
  }
}
