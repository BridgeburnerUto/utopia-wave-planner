// ── TAB: EOWCF ─────────────────────────────────────────────────────────────
// End-of-war ceasefire training planner, OWN kingdom only (leader ask 2026-10-07).
//
// Leadership sets kingdom-wide targets for the province's army AT EXIT —
// raw thieves/acre, raw wizards/acre, def specs/acre, off specs/acre, rest
// elites — plus the planned exit (ticks from now, 24..96 per the Relations
// page) and the ritual. For every province the planner then works out:
//   - WHEN to train: training must be FINISHED by exit (leader decision), so
//     it is ordered at `exit − training time`, with every gc earned until then.
//   - Gold at that moment: gold now + net income per tick (the Economy tab's
//     own `_provEconomy`, re-run each tick with the changed peasants/units/
//     buildings — no income formula is duplicated here) − draft costs −
//     construction.
//   - Soldiers at that moment: current soldiers + released off specs + draft.
//     The draft follows leadership practice: draft down to a target PPA
//     (peasants per acre, ~6.5) in ONE late burst at Emergency + Patriotism that
//     ends exactly when training is ordered -- the draft stays OFF until then so
//     every peasant earns for as long as possible. The burst start is computed
//     per province from its peasants and draft speed.
//   - The bill: thieves, def/off specs to target (specialist credits first —
//     they are LOST on exit), then the remaining soldiers as elites.
//   - Strategy search per province: how many surplus off specs to release all
//     the way to PEASANTS (they earn gc, but must be redrafted) instead of only
//     to soldiers (stop wages, no redraft), and whether razing banks into
//     armouries `build time` before training pays for itself. Best = most
//     elites, then most gold left. The no-release/no-armoury baseline is kept
//     so the gain is visible.
//   - Advice when gold is short: extra banks built NOW that close the gap.
//   - Wizards: guild production to exit (+ Ascendancy / Mystic / Heretic) vs
//     the WPA target, and the extra guild % that would close it.
//
// Modelling assumptions (all shown in the tab's help text — revisit with data):
//   * Population stays at its current total (EOWCF birth rate is +1000% for
//     24 ticks), so peasants = population − military at every tick. Drafting a
//     peasant therefore costs his income for the rest of the ceasefire.
//   * Released specs become soldiers; released soldiers become peasants; no refund.
//   * Armouries discount ALL training incl. thieves ("Military Training Costs").
//   * Heroism science: its effect % both speeds the draft and cuts its cost.
//   * Spells (Inspire Army, Builders Boon …) are not planned.
//
// The plan for each province is also rendered as Discord-ready text and
// PUBLISHED to Firestore `eowcf/{kdId}` (one write per click). The bot's
// /eowcf command only looks the player's slot up (from the number at the start
// of their server nick) and prints that text — so the maths lives here only.

const EO_DOC = () => `eowcf/${(S.own?.location || '').replace(':', '_')}`;
// Targets are per SETUP (leader 2026-10-07: an Orc General and a Faery Rogue get
// different numbers). Leadership fills the setups in once; every province picks
// the most specific match (race+personality > race > personality > Everyone),
// or the setup leadership assigned it by hand (cfg.assign[slot]).
const EO_SETUP_DEFAULT = () => ({ id: 'all', name: 'Everyone', race: '', pers: '',
                                  tpa: 4, wpa: 2.5, dpa: 5, opa: 0, ppa: EOWCF.PPA_DEFAULT });
const EO_CFG_DEFAULT = () => ({ ticks: 96, exitAt: 0, ritual: 'none',
                                draftRate: EOWCF.DRAFT_RATE_DEFAULT, patriotism: true,
                                setups: [EO_SETUP_DEFAULT()], assign: {} });
/** The live config (created on first use — state.js loads before config tables are usable here) */
function _eoC() { return S.eo.cfg || (S.eo.cfg = EO_CFG_DEFAULT()); }

