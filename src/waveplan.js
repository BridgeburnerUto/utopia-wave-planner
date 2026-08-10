// ── WAVE PLAN SOLVER ─────────────────────────────────────────────────────────
// Plans the ENTIRE wave kingdom-wide as one ordered hit sequence; each player
// is a sequence of hits within it. Rolling by army return time.
//
// Data model (all VERIFIED against a real IS dump 2026-07-14):
//  - API offense/defense points already include OME/DME; som.ome is the %.
//  - som.standingArmy = HOME units {generals, solds, oSpecs, elites, horses}.
//  - som.armiesAway[] = per-army {generals, solds, oSpecs, elites, horses,
//    secondsRemaining} — per-army offense = units × RACE_UNITS × ome.
//
// Slot model: one plannable slot per returning army (its gens + offense at its
// return time) plus a "home now" slot. A province's slots that fall within 1h
// of each other are MERGED into one (sum gens/off, latest time). A province
// left with ≥2 slots has a "stray army" — flagged so the leader can tell the
// player to hold it home next time.
//
// Solver priority: coverage of flagged targets (raze/mass honored) → every hit
// in acceptable NW range (0.75–1.33, aim 0.90–1.10) → maximize gains.
// Simulation: target land/NW drop per planned hit (attacker NW held static).
// Reservation: a big target that is some later slot's ONLY in-range option is
// avoided by earlier slots that have alternatives.
// Fallbacks for a slot out of range of every flagged target:
//  - in-range breakable NON-target (fat pure-def wall; never bloat) → 'wall'
//  - else least-bad flagged target by NW ratio, flagged 'marginal'.
//
// WAVE TYPES (S.waveType, dropdown on the Wave Plan tab):
//  - 'standard' — everything above, unchanged.
//  - 'shrink'   — chain as usual, but ALSO spend 1-3 hits each on leader-picked
//                 SHRINK targets (War Board "Shrink ⇩" column): big, high-pop
//                 enemy provinces we want smaller so the enemy KD loses living
//                 space/peons while the chain runs. Shrink hits are matched to
//                 attackers BEFORE the chain is solved, so the best-ranged
//                 (optimal RPNW) slots do the shrinking; the chain then eats
//                 what is left.
//  - 'shrinkai' — same, but the solver picks the shrink targets itself (fattest
//                 breakable, in-range, non-chain, non-bloat provinces), never
//                 more than WP_SHRINK_AI_MAX_TARGETS so the wave stays focused.
//                 Leader-set shrink flags are honoured first, AI fills the rest.

const WP_SLOT_MERGE_SEC = 3600;   // armies returning within 1h = one slot
const WP_MAX_HITS_PER_SLOT = 6;
const WP_AMBUSH_OFF_PCT = 0.20;   // leftover-off share worth holding a spare gen for ambush
const WP_MIN_SLOT_OFF   = 1000;   // slots below this offense are not attackers (pure-def provs)

// ── Shrink-wave tuning ───────────────────────────────────────────────────────
const WP_SHRINK_MAX_HITS       = 3;    // leader may order 1-3 hits per shrink target
const WP_SHRINK_MAX_PER_SLOT   = 2;    // shrink hits pre-matched to one attacker slot
const WP_SHRINK_AI_MAX_TARGETS = 6;    // AI never spreads wider than this (too thin)
const WP_SHRINK_AI_HITS        = 2;    // hits the AI plans per auto-picked target
const WP_SHRINK_AI_SLOT_SHARE  = 0.35; // max share of attack slots spent shrinking
const WP_SHRINK_AI_MIN_POP_PCT = 90;   // hard floor — never auto-shrink an emptier province

// Overflow cap: how many hits one province may soak from the low-priority tiers
// (uncovered / any / wall / marginal / dump). CHAIN victims are exempt — piling
// hits on one province is the whole point of a chain — as are raze/mass orders
// and shrink quota. Without this, a single low-def province becomes the dumping
// ground for every attacker that can't break anything else (14 hits, observed).
const WP_MAX_OVERFLOW_HITS_PER_TARGET = 5;

/** True for the wave types that run the shrink pass. */
function _wpIsShrinkWave(waveType) {
  return waveType === 'shrink' || waveType === 'shrinkai';
}

/** Raw troops to send: game applies +5% per extra general to the troops sent. */
function _wpTroopsFor(def, gens) {
  return Math.ceil((def + 1) / (1 + GEN_OFF_BONUS * (Math.max(1, gens) - 1)));
}

/**
 * Distribute a slot's SPARE generals across its planned hits.
 * More gens on a hit → fewer raw troops needed → fewer own losses. Each spare
 * gen goes to the hit where it saves the most troops (highest def first).
 * Ambush rule: if after all sends the province would still hold more than
 * WP_AMBUSH_OFF_PCT of the slot's offense at home, one spare general is held
 * back for a possible ambush instead of being spent on a hit.
 * Mutates each hit's gens/sentOff (needs hit.def and hit.minGens set).
 * Returns { heldGen, leftover }.
 */
