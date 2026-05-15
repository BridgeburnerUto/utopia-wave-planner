// ── TAB: INTEL ─────────────────────────────────────────────────────────────
// Enemy province intel table with sortable columns.
// Acre gain/loss and attack counts parsed from kingdomNews.parseString.

// ── News parsing ─────────────────────────────────────────────────────────────

/**
 * Parse raze and massacre events done BY OWN KD on enemy provinces.
 * Raze:     "[slot] - [name] (oLoc) invaded [slot] - [name] (eLoc) and razed X acres"
 * Massacre: "[slot] - [name] (oLoc) invaded [slot] - [name] (eLoc) and massacred ..."
 * Returns { [enemySlot]: { razes, razeAcres, massacres } }
 */
function parseCombatEvents(tickInterval) {
  try {
    const IS      = JSON.parse(localStorage.getItem('IntelState') || '{}');
    const news    = IS.kingdomNews?.parseString;
    const curDate = _parseUtoDate(IS.currentTick?.tickName || '');
    if (!news || !curDate) return {};

    const eLoc    = S.eLoc;
    const eLocPat = eLoc.replace(':', '\\:');
    const curAbs  = _utoToAbs(curDate.month, curDate.day, curDate.year);
    const minAbs  = curAbs - tickInterval;

    const events = {};
    function getOrCreate(slot) {
      if (!events[slot]) events[slot] = { razes: 0, razeAcres: 0, massacres: 0 };
      return events[slot];
    }

    news.split('\n').forEach(line => {
      const parts = line.split('\t');
      if (parts.length < 2) return;
      const d = _parseNewsDate(parts[0].trim());
      if (!d) return;
      const abs = _utoToAbs(d.month, d.day, d.year);
      if (abs < minAbs || abs > curAbs) return;
      const text = parts[1].trim();

      // Raze: "X - Name (anyLoc) invaded SLOT - Name (eLoc) and razed N acres"
      const raze = text.match(new RegExp(`invaded (\\d+)\\s*-\\s*.+?\\(${eLocPat}\\) and razed (\\d+) acres`));
      if (raze) {
        const s = getOrCreate(parseInt(raze[1]));
        s.razes++;
        s.razeAcres += parseInt(raze[2]);
        return;
      }

      // Massacre format 1: "X - Name (oLoc) killed N people within SLOT - Name (eLoc)"
      const mass1 = text.match(new RegExp(`killed [\\d,]+ people within (\\d+)\\s*-\\s*.+?\\(${eLocPat}\\)`));
      if (mass1) { getOrCreate(parseInt(mass1[1])).massacres++; return; }
      // Massacre format 2: "X - Name (oLoc) invaded SLOT - Name (eLoc) and killed N people"
      const mass2 = text.match(new RegExp(`invaded (\\d+)\\s*-\\s*.+?\\(${eLocPat}\\) and killed`));
      if (mass2) { getOrCreate(parseInt(mass2[1])).massacres++; }
    });

    return events;
  } catch(e) {
    console.log('[WavePlanner] Combat event parse error:', e.message);
    return {};
  }
}

/**
 * Parse attack entries from kingdomNews.parseString for the current enemy KD.
 * Returns per-slot stats: { acresGained, acresLost, attacksMade }
 * Filtered to entries within `tickInterval` ticks of current tick.
 *
 * News line formats:
 *   ENEMY ATTACKS OWN:  "[N] - [Name] (eKD) invaded [N] - [Name] (oKD) and captured X acres"
 *   OWN ATTACKS ENEMY:  "[N] - [Name] (oKD) captured X acres from [N] - [Name] (eKD)"
 *   ENEMY ATTACKS OTHERS: "[N] - [Name] (eKD) invaded [N] - [Name] (otherKD) and captured X acres"
 */