/** Setup for a province: manual assignment, else the most specific race/personality match */
function _eoSetupFor(prov, cfg) {
  const setups = cfg.setups?.length ? cfg.setups : [EO_SETUP_DEFAULT()];
  const manual = cfg.assign?.[prov.slot];
  if (manual) { const s = setups.find(x => x.id === manual); if (s) return { setup: s, how: 'manual' }; }
  const race = (prov.race || '').toLowerCase();
  const pers = (prov.sot?.personality || prov.personality || '').toLowerCase();
  let best = null, bestScore = -1;
  for (const s of setups) {
    if (s.race && s.race !== race) continue;
    if (s.pers && s.pers !== pers) continue;
    const score = (s.race ? 2 : 0) + (s.pers ? 1 : 0);
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return best ? { setup: best, how: 'auto' } : { setup: setups[0], how: 'fallback' };
}

// ── Model ────────────────────────────────────────────────────────────────────

/** x·(1−x) building curve (Growth page): rate × BE × min(50,p) × (1 − min(50,p)/100) */
function _eoCurve(rate, pct, be) {
  const p = Math.max(0, Math.min(50, pct || 0));
  return rate * p * (1 - p / 100) * (be == null ? 1 : be);
}

function _eoBook(prov, type) {
  return prov.sos?.books?.find(b => b.type === type)?.effect || 0;
}

/** Province with some numbers replaced — fed to _provEconomy. Shallow copies only. */
function _eoWith(prov, o) {
  const sot = { ...prov.sot, peasants: o.peasants, soldiers: o.soldiers, oSpecs: o.oSpecs };
  const bArr = prov.survey?.buildings;
  if (!bArr || !bArr.length) return { ...prov, sot };
  const buildings = bArr.map(b => {
    const n = b.name.toLowerCase();
    if (n === 'banks')     return { ...b, pctTot: o.banks };
    if (n === 'armouries') return { ...b, pctTot: o.arm };
    return b;
  });
  return { ...prov, sot, survey: { ...prov.survey, buildings } };
}

/**
 * Plan one province. `cfg` = {ticks, ritual, tpa, wpa, dpa, opa};
 * `ctx` = the Economy tab's kingdom context. Returns null when the province has
 * no SoT to plan from.
 */
function eoPlanProvince(prov, cfg, ctx, loc) {
  const sot = prov.sot;
  const land = prov.land || sot?.land || 0;
  if (!sot || !(land > 0) || sot.peasants == null) return null;

  const race = (prov.race || '').toLowerCase();
  const pers = (sot.personality || prov.personality || '').toLowerCase();
  const rit  = EOWCF_RITUALS[cfg.ritual] || EOWCF_RITUALS.none;
  const N    = Math.max(0, Math.round(cfg.ticks));
  const warn = [];

  const bArr = prov.survey?.buildings;
  const noSurvey = !(bArr && bArr.length);
  if (noSurvey) warn.push('no survey — buildings taken as 0');
  const pct = name => noSurvey ? 0 : (bArr.find(b => b.name.toLowerCase() === name)?.pctTot || 0);
  const be  = Math.max(sot.be || 100, 100) / 100 * (rit.beMult || 1);   // EOWCF resets BE to ≥100%

  // Units: home + away (armies come home at war end) + in training
  const tr  = prov.som?.training || {};
  if (!prov.som) warn.push('no SoM — units in training not counted');
  const have = {
    sol: sot.soldiers || 0,
    osp: (sot.oSpecs || 0) + (tr.oSpecs || 0),
    dsp: (sot.dSpecs || 0) + (tr.dSpecs || 0),
    eli: (sot.elites || 0) + (tr.elites || 0),
    thv: (sot.thieves || 0) + (tr.thieves || 0),
    wiz: sot.wizards || 0,
  };
  const target = {
    thv: Math.ceil(cfg.tpa * land), wiz: Math.ceil(cfg.wpa * land),
    dsp: Math.ceil(cfg.dpa * land), osp: Math.ceil(cfg.opa * land),
  };
  const need = {
    thv: Math.max(0, target.thv - have.thv),
    dsp: Math.max(0, target.dsp - have.dsp),
    osp: Math.max(0, target.osp - have.osp),
  };
  // Only off specs that are actually trained (not mid-training) can be released
  const surplusO = Math.max(0, Math.min(sot.oSpecs || 0, have.osp - target.osp));

  // Timing
  const valor  = _eoBook(prov, 'Valor');
  const tgCut  = Math.min(_eoCurve(EOWCF.TG_TIME_RATE, pct('training grounds'), be), 25);
  const trainTicks = Math.ceil(EOWCF.TRAIN_TICKS * (RACE_TRAIN_TIME_MULT[race] || 1) * (PERS_TRAIN_TIME_MULT[pers] || 1)
                     * (1 - valor / 100) * (1 - tgCut / 100));
  const buildTicks = Math.ceil(EOWCF.BUILD_TICKS * (RACE_BUILD_TIME_MULT[race] || 1));
  const trainAt = N - trainTicks;
  if (trainAt < 0) warn.push(`training takes ${trainTicks} ticks — it can no longer finish before exit`);
  const T = Math.max(0, trainAt);   // ticks of income/draft before training is ordered

  // Draft: rate set by leadership (default Emergency); blank = the province's own
  // setting (the Military Advisor block is a zeroed placeholder when unknown).
  const ma = prov.ma || {};
  const rateKey = cfg.draftRate || String(ma.draftRate || '').toLowerCase();
  const rate = EOWCF.DRAFT_RATES[rateKey] || EOWCF.DRAFT_RATES[EOWCF.DRAFT_RATE_DEFAULT];
  if (!EOWCF.DRAFT_RATES[rateKey]) warn.push(`draft rate unknown — ${EOWCF.DRAFT_RATE_DEFAULT} assumed`);
  const ppa = cfg.ppa > 0 ? cfg.ppa : EOWCF.PPA_DEFAULT;
  const heroism = _eoBook(prov, 'Heroism');
  // Military page: peasants × rate × race × pers × Patriotism × Heroism
  const draftSpeed = (rate.pct / 100) * (RACE_DRAFT_SPEED_MULT[race] || 1) * (PERS_DRAFT_SPEED_MULT[pers] || 1)
                   * (cfg.patriotism ? EOWCF.PATRIOTISM_DRAFT_MULT : 1) * (1 + heroism / 100);
  const draftGc = rate.gc * (RACE_DRAFT_COST_MULT[race] || 1) * (1 - heroism / 100) * (rit.draftCostMult || 1);
  const specCredits = ma.credits > 0 ? ma.credits : 0;
  const buildCredits = prov.survey?.credits || 0;

  // Construction (build + raze) per acre
  const bMult = (RACE_BUILD_COST_MULT[race] || 1) * (PERS_BUILD_COST_MULT[pers] || 1) * (rit.buildCostMult || 1);
  const acreCost = (EOWCF.BUILD_COST_K * (land + EOWCF.BUILD_COST_LAND)
                  + EOWCF.RAZE_COST_BASE + EOWCF.RAZE_COST_K * land) * bMult;

  const ectx = { ...ctx, wdWageCut: 0, beMin: 100, beMult: rit.beMult || 1, wageMult: rit.wageMult || 1 };
  const banks0 = pct('banks'), arm0 = pct('armouries');
  const pop = sot.peasants + have.sol + have.osp + have.dsp + have.eli + have.thv + have.wiz;

  // Ticks a burst needs to bring `pe` peasants down to `floor` (Infinity if it never can)
  const burstTicks = (pe, floor) => {
    if (pe <= floor) return 0;
    if (!(draftSpeed > 0)) return Infinity;
    let k = 0;
    while (pe > floor && k < 1000) { pe -= Math.max(1, Math.min(Math.floor(pe * draftSpeed), pe - floor)); k++; }
    return k;
  };

  // ── Tick simulation ──
  // `floorPpa` = the PPA to draft down to. The burst starts as LATE as possible
  // so it reaches that floor exactly at the training tick T (or now, if it can't).
  const start = (toPeasants, floorPpa = ppa) => {
    const pe = sot.peasants + toPeasants;
    const floor = Math.round(floorPpa * land);
    const k = burstTicks(pe, floor);
    return {
      t: 0, gold: sot.money || 0, minGold: sot.money || 0, credits: buildCredits,
      pe, sol: have.sol + (surplusO - toPeasants), oHome: (sot.oSpecs || 0) - surplusO,
      banks: banks0, arm: arm0, bankAdd: 0, drafted: 0, draftCost: 0, buildCost: 0,
      floor, burst: k, drStart: Math.max(0, T - k),
    };
  };
  const build = (st, acres) => {   // pays construction, building credits first
    const free = Math.min(st.credits, acres);
    st.credits -= free;
    const c = (acres - free) * acreCost;
    st.gold -= c; st.buildCost += c;
  };
  const step = (st, upto) => {
    for (; st.t < upto; st.t++) {
      const banksNow = st.banks + (st.t >= buildTicks ? st.bankAdd : 0);
      const e = _provEconomy(_eoWith(prov, { peasants: st.pe, soldiers: st.sol, oSpecs: st.oHome,
                                             banks: banksNow, arm: st.arm }), loc, ectx);
      st.gold += e ? e.net : 0;
      if (st.t >= st.drStart && st.pe > st.floor) {
        const d = Math.min(Math.floor(st.pe * draftSpeed), st.pe - st.floor);
        if (d > 0) {
          const x = (st.sol + st.oHome + have.dsp + have.eli) / pop;
          const dlf = Math.max(EOWCF.DLF[0] * x * x + EOWCF.DLF[1] * x + EOWCF.DLF[2], 1);
          const armDraftCut = _eoCurve(EOWCF.ARM_DRAFT_RATE, st.arm, be);
          const c = d * draftGc * dlf * (1 - armDraftCut / 100);
          st.gold -= c; st.draftCost += c; st.pe -= d; st.sol += d; st.drafted += d;
        }
      }
      st.minGold = Math.min(st.minGold, st.gold);
    }
    return st;
  };
  const swapToArmouries = (st, x) => {   // raze banks first, then other buildings
    st.banks = Math.max(0, st.banks - x);
    st.arm += x;
    build(st, Math.round(land * x / 100));
  };

  // Training bill at trainAt for a finished state
  const raceTC = (RACE_TRAIN_COST_MULT[race] || 1) * (PERS_TRAIN_COST_MULT[pers] || 1);
  // Every race/personality number comes from the config.js tables (UPDATE EVERY
  // AGE) — nothing is hard-coded here. A race missing from RACE_ELITE_COST is
  // flagged rather than guessed: its elites are priced at 0 and the plan says so.
  const eliteBase = RACE_ELITE_COST[race];
  if (eliteBase == null) warn.push(`no elite price for race "${race}" in config.js RACE_ELITE_COST — elites not costed`);
  const elitePerCredits = PERS_ELITE_PER_CREDITS[pers] || 0;
  const train = st => {
    const unitMult = raceTC * (1 - _eoCurve(EOWCF.ARM_TRAIN_RATE, st.arm, be) / 100);
    // Order: def specs, off specs, thieves (credits cover specs first), then elites —
    // every step limited by soldiers left AND gold left.
    let sol = st.sol, gold = Math.max(0, st.gold), credits = specCredits, freeSpecs = 0;
    const take = (want, unitGc, useCredits) => {
      let n = Math.min(want, sol);
      let free = useCredits ? Math.min(credits, n) : 0;
      const paid = unitGc > 0 ? Math.min(n - free, Math.floor(gold / unitGc)) : n - free;
      n = free + paid;
      credits -= free; freeSpecs += useCredits ? free : 0; sol -= n; gold -= paid * unitGc;
      return n;
    };
    const dsp = take(need.dsp, EOWCF.SPEC_COST * unitMult, true);
    const osp = take(need.osp, EOWCF.SPEC_COST * unitMult, true);
    const thv = take(need.thv, EOWCF.THIEF_COST * unitMult, false);
    const freeEli = elitePerCredits ? Math.min(sol, Math.floor(credits / elitePerCredits)) : 0;
    const fixed = Math.max(0, st.gold) - gold;
    const eliteUnit = (eliteBase || 0) * unitMult;
    const paidRoom = sol - freeEli;
    const afford = eliteUnit > 0 ? Math.floor(gold / eliteUnit) : paidRoom;
    const paidEli = Math.min(paidRoom, afford);
    const bill = fixed + paidEli * eliteUnit;
    const fixedMissing = need.thv + need.dsp + need.osp - (thv + dsp + osp);
    const fixedNoSol = Math.max(0, need.thv + need.dsp + need.osp - st.sol);   // missing for lack of soldiers
    return {
      thv, dsp, osp, eli: freeEli + paidEli, freeSpecs, freeEli,
      untrained: sol - freeEli - paidEli,                  // soldiers left because gold ran out
      fixedShort: fixedMissing > 0, fixedMissing, fixedNoSol,
      bill: Math.round(bill), left: Math.round(st.gold - bill), unitMult, eliteUnit,
    };
  };
  // Ranking: thief/spec targets met first, then most elites. On equal units the
  // SIMPLER plan wins (no armoury swap, no release to peasants) — a swap that only
  // leaves more spare gold is not worth asking a player for. Then most gold left.
  const fixedN = c => c.tr.thv + c.tr.dsp + c.tr.osp;
  const moves  = c => (c.arm > 0 ? 1 : 0) + (c.toP > 0 ? 1 : 0);
  const better = (a, b) => {
    if (!b) return true;
    if (fixedN(a) !== fixedN(b)) return fixedN(a) > fixedN(b);
    if (a.tr.eli !== b.tr.eli) return a.tr.eli > b.tr.eli;
    if (moves(a) !== moves(b)) return moves(a) < moves(b);
    return a.tr.left > b.tr.left;
  };
  const goldLimited = t => t.untrained + (t.fixedMissing - t.fixedNoSol) > 0;

  // ── Strategy search ──
  const swapAt = T - buildTicks;            // armouries must be finished when training is ordered
  const fracs = surplusO > 0 ? [0, 0.25, 0.5, 0.75, 1] : [0];
  const armOpts = swapAt >= 0 ? [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50] : [0];
  let best = null, baseline = null;
  for (const f of fracs) {
    const toP = Math.round(surplusO * f);
    const head = step(start(toP), Math.max(0, swapAt));   // shared prefix up to the swap tick
    for (const x of armOpts) {
      const st = { ...head };
      if (x > 0) swapToArmouries(st, x);
      step(st, T);
      const cand = { toP, arm: x, st, tr: train(st) };
      if (f === 0 && x === 0) baseline = cand;
      if (better(cand, best)) best = cand;
    }
  }
  // Refine the armoury % around the coarse winner (±4 in steps of 1)
  if (best.arm > 0) {
    const head = step(start(best.toP), swapAt);
    for (let x = Math.max(1, best.arm - 4); x <= Math.min(50, best.arm + 4); x++) {
      if (x === best.arm) continue;
      const st = { ...head }; swapToArmouries(st, x); step(st, T);
      const cand = { toP: best.toP, arm: x, st, tr: train(st) };
      if (better(cand, best)) best = cand;
    }
  }

  // ── Extra banks built NOW, when gold (not soldiers) is what limits elites ──
  let banksAdd = null;
  if (goldLimited(best.tr) && T > buildTicks) {
    const tryBanks = b => {
      const st = start(best.toP); st.bankAdd = b; build(st, Math.round(land * b / 100));
      step(st, Math.max(0, swapAt));
      if (best.arm > 0) swapToArmouries(st, best.arm);
      step(st, T);
      return { st, tr: train(st) };
    };
    const maxB = Math.max(0, 50 - banks0);
    for (let b = 1; b <= maxB; b++) {
      const r = tryBanks(b);
      const units = x => fixedN(x) + x.tr.eli;
      if (!goldLimited(r.tr)) { banksAdd = { pct: b, cost: Math.round(r.st.buildCost - best.st.buildCost), left: r.tr.left }; break; }
      if (b === maxB) banksAdd = { pct: b, cost: Math.round(r.st.buildCost - best.st.buildCost), left: r.tr.left,
                                   partial: r.tr.untrained + (r.tr.fixedMissing - r.tr.fixedNoSol),
                                   gain: units(r) - units(best) };
    }
    if (banksAdd && banksAdd.partial != null && banksAdd.gain <= 0) banksAdd = null;   // banks would not help
  }

  // ── Wizards from guilds ──
  const wizMult  = (PERS_GUILD_MULT[pers] || 1) * (rit.wizMult || 1);
  const guildPct = pct('guilds');
  const wizProj  = Math.round(have.wiz + EOWCF.GUILD_WIZ_PER_TICK * land * guildPct / 100 * wizMult * N);
  const wizGap   = Math.max(0, target.wiz - wizProj);
  const newGuildTicks = N - buildTicks;
  const extraGuildPct = wizGap > 0
    ? (newGuildTicks > 0 ? wizGap / (EOWCF.GUILD_WIZ_PER_TICK * wizMult * newGuildTicks) / land * 100 : Infinity)
    : 0;

  const bt = best.tr;
  if (best.st.pe > best.st.floor)
    warn.push(`the draft cannot reach ${ppa} PPA by training — drafting from now still ends at ${(best.st.pe / land).toFixed(1)} PPA`);
  // Soldiers are the limit when targets lack soldiers, or gold is left over that
  // could pay for more elites. Advise the lower PPA that would supply them,
  // bounded by what a burst from NOW can physically deliver (a run to PPA 0).
  // Approximate: drafting deeper also costs gc and income, which this one-step
  // estimate ignores — hence "≈".
  let draftAdvice = null;
  if (!goldLimited(bt) && eliteBase && (bt.fixedNoSol > 0 || bt.left > bt.eliteUnit * 100)) {
    const spareEli = Math.max(0, Math.floor((bt.left - bt.fixedNoSol * EOWCF.SPEC_COST * bt.unitMult) / bt.eliteUnit));
    const wanted = bt.fixedNoSol + spareEli;
    const cap = step(start(best.toP, 0), T);
    const canGet = Math.max(0, cap.sol - best.st.sol);
    const extra = Math.min(wanted, canGet);
    if (extra > 0) draftAdvice = {
      extra, wanted, speedLimited: canGet < wanted, spareEli,
      ppa: Math.max(0, Math.floor((best.st.pe - extra) / land * 10) / 10),
    };
  }
  const net0 = _provEconomy(prov, loc, ectx)?.net;
  if (net0 != null && net0 < 0) warn.push('income is negative right now — wages exceed income');
  return {
    slot: prov.slot, name: prov.name, race, pers, land, N, trainAt, trainTicks, buildTicks, swapAt,
    have, target, need, surplusO, specCredits, buildCredits,
    draft: { rate: rateKey || EOWCF.DRAFT_RATE_DEFAULT, patriotism: !!cfg.patriotism, ppa,
             startAt: best.st.drStart, ticks: Math.min(best.st.burst, T), drafted: best.st.drafted,
             cost: Math.round(best.st.draftCost), ppaAtTrain: best.st.pe / land, advice: draftAdvice },
    release: { toPeasants: best.toP, toSoldiers: surplusO - best.toP },
    arm: { pct: best.arm, from: arm0, cost: best.arm ? Math.round(best.st.buildCost) : 0 },
    gold: { now: sot.money || 0, atTrain: Math.round(best.st.gold), min: Math.round(best.st.minGold) },
    soldiersAtTrain: best.st.sol,
    train: bt,
    baseline: { eli: baseline.tr.eli, left: baseline.tr.left },
    banksAdd,
    wiz: { have: have.wiz, proj: wizProj, target: target.wiz, gap: wizGap, extraGuildPct, guildPct, mult: wizMult },
    after: {
      thv: have.thv + bt.thv, dsp: have.dsp + bt.dsp, osp: have.osp - surplusO + bt.osp,
      eli: have.eli + bt.eli, wiz: wizProj,
    },
    warn,
  };
}

/** Plan every own province with the current config, each with its setup's targets */
function eoPlanAll(cfg) {
  const provs = S.own?.provinces || [];
  const ctx = _econKdCtx(provs, S.own, true);
  return provs.map(p => {
    const { setup, how } = _eoSetupFor(p, cfg);
    const pc = { ...cfg, tpa: setup.tpa, wpa: setup.wpa, dpa: setup.dpa, opa: setup.opa, ppa: setup.ppa };
    try {
      const r = eoPlanProvince(p, pc, ctx, S.own?.location);
      if (r) r.setup = { id: setup.id, name: setup.name, how };
      return r;
    } catch (e) { console.error('[WavePlanner] EOWCF plan failed for', p.name, e); return null; }
  }).filter(Boolean);
}

// ── Config / persistence ─────────────────────────────────────────────────────

/** Ticks left to the planned exit — the config stores an absolute time so it counts down */
function _eoTicksLeft(cfg) {
  if (!cfg.exitAt) return cfg.ticks;
  return Math.max(0, Math.min(EOWCF.MAX_TICKS, Math.ceil((cfg.exitAt - Date.now()) / 3600e3)));
}
function _eoCfgNow() {
  const c = _eoC();
  return { ...c, ticks: _eoTicksLeft(c) };
}

/** One read per session (FB_QUOTA rule 1): the published config, if any */
async function _eoLoad(force) {
  if (S.eo.loaded && !force) return;
  S.eo.loadErr = '';
  const doc = await fbGet(EO_DOC());
  S.eo.loaded = true;
  if (!doc) { S.eo.loadErr = ''; return; }   // no doc yet = nothing published (fbGet can't tell 404 from failure)
  const f = Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, _fromFB(v)]));
  try {
    const saved = JSON.parse(f.cfgJson || '{}');
    const c = { ...EO_CFG_DEFAULT(), ...saved };
    if (!saved.setups?.length && saved.tpa != null)   // config from before setups existed
      c.setups = [{ ...EO_SETUP_DEFAULT(), tpa: saved.tpa, wpa: saved.wpa, dpa: saved.dpa, opa: saved.opa ?? 0 }];
    S.eo.cfg = c;
  } catch (e) { /* keep defaults */ }
  S.eo.publishedAt = f.updatedAt || 0;
  S.eo.publishedBy = f.by || '';
}