function _wpFinalizeSlotHits(sl, hits, extras) {
  if (!hits.length) return { heldGen: false, leftover: sl.off };
  const apply = (n) => {
    hits.forEach(h => { h.gens = h.minGens; });
    let left = n;
    while (left > 0) {
      let best = null, bestSave = 0;
      for (const h of hits) {
        const save = _wpTroopsFor(h.def, h.gens) - _wpTroopsFor(h.def, h.gens + 1);
        if (save > bestSave) { bestSave = save; best = h; }
      }
      if (!best) break;
      best.gens++; left--;
    }
    hits.forEach(h => { h.sentOff = _wpTroopsFor(h.def, h.gens); });
    return sl.off - hits.reduce((s, h) => s + h.sentOff, 0);
  };
  let heldGen  = false;
  let leftover = apply(extras);
  if (extras > 0 && leftover > WP_AMBUSH_OFF_PCT * sl.off) {
    leftover = apply(extras - 1);
    heldGen  = true;
  }
  return { heldGen, leftover };
}

/** Pop-strategy warning: solver never overrides leader flags, only warns.
 *  Own prov <70% pop = "fat" (wants raze/mass); ≥100% = "needs acres" (wants TM). */
function _wpPopWarn(popPct, type) {
  if (popPct == null) return null;
  if (popPct < 70   && type === 'TM') return `fat (pop ${popPct}%) — raze/mass preferred`;
  if (popPct >= 100 && type !== 'TM') return `needs acres (pop ${popPct}%) — TM preferred`;
  return null;
}

/** Candidate ordering: range band first, then enemy pop% (fat enemies before
 *  thin ones — user rule), then estimated gain. Never trades a better band
 *  for a fatter target. */
function _wpBandRank(r) { return r === 'optimal' ? 0 : r === 'ok' ? 1 : 2; }
function _wpByBandPopGain(a, b) {
  return _wpBandRank(a.range) - _wpBandRank(b.range)
      || (b.t.pop || 0) - (a.t.pop || 0)
      || b.gain - a.gain;
}

// ── Unit offense helper ──────────────────────────────────────────────────────
// Offense points of a unit bundle for a race, at the given OME and elite %.
// Rebuilt from raw units, so it must apply the same unit-strength bonuses the
// game bakes into offPoints: General +2 elite, War Hero +2 ospec (always), and
// Avian Dive Bomb +2 ospec (war — always active in this war-planning tool).
function _wpUnitsOff(units, race, personality, ome, elitePct) {
  const r = (race || '').toLowerCase();
  const p = (personality || '').toLowerCase();
  const u = RACE_UNITS[r];
  if (!u) return 0;
  const eliteOff = u.elite[0] + (PERS_ELITE_OFF_BONUS[p] || 0);
  const ospecOff = u.ospec[0] + (PERS_OSPEC_OFF_BONUS[p] || 0) + (RACE_WAR_OSPEC_OFF_BONUS[r] || 0);
  const raw = (units.solds  || 0) * u.soldier[0]
            + (units.oSpecs || 0) * ospecOff
            + (units.elites || 0) * eliteOff * (elitePct / 100)
            + (units.horses || 0) * u.horse[0];
  return raw * ome;
}

// ── Attack slots ─────────────────────────────────────────────────────────────
/**
 * Build plannable attack slots from own provinces.
 * Returns [{key, provSlot, attacker, race, nw, land, availableAt(sec, 0=now),
 *           gens, off, stray, isHome}], sorted by availableAt ASC, then NW DESC
 * (same-time slots: big attackers pick first while targets are still fat).
 */
function buildWaveSlots() {
  const slots = [];
  for (const p of (S.own?.provinces || [])) {
    const som = p.som || {};
    const elitePct = _elitePctFor(p);   // shared setting, else race default (def elites → 0%)
    const ome  = (som.ome || 100) / 100;
    const pers = p.sot?.personality;

    const provSlots = [];

    // Home slot: everything currently home; 1 general must stay.
    const sa = som.standingArmy || {};
    const homeGens = sa.generals != null ? sa.generals : 5;
    // Withhold home elites per elite % (offPointsHome already includes them, OME-adjusted)
    const homeWithheld = (sa.elites || 0) > 0 && elitePct < 100
      ? _wpUnitsOff({ elites: sa.elites }, p.race, pers, ome, 100 - elitePct)
      : 0;
    const homeOff = Math.max(0, (som.offPointsHome || 0) - homeWithheld) * FANATICISM_OFF_MULT;
    if (homeGens - 1 > 0 && homeOff > 0) {
      provSlots.push({ availableAt: 0, gens: homeGens - 1, off: homeOff, isHome: true });
    }

    // One slot per returning army (overdue = available now)
    for (const a of (som.armiesAway || [])) {
      const gens = a.generals || 0;
      const off  = _wpUnitsOff(a, p.race, pers, ome, elitePct) * FANATICISM_OFF_MULT;
      if (gens <= 0 && off <= 0) continue;
      provSlots.push({
        availableAt: Math.max(0, a.secondsRemaining || 0),
        gens, off, isHome: false,
      });
    }

    // Merge slots within 1h of each other (chain-merge after sorting)
    provSlots.sort((a, b) => a.availableAt - b.availableAt);
    const merged = [];
    for (const s of provSlots) {
      const last = merged[merged.length - 1];
      if (last && s.availableAt - last.availableAt <= WP_SLOT_MERGE_SEC) {
        last.gens += s.gens;
        last.off  += s.off;
        last.availableAt = s.availableAt;    // wave when the latest of the group lands
        last.isHome = last.isHome && s.isHome;
      } else {
        merged.push({ ...s });
      }
    }

    const stray = merged.length > 1;
    const popPct = _ownPopPct(p);
    merged.filter(s => s.off >= WP_MIN_SLOT_OFF).forEach((s, i) => slots.push({
      key:      p.slot + (merged.length > 1 ? '_' + i : ''),
      provSlot: p.slot,
      attacker: p.name,
      race:     p.race || '',
      pers:     pers || '',      // race+pers feed the gain estimator's Race/Personality mods
      nw:       p.networth || 0,
      land:     p.land || 0,
      popPct,
      availableAt: s.availableAt,
      gens:     s.gens,
      off:      Math.round(s.off),
      stray,
      isHome:   s.isHome,
    }));
  }
  slots.sort((a, b) => a.availableAt !== b.availableAt
    ? a.availableAt - b.availableAt
    : b.nw - a.nw);
  return slots;
}