function parseNewsActivity(tickInterval) {
  try {
    const IS       = JSON.parse(localStorage.getItem('IntelState') || '{}');
    const news     = IS.kingdomNews?.parseString;
    const curTick  = IS.currentTick?.tickNumber || 0;
    const curDate  = _parseUtoDate(IS.currentTick?.tickName || '');
    if (!news || !curDate) return {};

    const eLoc = S.eLoc; // e.g. "5:3"
    const oLoc = S.own?.location || ''; // e.g. "1:6"
    const eLocPat = eLoc.replace(':', '\\:');

    // Convert current date to absolute day
    const curAbs = _utoToAbs(curDate.month, curDate.day, curDate.year);
    const minAbs = curAbs - tickInterval;

    // Per-slot accumulators
    const stats = {}; // { [slot]: { acresGained, acresLost, attacksMade } }

    function getOrCreate(slot) {
      if (!stats[slot]) stats[slot] = { acresGained: 0, acresLost: 0, attacksMade: 0 };
      return stats[slot];
    }

    const lines = news.split('\n');

    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length < 2) continue;
      const dateStr = parts[0].trim();
      const text    = parts[1].trim();
      const d = _parseNewsDate(dateStr);
      if (!d) continue;
      const abs = _utoToAbs(d.month, d.day, d.year);
      if (abs < minAbs || abs > curAbs) continue;

      // Pattern 1: Enemy province attacks someone and gains land
      // "[slot] - [name] (eLoc) invaded [slot] - [name] (anyLoc) and captured N acres"
      const atkGain = text.match(new RegExp(`^(\\d+)\\s*-\\s*.+?\\(${eLocPat}\\)\\s+invaded\\s+.+?and captured (\\d+) acres`));
      if (atkGain) {
        const slot  = parseInt(atkGain[1]);
        const acres = parseInt(atkGain[2]);
        getOrCreate(slot).acresGained += acres;
        getOrCreate(slot).attacksMade += 1;
        continue;
      }

      // Pattern 2: Someone captures land FROM enemy province
      // "[slot] - [name] (anyLoc) captured N acres [of land] from [slot] - [name] (eLoc)"
      const defLoss = text.match(new RegExp(`captured ([\\d,]+) acres(?:\\s+of\\s+land)?\\s+from (\\d+)\\s*-\\s*.+?\\(${eLocPat}\\)`));
      if (defLoss) {
        const acres = parseInt(defLoss[1].replace(/,/g, ''));
        const slot  = parseInt(defLoss[2]);
        getOrCreate(slot).acresLost += acres;
        continue;
      }

      // Pattern 3: Ambush — enemy province ambushed and took acres
      // "[slot] - [name] (eLoc) ambushed armies from ... and took N acres"
      const ambush = text.match(new RegExp(`^(\\d+)\\s*-\\s*.+?\\(${eLocPat}\\)\\s+ambushed armies from .+? and took (\\d+) acres`));
      if (ambush) {
        getOrCreate(parseInt(ambush[1])).acresGained += parseInt(ambush[2]);
        getOrCreate(parseInt(ambush[1])).attacksMade += 1;
        continue;
      }
    }

    return stats;
  } catch(e) {
    console.log('[WavePlanner] Intel news parse error:', e.message);
    return {};
  }
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
  if (!S.intelSort)    S.intelSort    = { col: 'slot', dir: 1 };
  if (!S.intelInterval) S.intelInterval = 24;

  const activity      = parseNewsActivity(S.intelInterval);
  const combatEvents  = parseCombatEvents(S.intelInterval);

  // Build row data
  const rows = S.enemy.provinces.map(p => {
    const sot  = p.sot || {};
    const act  = activity[p.slot] || { acresGained: 0, acresLost: 0, attacksMade: 0 };
    const ce   = combatEvents[p.slot] || { razes: 0, razeAcres: 0, massacres: 0 };
    const nwpa = p.land > 0 ? Math.round((p.networth || 0) / p.land) : 0;
    const da   = p.calcs?.defPointsSummary?.ageSeconds;
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
      acresGained:  act.acresGained,
      acresLost:    act.acresLost,
      attacksMade:  act.attacksMade,
      razes:        ce.razes,
      razeAcres:    ce.razeAcres,
      massacres:    ce.massacres,
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

  // Interval dropdown
  const intervals = [4, 6, 8, 12, 24];
  const intervalSelect = `
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:10px;font-weight:700;color:#7a5a2a;text-transform:uppercase;letter-spacing:1px;">Interval</span>
      <select onchange="__wpA.setIntelInterval(parseInt(this.value))"
        style="background:#1a1208;border:1px solid #4a3010;color:#c8a060;font-size:12px;padding:4px 8px;border-radius:3px;outline:none;cursor:pointer;">
        ${intervals.map(t => `<option value="${t}" ${S.intelInterval===t?'selected':''}>${t} ticks</option>`).join('')}
      </select>
      <span style="font-size:11px;color:#7a5a2a;font-style:italic;">Gain/loss/attacks parsed from kingdom news</span>
    </div>`;

  // Sort indicator helper
  const si = (c) => {
    if (S.intelSort.col !== c) return '<span style="color:#4a3010;margin-left:3px;">⇅</span>';
    return S.intelSort.dir === -1
      ? '<span style="color:#D4A017;margin-left:3px;">↓</span>'
      : '<span style="color:#D4A017;margin-left:3px;">↑</span>';
  };

  // Column header helper
  const th = (col, label, title='') =>
    `<th onclick="__wpA.intelSort('${col}')" title="${esc(title)}"
      style="cursor:pointer;user-select:none;white-space:nowrap;padding:8px 10px;text-align:right;background:#120d04;font-size:9px;font-weight:700;color:#7a5a2a;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #4a3010;${S.intelSort.col===col?'color:#D4A017;':''}"
    >${label}${si(col)}</th>`;

  const thLeft = (col, label) =>
    `<th onclick="__wpA.intelSort('${col}')"
      style="cursor:pointer;user-select:none;white-space:nowrap;padding:8px 10px;text-align:left;background:#120d04;font-size:9px;font-weight:700;color:#7a5a2a;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #4a3010;${S.intelSort.col===col?'color:#D4A017;':''}"
    >${label}${si(col)}</th>`;

  const tableRows = rows.map(r => {
    const ageCol = r.stale ? '#E05050' : r.intelAge != null ? (r.intelAge < 3600 ? '#60C040' : r.intelAge < 14400 ? '#D4A017' : '#e09040') : '#7a5a2a';
    const gainCol  = r.acresGained > 0 ? '#60C040' : '#7a5a2a';
    const lossCol  = r.acresLost   > 0 ? '#E05050' : '#7a5a2a';
    const atkCol   = r.attacksMade >= 4 ? '#E05050' : r.attacksMade >= 2 ? '#e09040' : r.attacksMade > 0 ? '#D4A017' : '#7a5a2a';

    return `<tr style="border-bottom:1px solid #2a1a08;">
      <td style="padding:7px 10px;font-weight:700;color:#c8a060;">${r.slot}</td>
      <td style="padding:7px 10px;color:#c8a060;font-weight:500;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.name)}</td>
      <td style="padding:7px 10px;color:#7a5a2a;font-size:11px;">${esc(r.race)}</td>
      <td style="padding:7px 10px;text-align:right;">${fK(r.nw)}</td>
      <td style="padding:7px 10px;text-align:right;">${fK(r.land)}</td>
      <td style="padding:7px 10px;text-align:right;">${fK(r.off)}</td>
      <td style="padding:7px 10px;text-align:right;">${fK(r.def)}</td>
      <td style="padding:7px 10px;text-align:right;">${fK(r.nwpa)}</td>
      <td style="padding:7px 10px;text-align:right;">${fK(r.peons)}</td>
      <td style="padding:7px 10px;text-align:right;color:${gainCol};font-weight:${r.acresGained>0?'700':'400'};">${r.acresGained > 0 ? '+'+fK(r.acresGained) : '—'}</td>
      <td style="padding:7px 10px;text-align:right;color:${lossCol};font-weight:${r.acresLost>0?'700':'400'};">${r.acresLost > 0 ? '-'+fK(r.acresLost) : '—'}</td>
      <td style="padding:7px 10px;text-align:right;color:${atkCol};font-weight:${r.attacksMade>0?'700':'400'};">${r.attacksMade || '—'}</td>
      <td style="padding:7px 10px;text-align:right;color:${r.razes>0?'#E05050':'#3a2810'};font-weight:${r.razes>0?'700':'400'};">${r.razes > 0 ? r.razes+'×' : '—'}</td>
      <td style="padding:7px 10px;text-align:right;color:${r.razeAcres>0?'#E05050':'#3a2810'};font-weight:${r.razeAcres>0?'700':'400'};">${r.razeAcres > 0 ? '-'+fK(r.razeAcres) : '—'}</td>
      <td style="padding:7px 10px;text-align:right;color:${r.massacres>0?'#E05050':'#3a2810'};font-weight:${r.massacres>0?'700':'400'};">${r.massacres > 0 ? r.massacres+'×' : '—'}</td>
      <td style="padding:7px 10px;text-align:right;font-size:10px;color:${ageCol};">${r.intelAge != null ? fA(r.intelAge) : '—'}</td>
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

  const totRow = `<tr style="border-top:2px solid #4a3010;background:#120d04;">
    <td colspan="3" style="padding:7px 10px;font-size:10px;font-weight:700;color:#7a5a2a;text-transform:uppercase;letter-spacing:1px;">Kingdom Total</td>
    <td style="padding:7px 10px;text-align:right;font-weight:700;color:#D4A017;">${fK(totals.nw)}</td>
    <td style="padding:7px 10px;text-align:right;font-weight:700;color:#D4A017;">${fK(totals.land)}</td>
    <td style="padding:7px 10px;text-align:right;font-weight:700;color:#D4A017;">${fK(totals.off)}</td>
    <td style="padding:7px 10px;text-align:right;font-weight:700;color:#D4A017;">${fK(totals.def)}</td>
    <td style="padding:7px 10px;"></td>
    <td style="padding:7px 10px;text-align:right;font-weight:700;color:#D4A017;">${fK(totals.peons)}</td>
    <td style="padding:7px 10px;text-align:right;font-weight:700;color:#60C040;">${totals.gained > 0 ? '+'+fK(totals.gained) : '—'}</td>
    <td style="padding:7px 10px;text-align:right;font-weight:700;color:#E05050;">${totals.lost > 0 ? '-'+fK(totals.lost) : '—'}</td>
    <td style="padding:7px 10px;text-align:right;font-weight:700;color:#D4A017;">${totals.attacks || '—'}</td>
    <td style="padding:7px 10px;text-align:right;font-weight:700;color:${totals.razes>0?'#E05050':'#7a5a2a'};">${totals.razes > 0 ? totals.razes+'×' : '—'}</td>
    <td style="padding:7px 10px;text-align:right;font-weight:700;color:${totals.razeAcres>0?'#E05050':'#7a5a2a'};">${totals.razeAcres > 0 ? '-'+fK(totals.razeAcres) : '—'}</td>
    <td style="padding:7px 10px;text-align:right;font-weight:700;color:${totals.massacres>0?'#E05050':'#7a5a2a'};">${totals.massacres > 0 ? totals.massacres+'×' : '—'}</td>
    <td></td>
  </tr>`;

  const table = `
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;background:#1a1208;border:1px solid #3a2810;border-radius:4px;overflow:hidden;">
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
          ${th('acresGained',`+Acres (${S.intelInterval}t)`,'Acres gained in interval')}
          ${th('acresLost',`-Acres (${S.intelInterval}t)`,'Acres lost in interval')}
          ${th('attacksMade',`Attacks (${S.intelInterval}t)`,'Attacks made in interval')}
          ${th('razes',`Razes (${S.intelInterval}t)`,'Times razed in interval')}
          ${th('razeAcres',`Raze Acres (${S.intelInterval}t)`,'Total acres razed in interval')}
          ${th('massacres',`Massacres (${S.intelInterval}t)`,'Times massacred in interval')}
          ${th('intelAge','Intel','Intel age')}
        </tr></thead>
        <tbody>${tableRows}</tbody>
        <tfoot>${totRow}</tfoot>
      </table>
    </div>`;

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      ${intervalSelect}
      <div style="font-size:11px;color:#7a5a2a;">${rows.length} provinces · ${esc(S.enemy.kingdomName || S.eLoc)}</div>
    </div>
    ${table}`;
}