/**
 * Plan text for one province. `discord` = the published version the bot prints:
 * moments are Discord timestamps (<t:unix:R>), which every player's client shows
 * live ("in 3 hours", their own time zone) — so the text does not go stale between
 * publishing and the player asking. The planner view shows tick counts instead.
 */
function _eoPlanText(p, discord) {
  const n = v => Math.round(v).toLocaleString('en-US');
  const at = ticks => {
    const lbl = S.currentTickName ? _ritualExpiry(S.currentTickName, Math.max(1, ticks))?.label : '';
    if (ticks <= 0) return 'NOW';
    if (discord) {
      // Ticks land on the hour: the Nth tick from now is N−1 hours after the next full hour
      const unix = Math.floor((Math.ceil(Date.now() / 3600e3) + ticks - 1) * 3600);
      return `<t:${unix}:R>${lbl ? ' (' + lbl + ')' : ''}`;
    }
    return `in ${ticks} tick${ticks === 1 ? '' : 's'}${lbl ? ' (' + lbl + ')' : ''}`;
  };
  const L = [];
  L.push(`**${p.name}** (slot ${p.slot}) — ${p.land.toLocaleString('en-US')} acres, ${p.race}${p.pers ? ' ' + p.pers : ''}`
    + (p.setup ? ` · setup **${p.setup.name}**` : ''));
  L.push(`Exit ${at(p.N)}. Training takes ${p.trainTicks} ticks → **order training ${at(p.trainAt)}**.`);
  const steps = [];   // [tick, text] — listed in time order
  if (p.release.toPeasants || p.release.toSoldiers) {
    const parts = [];
    if (p.release.toSoldiers) parts.push(`${n(p.release.toSoldiers)} → soldiers`);
    if (p.release.toPeasants) parts.push(`${n(p.release.toPeasants)} → all the way to peasants`);
    steps.push([0, `Release ${n(p.surplusO)} off specs NOW: ${parts.join(', ')}.`]);
  }
  const d = p.draft;
  if (d.drafted > 0) {
    const rateName = d.rate.charAt(0).toUpperCase() + d.rate.slice(1);
    steps.push([d.startAt, `Start drafting ${at(d.startAt)}: **${rateName}**${d.patriotism ? ' + **Patriotism**' : ''}`
      + ` for ${d.ticks} ticks, down to ${d.ppa} PPA (≈${n(d.drafted)} soldiers, ≈${n(d.cost)} gc).`
      + (d.startAt > 0 ? ' Keep the draft OFF until then.' : '')
      + (d.patriotism && d.ticks > EOWCF.PATRIOTISM_TICKS ? ` Recast Patriotism — it lasts ${EOWCF.PATRIOTISM_TICKS} ticks.` : '')]);
  }
  if (p.arm.pct > 0) steps.push([p.swapAt, `Swap ${p.arm.pct}% to **armouries** ${at(p.swapAt)} (banks first; ≈${n(p.arm.cost)} gc).`]);
  const t = p.train;
  const tr = [];
  if (t.thv) tr.push(`${n(t.thv)} thieves`);
  if (t.dsp) tr.push(`${n(t.dsp)} def specs`);
  if (t.osp) tr.push(`${n(t.osp)} off specs`);
  if (t.eli) tr.push(`**${n(t.eli)} elites**`);
  steps.push([Math.max(0, p.trainAt) + 0.5, `Train ${at(p.trainAt)}: ${tr.length ? tr.join(', ') : (t.fixedNoSol > 0 ? 'nothing — no soldiers left to train' : 'nothing needed')}`
    + (t.freeSpecs ? ` (${n(t.freeSpecs)} specs on credits)` : '')
    + (t.freeEli ? ` (${n(t.freeEli)} elites on credits)` : '') + '.']);
  steps.sort((a, b) => a[0] - b[0]).forEach(([, s], i) => L.push(`${i + 1}. ${s}`));
  L.push(`Gold: ${n(p.gold.now)} now → ≈${n(p.gold.atTrain)} at training; bill ≈${n(t.bill)}, ${t.left >= 0 ? n(t.left) + ' left' : 'gold runs out'}.`);
  if (t.untrained > 0) L.push(`⚠ ${n(t.untrained)} soldiers stay untrained — not enough gold.`);
  if (t.fixedNoSol > 0) L.push(`⚠ ${n(t.fixedNoSol)} soldiers short of the thief/spec targets even after drafting down to ${d.ppa} PPA.`);
  else if (t.fixedShort) L.push(`⚠ Not enough gold for the thief/spec targets (${n(t.fixedMissing)} units short).`);
  const tpa = p.after.thv / p.land, wpa = p.after.wiz / p.land, dpa = p.after.dsp / p.land;
  L.push(`At exit: TPA ${tpa.toFixed(2)} · WPA ${wpa.toFixed(2)} · ${dpa.toFixed(2)} dspecs/acre · ${n(p.after.eli)} elites`);
  if (p.train.eli > p.baseline.eli) L.push(`-# This plan trains ${n(p.train.eli - p.baseline.eli)} more elites than no release / no armouries.`);

  // What-ifs — NOT included in the numbers above, so the plan is exactly what it says
  const more = [];
  const da = p.draft.advice;
  if (da) more.push(`Draft deeper, to ≈**${da.ppa} PPA**, for ≈${n(da.extra)} more soldiers`
    + (da.speedLimited ? ` (the most the draft can deliver in time; ${n(da.wanted)} wanted)` : '')
    + (da.spareEli ? ` — spare gold pays for ≈${n(da.spareEli)} more elites.` : '.'));
  if (p.banksAdd) more.push(p.banksAdd.partial != null
    ? `Build +${p.banksAdd.pct}% banks NOW (≈${n(p.banksAdd.cost)} gc): helps, but still ${n(p.banksAdd.partial)} units short of gold.`
    : `Build +${p.banksAdd.pct}% banks NOW (≈${n(p.banksAdd.cost)} gc) to afford every soldier above.`);
  if (p.wiz.gap > 0) more.push(isFinite(p.wiz.extraGuildPct)
    ? `Wizards: ${n(p.wiz.proj)} of ${n(p.wiz.target)} by exit — +${p.wiz.extraGuildPct.toFixed(1)}% guilds NOW to reach the target.`
    : `Wizards: ${n(p.wiz.proj)} of ${n(p.wiz.target)} by exit — too late for new guilds to close it.`);
  if (more.length) { L.push('**To do better:**'); more.forEach(m => L.push('• ' + m)); }
  if (p.warn.length) L.push(`-# ${p.warn.join('; ')}`);
  return L.join('\n');
}