// ── Targets ──────────────────────────────────────────────────────────────────
/**
 * Flagged wave targets with live intel + mutable sim state.
 * shrinkGoals ({[slot]: {hits, ai}}) pulls shrink-only provinces (not flagged
 * as wave targets on the board) into the target pool as well — empty object /
 * omitted for a standard wave, so behaviour there is unchanged.
 */
function buildWaveTargets(shrinkGoals) {
  const sg = shrinkGoals || {};
  return (S.enemy?.provinces || [])
    .filter(ep => S.provinces[ep.slot]?.wave || sg[ep.slot])
    .map(ep => {
      const plan = S.provinces[ep.slot];
      const tp   = pd('[' + ep.slot + ']');
      return {
        slot: ep.slot, name: ep.name, race: ep.race || '',
        tp,
        def:  tp?.calcs?.defPointsSummary?.defPointsHome || 0,
        nw:   tp?.networth || ep.networth || 0,
        land: tp?.land || 0,
        pop:  _enemyPopPct(tp),
        intelAge: tp?.calcs?.defPointsSummary?.ageSeconds,
        needsRaze:     plan.needsRaze     || false,
        needsMassacre: plan.needsMassacre || false,
        bloat:         plan.bloat         || false,
        targetAcres:   plan.targetAcres   || 0,   // chain goal: hit until simLand ≤ this
        shrinkGoal:    sg[ep.slot]?.hits  || 0,   // shrink goal: this many hits wanted
        shrinkAI:      !!sg[ep.slot]?.ai,         // picked by the solver, not the leader
        shrinkOnly:    !!sg[ep.slot] && !plan.wave,
        // sim state
        simNW: tp?.networth || ep.networth || 0,
        simLand: tp?.land || 0,
        hits: 0, razeDone: false, massDone: false,
      };
    })
    .filter(t => t.nw > 0);
}

/** Non-flagged, non-bloat enemy provinces — fallback "wall" pool.
 *  Shrink targets live in the target pool instead — never in both (one sim
 *  state per province). */
function _wpWallPool(shrinkGoals) {
  const sg = shrinkGoals || {};
  return (S.enemy?.provinces || [])
    .filter(ep => !S.provinces[ep.slot]?.wave && !S.provinces[ep.slot]?.bloat && !sg[ep.slot])
    .map(ep => {
      const tp = pd('[' + ep.slot + ']');
      return {
        slot: ep.slot, name: ep.name, race: ep.race || '', tp,
        def:  tp?.calcs?.defPointsSummary?.defPointsHome || 0,
        nw:   tp?.networth || ep.networth || 0,
        land: tp?.land || 0,
        pop:  _enemyPopPct(tp),
        intelAge: tp?.calcs?.defPointsSummary?.ageSeconds,
        needsRaze: false, needsMassacre: false, bloat: false,
        simNW: tp?.networth || ep.networth || 0,
        simLand: tp?.land || 0,
        hits: 0, razeDone: false, massDone: false,
        isWall: true,
      };
    })
    .filter(t => t.nw > 0 && t.def > 0);
}

// ── Range helpers ────────────────────────────────────────────────────────────
function _wpRange(aNW, tNW) {
  if (!aNW || !tNW) return 'out';
  const r = aNW / tNW;
  if (r >= NW_OPTIMAL.min   && r <= NW_OPTIMAL.max)   return 'optimal';
  if (r >= NW_WAR_RANGE.min && r <= NW_WAR_RANGE.max) return 'ok';
  return 'out';
}

function _wpMinGens(def, off, gensAvail) {
  if (!gensAvail || off <= 0) return 0;
  if (!def)                   return 1;
  if (off > def)              return 1;
  const n = Math.ceil(1 + (def / off - 1) / GEN_OFF_BONUS);
  return n <= gensAvail ? n : 0;
}

// ── Shrink pass ──────────────────────────────────────────────────────────────
// A shrink wave keeps the chain, but first spends a few hits on the enemy's
// biggest, fullest provinces: taking their acres removes living space, so the
// peons they lose don't come back — econ damage while the chain runs.

