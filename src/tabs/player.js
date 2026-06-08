// ── TAB: PLAYER ────────────────────────────────────────────────────────────
// "My Orders" tab — province picker + attack plan calculator.
// calcAttacks() is pure business logic, separated from the render function.

// ── Manual stat overrides (per province, persisted in localStorage) ─────────
// Players enter their own max off / NW / generals rather than relying on
// potentially stale SoM/SoT API data.

function _mkey(provName) { return 'wc_ms_' + provName; }

function loadManual(provName) {
  try { return JSON.parse(localStorage.getItem(_mkey(provName)) || '{}'); }
  catch(e) { return {}; }
}

function saveManual(provName, obj) {
  localStorage.setItem(_mkey(provName), JSON.stringify(obj));
}

/** Called by inline oninput handlers — saves a single field and re-renders. */
function setManualStat(provName, field, rawVal) {
  var ms = loadManual(provName);
  var v  = parseInt(rawVal);
  if (v > 0) ms[field] = v; else delete ms[field];
  saveManual(provName, ms);
  renderPlayer();
}

/** Return the effective value for a stat: manual override > API data > 0 */
function _eff(provName, field, apiVal) {
  var ms = loadManual(provName);
  return ms[field] != null ? ms[field] : (apiVal || 0);
}

// ── Raze / Massacre claim storage (per war, per device) ──────────────────────
// Stored as { "raze_18": "My Province", "massacre_5": "My Province" }
// Key is scoped to enemy location so it resets each new war automatically.

function _claimKey() { return 'wc_raze_' + (S.eLoc || ''); }
function loadClaims() {
  try { return JSON.parse(localStorage.getItem(_claimKey()) || '{}'); }
  catch(e) { return {}; }
}

/** Toggle a raze/massacre claim for a slot. Called from inline onclick. */
function claimAction(slot, type) {
  const c = loadClaims();
  const k = type + '_' + slot;
  if (c[k]) delete c[k]; else c[k] = S.playerProv?.name || '✓';
  localStorage.setItem(_claimKey(), JSON.stringify(c));
  renderPlayer();
}

/**
 * Parse wave string → numeric priority for sorting.
 * 'current 1' → 1, 'current 2' → 2, 'current' (no number) → 50
 */
function _waveOrder(wave) {
  if (!wave) return 999;
  if (wave === 'current') return 50;
  if (wave.startsWith('current ')) {
    const n = parseInt(wave.split(' ')[1]);
    return isNaN(n) ? 50 : n;
  }
  return 50;
}

/** Human-readable wave name for attack card headers */
function _waveDisplayName(wave) {
  if (wave === 'current')   return 'Current Wave';
  if (wave === 'current 1') return 'Current Wave P1';
  if (wave === 'current 2') return 'Current Wave P2';
  if (wave === 'preplan')   return 'Pre-Plan';
  return wave || 'Wave';
}

/**
 * Pure function: given a province, return an ordered attack plan.
 *
 * Key mechanics:
 *  - attackableGens = gensHome - 1   (1 general ALWAYS stays home)
 *  - Offense and generals are TWO INDEPENDENT pools:
 *      offLeft  starts at aOff, depleted by (target_def + 1) per attack
 *      gensLeft starts at attackableGens, depleted by N per attack
 *  - Normally 1 general per attack; extra generals only when offLeft ≤ tDef,
 *    each adds 5% to offense: effective = offLeft × (1 + 0.05×(N−1))
 *  - Assigned RAZE/MASS → single hit each (war leader flag always honoured)
 *  - Assigned TM → multi-hit loop with min gens until can't break or gens/off gone
 *  - KD pool uses remaining gens/off; pop% strategy determines types
 *  - Bloat targets never TM — only raze/mass when flagged by war leader
 *  - Gains estimated for TM attacks using RPNW × RKNW × modifiers
 *
 * Returns {attacks, gensHome, attackableGens, gensLeft, offLeft,
 *          ownPop, totalGains, reason}
 */