async function eoPublish() {
  const cfg = _eoCfgNow();
  const plans = eoPlanAll(cfg);
  if (!plans.length) { S.eo.msg = 'Nothing to publish — no own provinces loaded.'; renderEowcf(); return; }
  S.eo.publishing = true; renderEowcf();
  const provinces = {};
  plans.forEach(p => { provinces[p.slot] = { name: p.name, text: _eoPlanText(p, true) }; });
  const now = Date.now();
  const saveCfg = { ..._eoC(), exitAt: _eoC().exitAt || now + cfg.ticks * 3600e3 };
  const res = await fbWrite(EO_DOC(), {
    cfgJson: JSON.stringify(saveCfg),
    planJson: JSON.stringify({ kd: S.own?.location, kdName: S.own?.kingdomName || '', updatedAt: now,
                               exitAt: saveCfg.exitAt, ritual: cfg.ritual, provinces }),
    updatedAt: now,
    by: S.role || '',
  });
  S.eo.publishing = false;
  if (res && !res.error) {
    S.eo.cfg = saveCfg; S.eo.publishedAt = now;
    S.eo.msg = `Published ${plans.length} province plans — players can now use /eowcf in Discord.`;
  } else {
    S.eo.msg = '⚠ Publish failed: ' + (res?.error?.message || 'network error') + '. Nothing was changed.';
  }
  renderEowcf();
}

