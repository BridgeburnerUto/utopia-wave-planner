// ── TAB: INTEL ─────────────────────────────────────────────────────────────
// Enemy province intel table with sortable columns.
// Acre gain/loss and attack counts parsed from kingdomNews.parseString.

// ── News parsing ─────────────────────────────────────────────────────────────

/**
 * Parse raze and massacre events against enemy provinces.
 * Actual IS news format: "AttackerName (anyLoc) invaded DefName (eLoc) and razed N acres"
 * No slot-number prefix — match defender by name, look up slot from nameToSlot index.
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

    // Name → slot lookup for fast attribution
    const nameToSlot = {};
    (S.enemy?.provinces || []).forEach(p => { nameToSlot[p.name] = p.slot; });

    const events = {};
    function getOrCreate(slot) {
      if (!events[slot]) events[slot] = { razes: 0, razeAcres: 0, massacres: 0 };
      return events[slot];
    }

    for (const line of news.split('\n')) {
      const parts = line.split('\t');
      if (parts.length < 2) continue;
      const d = _parseNewsDate(parts[0].trim());
      if (!d) continue;
      const abs = _utoToAbs(d.month, d.day, d.year);
      if (abs < minAbs || abs > curAbs) continue;
      const text = parts[1].trim();

      // Raze: "Attacker (anyLoc) invaded DefName (eLoc) and razed N acres"
      const raze = text.match(new RegExp(`invaded\\s+(.+?)\\s*\\(${eLocPat}\\)\\s+and\\s+razed\\s+([\\d,]+)\\s+acres`, 'i'));
      if (raze) {
        const slot = nameToSlot[raze[1].trim()];
        if (slot != null) {
          getOrCreate(slot).razes++;
          getOrCreate(slot).razeAcres += parseInt(raze[2].replace(/,/g, ''));
        }
        continue;
      }

      // Massacre format 1: "Attacker killed N people within DefName (eLoc)"
      const mass1 = text.match(new RegExp(`killed\\s+[\\d,]+\\s+people\\s+within\\s+(.+?)\\s*\\(${eLocPat}\\)`, 'i'));
      if (mass1) {
        const slot = nameToSlot[mass1[1].trim()];
        if (slot != null) getOrCreate(slot).massacres++;
        continue;
      }

      // Massacre format 2: "Attacker invaded DefName (eLoc) and killed N people"
      const mass2 = text.match(new RegExp(`invaded\\s+(.+?)\\s*\\(${eLocPat}\\)\\s+and\\s+killed`, 'i'));
      if (mass2) {
        const slot = nameToSlot[mass2[1].trim()];
        if (slot != null) getOrCreate(slot).massacres++;
      }
    }

    return events;
  } catch(e) {
    console.log('[WavePlanner] Combat event parse error:', e.message);
    return {};
  }
}

/**
 * Parse attack entries from kingdomNews.parseString for the current enemy KD.
 * Returns per-slot stats: { acresGained, acresLost, attacksMade }
 *
 * Actual IS news format (no slot-number prefix):
 *   "AttackerName (eLoc) invaded DefName (anyLoc) and captured N acres"  ← enemy gains
 *   "AttackerName (anyLoc) invaded DefName (eLoc) and captured N acres"  ← enemy loses
 *   "AttackerName (eLoc) ambushed armies from ... and took N acres"       ← enemy gains
 *
 * Province matching is by name via nameToSlot index (slot numbers not in news text).
 */