/** Leader-set shrink goals from the board: {[slot]: {hits, ai:false}}. */
function _wpLeaderShrinkGoals() {
  const out = {};
  for (const ep of (S.enemy?.provinces || [])) {
    const n = Math.min(WP_SHRINK_MAX_HITS, parseInt(S.provinces[ep.slot]?.shrink) || 0);
    if (n > 0) out[ep.slot] = { hits: n, ai: false };
  }
  return out;
}

/**
 * Auto-pick shrink targets ('shrinkai'): the FULLEST breakable enemy provinces
 * that are in range of at least one attacker slot.
 *
 * Two-step selection, and the order matters:
 *  1. GATE on density — a province under WP_SHRINK_AI_MIN_POP_PCT is never
 *     picked, full stop. A captured acre carries population pro rata, so an
 *     acre off a 100%-pop province removes ~25 peons while the same acre off a
 *     40%-pop one removes ~10 and the rest of its peons still fit. Shrinking an
 *     emptier province only deletes unused living space (acre trading).
 *  2. RANK the survivors by SIZE (estimated population, acres as the tiebreak).
 *     Everything past the gate is already full, so the bigger province loses
 *     more real housing per hit — 2 hits on a 550-acre prov beat 2 hits on a
 *     200-acre one. (Ranking by size WITHOUT the gate was the original bug:
 *     it just picked the biggest half-empty provinces.)
 *
 * Also excluded: chain victims and anything the leader flagged as a wave target
 * (the leader already has plans for those — the AI must not spend its quota on
 * them), bloat provinces (deliberately left to grow), and anything without
 * fresh defense intel — the solver must not order hits on a province whose
 * defense it does not know. Capped by WP_SHRINK_AI_MAX_TARGETS and by the share
 * of the wave we are willing to spend shrinking.
 */
function _wpAiShrinkPicks(slots, leaderGoals) {
  const budget     = Math.max(WP_SHRINK_AI_HITS, Math.floor(slots.length * WP_SHRINK_AI_SLOT_SHARE));
  const maxTargets = Math.min(WP_SHRINK_AI_MAX_TARGETS, Math.floor(budget / WP_SHRINK_AI_HITS));
  const taken      = Object.keys(leaderGoals).length;
  const room       = maxTargets - taken;
  if (room <= 0) return {};

  const cands = (S.enemy?.provinces || []).map(ep => {
    if (leaderGoals[ep.slot]) return null;
    const plan = S.provinces[ep.slot] || {};
    if (plan.bloat)           return null;   // bloat = let it grow, hit with thievery
    if (plan.targetAcres > 0) return null;   // chain victim — already the wave's focus
    if (plan.wave)            return null;   // leader flagged it — their plan wins, not ours
    const tp   = pd('[' + ep.slot + ']') || ep;
    const def  = tp?.calcs?.defPointsSummary?.defPointsHome || 0;
    const nw   = tp.networth || ep.networth || 0;
    const land = tp.land || 0;
    if (!def || !nw || !land) return null;   // no def intel → never auto-target
    const reachable = slots.some(sl =>
      _wpRange(sl.nw, nw) !== 'out' && _wpMinGens(def, sl.off, sl.gens));
    if (!reachable) return null;
    const popPct = _enemyPopPct(tp);
    // STEP 1 — density gate. No pop intel, or not full enough for its acres to
    // be worth taking: never auto-picked, however big it is.
    if (popPct == null || popPct < WP_SHRINK_AI_MIN_POP_PCT) return null;
    const pop = _provCurrentPop(tp) ?? (land * 25 * (popPct / 100));
    return { slot: ep.slot, popPct, land, pop };
    // STEP 2 — rank the survivors by SIZE. They are all full already, so the
    // bigger one loses more occupied housing per hit; acres break ties.
  }).filter(Boolean).sort((a, b) => b.pop - a.pop || b.land - a.land);

  const out = {};
  for (const c of cands.slice(0, room)) out[c.slot] = { hits: WP_SHRINK_AI_HITS, ai: true };
  return out;
}

/** All shrink goals for a wave type (leader flags, plus AI picks in 'shrinkai'). */
function _wpShrinkGoals(waveType, slots) {
  if (!_wpIsShrinkWave(waveType)) return {};
  const leader = _wpLeaderShrinkGoals();
  return waveType === 'shrinkai'
    ? { ...leader, ..._wpAiShrinkPicks(slots, leader) }
    : leader;
}

/**
 * Match shrink hits to attacker slots BEFORE the chain is solved, so shrink
 * targets get the best-ranged attackers (user rule) instead of whatever the
 * chain leaves over. Returns {[slotKey]: [targetSlot, ...]} — intent only; the
 * main loop still checks it can actually break the target at that point.
 * Protected: a slot that is the ONLY in-range breaker of a chain victim is
 * never given shrink work.
 */