/** Inputs: write straight into S.eo.cfg and re-plan */
function eoSet(key, val) {
  const c = _eoC();
  if (key === 'ticks') {
    const t = Math.max(1, Math.min(EOWCF.MAX_TICKS, parseInt(val, 10) || 0));
    c.ticks = t; c.exitAt = Date.now() + t * 3600e3;
  } else if (key === 'ritual') {
    c.ritual = EOWCF_RITUALS[val] ? val : 'none';
  } else if (key === 'draftRate') {
    c.draftRate = EOWCF.DRAFT_RATES[val] ? val : '';
  } else if (key === 'patriotism') {
    c.patriotism = !!val;
  } else {
    const v = parseFloat(String(val).replace(',', '.'));
    c[key] = isFinite(v) && v >= 0 ? v : 0;
  }
  S.eo.msg = '';
  renderEowcf();
}
/** Setup table edits. Numbers are per acre (PPA = peasants per acre). */
function eoSetupSet(i, key, val) {
  const s = _eoC().setups[i];
  if (!s) return;
  if (key === 'name') s.name = String(val).trim().slice(0, 40) || 'Setup';
  else if (key === 'race' || key === 'pers') s[key] = String(val || '').toLowerCase();
  else { const v = parseFloat(String(val).replace(',', '.')); s[key] = isFinite(v) && v >= 0 ? v : 0; }
  S.eo.msg = ''; renderEowcf();
}
function eoSetupAdd() {
  const c = _eoC();
  const base = c.setups[0] || EO_SETUP_DEFAULT();
  c.setups.push({ ...base, id: 's' + Date.now().toString(36), name: 'New setup', race: '', pers: '' });
  S.eo.msg = ''; renderEowcf();
}
function eoSetupDel(i) {
  const c = _eoC();
  if (i === 0 || !c.setups[i]) return;          // "Everyone" is the catch-all and stays
  const id = c.setups[i].id;
  c.setups.splice(i, 1);
  for (const k of Object.keys(c.assign || {})) if (c.assign[k] === id) delete c.assign[k];
  S.eo.msg = ''; renderEowcf();
}
function eoAssign(slot, id) {
  const c = _eoC();
  c.assign = c.assign || {};
  if (id) c.assign[slot] = id; else delete c.assign[slot];
  S.eo.msg = ''; renderEowcf();
}
function eoSel(slot) { S.eo.sel = S.eo.sel === slot ? null : slot; renderEowcf(); }
function eoRefresh() { S.eo.loaded = false; renderEowcf({ force: true }); }