function calcAttacks(prov) {
  // ── Own stats with army-return auto-correction ────────────────────────────
  // armiesAway[i].secondsRemaining <= 0 means that army is past its return window.
  // When ALL armies are overdue, offPointsHome and standingArmy.generals are stale.
  //
  // Fix: SoT offPoints = total offense for ALL troops regardless of location,
  // so it's the best available "all generals home" figure.
  // SoT generals = total province generals (same logic).
  // Manual overrides still take full priority via _eff().

  const _armiesAway   = prov.som?.armiesAway || [];
  const _overdueCount = _armiesAway.filter(
    a => a.secondsRemaining != null && a.secondsRemaining <= 0
  ).length;
  const _anyArmyAway  = _armiesAway.length > 0;
  const _allOverdue   = _anyArmyAway && _overdueCount === _armiesAway.length;
  const _anyOverdue   = _anyArmyAway && _overdueCount > 0;

  // Offense: prefer SoT total when all armies are overdue
  const _sotOff  = prov.sot?.offPoints || 0;
  const _apiOff  = _allOverdue && _sotOff ? _sotOff : (prov.som?.offPointsHome || 0);
  const _offSrc  = _allOverdue && _sotOff  ? 'sot'
                 : _allOverdue && !_sotOff ? 'stale'  // overdue but no SoT — show warning
                 : 'som';

  // Generals: prefer SoT total when all armies are overdue
  const _sotGens = prov.sot?.generals;
  const _apiGens = _allOverdue && _sotGens != null
    ? _sotGens
    : (prov.som?.standingArmy?.generals ?? _sotGens ?? 5);
  const _gensSrc = _allOverdue && _sotGens != null ? 'sot' : 'som';

  // Bundle for UI display
  const armyStatus = {
    anyAway:    _anyArmyAway,
    anyOverdue: _anyOverdue,
    allOverdue: _allOverdue,
    offSrc:     _offSrc,   // 'som' | 'sot' | 'stale'
    gensSrc:    _gensSrc,  // 'som' | 'sot'
  };

  const aOff     = _eff(prov.name, 'off',  _apiOff);
  const aNW      = _eff(prov.name, 'nw',   prov.networth || 0);
  const gensHome = _eff(prov.name, 'gens', _apiGens);
  const ownLand  = prov.land || prov.sot?.acres || 0;

  // Fix: always keep 1 general home
  const attackableGens = Math.max(0, gensHome - 1);

  // Own pop% — Utopia formula:
  //   Current Population = peasants + totalTroops + thieves + wizards
  //   Raw Living Space   = builtAcres*25 + barrenAcres*15 + homesAcres*35  (survey used when available)
  //   Mod Living Space   = Raw × Race Bonus × (1 + Housing Science %)
  //   Pop%               = Current Population / Mod Living Space * 100
  // Race: Halfling ×1.10, Faery ×0.95, others ×1.00  (source: age_details)
  // Housing science: sos.books[{type:'Housing'}].effect (e.g. 4.5 → ×1.045)
  // Honor pop bonus: not available in province data — treated as ×1.0
  // sot.ppa is peasants-per-acre only, NOT total people — don't use it directly.
  const _sot  = prov.sot || {};
  const _land = prov.land || _sot.land || 0;
  const _totalPop = (_sot.peasants || 0) + (_sot.totalTroops || 0)
                  + (_sot.thieves  || 0) + (_sot.wizards    || 0);

  // Race population multiplier
  const _racePopMult = (function(race) {
    if (!race) return 1;
    const r = race.toLowerCase();
    if (r === 'halfling') return 1.10;
    if (r === 'faery')    return 0.95;
    return 1;
  })(prov.race);

  let ownPop = null;
  if (_land > 0) {
    const _bArr = prov.survey?.buildings;
    let _rawLS;
    if (_bArr && _bArr.length > 0) {
      // Survey available — accurate living space
      const _barrenEntry = _bArr.find(b => /barren/i.test(b.name));
      const _homesEntry  = _bArr.find(b => /^homes$/i.test(b.name));
      const _sumBuilt    = _bArr
        .filter(b => !(/barren/i.test(b.name)))
        .reduce((s, b) => s + (b.pctTot || 0), 0);
      const _barrenPct   = _barrenEntry ? (_barrenEntry.pctTot || 0) : Math.max(0, 100 - _sumBuilt);
      const _homesPct    = _homesEntry  ? (_homesEntry.pctTot  || 0) : 0;
      const _barrenAcres = _land * _barrenPct / 100;
      const _homesAcres  = _land * _homesPct  / 100;
      const _builtAcres  = _land - _barrenAcres - _homesAcres;
      _rawLS = _builtAcres * 25 + _barrenAcres * 15 + _homesAcres * 35; // Homes = 25 built + 10 bonus
    } else {
      // No survey — simplified fallback
      _rawLS = _land * 25;
    }
    // Housing science bonus: sos.books[{type:'Housing', effect:N}] → +N% max pop
    const _housingEffect = prov.sos?.books?.find(b => b.type === 'Housing')?.effect || 0;
    const _scienceMult   = 1 + (_housingEffect / 100);
    // Honor population bonus: not available in province data — treated as 1.0
    const _modLS = _rawLS * _racePopMult * _scienceMult;
    ownPop = _modLS > 0
      ? Math.min(Math.round(_totalPop / _modLS * 100), 150)
      : null;
  }

  if (!aOff)          return { attacks: [], gensHome, attackableGens, ownPop, reason: 'no_off' };
  if (!attackableGens) return { attacks: [], gensHome, attackableGens, ownPop, reason: 'no_gens' };

  // ── Helpers: generals and offense are independent pools ───────────────────
  // Min gens to break tDef given current offLeft:
  //   1 gen if offLeft > tDef (normal case)
  //   N gens if extra bonus needed: offLeft × (1 + 0.05×(N−1)) > tDef
  //   Returns 0 if impossible with gensAvail available
  function minGensToBreak(tDef, offLeft, gensAvail) {
    if (!gensAvail || offLeft <= 0) return 0;
    if (!tDef)                      return 1;
    if (offLeft > tDef)             return 1;
    // Need gen bonus: solve offLeft*(1+0.05*(N-1)) > tDef → N > 1+(tDef/offLeft-1)/0.05
    const n = Math.ceil(1 + (tDef / offLeft - 1) / 0.05);
    return n <= gensAvail ? n : 0;
  }

  function canBreak(tDef, offLeft, gensAvail) {
    return minGensToBreak(tDef, offLeft, gensAvail) > 0;
  }

  // ── Own race/personality offense multiplier ───────────────────────────────
  // Applied when comparing against enemy defense (breakability check).
  // Depletion of offLeft still uses raw tDef — troops sent are real troops.
  const ownRace = (prov.race || '').toLowerCase();
  const ownPers = (prov.sot?.personality || '').toLowerCase();
  const ownOffMult = (RACE_OFF_MULT[ownRace] || 1.0) * (PERSONALITY_OFF_MULT[ownPers] || 1.0);

  // ── NW quality score ───────────────────────────────────────────────────────
  function nwQuality(tNW) {
    if (!aNW || !tNW) return 1;
    const r = aNW / tNW;
    if (r >= 0.90 && r <= 1.10) return 3;
    if (r >= 0.75 && r <= 1.33) return 2;
    return 1;
  }

  // ── KD averages for RKNW ──────────────────────────────────────────────────
  const ownProvs    = S.own?.provinces   || [];
  const eneProvs    = S.enemy?.provinces || [];
  const ownKdAvgNW  = ownProvs.length ? ownProvs.reduce((s,p) => s+(p.networth||0),0) / ownProvs.length : 0;
  const eneKdAvgNW  = eneProvs.length ? eneProvs.reduce((s,p) => s+(p.networth||0),0) / eneProvs.length : 0;

  // ── Estimated TM land gains ────────────────────────────────────────────────
  function estimateTMGains(tNW, tLand, tp) {
    if (!tLand || !ownLand || !tNW || !aNW) return null;

    // RPNW
    const rpnw = tNW / aNW;
    let rpnwF = 0;
    if      (rpnw >= 0.567 && rpnw < 0.9)  rpnwF = 3 * rpnw - 1.7;
    else if (rpnw >= 0.9   && rpnw <= 1.1) rpnwF = 1;
    else if (rpnw >  1.1   && rpnw <= 1.6) rpnwF = -2 * rpnw + 3.2;
    if (rpnwF <= 0) return 0;

    // RKNW
    const rknw  = ownKdAvgNW > 0 ? eneKdAvgNW / ownKdAvgNW : 1;
    const rknwF = rknw < 0.5 ? 0.8 : rknw < 0.9 ? rknw / 2 + 0.55 : 1;

    // MAP modifier (in-war formula)
    const mapText = tp?.sot?.map || '';
    const mapF = (!mapText || mapText === 'Not much') ? 1.0
               : mapText === 'A little'               ? 0.90
               : 0.80; // Moderately / Heavily / Extremely → 80% in war

    // Castles modifier — only if survey data exists
    const castlePct = tp?.survey?.buildings?.find(b => b.name === 'Castles')?.pctTot;
    const castleF   = castlePct != null ? Math.max(0, 1 - (castlePct / 100 * 2.25)) : 1.0;

    // Relations modifier — always war
    const relF = 1.10;

    // Enemy protection ritual — reduces their land loss on each TM hit
    // Add known ritual names here as you encounter them in-game.
    let enemyRitualF = 1.0;
    const eRitual = (S.enemy?.kdEffects?.ritual || '').toLowerCase();
    if (eRitual.includes('protection') || eRitual.includes('shield') || eRitual.includes('barrier')) {
      const eff = S.enemy?.kdEffects?.ritualEff || 15;
      enemyRitualF = Math.max(0.5, 1 - eff / 100);
    }

    const raw = tLand * 0.12 * rpnwF * rknwF * relF * mapF * castleF * enemyRitualF;
    const cap = Math.min(ownLand, tLand) * 0.20;
    return Math.round(Math.min(raw, cap));
  }

  // ── Collect and classify wave targets ─────────────────────────────────────
  const myName = prov.name;

  const allWaveItems = S.enemy ? S.enemy.provinces
    .filter(p => S.provinces[p.slot]?.wave)
    .map(p => {
      const plan = S.provinces[p.slot];
      return {
        province: {
          slot: '['+p.slot+']', rawSlot: p.slot, name: p.name, race: p.race,
          requiredOps:   plan.requiredOps   || [],
          notes:         plan.notes         || '',
          needsRaze:     plan.needsRaze     || false,
          needsMassacre: plan.needsMassacre || false,
          bloat:         plan.bloat         || false,
        },
        assignedTo:   plan.assignedTo || [],
        wave:         plan.wave,
        waveName:     _waveDisplayName(plan.wave),
        wavePriority: _waveOrder(plan.wave),
      };
    }) : [];

  if (!allWaveItems.length) return { attacks: [], gensHome, attackableGens, ownPop, reason: 'no_targets' };

  // Three buckets: A = mine, B = KD pool, C = other's (skip)
  const myItems   = allWaveItems.filter(t => t.assignedTo.length > 0 && t.assignedTo.includes(myName));
  const poolItems = allWaveItems.filter(t => t.assignedTo.length === 0);
  // items assigned to others (not me, not empty) are intentionally ignored

  // ── Enrich target with intel data ─────────────────────────────────────────
  function enrich(item) {
    const tp    = pd(item.province.slot);
    const tDef  = tp?.calcs?.defPointsSummary?.defPointsHome || 0;
    const tNW   = tp?.networth || 0;
    const tLand = tp?.land || 0;
    const away  = tp?.som?.armiesAway?.length > 0;
    const dAge  = tp?.calcs?.defPointsSummary?.ageSeconds;

    // Apply race/personality defense multiplier to get effective enemy defense.
    // tDef (raw) is kept for off-depletion math; tDefEff is used for all
    // breakability checks so Dwarves/Halflings are harder to break than raw points suggest.
    const eRace = (tp?.race || item.province.race || '').toLowerCase();
    const ePers = (tp?.sot?.personality || '').toLowerCase();
    const tDefEff = Math.round(tDef * (RACE_DEF_MULT[eRace] || 1.0) * (PERSONALITY_DEF_MULT[ePers] || 1.0));
    const raceMod = eRace ? (RACE_DEF_MULT[eRace] || 1.0) : 1.0;
    const persMod = ePers ? (PERSONALITY_DEF_MULT[ePers] || 1.0) : 1.0;
    const hasDefMod = (raceMod !== 1.0 || persMod !== 1.0);

    // Enemy pop%: same formula as own province — ppa is peasants-only, need total pop.
    // Use component sum if available; fall back to ppa/25*100 if fields absent.
    const _es = tp?.sot || {};
    const _eLand = tp?.land || 0;
    const _eTotalPop = (_es.peasants || 0) + (_es.totalTroops || 0)
                     + (_es.thieves  || 0) + (_es.wizards    || 0);
    const tPop  = _eLand > 0 && _eTotalPop > 0
      ? Math.min(Math.round(_eTotalPop / (_eLand * 25) * 100), 150)
      : _es.ppa != null ? Math.min(Math.round(_es.ppa / 25 * 100), 150) : null;
    const nwQ   = nwQuality(tNW);
    // Breakability uses effective values: our racial/pers off bonus vs their racial/pers def bonus
    const canBr = canBreak(tDefEff, aOff * ownOffMult, attackableGens);
    const gains = estimateTMGains(tNW, tLand, tp);
    return { item, tp, tDef, tDefEff, hasDefMod, eRace, ePers, tNW, tLand, tPop, nwQ, away, breaks: canBr, dAge, gains };
  }

  const myEnriched   = myItems.map(enrich);
  const poolEnriched = poolItems.map(enrich);

  // ── Sort assigned targets: wave priority ASC, tDef ASC within priority ─────
  myEnriched.sort((a, b) => {
    const pa = a.item.wavePriority, pb = b.item.wavePriority;
    return pa !== pb ? pa - pb : a.tDef - b.tDef;
  });

  // ── Sort pool targets: NW quality DESC → breakable DESC → enemy pop% DESC ──
  poolEnriched.sort((a, b) => {
    if (b.nwQ !== a.nwQ) return b.nwQ - a.nwQ;
    const bBr = b.breaks ? 1 : 0, aBr = a.breaks ? 1 : 0;
    if (bBr !== aBr)     return bBr - aBr;
    return (b.tPop || 0) - (a.tPop || 0);
  });

  // ── >100% pop: expand pool to any non-bloat enemy province ──────────────────
  // Order: wave targets in good/optimal NW range first, then all other enemy
  // provinces sorted by NW quality → can break → enemy pop% DESC, then wave
  // targets in marginal range last.
  let activePool = poolEnriched;
  if (ownPop !== null && ownPop > 100 && S.enemy?.provinces) {
    const waveSlotSet = new Set(allWaveItems.map(t => t.province.rawSlot));

    const extraItems = S.enemy.provinces
      .filter(ep => {
        if (waveSlotSet.has(ep.slot)) return false;  // already in wave pool
        const pl = S.provinces[ep.slot];
        if (pl?.bloat) return false;                  // never attack bloat
        // Skip targets assigned to someone else
        if (pl?.assignedTo?.length > 0 && !pl.assignedTo.includes(myName)) return false;
        return true;
      })
      .map(ep => ({
        province: {
          slot: '['+ep.slot+']', rawSlot: ep.slot, name: ep.name, race: ep.race,
          requiredOps: [], notes: '', needsRaze: false, needsMassacre: false, bloat: false,
        },
        assignedTo: (S.provinces[ep.slot]?.assignedTo) || [],
        wave: null,
        waveName: 'Opportunity',
        wavePriority: 999,
      }));

    const extraEnriched = extraItems.map(enrich).sort((a, b) => {
      if (b.nwQ !== a.nwQ) return b.nwQ - a.nwQ;
      const bBr = b.breaks ? 1 : 0, aBr = a.breaks ? 1 : 0;
      if (bBr !== aBr)     return bBr - aBr;
      return (b.tPop || 0) - (a.tPop || 0);
    });

    // Wave targets in good/optimal range come before the extra pool;
    // wave marginal targets are last resort after the extra pool is exhausted.
    const waveGood     = poolEnriched.filter(t => t.nwQ >= 2);
    const waveMarginal = poolEnriched.filter(t => t.nwQ <  2);
    activePool = [...waveGood, ...extraEnriched, ...waveMarginal];
  }

  // ── Attack type per target ─────────────────────────────────────────────────
  // Bloat: never TM — only RAZE or MASS when war leader explicitly flags them.
  // Non-bloat: war leader needsRaze/needsMassacre flag always honoured (single hit).
  // Otherwise TM (pool targets' op type is governed separately by pop% strategy).
  function attackType(enriched) {
    const p = enriched.item.province;
    if (p.bloat) {
      if (p.needsRaze)     return 'RAZE';
      if (p.needsMassacre) return 'MASS';
      return null; // bloat with no action flag → never attack
    }
    // War leader explicit flags always win — regardless of own pop%
    if (p.needsRaze)     return 'RAZE';
    if (p.needsMassacre) return 'MASS';
    return 'TM';
  }

  // ── Pop% strategy for pool targets ────────────────────────────────────────
  // Pool raze/mass: only allowed if pop% < 100%.  >100% = TM focus only.
  // Pool TM limit: pop% < 70% → max 2 TM from pool (prefer raze/mass there)
  const poolRazeAllowed = ownPop === null || ownPop < 100;
  const poolRazeMassMax = (ownPop !== null && ownPop >= 70 && ownPop <= 99) ? 1 : Infinity;
  const poolTMMax       = (ownPop !== null && ownPop < 70) ? 2 : Infinity;

  // ── Attack loop state ─────────────────────────────────────────────────────
  const attacks   = [];
  let gensLeft    = attackableGens;
  let offLeft     = aOff;                 // depleted by (tDef+1) per attack
  let poolTMCount = 0, poolRMCount = 0;
  const hitCount  = {};                   // rawSlot → hit count for SoD reminders

  function addAttack(enriched, isTM, isPool) {
    // Use effective offense (with racial/pers bonus) and effective defense for gen calc.
    // offLeft depletion uses raw tDef — troops physically sent are unchanged by the multiplier.
    const mg = minGensToBreak(enriched.tDefEff, offLeft * ownOffMult, gensLeft);
    // mg === 0 means can't break — still record as marginal if it's an assigned target
    const sentOff = mg > 0
      ? Math.round(offLeft * (1 + 0.05 * (mg - 1)))  // effective off with gen bonus
      : 0;
    const rs = enriched.item.province.rawSlot;
    hitCount[rs] = (hitCount[rs] || 0) + 1;
    gensLeft     = Math.max(0, gensLeft - mg);
    offLeft      = Math.max(0, offLeft - (enriched.tDef + 1)); // spend minimum needed (raw)
    if (isPool) { if (isTM) poolTMCount++; else poolRMCount++; }
    attacks.push({
      n:          attacks.length + 1,
      target:     enriched,
      gens:       mg,
      sentOff,
      result:     mg > 0 ? 'yes' : 'marginal',
      pct:        sentOff > 0 ? Math.round(sentOff / (enriched.tDef || 1) * 100) : 0,
      attackType: isTM ? 'TM' : (enriched.item.province.needsRaze ? 'RAZE' : 'MASS'),
      isAssigned: !isPool,
      gains:      isTM ? enriched.gains : null,
      sodNote:    hitCount[rs] > 1
                    ? `Take a fresh SoD on ${enriched.item.province.name} before sending this attack`
                    : null,
      waveName:   enriched.item.waveName,
      tPop:       enriched.tPop,
    });
  }

  // Partition assigned targets: RAZE/MASS (single hit) vs TM (multi-hit)
  const myRM = myEnriched.filter(t => { const at = attackType(t); return at === 'RAZE' || at === 'MASS'; });
  const myTM = myEnriched.filter(t => attackType(t) === 'TM');

  // Pass 1A: assigned RAZE / MASS — single hit each, ordered by wave priority
  for (const t of myRM) {
    if (gensLeft <= 0 || offLeft <= 0) break;
    addAttack(t, false, false);  // single hit; addAttack marks result marginal if can't break
  }

  // Pass 1B: assigned TM — min gens per hit, repeat until can't break or resources gone.
  // Remaining gens/off fall through to the pool pass below.
  for (const t of myTM) {
    if (gensLeft <= 0 || offLeft <= 0) break;
    if (!canBreak(t.tDefEff, offLeft * ownOffMult, gensLeft)) {
      // Assigned but unbreakable — show as warning, don't loop
      addAttack(t, true, false);
      continue;
    }
    // Multi-hit: each iteration uses minimum gens, leaving the rest for another round
    while (gensLeft > 0 && offLeft > 0 && canBreak(t.tDefEff, offLeft * ownOffMult, gensLeft)) {
      addAttack(t, true, false);
    }
  }

  // Pass 2: pool/opportunity targets (spare gens/off, pop% strategy applies)
  for (const t of activePool) {
    if (gensLeft <= 0 || offLeft <= 0) break;
    if (!canBreak(t.tDefEff, offLeft * ownOffMult, gensLeft)) continue; // skip unbreakable
    const aType = attackType(t);
    if (!aType) continue;
    const isTM = aType === 'TM';
    if (!isTM && !poolRazeAllowed) continue;             // >100% pop: skip pool raze/mass
    if (!isTM && poolRMCount >= poolRazeMassMax) continue; // 70-99%: 1 raze/mass max
    if (isTM  && poolTMCount >= poolTMMax)       continue; // <70%: limit TM from pool
    addAttack(t, isTM, true);
  }

  const totalGains = attacks.reduce((s, a) => s + (a.gains || 0), 0);

  return {
    attacks, prov, gensHome, attackableGens,
    gensLeft, offLeft,
    ownPop, totalGains,
    best: myEnriched[0] || poolEnriched[0] || null,
    armyStatus,
  };
}