function _wpAssignShrink(slots, targets, gainFn) {
  const needs = targets.filter(t => t.shrinkGoal > 0);
  if (!needs.length) return {};

  // Slots that must stay free for a chain victim only they can reach
  const protectedSlots = new Set();
  for (const t of targets) {
    if (!(t.targetAcres > 0)) continue;
    const able = slots.filter(sl => _wpRange(sl.nw, t.nw) !== 'out' && _wpMinGens(t.def, sl.off, sl.gens));
    if (able.length === 1) protectedSlots.add(able[0].key);
  }

  const pairs = [];
  for (const sl of slots) {
    if (protectedSlots.has(sl.key)) continue;
    for (const t of needs) {
      const range = _wpRange(sl.nw, t.nw);
      if (range === 'out') continue;                        // shrink = good-range work only
      if (!_wpMinGens(t.def, sl.off, sl.gens)) continue;     // can't break it even at full off
      pairs.push({ sl, t, range, gain: gainFn(t, sl) });
    }
  }
  // Optimal range first, then the fattest target, then gains
  pairs.sort((a, b) => _wpBandRank(a.range) - _wpBandRank(b.range)
                    || (b.t.pop || 0) - (a.t.pop || 0)
                    || b.gain - a.gain);

  const assign = {};
  const perSlot = {}, perTarget = {};
  for (const p of pairs) {
    if ((perTarget[p.t.slot] || 0) >= p.t.shrinkGoal)     continue;
    if ((perSlot[p.sl.key]  || 0) >= WP_SHRINK_MAX_PER_SLOT) continue;
    (assign[p.sl.key] = assign[p.sl.key] || []).push(p.t.slot);
    perTarget[p.t.slot] = (perTarget[p.t.slot] || 0) + 1;
    perSlot[p.sl.key]   = (perSlot[p.sl.key]  || 0) + 1;
  }
  return assign;
}

/** Shrink progress for every target with a shrink goal. `hits` is every hit the
 *  wave lands there (a leftover dump hit shrinks it just as well), so it can
 *  exceed the goal — the UI words it as "N hits (goal G)". */
function _wpShrinkStatus(targets) {
  return targets.filter(t => t.shrinkGoal > 0).map(t => ({
    name: t.name, slot: t.slot, goal: t.shrinkGoal, hits: t.hits, ai: t.shrinkAI,
    from: t.land, to: Math.round(t.simLand),
    done: t.hits >= t.shrinkGoal,
  }));
}

// ── Solver ───────────────────────────────────────────────────────────────────
/** Chain-goal progress for every target with targetAcres set. */
function _wpChainStatus(targets) {
  return targets.filter(t => t.targetAcres > 0).map(t => ({
    name: t.name, slot: t.slot,
    from: t.land, to: Math.round(t.simLand), goal: t.targetAcres,
    done: t.simLand <= t.targetAcres,
  }));
}

/**
 * Generate the wave sequence. Pure: reads S, returns {seq, slots, targets,
 * uncovered, idleSlots, ambushHolds, chainStatus, shrinkStatus, shrinkGoals,
 * waveType, totalGains}. Does not mutate S.
 * waveType: 'standard' | 'shrink' | 'shrinkai' (see header).
 */