// ── Render ──────────────────────────────────────────────────────────────────

function _eoMdToHtml(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b style="color:#fff">$1</b>')
    .replace(/^-# (.*)$/gm, '<span style="color:#7a9090;font-size:15px">$1</span>')
    .replace(/\n/g, '<br>');
}

async function renderEowcf(opts = {}) {
  const el = $id('__wpc_eowcf');
  if (!el) return;
  if (!S.own?.provinces?.length) {
    renderTab('__wpc_eowcf', () => `<div style="color:#7a9090;font-size:19px;padding:20px 0;font-style:italic">No own kingdom loaded.</div>`);
    return;
  }
  if (!S.eo.loaded) {
    renderTab('__wpc_eowcf', () => loadingHTML('LOADING EOWCF PLAN...'));
    await _eoLoad(opts.force);
    if (S.tab !== 'eowcf') return;
  }
  const cfg = _eoCfgNow();
  const plans = eoPlanAll(cfg);

  renderTab('__wpc_eowcf', () => {
    const c = _eoC();
    const inp = (key, label, val, w, title) => `<label style="display:flex;flex-direction:column;gap:2px;font-size:14px;color:#7a9090;font-weight:700;letter-spacing:1px;text-transform:uppercase" title="${esc(title || '')}">
        ${label}<input type="number" step="any" min="0" value="${esc(String(val))}" style="width:${w}px;font-size:18px;padding:3px 6px;background:#2b3333;color:#fff;border:1px solid #617070;border-radius:3px"
          onchange="__wpA.eoSet('${key}', this.value)"></label>`;
    const exitLbl = S.currentTickName ? _ritualExpiry(S.currentTickName, cfg.ticks)?.label : '';
    const controls = `<div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:14px;margin-bottom:10px">
        ${inp('ticks', 'Exit in (ticks)', cfg.ticks, 90, `EOWCF lasts ${EOWCF.MIN_TICKS}–${EOWCF.MAX_TICKS} ticks. Counts down by itself once set.`)}
        <label style="display:flex;flex-direction:column;gap:2px;font-size:14px;color:#7a9090;font-weight:700;letter-spacing:1px;text-transform:uppercase">Ritual
          <select style="font-size:18px;padding:3px 6px;background:#2b3333;color:#fff;border:1px solid #617070;border-radius:3px" onchange="__wpA.eoSet('ritual', this.value)">
            ${Object.entries(EOWCF_RITUALS).map(([k, r]) => `<option value="${k}"${k === c.ritual ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}
          </select></label>
        <label style="display:flex;flex-direction:column;gap:2px;font-size:14px;color:#7a9090;font-weight:700;letter-spacing:1px;text-transform:uppercase" title="Draft rate for the burst (leadership practice: Emergency). 'Own' = each province's current setting">Draft rate
          <select style="font-size:18px;padding:3px 6px;background:#2b3333;color:#fff;border:1px solid #617070;border-radius:3px" onchange="__wpA.eoSet('draftRate', this.value)">
            <option value=""${!c.draftRate ? ' selected' : ''}>Own</option>
            ${Object.keys(EOWCF.DRAFT_RATES).map(k => `<option value="${k}"${k === c.draftRate ? ' selected' : ''}>${k.charAt(0).toUpperCase() + k.slice(1)}</option>`).join('')}
          </select></label>
        <label style="display:flex;align-items:center;gap:6px;font-size:14px;color:#7a9090;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding-bottom:6px" title="Patriotism: +${Math.round((EOWCF.PATRIOTISM_DRAFT_MULT - 1) * 100)}% draft speed, lasts ${EOWCF.PATRIOTISM_TICKS} ticks">
          <input type="checkbox" ${c.patriotism ? 'checked' : ''} onchange="__wpA.eoSet('patriotism', this.checked)"> Patriotism</label>
        <span style="font-size:15px;color:#7a9090;padding-bottom:6px">${exitLbl ? `Exit ≈ <b style="color:#b8c8c8">${esc(exitLbl)}</b>` : ''}</span>
        <button class="wb g" style="font-size:16px;padding:5px 14px" ${S.eo.publishing ? 'disabled' : ''} onclick="__wpA.eoPublish()">${S.eo.publishing ? 'Publishing…' : '📣 Publish to Discord bot'}</button>
        <button class="wb" style="font-size:16px;padding:5px 12px" onclick="__wpA.eoRefresh()" title="Re-read the published config from Firestore">⟳</button>
      </div>
      <div style="font-size:14px;color:#617070;margin-bottom:10px">${S.eo.publishedAt
        ? `Last published ${fA((Date.now() - S.eo.publishedAt) / 1000)} ago — players see that version with /eowcf until you publish again.`
        : 'Not published yet — /eowcf in Discord has nothing to show.'}
        ${S.eo.msg ? `<span style="color:${S.eo.msg.startsWith('⚠') ? '#E05050' : '#60C040'};margin-left:8px">${esc(S.eo.msg)}</span>` : ''}</div>`;

    // ── Setups: one row per role/race/personality, filled in once by leadership ──
    // Race list from the config tables, personality list from our own provinces —
    // nothing hard-coded (both change between ages).
    const races = Object.keys(RACE_ELITE_COST).sort();
    const perss = [...new Set((S.own?.provinces || []).map(p => (p.sot?.personality || p.personality || '').toLowerCase()).filter(Boolean)),
                   ...c.setups.map(s => s.pers).filter(Boolean)].filter((v, i, a) => a.indexOf(v) === i).sort();
    const cap = s => s.replace(/\b\w/g, m => m.toUpperCase());
    const usedBy = id => plans.filter(p => p.setup?.id === id).length;
    const sIn = (i, key, val, w, title) => `<input type="number" step="any" min="0" value="${esc(String(val ?? ''))}" title="${esc(title)}"
        style="width:${w}px;font-size:17px;padding:2px 5px;background:#2b3333;color:#fff;border:1px solid #617070;border-radius:3px"
        onchange="__wpA.eoSetupSet(${i}, '${key}', this.value)">`;
    const sSel = (i, key, val, opts) => `<select style="font-size:16px;padding:2px 4px;background:#2b3333;color:#fff;border:1px solid #617070;border-radius:3px"
        onchange="__wpA.eoSetupSet(${i}, '${key}', this.value)"><option value="">Any</option>
        ${opts.map(o => `<option value="${esc(o)}"${o === val ? ' selected' : ''}>${esc(cap(o))}</option>`).join('')}</select>`;
    const setupRows = c.setups.map((s, i) => `<tr>
        <td>${i === 0 ? `<b style="color:#fff">${esc(s.name)}</b>` : `<input value="${esc(s.name)}" style="width:150px;font-size:17px;padding:2px 5px;background:#2b3333;color:#fff;border:1px solid #617070;border-radius:3px" onchange="__wpA.eoSetupSet(${i}, 'name', this.value)">`}</td>
        <td>${i === 0 ? '<span style="color:#7a9090">Any</span>' : sSel(i, 'race', s.race, races)}</td>
        <td>${i === 0 ? '<span style="color:#7a9090">Any</span>' : sSel(i, 'pers', s.pers, perss)}</td>
        <td>${sIn(i, 'tpa', s.tpa, 64, 'Raw thieves per acre at exit')}</td>
        <td>${sIn(i, 'wpa', s.wpa, 64, 'Raw wizards per acre at exit (guilds only)')}</td>
        <td>${sIn(i, 'dpa', s.dpa, 64, 'Defensive specialists per acre at exit')}</td>
        <td>${sIn(i, 'opa', s.opa, 64, 'Offensive specialists per acre to KEEP — the rest are released and retrained')}</td>
        <td>${sIn(i, 'ppa', s.ppa, 64, 'Peasants per acre to draft down to')}</td>
        <td style="font-family:monospace;color:#7a9090">${usedBy(s.id)}</td>
        <td>${i === 0 ? '' : `<button class="wb" style="font-size:14px;padding:1px 8px" onclick="__wpA.eoSetupDel(${i})" title="Delete this setup">✕</button>`}</td>
      </tr>`).join('');
    const setupsHtml = `<div style="font-size:15px;color:#7a9090;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:4px 0 6px">Targets by setup
        <span style="text-transform:none;font-weight:400;letter-spacing:0;color:#617070"> — per acre at exit, rest = elites. A province uses the most specific match
        (race + personality › race › personality › Everyone); override it per province in the table below.</span></div>
      <table class="wtbl" style="margin-bottom:6px"><thead><tr><th>Setup</th><th>Race</th><th>Personality</th>
        <th title="Raw thieves per acre">TPA</th><th title="Raw wizards per acre">WPA</th><th title="Def specs per acre">Dspec/a</th>
        <th title="Off specs per acre to keep">Ospec/a</th><th title="Peasants per acre after the draft">PPA</th><th>Provs</th><th></th></tr></thead>
        <tbody>${setupRows}</tbody></table>
      <button class="wb" style="font-size:15px;padding:3px 12px;margin-bottom:14px" onclick="__wpA.eoSetupAdd()">+ Add setup</button>`;

    // KD cards
    const sum = (f) => plans.reduce((s, p) => s + f(p), 0);
    const short = plans.filter(p => p.train.untrained > 0 || p.train.fixedShort).length;
    const card = (l, v, title, color) => `<div class="wkb" title="${esc(title)}"><div class="l">${l}</div><div class="v" style="color:${color || '#fff'};font-family:monospace">${v}</div></div>`;
    const cards = `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        ${card('Provinces', plans.length, 'Own provinces with a SoT to plan from')}
        ${card('On track', plans.length - short, 'Every soldier trained and thief/spec targets met', '#60C040')}
        ${card('Short', short, 'Gold or soldiers do not reach the targets', short ? '#E05050' : '#60C040')}
        ${card('Elites to train', fK(sum(p => p.train.eli)), 'Total elites ordered at training time')}
        ${card('Plan gain', '+' + fK(sum(p => p.train.eli - p.baseline.eli)), 'Extra elites from release-to-peasants and armoury swaps, vs doing neither', '#ffd400')}
        ${card('Armoury swaps', plans.filter(p => p.arm.pct > 0).length, 'Provinces where razing banks into armouries before training pays for itself')}
        ${card('WPA short', plans.filter(p => p.wiz.gap > 0).length, 'Provinces whose guilds will not reach the WPA target by exit', '#c090ff')}
      </div>`;

    const n = fK;
    const rows = plans.sort((a, b) => a.slot - b.slot).map(p => {
      const t = p.train;
      const bad = t.untrained > 0 || t.fixedShort;
      const tick = v => v <= 0 ? '<b style="color:#E05050">now</b>' : v + 't';
      const rel = p.surplusO ? `${n(p.release.toSoldiers)}→sol${p.release.toPeasants ? `<br>${n(p.release.toPeasants)}→peas` : ''}` : '—';
      const wizC = p.wiz.gap > 0 ? '#c090ff' : '#60C040';
      const sel = S.eo.sel === p.slot;
      const row = `<tr style="cursor:pointer${sel ? ';background:rgba(255,212,0,.07)' : ''}" onclick="__wpA.eoSel(${p.slot})">
        <td>${p.slot}</td>
        <td><b style="color:#fff">${esc(p.name)}</b><br><span style="font-size:14px;color:#7a9090">${esc(p.race)} ${esc(p.pers)} · ${p.land.toLocaleString('en-US')}a</span></td>
        <td onclick="event.stopPropagation()"><select style="font-size:15px;padding:2px 4px;background:#2b3333;color:${p.setup?.how === 'manual' ? '#ffd400' : '#fff'};border:1px solid #617070;border-radius:3px;max-width:150px"
            title="${p.setup?.how === 'manual' ? 'Set by hand' : 'Matched by race/personality'}" onchange="__wpA.eoAssign(${p.slot}, this.value)">
            <option value="">Auto${p.setup?.how !== 'manual' ? ' (' + esc(p.setup?.name || '') + ')' : ''}</option>
            ${c.setups.map(s => `<option value="${esc(s.id)}"${c.assign?.[p.slot] === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select></td>
        <td style="font-family:monospace">${tick(p.trainAt)}${p.draft.drafted ? `<br><span style="font-size:14px;color:#7a9090" title="Draft burst start (${p.draft.ticks} ticks)">draft @${tick(p.draft.startAt)}</span>` : ''}</td>
        <td style="font-family:monospace;font-size:16px">${rel}</td>
        <td style="font-family:monospace">${p.arm.pct ? `<b style="color:#ffd400">${p.arm.pct}%</b><br><span style="font-size:14px">@${tick(p.swapAt)}</span>` : '—'}</td>
        <td style="font-family:monospace">${n(p.have.thv)}→${n(p.after.thv)}<br><span style="font-size:14px;color:#7a9090">${(p.after.thv / p.land).toFixed(2)} tpa</span></td>
        <td style="font-family:monospace;color:${wizC}">${n(p.wiz.proj)}/${n(p.wiz.target)}${p.wiz.gap > 0 ? `<br><span style="font-size:14px">${isFinite(p.wiz.extraGuildPct) ? '+' + p.wiz.extraGuildPct.toFixed(1) + '% guilds' : 'too late'}</span>` : ''}</td>
        <td style="font-family:monospace">${n(p.have.dsp)}→${n(p.after.dsp)}</td>
        <td style="font-family:monospace"><b style="color:#fff">+${n(t.eli)}</b>${t.eli > p.baseline.eli ? `<br><span style="font-size:14px;color:#ffd400">+${n(t.eli - p.baseline.eli)} vs base</span>` : ''}</td>
        <td style="font-family:monospace">${n(p.gold.atTrain)}<br><span style="font-size:14px;color:${t.left < 0 || t.untrained ? '#E05050' : '#7a9090'}">bill ${n(t.bill)}</span></td>
        <td>${bad ? `<span style="color:#E05050">${t.untrained ? n(t.untrained) + ' untrained' : 'short of soldiers'}</span>${p.banksAdd ? `<br><span style="font-size:14px">+${p.banksAdd.pct}% banks</span>` : ''}` : '<span style="color:#60C040">✓</span>'}${p.warn.length ? ` <span title="${esc(p.warn.join('\n'))}">⚠</span>` : ''}</td>
      </tr>`;
      return row + (sel ? `<tr><td colspan="12" style="background:#2b3333;font-size:17px;line-height:1.5;padding:12px 16px">${_eoMdToHtml(_eoPlanText(p))}</td></tr>` : '');
    }).join('');

    return sectionHead(`END OF WAR CEASEFIRE — TRAINING PLAN (${S.own.location || ''})`) + controls + setupsHtml + cards
      + `<table class="wtbl"><thead><tr>
          <th>#</th><th>Province</th><th>Setup</th><th title="Ticks until training must be ordered so it finishes by exit">Train in</th>
          <th title="Surplus off specs to release now">Release</th><th title="Armouries to swap in (and when to order them)">Arm</th>
          <th>Thieves</th><th title="Wizards projected at exit / target">Wizards</th><th>Def specs</th>
          <th>Elites</th><th title="Gold at training time / training bill">Gold</th><th>Status</th>
        </tr></thead><tbody>${rows}</tbody></table>
        <div style="font-size:14px;color:#617070;margin-top:12px;line-height:1.5">
          Click a province for its full plan — the same text players get from <b>/eowcf</b> in Discord (published version).
          Model: gold now + the Economy tab's net income each tick (BE reset to ≥100%, ritual applied, no war doctrine)
          − draft − construction (build + raze, building credits first). The draft is one late burst at the chosen rate
          (Patriotism, race/personality, Heroism, Draft Level Factor) down to the setup's PPA, timed to end when training is ordered.
          Training is ordered at <i>exit − training time</i> (Valor, Training Grounds, race/personality) so it finishes by exit.
          Specialist credits pay for specs first (lost on exit); Generals turn leftover credits into elites (2:1).
          Assumes population stays full (EOWCF +1000% births), released specs → soldiers → peasants with no refund,
          armouries discount thieves too, and no spells. Wizards come from guilds only (0.02/acre/tick, not BE-affected).
        </div>`;
  });
}