function parseNewsActivity(tickInterval) {
  try {
    const IS      = JSON.parse(localStorage.getItem('IntelState') || '{}');
    const news    = IS.kingdomNews?.parseString;
    const curDate = _parseUtoDate(IS.currentTick?.tickName || '');
    if (!news || !curDate) return {};

    const eLoc = S.eLoc;

    // Build name → slot index for enemy provinces
    const nameToSlot = {};
    (S.enemy?.provinces || []).forEach(p => { nameToSlot[p.name] = p.slot; });

    const curAbs = _utoToAbs(curDate.month, curDate.day, curDate.year);
    const minAbs = curAbs - tickInterval;

    const stats = {};
    function getOrCreate(slot) {
      if (!stats[slot]) stats[slot] = { acresGained: 0, acresLost: 0, attacksMade: 0 };
      return stats[slot];
    }

    for (const line of news.split('\n')) {
      const parts = line.split('\t');
      if (parts.length < 2) continue;
      const d = _parseNewsDate(parts[0].trim());
      if (!d) continue;
      const abs = _utoToAbs(d.month, d.day, d.year);
      if (abs < minAbs || abs > curAbs) continue;
      const text = parts[1].trim();

      // "AttackerName (atkLoc) invaded DefName (defLoc) and captured N acres [of land]"
      const captured = text.match(/^(.+?)\s*\(([^)]+)\)\s+invaded\s+(.+?)\s*\(([^)]+)\)\s+and\s+captured\s+([\d,]+)\s+acres/i);
      if (captured) {
        const atkName = captured[1].trim();
        const atkLoc  = captured[2].trim();
        const defName = captured[3].trim();
        const defLoc  = captured[4].trim();
        const acres   = parseInt(captured[5].replace(/,/g, ''));
        if (atkLoc === eLoc) {
          // Enemy province is attacker → gains acres
          const slot = nameToSlot[atkName];
          if (slot != null) { getOrCreate(slot).acresGained += acres; getOrCreate(slot).attacksMade++; }
        } else if (defLoc === eLoc) {
          // Enemy province is defender → loses acres
          const slot = nameToSlot[defName];
          if (slot != null) { getOrCreate(slot).acresLost += acres; }
        }
        continue;
      }

      // "AttackerName (eLoc) ambushed armies from ... and took N acres"
      const ambush = text.match(/^(.+?)\s*\(([^)]+)\)\s+ambushed\s+armies\s+from\s+.+?\s+and\s+took\s+([\d,]+)\s+acres/i);
      if (ambush && ambush[2].trim() === eLoc) {
        const slot = nameToSlot[ambush[1].trim()];
        if (slot != null) { getOrCreate(slot).acresGained += parseInt(ambush[3].replace(/,/g,'')); getOrCreate(slot).attacksMade++; }
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
      acresGained:  act.acresGained,
      acresLost:    act.acresLost,
      attacksMade:  act.attacksMade,
      razes:        ce.razes,
      razeAcres:    ce.razeAcres,
      massacres:    ce.massacres,
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

  // Interval dropdown
  const intervals = [4, 6, 8, 12, 24, 36, 48, 60, 72];
  const intervalSelect = `
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:17px;font-weight:700;color:#7a9090;text-transform:uppercase;letter-spacing:1px;">Interval</span>
      <select onchange="__wpA.setIntelInterval(parseInt(this.value))"
        style="background:#3c4545;border:1px solid #617070;color:#ffffff;font-size:19px;padding:4px 8px;border-radius:3px;outline:none;cursor:pointer;">
        ${intervals.map(t => `<option value="${t}" ${S.intelInterval===t?'selected':''}>${t} ticks</option>`).join('')}
      </select>
      <span style="font-size:17px;color:#7a9090;font-style:italic;">Gain/loss/attacks parsed from kingdom news</span>
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
          ${th('acresGained',`+Ac ${S.intelInterval}t`,'Acres gained in interval')}
          ${th('acresLost',`-Ac ${S.intelInterval}t`,'Acres lost in interval')}
          ${th('attacksMade',`Atks ${S.intelInterval}t`,'Attacks made in interval')}
          ${th('razes',`Rz ${S.intelInterval}t`,'Razes in interval')}
          ${th('razeAcres',`RzAc ${S.intelInterval}t`,'Raze acres in interval')}
          ${th('massacres',`Ms ${S.intelInterval}t`,'Massacres in interval')}
          ${th('awayEarliest','Away','Enemy armies away — oSpecs · time to return')}
          ${th('intelAge','Age','Intel age')}
        </tr></thead>
        <tbody>${tableRows}</tbody>
        <tfoot>${totRow}</tfoot>
      </table>
    </div>`;

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      ${intervalSelect}
      <div style="font-size:17px;color:#7a9090;">${rows.length} provinces · ${esc(S.enemy.kingdomName || S.eLoc)}</div>
    </div>
    ${table}`;
}