function generateWaveSeq(waveType) {
  const wt      = waveType || S.waveType || 'standard';
  const slots   = buildWaveSlots();
  const shrinkGoals = _wpShrinkGoals(wt, slots);
  const targets = buildWaveTargets(shrinkGoals);
  const walls   = _wpWallPool(shrinkGoals);

  const ownProvs   = S.own?.provinces   || [];
  const eneProvs   = S.enemy?.provinces || [];
  const ownKdAvgNW = ownProvs.length ? ownProvs.reduce((s,p) => s+(p.networth||0),0) / ownProvs.length : 0;
  const eneKdAvgNW = eneProvs.length ? eneProvs.reduce((s,p) => s+(p.networth||0),0) / eneProvs.length : 0;

  // Reservation: a target that is some LATER slot's only in-range flagged
  // option (at current NWs) is avoided by earlier slots with alternatives.
  const soleOptionOf = {}; // target slot → count of slots for which it's the sole option
  for (const sl of slots) {
    const inRange = targets.filter(t => _wpRange(sl.nw, t.nw) !== 'out' && !t.bloat);
    if (inRange.length === 1) soleOptionOf[inRange[0].slot] = (soleOptionOf[inRange[0].slot] || 0) + 1;
  }
  const reservedHits = { ...soleOptionOf }; // consumed as reserved slots take their hits

  const seq = [];
  const idleSlots = [];
  const ambushHolds = [];

  function estGain(t, sl) {
    return _estimateTMGain(t.simNW, t.simLand, t.tp, sl.land, sl.nw, ownKdAvgNW, eneKdAvgNW,
                             { race: sl.race, personality: sl.pers }) || 0;
  }

  // Shrink hits are matched to attackers up front (before the chain is solved)
  // so the best-ranged slots do the shrinking. {slotKey: [targetSlot,...]}
  const shrinkAssign = _wpAssignShrink(slots, targets, estGain);

  function applyHit(t, sl, type, gens, gensLeft, offLeft, extra) {
    const gain = type === 'TM' ? estGain(t, sl) : 0;
    const projNW = Math.round(t.simNW);
    seq.push({
      n: seq.length + 1,
      slotKey: sl.key, provSlot: sl.provSlot, attacker: sl.attacker,
      availableAt: sl.availableAt,
      targetSlot: t.slot, target: t.name, isWall: !!t.isWall,
      type, gens,
      def: t.def,
      minGens: gens,
      sentOff: _wpTroopsFor(t.def, gens),
      popWarn: _wpPopWarn(sl.popPct, type),
      projNW,
      projLand: Math.round(t.simLand),
      range: _wpRange(sl.nw, t.simNW),
      estGain: Math.round(gain),
      ...extra,
    });
    t.hits++;
    if (type === 'RAZE') t.razeDone = true;
    if (type === 'MASS') t.massDone = true;
    if (gain > 0) {
      const nwPerAcre = t.simLand > 0 ? t.simNW / t.simLand : 0;
      t.simLand = Math.max(0, t.simLand - gain);
      t.simNW   = Math.max(0, t.simNW - gain * nwPerAcre);
    }
  }

  for (const sl of slots) {
    let gensLeft = sl.gens;
    let offLeft  = sl.off;
    let hitsThisSlot = 0;
    const slotSeqStart = seq.length;
    const slotHadReservation = targets.some(t =>
      soleOptionOf[t.slot] && _wpRange(sl.nw, t.nw) !== 'out');

    while (gensLeft > 0 && offLeft > 0 && hitsThisSlot < WP_MAX_HITS_PER_SLOT) {
      // Candidates among flagged targets: breakable now, range by simulated NW
      const cands = targets.map(t => {
        if (t.bloat && !( (t.needsRaze && !t.razeDone) || (t.needsMassacre && !t.massDone) )) return null;
        const mg = _wpMinGens(t.def, offLeft, gensLeft);
        if (!mg) return null;
        const range = _wpRange(sl.nw, t.simNW);
        return { t, mg, range, gain: estGain(t, sl) };
      }).filter(Boolean);

      // Skip reserved targets when this slot has other in-range choices
      const inRange = cands.filter(c => c.range !== 'out');
      const nonReserved = inRange.filter(c =>
        !(reservedHits[c.t.slot] > 0) || inRange.length === 1 || slotHadReservation);
      const pool = nonReserved.length ? nonReserved : inRange;

      let pick = null, type = 'TM', marginal = false, fallback = null, shrink = false;

      // Chain goal helpers: unmet chains come first; met chains ("done") drop
      // to overflow — they only soak dump hits / last-resort marginals.
      const chainNeeded = t => t.targetAcres > 0 && t.simLand > t.targetAcres;
      const chainDone   = t => t.targetAcres > 0 && t.simLand <= t.targetAcres;
      // Shrink quota: hits still wanted on a shrink target. A shrink-ONLY
      // target whose quota is filled drops out of the normal tiers (we do not
      // want the wave drifting onto it once its acres are taken).
      const shrinkNeeded = t => t.shrinkGoal > 0 && t.hits < t.shrinkGoal;
      const shrinkSpent  = t => t.shrinkOnly && t.hits >= t.shrinkGoal;
      const mine = shrinkAssign[sl.key] || [];
      // Overflow cap — applies to the low-priority tiers only; a chain victim is
      // meant to be pounded, so it is never capped.
      const overflowOk = t => t.targetAcres > 0 || t.hits < WP_MAX_OVERFLOW_HITS_PER_TARGET;

      // 1. Raze/Massacre still needed, in range preferred
      const rm = pool.filter(c => (c.t.needsRaze && !c.t.razeDone) || (c.t.needsMassacre && !c.t.massDone))
        .sort(_wpByBandPopGain);
      // 2. Shrink work pre-matched to THIS slot — planned ahead of the chain so
      //    shrink targets get optimal-range attackers
      const shrinkMine = pool.filter(c => shrinkNeeded(c.t) && mine.includes(c.t.slot))
        .sort(_wpByBandPopGain);
      // 3. Chain quota: unmet chain targets before everything else — the wave
      //    is built around the chain
      const chain = pool.filter(c => chainNeeded(c.t) && !c.t.bloat).sort(_wpByBandPopGain);
      // 4. Shrink quota nobody delivered on (its matched slot could not break
      //    it, or was spent) — any in-range slot picks up the slack
      const shrinkLeft = pool.filter(c => shrinkNeeded(c.t) && !c.t.bloat).sort(_wpByBandPopGain);
      // 5. Uncovered targets (0 hits): range band → enemy pop% → gain
      const uncov = pool.filter(c => c.t.hits === 0 && !c.t.bloat && !chainDone(c.t) && !shrinkSpent(c.t))
        .sort(_wpByBandPopGain);
      // 6. Any in-range flagged (met chains/shrinks and over-hit provs excluded)
      const any = pool.filter(c => !c.t.bloat && !chainDone(c.t) && !shrinkSpent(c.t) && overflowOk(c.t))
        .sort(_wpByBandPopGain);

      if      (rm.length)         { pick = rm[0]; type = pick.t.needsRaze && !pick.t.razeDone ? 'RAZE' : 'MASS'; }
      else if (shrinkMine.length) { pick = shrinkMine[0]; shrink = true; }
      else if (chain.length)      { pick = chain[0]; }
      else if (shrinkLeft.length) { pick = shrinkLeft[0]; shrink = true; }
      else if (uncov.length)      { pick = uncov[0]; }
      else if (any.length)        { pick = any[0]; }
      else {
        // Fallbacks — nothing flagged is in range for this slot
        // a) in-range breakable wall (non-target, non-bloat)
        const wall = walls.map(w => {
          if (!overflowOk(w)) return null;
          const mg = _wpMinGens(w.def, offLeft, gensLeft);
          if (!mg) return null;
          const range = _wpRange(sl.nw, w.simNW);
          if (range === 'out') return null;
          return { t: w, mg, range, gain: estGain(w, sl) };
        }).filter(Boolean).sort(_wpByBandPopGain);
        if (wall.length) { pick = wall[0]; fallback = 'wall'; }
        else {
          // b) least-bad flagged target by NW ratio, breakable, marked marginal.
          //    Shrink targets that already got their hits go last — leftover
          //    offense shouldn't pile onto one province the wave is done with.
          const lb = cands.filter(c => !c.t.bloat && overflowOk(c.t))
            .sort((a, b) => (Number(shrinkSpent(a.t)) - Number(shrinkSpent(b.t))) ||
                            Math.abs(Math.log(sl.nw / (a.t.simNW || 1))) -
                            Math.abs(Math.log(sl.nw / (b.t.simNW || 1))));
          if (lb.length) { pick = lb[0]; marginal = true; }
        }
      }

      if (!pick) break; // nothing breakable at all — slot done

      if (reservedHits[pick.t.slot] > 0 && slotHadReservation) reservedHits[pick.t.slot]--;
      applyHit(pick.t, sl, type, pick.mg, gensLeft, offLeft, { marginal, fallback, shrink });
      gensLeft -= pick.mg;
      offLeft  -= _wpTroopsFor(pick.t.def, pick.mg); // gen bonus already saves troops here
      hitsThisSlot++;
      type = 'TM';
    }

    // Dump pass — an attacker should not leave offense home in war. Spend
    // what's left on the best still-breakable enemy (usually small and out of
    // range; range band → enemy pop% → gain). The ambush hold below can then
    // only trigger when the leftover genuinely can't break anything.
    const overflowDumpOk = t => t.targetAcres > 0 || t.hits < WP_MAX_OVERFLOW_HITS_PER_TARGET;
    const dumpPool = targets.concat(walls);
    while (gensLeft > 0 && offLeft > 0 && hitsThisSlot < WP_MAX_HITS_PER_SLOT) {
      const dcands = dumpPool.map(t => {
        if (t.bloat || !overflowDumpOk(t)) return null;
        const mg = _wpMinGens(t.def, offLeft, gensLeft);
        if (!mg) return null;
        return { t, mg, range: _wpRange(sl.nw, t.simNW), gain: estGain(t, sl) };
      }).filter(Boolean).sort(_wpByBandPopGain);
      if (!dcands.length) break;
      const d = dcands[0];
      applyHit(d.t, sl, 'TM', d.mg, gensLeft, offLeft, { dump: true });
      gensLeft -= d.mg;
      offLeft  -= _wpTroopsFor(d.t.def, d.mg);
      hitsThisSlot++;
    }

    if (hitsThisSlot === 0) { idleSlots.push(sl.key); continue; }

    // Spread the slot's spare generals over its hits (fewer troops sent =
    // fewer losses); hold one back for ambush when plenty of off stays home.
    const fin = _wpFinalizeSlotHits(sl, seq.slice(slotSeqStart), gensLeft);
    if (fin.heldGen) ambushHolds.push({
      attacker: sl.attacker, provSlot: sl.provSlot, slotKey: sl.key, leftover: Math.round(fin.leftover),
    });
  }

  const uncovered  = targets.filter(t => !t.bloat && t.hits === 0).map(t => pnum(t.slot, t.name));
  const totalGains = seq.reduce((s, h) => s + (h.estGain || 0), 0);
  // The pop% floor can legitimately leave the AI with nothing to shrink — say so
  // rather than letting the leader think the pass silently did nothing.
  const shrinkNote = (wt === 'shrinkai' && !Object.values(shrinkGoals).some(g => g.ai))
    ? `No enemy province qualifies for auto-shrink — none are at ${WP_SHRINK_AI_MIN_POP_PCT}%+ pop `
      + `(and breakable, in range, not a chain victim or bloat prov). Shrinking an emptier province `
      + `would only take empty living space, so the wave was planned as a normal chain.`
    : null;
  return { seq, slots, targets, uncovered, idleSlots, ambushHolds,
           chainStatus:  _wpChainStatus(targets),
           shrinkStatus: _wpShrinkStatus(targets),
           shrinkGoals, shrinkNote,
           waveType: wt,
           totalGains };
}