function renderPlayer() {
  renderTab('__wpc_player', _buildPlayer);
}

function _buildPlayer() {
  if (!S.own || !S.enemy) return '<div class="watk-noprov">Loading data...</div>';
  if (!S.playerProv)      return _buildProvPicker();

  const prov = S.playerProv;
  const { attacks, gensHome, attackableGens, gensLeft, homeOffRemaining, ownPop, totalGains, reason, armyStatus } = calcAttacks(prov);
  const waveTargets = S.enemy ? S.enemy.provinces
    .filter(p => S.provinces[p.slot]?.wave)
    .map(p => {
      const plan = S.provinces[p.slot];
      return {
        province: { slot: '['+p.slot+']', rawSlot: p.slot, name: p.name, race: p.race,
                    requiredOps:   plan.requiredOps   || [],
                    notes:         plan.notes         || '',
                    needsRaze:     plan.needsRaze     || false,
                    needsMassacre: plan.needsMassacre || false,
                    bloat:         plan.bloat         || false,
                    assignedTo:    plan.assignedTo    || [] },
        waveName: _waveDisplayName(plan.wave),
      };
    }) : [];
  const aOff = _eff(prov.name, 'off', prov.som?.offPointsHome || 0);

  // ── Army return banner ───────────────────────────────────────────────────
  // Show before building the header so it appears above the stat inputs.
  let armyBanner = '';
  const ms0 = loadManual(prov.name);
  if (armyStatus?.allOverdue) {
    if (armyStatus.offSrc === 'sot') {
      // Auto-corrected — brief info note only if no manual override
      if (!ms0.off && !ms0.gens) {
        armyBanner = `<div style="margin-bottom:10px;padding:8px 14px;background:#1a2820;border:1px solid #305040;
            border-radius:3px;font-size:17px;color:#60c040;display:flex;align-items:center;gap:8px">
          <span style="font-size:19px">↩</span>
          <span><b>All armies returned</b> — offense and generals updated from SoT data automatically.
          Override the fields below if the SoT is stale.</span>
        </div>`;
      }
    } else {
      // Overdue but no SoT to fall back on — manual entry required
      armyBanner = `<div style="margin-bottom:10px;padding:8px 14px;background:#201808;border:1px solid #805020;
          border-radius:3px;font-size:17px;color:#e09040;display:flex;align-items:center;gap:8px">
        <span style="font-size:19px">⚠</span>
        <span><b>All armies returned but no SoT available.</b>
        Offense data is stale — enter your current max offense in the field below.</span>
      </div>`;
    }
  } else if (armyStatus?.anyOverdue) {
    armyBanner = `<div style="margin-bottom:10px;padding:8px 14px;background:#201808;border:1px solid #805020;
        border-radius:3px;font-size:17px;color:#e09040;display:flex;align-items:center;gap:8px">
      <span style="font-size:19px">⚠</span>
      <span><b>Some armies have returned</b> — generals and offense may be higher than shown.
      Verify your stats or enter current values below.</span>
    </div>`;
  }

  let h = armyBanner + _playerHeader(prov, aOff, gensHome, attackableGens, ownPop, waveTargets.length, armyStatus);

  if (!waveTargets.length) {
    return h + `<div class="watk-notarget">// No wave targets assigned yet<br>
      <span style="font-size:17px">The war leader needs to set targets in the WAR BOARD tab first</span></div>`;
  }
  if (reason === 'no_off') {
    return h + `<div class="watk-notarget">// No offensive data available for this province<br>
      <span style="font-size:17px">SoM data needed to calculate attacks</span></div>`;
  }
  if (reason === 'no_gens') {
    return h + `<div class="watk-notarget">// Cannot attack — only 1 general home<br>
      <span style="font-size:17px">At least 2 generals must be home (1 is always kept back)</span></div>`;
  }
  if (!attacks.length) {
    return h + `<div class="watk-notarget">// No attack plan generated<br>
      <span style="font-size:17px">No breakable targets with your current generals — check intel age or wait for armies to return</span></div>`;
  }

  // Group attacks by wave name
  const byWave = {};
  attacks.forEach(atk => {
    const wn = atk.target.waveName || 'Wave';
    if (!byWave[wn]) byWave[wn] = [];
    byWave[wn].push(atk);
  });

  h += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
    <div class="wsech" style="margin-bottom:0">// ATTACK PLAN</div>
    <button onclick="__wpA.toggleNWPanel()"
      style="padding:4px 12px;background:#1a2828;border:1px solid #617070;color:#a0d0b0;
             font-size:17px;font-weight:700;cursor:pointer;border-radius:3px"
      title="Open wave target province pages to get real-time NW during a wave">
      ⟳ NW
    </button>
  </div>`;
  Object.entries(byWave).forEach(([wave, list]) => {
    h += _buildAttackCard(wave, list);
  });

  // Total estimated TM gains
  if (totalGains > 0) {
    h += `<div style="margin:6px 0 10px;padding:8px 14px;background:#1a2828;border:1px solid #304880;
                      border-radius:3px;font-size:17px;color:#80a8f0;display:flex;align-items:center;gap:10px">
      <span style="font-weight:700">📊 Total estimated TM gains: ~${fK(totalGains)} acres</span>
      <span style="font-size:13px;color:#617070">* rituals, honor not included</span>
    </div>`;
  }

  if (gensLeft > 0 && homeOffRemaining > 0) {
    h += `<div style="margin:10px 0;padding:8px 12px;background:#1a2828;border:1px solid #617070;
                      border-radius:3px;font-family:monospace;font-size:17px;color:#7a9090">
      🏠 ${gensLeft} gen${gensLeft > 1 ? 's' : ''} remaining home
      — ${fK(Math.round(homeOffRemaining))} off available for ambush / defense
    </div>`;
  }

  h += _buildContextTable(waveTargets, prov, aOff);
  return h;
}

function _buildProvPicker() {
  return `
    <div style="max-width:480px">
      <div class="wsech">// SELECT YOUR PROVINCE</div>
      <div style="display:grid;gap:8px">
        ${(S.own?.provinces || []).map(p => {
          const off  = p.som?.offPointsHome || p.sot?.offPoints || 0;
          const gens = p.som?.standingArmy?.generals ?? '?';
          return `<div onclick="__wpA.pickProv(${p.slot})"
            style="background:#2b3333;border:1px solid #617070;border-radius:3px;padding:12px 14px;cursor:pointer;
                   display:flex;align-items:center;justify-content:space-between;transition:border-color .15s"
            onmouseover="this.style.borderColor='#617070'" onmouseout="this.style.borderColor='#617070'">
            <div>
              <div style="font-size:21px;font-weight:700">${esc(p.name)}</div>
              <div style="font-family:monospace;font-size:17px;color:#7a9090">${esc(p.race || '')} · ${esc(p.sot?.personality || '')}</div>
            </div>
            <div style="text-align:right">
              <div style="font-family:monospace;font-size:19px;color:#ffd400">${fK(off)} off</div>
              <div style="font-family:monospace;font-size:17px;color:#7a9090">${gens} gens home · ${fK(p.networth)} NW</div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

function _playerHeader(prov, aOff, gensHome, attackableGens, ownPop, targetCount, armyStatus) {
  const genColor = attackableGens >= 3 ? '#60C040' : attackableGens >= 1 ? '#e09040' : '#E05050';
  const popColor = ownPop === null ? '#7a9090'
                 : ownPop > 100   ? '#60C040'
                 : ownPop >= 70   ? '#ffd400' : '#E05050';
  const popTier  = ownPop === null ? '' : ownPop > 100 ? 'TM focus' : ownPop >= 70 ? 'mixed' : 'raze/mass';
  const ms = loadManual(prov.name);  // single localStorage read for the whole header

  // Source-aware API values — when armies are overdue, use the auto-corrected figures
  const _sotOff  = prov.sot?.offPoints || 0;
  const _apiOff  = (armyStatus?.allOverdue && _sotOff) ? _sotOff : (prov.som?.offPointsHome || 0);
  const _sotGens = prov.sot?.generals;
  const _apiGens = (armyStatus?.allOverdue && _sotGens != null)
    ? _sotGens : (prov.som?.standingArmy?.generals ?? _sotGens ?? 5);

  const apiOff  = _apiOff;
  const apiNW   = prov.networth || 0;
  const apiGens = _apiGens;

  // Hint labels for each input — show data source and auto-correction status
  const offHintRaw  = !ms.off
    ? (armyStatus?.allOverdue && _sotOff ? '<span style="color:#60c040">↩ SoT (army returned)</span>'
    : armyStatus?.offSrc === 'stale'     ? '<span style="color:#e09040">⚠ stale — enter max off</span>'
    : apiOff                             ? 'from SoM' : '')
    : '✎ manual';
  const gensHintRaw = !ms.gens
    ? (armyStatus?.allOverdue && _sotGens != null ? '<span style="color:#60c040">↩ SoT (army returned)</span>'
    : apiGens                                     ? 'from SoM' : '')
    : '✎ manual';

  // Amber border on offense input if overdue and no SoT fallback and no manual override
  const offInputBorder = (!ms.off && armyStatus?.offSrc === 'stale')
    ? '#e09040' : '#617070';
  // Escape province name for safe embedding in both HTML attrs and JS string literals
  const pn = prov.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '&lt;');

  const inputStyle = 'background:#1a2828;border:1px solid #617070;color:#ffffff;font-family:monospace;' +
    'font-size:17px;padding:4px 8px;border-radius:3px;width:100%;box-sizing:border-box;margin-top:3px';
  const offInputStyle = inputStyle.replace('#617070', offInputBorder);
  const hintStyle = 'font-size:13px;color:#7a9090;margin-top:2px';

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div>
        <div style="font-size:21px;font-weight:700">${esc(prov.name)}</div>
        <div style="font-family:monospace;font-size:17px;color:#7a9090">${esc(prov.race || '')} · ${esc(prov.sot?.personality || '')}</div>
      </div>
      <button onclick="__wpA.pickProv('')"
        style="padding:5px 10px;background:#2b3333;border:1px solid #617070;color:#ffffff;font-size:17px;font-weight:700;cursor:pointer;border-radius:3px">
        ↩ Change
      </button>
    </div>

    <div style="background:#1a2828;border:1px solid #617070;border-radius:3px;padding:12px 14px;margin-bottom:14px">
      <div style="font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#7a9090;margin-bottom:10px">
        My Stats — enter your current values (saves on Tab/Enter/click away)
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <div>
          <div style="font-size:13px;color:#7a9090;font-weight:700;text-transform:uppercase;letter-spacing:1px">Max Offense</div>
          <input type="number" value="${ms.off || apiOff || ''}" placeholder="${apiOff ? fK(apiOff)+' (API)' : 'e.g. 85000'}"
            style="${offInputStyle}"
            onchange="__wpA.setManualStat('${pn}','off',this.value)"
            onkeydown="if(event.key==='Enter')this.blur()">
          <div style="${hintStyle}">${offHintRaw}</div>
        </div>
        <div>
          <div style="font-size:13px;color:#7a9090;font-weight:700;text-transform:uppercase;letter-spacing:1px">Net Worth</div>
          <input type="number" value="${ms.nw || apiNW || ''}" placeholder="${apiNW ? fK(apiNW)+' (API)' : 'e.g. 250000'}"
            style="${inputStyle}"
            onchange="__wpA.setManualStat('${pn}','nw',this.value)"
            onkeydown="if(event.key==='Enter')this.blur()">
          ${ms.nw ? '<div style="'+hintStyle+'">✎ manual</div>' : (apiNW ? '<div style="'+hintStyle+'">from IS</div>' : '')}
        </div>
        <div>
          <div style="font-size:13px;color:#7a9090;font-weight:700;text-transform:uppercase;letter-spacing:1px">Generals</div>
          <input type="number" min="0" max="5" value="${ms.gens != null ? ms.gens : (apiGens || '')}" placeholder="${apiGens || '1-5'}"
            style="${inputStyle}"
            onchange="__wpA.setManualStat('${pn}','gens',this.value)"
            onkeydown="if(event.key==='Enter')this.blur()">
          <div style="${hintStyle}">${gensHintRaw}</div>
        </div>
      </div>
    </div>

    <div class="watk-summary">
      <div class="watk-sstat"><div class="l">Off Home</div><div class="v">${fK(aOff)}</div></div>
      <div class="watk-sstat">
        <div class="l">Generals</div>
        <div class="v" style="color:${genColor}">${attackableGens}<span style="font-size:19px;color:#7a9090"> attack</span></div>
        <div class="s">${gensHome} home · 1 kept</div>
      </div>
      <div class="watk-sstat"><div class="l">Own NW</div><div class="v">${fK(aOff ? (ms.nw || apiNW) : 0)}</div></div>
      ${ownPop !== null ? `<div class="watk-sstat">
        <div class="l">Own Pop%</div>
        <div class="v" style="color:${popColor}">${ownPop}%</div>
        <div class="s">${popTier}</div>
      </div>` : ''}
      <div class="watk-sstat"><div class="l">Wave Targets</div><div class="v">${targetCount}</div><div class="s">by war leader</div></div>
    </div>`;
}

function _buildAttackCard(wave, atkList) {
  let h = `
    <div class="watk-card">
      <div class="watk-header">
        <span class="watk-wave">// ${esc(wave.toUpperCase())}</span>
        <span style="font-family:monospace;font-size:17px;color:#7a9090">${atkList.length} attack${atkList.length > 1 ? 's' : ''}</span>
      </div>
      <div class="watk-body">`;

  const claims = loadClaims();

  atkList.forEach(atk => {
    const t         = atk.target;
    const away      = t.tp?.som?.armiesAway?.length > 0;
    const ops       = t.item.province.requiredOps || [];
    const da        = t.dAge;
    const genColor  = atk.gens <= 2 ? '#60C040' : atk.gens <= 3 ? '#e09040' : '#ffffff';
    const resCls    = atk.result === 'yes' ? 'watk-yes' : atk.result === 'close' ? 'watk-cl' : 'watk-no';
    const resLabel  = atk.result === 'yes' ? 'BREAKS' : atk.result === 'close' ? 'CLOSE' : 'RISKY';
    const sentOff   = atk.sentOff || 0;
    const rs        = t.item.province.rawSlot;
    const razeClaim = claims['raze_'     + rs];
    const massClaim = claims['massacre_' + rs];

    // Attack type badge
    const typeBadge = atk.attackType === 'RAZE' ? '<span class="watk-type watk-type-rz">Raze</span>'
                    : atk.attackType === 'MASS' ? '<span class="watk-type watk-type-ms">Mass</span>'
                    : '<span class="watk-type watk-type-tm">TM</span>';
    // Source badge
    const srcBadge = atk.isAssigned
      ? '<span class="watk-src watk-src-a">Assigned</span>'
      : '<span class="watk-src watk-src-p">KD pool</span>';
    // Gains line (TM only)
    const gainsNote = atk.gains != null && atk.gains > 0
      ? `<span style="color:#80a8f0">~${fK(atk.gains)} acres (est.)</span>`
      : atk.gains === 0 ? '<span style="color:#617070">~0 acres (NW out of range)</span>' : '';
    // Enemy pop% for pool targets
    const tPopNote = !atk.isAssigned && atk.tPop != null
      ? `<span style="color:#7a9090">enemy pop ${atk.tPop}%</span>` : '';

    h += `
      <div class="watk-row">
        <div class="watk-num" style="color:#7a9090">${atk.n}</div>
        <div class="watk-main">
          <div class="watk-target" style="display:flex;align-items:center;flex-wrap:wrap;gap:6px">
            <span>${esc(t.item.province.name)}</span>
            ${typeBadge}${srcBadge}
            ${away ? '<span style="color:#60C040;font-size:17px">↗ army away</span>' : ''}
          </div>
          <div class="watk-detail">
            ${t.hasDefMod
              ? `${fK(t.tDefEff)} eff def <span style="color:#617070;font-size:15px">(${fK(t.tDef)} raw · ${t.eRace}${t.ePers ? ' ' + t.ePers : ''})</span>`
              : `${fK(t.tDef)} def`
            } · ${fK(sentOff)} off sent · ${atk.pct}% ratio
            ${da != null ? ` · intel <span class="${aC(da)}">${fA(da)}</span> old` : ''}
            ${gainsNote ? ` · ${gainsNote}` : ''}
            ${tPopNote  ? ` · ${tPopNote}`  : ''}
            ${atk.note    ? `<br><span style="color:#e09040">⚠ ${esc(atk.note)}</span>` : ''}
            ${atk.sodNote ? `<br><span style="color:#ffd400;font-weight:700">⚠ ${esc(atk.sodNote)}</span>` : ''}
          </div>
          ${ops.length ? `<div class="watk-ops">${ops.map(o => `<span class="wtag" style="cursor:default">${o}</span>`).join('')}</div>` : ''}
          ${t.item.province.notes ? `<div style="margin-top:4px;font-size:17px;color:#ffffff;background:#2b3333;padding:4px 6px;border-radius:2px;border-left:2px solid #ffd400">${esc(t.item.province.notes)}</div>` : ''}
          ${t.item.province.needsRaze ? `
          <div class="watk-task${razeClaim ? ' claimed' : ''}">
            <span>🔥</span>
            <span style="font-weight:700;color:${razeClaim ? '#ffd400' : '#E05050'}">${razeClaim ? 'RAZE — you claimed this' : 'RAZE NEEDED'}</span>
            <label class="watk-claim">
              <input type="checkbox" ${razeClaim ? 'checked' : ''} onchange="__wpA.claimAction(${rs},'raze')"
                style="cursor:pointer;width:14px;height:14px;accent-color:#ffd400">
              <span style="font-size:17px;color:${razeClaim ? '#ffd400' : '#7a9090'}">${razeClaim ? 'unclaim' : 'claim'}</span>
            </label>
          </div>` : ''}
          ${t.item.province.needsMassacre ? `
          <div class="watk-task${massClaim ? ' claimed' : ''}">
            <span>💀</span>
            <span style="font-weight:700;color:${massClaim ? '#ffd400' : '#E05050'}">${massClaim ? 'MASSACRE — you claimed this' : 'MASSACRE NEEDED'}</span>
            <label class="watk-claim">
              <input type="checkbox" ${massClaim ? 'checked' : ''} onchange="__wpA.claimAction(${rs},'massacre')"
                style="cursor:pointer;width:14px;height:14px;accent-color:#ffd400">
              <span style="font-size:17px;color:${massClaim ? '#ffd400' : '#7a9090'}">${massClaim ? 'unclaim' : 'claim'}</span>
            </label>
          </div>` : ''}
        </div>
        <div class="watk-gen">
          <div class="watk-gen-num" style="color:${genColor}">${atk.gens}</div>
          <div class="watk-gen-label">generals</div>
        </div>
        <div class="watk-result ${resCls}">${resLabel}<br>${atk.pct}%</div>
      </div>`;
  });

  h += '</div></div>';
  return h;
}

function _buildContextTable(waveTargets, prov, aOff) {
  // Use effective NW (manual override wins over API) for range check — same as calcAttacks()
  const aNW = _eff(prov.name, 'nw', prov.networth || 0);
  const ctxClaims = loadClaims();
  const thStyle   = 'text-align:left;padding:5px 8px;font-size:15px;font-weight:700;color:#7a9090;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #617070';

  const rows = waveTargets.map(item => {
    const tp    = pd(item.province.slot);
    const tDef  = tp?.calcs?.defPointsSummary?.defPointsHome || 0;
    const tNW   = tp?.networth || 0;
    const away  = tp?.som?.armiesAway?.length > 0;
    // NW quality (no hard cutoff — any target is hittable)
    const nwQ   = (!aNW || !tNW) ? 1
                : (() => { const r = aNW / tNW; return r >= 0.90 && r <= 1.10 ? 3 : r >= 0.75 && r <= 1.33 ? 2 : 1; })();
    const nwLabel = nwQ === 3 ? '✓ optimal' : nwQ === 2 ? '✓ good' : '~ marginal';
    const nwCls   = nwQ === 3 ? 'wmyes' : nwQ === 2 ? 'wmyes' : 'wmcl';
    const pct   = tDef > 0 && aOff > 0 ? Math.round(aOff / tDef * 100) : 0;
    const breaksCls = !aOff || !tDef ? 'wmcl' : aOff > tDef * 1.01 ? 'wmyes' : 'wmno';
    const rs    = item.province.rawSlot;
    const razeClaim = ctxClaims['raze_' + rs];
    const massClaim = ctxClaims['massacre_' + rs];
    const taskHtml  = [
      item.province.needsRaze     ? `<span style="color:${razeClaim?'#ffd400':'#E05050'};font-weight:700">🔥${razeClaim?' ✓':''}</span>` : '',
      item.province.needsMassacre ? `<span style="color:${massClaim?'#ffd400':'#E05050'};font-weight:700">💀${massClaim?' ✓':''}</span>` : '',
    ].filter(Boolean).join(' ') || '—';
    // Bloat / assigned metadata
    const bloat    = item.province.bloat;
    const assigned = item.province.assignedTo || [];
    const assignHtml = assigned.length === 0
      ? '<span style="color:#617070;font-size:15px">KD pool</span>'
      : assigned.map(n => `<span class="wtag" style="font-size:13px;margin:1px;cursor:default">${esc(n)}</span>`).join('');
    const bloatHtml = bloat
      ? '<span style="color:#9060c0;font-size:17px;font-weight:700">● Bloat</span>'
      : '—';

    return `<tr style="border-bottom:1px solid #617070${bloat?';background:rgba(100,60,130,.06)':''}">
      <td style="padding:6px 8px;font-weight:600">${esc(item.province.name)}</td>
      <td style="padding:6px 8px;font-family:monospace">${fK(tDef)}</td>
      <td style="padding:6px 8px;font-family:monospace">${fK(tNW)}</td>
      <td style="padding:6px 8px"><span class="wmatch ${breaksCls}">${pct}%</span></td>
      <td style="padding:6px 8px"><span class="wmatch ${nwCls}">${nwLabel}</span></td>
      <td style="padding:6px 8px">${away ? '<span style="color:#60C040;font-family:monospace;font-size:17px">AWAY</span>' : '—'}</td>
      <td style="padding:6px 8px">${taskHtml}</td>
      <td style="padding:6px 8px">${assignHtml}</td>
      <td style="padding:6px 8px">${bloatHtml}</td>
    </tr>`;
  }).join('');

  return `
    <div style="margin-top:20px" class="wsech">// ALL WAVE TARGETS (context)</div>
    <table style="width:100%;border-collapse:collapse;font-size:17px">
      <thead><tr>
        <th style="${thStyle}">Province</th>
        <th style="${thStyle}">Def Home</th>
        <th style="${thStyle}">NW</th>
        <th style="${thStyle}">Off/Def</th>
        <th style="${thStyle}">NW Range</th>
        <th style="${thStyle}">Army</th>
        <th style="${thStyle}">Task</th>
        <th style="${thStyle}">Assigned</th>
        <th style="${thStyle}">Bloat</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function pickProv(slot) {
  if (!slot) { S.playerProv = null; renderPlayer(); return; }
  S.playerProv = S.own.provinces.find(p => p.slot === parseInt(slot)) || null;
  renderPlayer();
}