/**
 * Re-simulate an EXISTING sequence (after manual reassign/remove): keeps the
 * (attacker, target, type) of every hit and its order, recomputes gens needed,
 * sent off, ranges, gains and projections against fresh sim state.
 * Returns a new seq array; hits whose attacker can no longer break are kept
 * but marked result:'risky'.
 */
function resimulateWaveSeq(seq, waveType) {
  const wt      = waveType || S.waveType || 'standard';
  const slots   = buildWaveSlots();
  // Same goals as generation: leader flags are stored on the plan, and the AI
  // pick is deterministic for the same intel, so the target pool matches.
  const shrinkGoals = _wpShrinkGoals(wt, slots);
  const targets = buildWaveTargets(shrinkGoals);
  const walls   = _wpWallPool(shrinkGoals);
  const bySlotKey  = Object.fromEntries(slots.map(s => [s.key, { ...s, gensLeft: s.gens, offLeft: s.off }]));
  const byTarget   = {};
  targets.concat(walls).forEach(t => { byTarget[t.slot] = t; });

  const ownProvs   = S.own?.provinces   || [];
  const eneProvs   = S.enemy?.provinces || [];
  const ownKdAvgNW = ownProvs.length ? ownProvs.reduce((s,p) => s+(p.networth||0),0) / ownProvs.length : 0;
  const eneKdAvgNW = eneProvs.length ? eneProvs.reduce((s,p) => s+(p.networth||0),0) / eneProvs.length : 0;

  const out = [];
  for (const h of seq) {
    const sl = bySlotKey[h.slotKey];
    const t  = byTarget[h.targetSlot];
    if (!sl || !t) continue; // attacker slot or target vanished — drop hit
    const mg = _wpMinGens(t.def, sl.offLeft, sl.gensLeft);
    const gain = h.type === 'TM'
      ? (_estimateTMGain(t.simNW, t.simLand, t.tp, sl.land, sl.nw, ownKdAvgNW, eneKdAvgNW,
                             { race: sl.race, personality: sl.pers }) || 0)
      : 0;
    out.push({
      ...h,
      n: out.length + 1,
      attacker: sl.attacker, provSlot: sl.provSlot, availableAt: sl.availableAt,
      gens: mg || 1,
      def: t.def,
      minGens: mg || 1,
      sentOff: _wpTroopsFor(t.def, mg || 1),
      popWarn: _wpPopWarn(sl.popPct, h.type),
      projNW: Math.round(t.simNW),
      projLand: Math.round(t.simLand),
      range: _wpRange(sl.nw, t.simNW),
      estGain: Math.round(gain),
      risky: mg === 0,
    });
    t.hits++;   // keeps chain/shrink status accurate after manual edits
    if (mg) { sl.gensLeft -= mg; sl.offLeft -= _wpTroopsFor(t.def, mg); }
    if (gain > 0) {
      const nwPerAcre = t.simLand > 0 ? t.simNW / t.simLand : 0;
      t.simLand = Math.max(0, t.simLand - gain);
      t.simNW   = Math.max(0, t.simNW - gain * nwPerAcre);
    }
  }

  // Same spare-gen distribution + ambush hold as generateWaveSeq, per slot
  const ambushHolds = [];
  const bySlotHits = {};
  out.forEach(h => { (bySlotHits[h.slotKey] = bySlotHits[h.slotKey] || []).push(h); });
  for (const [key, hits] of Object.entries(bySlotHits)) {
    const sl = bySlotKey[key];
    if (!sl) continue;
    const fin = _wpFinalizeSlotHits(sl, hits.filter(h => !h.risky), Math.max(0, sl.gensLeft));
    if (fin.heldGen) ambushHolds.push({
      attacker: sl.attacker, provSlot: sl.provSlot, slotKey: key, leftover: Math.round(fin.leftover),
    });
  }
  return { seq: out, ambushHolds,
           chainStatus:  _wpChainStatus(targets),
           shrinkStatus: _wpShrinkStatus(targets) };
}

// ── Discord hitlist ──────────────────────────────────────────────────────────
/** Post the full wave sequence to the configured Discord webhook. */
async function postWaveSeqToDiscord(seq) {
  if (!S.discordWebhook || !seq?.length) return false;
  const fmtT = s => s <= 0 ? 'now' : fA(s);
  const lines = seq.map(h =>
    `**#${h.n}** ${pnum(h.provSlot, h.attacker)} → **${pnum(h.targetSlot, h.target)}** · ${h.type} · ${h.gens} gen${h.gens > 1 ? 's' : ''}` +
    ` · ${fK(h.sentOff)} off · ${fmtT(h.availableAt)}` +
    (h.estGain ? ` · ~${fK(h.estGain)} ac` : '') +
    (h.shrink ? ' · ⇩ shrink' : '') +
    (h.marginal ? ' · ⚠ marginal' : '') + (h.isWall ? ' · wall' : '') +
    (h.dump ? ' · dump' : ''));

  // Discord: max 4096 chars per embed description, 10 embeds per message
  const embeds = [];
  let buf = [];
  for (const line of lines) {
    if (buf.join('\n').length + line.length > 3800) { embeds.push(buf); buf = []; }
    buf.push(line);
  }
  if (buf.length) embeds.push(buf);

  const total = seq.reduce((s, h) => s + (h.estGain || 0), 0);
  const msg = {
    content: '',
    embeds: embeds.slice(0, 10).map((chunk, i) => ({
      title: i === 0 ? `⚔ WAVE PLAN — vs ${S.enemy?.kingdomName || S.eLoc} (${seq.length} hits, ~${fK(total)} acres)` : undefined,
      description: chunk.join('\n'),
      color: 0xE05050,
      footer: i === embeds.length - 1 ? { text: 'Wave Planner · hits in send order · times = army return' } : undefined,
      timestamp: i === embeds.length - 1 ? new Date().toISOString() : undefined,
    })),
  };
  return sendDiscordEmbed(S.discordWebhook, msg);
}
