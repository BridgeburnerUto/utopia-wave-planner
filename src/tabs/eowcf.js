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
//   * Thieves: flat THIEF_COST — no armoury or training-cost modifiers (leader, in game).
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
                                  tpa: 4, wpa: 2.5, dpa: 5, opa: 0, ppa: EOWCF.PPA_DEFAULT,
                                  guildPct: EOWCF.GUILD_PCT_DEFAULT, towerPct: EOWCF.TOWER_PCT_DEFAULT, homesPct: null });   // null = keep current homes
const EO_CFG_DEFAULT = () => ({ ticks: 96, exitAt: 0, ritual: 'none',
                                draftRate: EOWCF.DRAFT_RATE_DEFAULT, patriotism: true, inspire: true,
                                spareGold: EOWCF.SPARE_GOLD, wageRate: EOWCF.WAGE_RATE,
                                wageExitRate: EOWCF.WAGE_EXIT_RATE, wageRaiseTicks: EOWCF.WAGE_RAISE_TICKS,
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

/** Province with some numbers replaced — fed to _provEconomy. Shallow copies only.
 *  `o.build` = {lowercase building name: pct} replaces the whole survey mix;
 *  `o.wages` replaces the wage rate (Military Advisor field). */
function _eoWith(prov, o) {
  const sot = { ...prov.sot, peasants: o.peasants, soldiers: o.soldiers, oSpecs: o.oSpecs };
  const ma = o.wages != null ? { ...(prov.ma || {}), wages: o.wages } : prov.ma;
  const bArr = prov.survey?.buildings;
  if (!bArr || !bArr.length || !o.build) return { ...prov, sot, ma };
  const buildings = bArr.map(b => ({ ...b, pctTot: o.build[b.name.toLowerCase()] || 0 }));
  return { ...prov, sot, ma, survey: { ...prov.survey, buildings } };
}

/** Building mix as {lowercase name: pct}, from the survey */
function _eoBuildOf(prov) {
  const m = {};
  for (const b of prov.survey?.buildings || []) m[b.name.toLowerCase()] = b.pctTot || 0;
  return m;
}

/**
 * Plan one province. `cfg` = {ticks, ritual, draftRate, patriotism, inspire,
 * wageRate, wageExitRate, wageRaiseTicks, spareGold} + the setup's targets
 * {tpa, wpa, dpa, opa, ppa, guildPct, towerPct}; `ctx` = the Economy tab's
 * kingdom context. Returns null when the province has no SoT to plan from.
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
  const acres = p => Math.round(land * p / 100);

  const b0 = _eoBuildOf(prov);
  const hasSurvey = Object.keys(b0).length > 0;
  if (!hasSurvey) warn.push('no survey — buildings unknown, no build advice');
  const be = Math.max(sot.be || 100, 100) / 100 * (rit.beMult || 1);   // EOWCF resets BE to ≥100%

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

  // ── Timing ──
  // Inspire Army / Hero's Inspiration is cast right before training (leader):
  // it shortens training only. Training Grounds count as they stand AT training,
  // i.e. after the rebuild (war buildings are razed, so normally 0).
  const valor = _eoBook(prov, 'Valor');
  const insp  = cfg.inspire ? EOWCF.INSPIRE[PERS_HEROS_INSPIRATION[pers] ? 'hero' : 'army'] : null;
  const trainTicksFor = tgPct => Math.ceil(EOWCF.TRAIN_TICKS * (RACE_TRAIN_TIME_MULT[race] || 1) * (PERS_TRAIN_TIME_MULT[pers] || 1)
    * (1 - valor / 100) * (1 - Math.min(_eoCurve(EOWCF.TG_TIME_RATE, tgPct, be), 25) / 100) * (insp ? insp.trainMult : 1));
  const buildTicks = Math.ceil(EOWCF.BUILD_TICKS * (RACE_BUILD_TIME_MULT[race] || 1));
  // Rebuild only if it finishes before training would have to be ordered
  const canRebuild = hasSurvey && N - trainTicksFor(0) > buildTicks;
  if (hasSurvey && !canRebuild) warn.push('too late for a rebuild to finish before training — current build kept');
  const trainTicks = trainTicksFor(canRebuild ? 0 : (b0['training grounds'] || 0));
  const trainAt = N - trainTicks;
  if (trainAt < 0) warn.push(`training takes ${trainTicks} ticks — it can no longer finish before exit`);
  const T = Math.max(0, trainAt);   // ticks of income/draft before training is ordered

  // ── Draft (leadership: Emergency + Patriotism, one late burst to the PPA) ──
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

  // ── Wages: ceasefire rate from the start, raised again before exit ──
  const wageLow  = cfg.wageRate > 0 ? cfg.wageRate : EOWCF.WAGE_RATE;
  const wageHigh = cfg.wageExitRate > 0 ? cfg.wageExitRate : EOWCF.WAGE_EXIT_RATE;
  const wageRaiseAt = Math.max(0, N - (cfg.wageRaiseTicks >= 0 ? cfg.wageRaiseTicks : EOWCF.WAGE_RAISE_TICKS));

  // ── Construction cost: build (credits first) + raze, per acre ──
  const bMult = (RACE_BUILD_COST_MULT[race] || 1) * (PERS_BUILD_COST_MULT[pers] || 1) * (rit.buildCostMult || 1);
  const buildAcreGc = EOWCF.BUILD_COST_K * (land + EOWCF.BUILD_COST_LAND) * bMult;
  const razeAcreGc  = (EOWCF.RAZE_COST_BASE + EOWCF.RAZE_COST_K * land) * bMult;

  const ectx = { ...ctx, wdWageCut: 0, beMin: 100, beMult: rit.beMult || 1, wageMult: rit.wageMult || 1 };
  const housing = _eoBook(prov, 'Housing');
  const homePop = EOWCF.HOME_EXTRA_POP * (PERS_HOME_CAP_MULT[pers] || 1) * (1 + housing / 100) * (RACE_POP_MULT[race] || 1);
  const pop0 = sot.peasants + have.sol + have.osp + have.dsp + have.eli + have.thv + have.wiz;

  // ── The build ──
  // Dungeons: keep only what the current prisoners fill (filled dungeons pay).
  const dungNeed = (sot.prisoners || 0) / (EOWCF.DUNGEON_CAP * (PERS_DUNGEON_CAP_MULT[pers] || 1)) / land * 100;
  const dungPct  = Math.min(b0.dungeons || 0, Math.ceil(dungNeed * 10) / 10);
  // Farms: production covers consumption at exit ("sustainable", leader). Population
  // is held constant, so consumption is today's (plus any homes, added below).
  const foodMult = RACE_FOOD_MULT[race] ?? 1;
  const farmAcreFood = EOWCF.FARM_BUSHELS * be * (PERS_FARM_PROD_MULT[pers] || 1) * (1 + _eoBook(prov, 'Production') / 100);
  const farmPctFor = pop => foodMult > 0 ? Math.min(100, Math.ceil(pop * EOWCF.FOOD_PER_PERSON * foodMult / farmAcreFood / land * 1000) / 10) : 0;
  const guildBase = cfg.guildPct >= 0 ? cfg.guildPct : EOWCF.GUILD_PCT_DEFAULT;
  const towerPct  = cfg.towerPct >= 0 ? cfg.towerPct : EOWCF.TOWER_PCT_DEFAULT;
  // Homes are leadership's call (setup); blank = keep what the province has, so a
  // default never razes homes (fewer people = fewer to work and to draft).
  const homesPct  = cfg.homesPct != null && cfg.homesPct >= 0 ? cfg.homesPct : (b0.homes || 0);
  // Wizards: old guilds produce until the rebuild is done, the new mix after.
  const wizMult = (PERS_GUILD_MULT[pers] || 1) * (rit.wizMult || 1);
  const wizPerPctTick = EOWCF.GUILD_WIZ_PER_TICK * wizMult * land / 100;
  const g0 = b0.guilds || 0;
  const oldTicks = Math.min(buildTicks, N);
  const wizFor = gNew => Math.round(have.wiz + wizPerPctTick * (g0 * oldTicks + gNew * Math.max(0, N - oldTicks)));
  const guildForWpa = N > oldTicks
    ? Math.max(0, (target.wiz - have.wiz - wizPerPctTick * g0 * oldTicks) / (wizPerPctTick * (N - oldTicks))) : Infinity;

  /** The full mix for a given banks % and homes %: basics, money, WPA guilds, rest unis */
  const mixFor = (banks, homes) => {
    const farms = farmPctFor(pop0 + acres(homes) * homePop);
    const m = { dungeons: dungPct, farms, towers: towerPct, banks, homes };
    let left = 100 - dungPct - farms - towerPct - banks - homes;
    const guilds = Math.max(0, Math.min(left, Math.max(guildBase, Math.ceil(guildForWpa * 10) / 10)));
    m.guilds = guilds; left -= guilds;
    m.universities = Math.max(0, Math.round(left * 10) / 10);
    return m;
  };
  const basicsPct = () => dungPct + farmPctFor(pop0 + acres(homesPct - (b0.homes || 0)) * homePop) + towerPct + guildBase + homesPct;

  // ── Tick simulation ──
  const burstTicks = (pe, floor) => {
    if (pe <= floor) return 0;
    if (!(draftSpeed > 0)) return Infinity;
    let k = 0;
    while (pe > floor && k < 1000) { pe -= Math.max(1, Math.min(Math.floor(pe * draftSpeed), pe - floor)); k++; }
    return k;
  };
  /** `mix` = the build to order NOW (null = keep the current one) */
  const start = (toPeasants, mix, floorPpa = ppa) => {
    const homesAdd = mix ? acres((mix.homes || 0) - (b0.homes || 0)) : 0;
    const popAdd = Math.round(homesAdd * homePop);             // lands when the rebuild is done
    const pe = sot.peasants + toPeasants;
    const floor = Math.round(floorPpa * land);
    const peAtBurst = pe + (popAdd > 0 ? popAdd : 0);
    const k = burstTicks(peAtBurst, floor);
    // During construction the changed acres stand empty (no jobs, no effect)
    let during = null, built = 0, razed = 0;
    if (mix) {
      during = {};
      let kept = 0;
      for (const n of new Set([...Object.keys(b0), ...Object.keys(mix)])) {
        if (n === 'barren land') continue;
        during[n] = Math.min(b0[n] || 0, mix[n] || 0); kept += during[n];
        built += Math.max(0, (mix[n] || 0) - (b0[n] || 0));
      }
      during['barren land'] = Math.max(0, 100 - kept);
      razed = Math.max(0, built - (b0['barren land'] || 0));
    }
    const st = {
      t: 0, gold: sot.money || 0, minGold: sot.money || 0, credits: buildCredits,
      pe, sol: have.sol + (surplusO - toPeasants), oHome: (sot.oSpecs || 0) - surplusO,
      build: during || b0, after: mix, popAdd, drafted: 0, draftCost: 0, buildCost: 0,
      floor, burst: k, drStart: Math.max(0, T - k), arm: 0,
    };
    if (mix) { pay(st, acres(built), acres(razed)); st.rebuild = { built: acres(built), razed: acres(razed), cost: st.buildCost }; }
    st.arm = st.build.armouries || 0;
    return st;
  };
  const pay = (st, buildAcres, razeAcres) => {            // building credits cover construction first
    const free = Math.min(st.credits, buildAcres);
    st.credits -= free;
    const c = (buildAcres - free) * buildAcreGc + razeAcres * razeAcreGc;
    st.gold -= c; st.buildCost += c;
  };
  const step = (st, upto) => {
    for (; st.t < upto; st.t++) {
      if (st.after && st.t === buildTicks) {                 // rebuild finished
        st.build = st.after; st.after = null; st.arm = st.build.armouries || 0;
        if (st.popAdd) { st.pe = Math.max(0, st.pe + st.popAdd); st.popAdd = 0; }
      }
      // Income only changes when its inputs do — most ticks before the draft burst
      // repeat the previous one, so reuse it (the plan runs ~100 simulations/province).
      const wages = st.t >= wageRaiseAt ? wageHigh : wageLow;
      const k = st.econKey;
      if (!k || k.pe !== st.pe || k.sol !== st.sol || k.oHome !== st.oHome || k.build !== st.build || k.wages !== wages) {
        const e = _provEconomy(_eoWith(prov, { peasants: st.pe, soldiers: st.sol, oSpecs: st.oHome, build: st.build, wages }), loc, ectx);
        st.econKey = { pe: st.pe, sol: st.sol, oHome: st.oHome, build: st.build, wages, net: e ? e.net : 0 };
      }
      st.gold += st.econKey.net;
      if (st.t >= st.drStart && st.pe > st.floor) {
        const d = Math.min(Math.floor(st.pe * draftSpeed), st.pe - st.floor);
        if (d > 0) {
          const x = (st.sol + st.oHome + have.dsp + have.eli) / pop0;
          const dlf = Math.max(EOWCF.DLF[0] * x * x + EOWCF.DLF[1] * x + EOWCF.DLF[2], 1);
          const c = d * draftGc * dlf * (1 - _eoCurve(EOWCF.ARM_DRAFT_RATE, st.arm, be) / 100);
          st.gold -= c; st.draftCost += c; st.pe -= d; st.sol += d; st.drafted += d;
        }
      }
      st.minGold = Math.min(st.minGold, st.gold);
    }
    return st;
  };
  const copy = st => ({ ...st, build: { ...st.build }, after: st.after && { ...st.after }, econKey: null });
  /** Raze x% (banks first, then universities, then guilds above the base) into armouries */
  const swapToArmouries = (st, x) => {
    const b = { ...st.build };
    let left = x;
    for (const n of ['banks', 'universities']) { const take = Math.min(left, b[n] || 0); b[n] = (b[n] || 0) - take; left -= take; }
    if (left > 0) { const take = Math.min(left, Math.max(0, (b.guilds || 0) - guildBase)); b.guilds -= take; left -= take; }
    if (left > 0) return false;                              // nothing left to swap from
    b.armouries = (b.armouries || 0) + x;
    st.build = b; st.arm = b.armouries;
    pay(st, acres(x), acres(x));
    return true;
  };

  // ── Training bill at trainAt ──
  const raceTC = (RACE_TRAIN_COST_MULT[race] || 1) * (PERS_TRAIN_COST_MULT[pers] || 1);
  // Every race/personality number comes from the config.js tables (UPDATE EVERY
  // AGE) — nothing is hard-coded here. A race missing from RACE_ELITE_COST is
  // flagged rather than guessed: its elites are priced at 0 and the plan says so.
  const eliteBase = RACE_ELITE_COST[race];
  if (eliteBase == null) warn.push(`no elite price for race "${race}" in config.js RACE_ELITE_COST — elites not costed`);
  const elitePerCredits = PERS_ELITE_PER_CREDITS[pers] || 0;
  const thiefCredits = RACE_THIEF_CREDITS[race] || PERS_THIEF_CREDITS[pers] || 0;   // credits per thief, 0 = not allowed
  const thiefUnit = EOWCF.THIEF_COST * (RACE_THIEF_COST_MULT[race] || 1) * (PERS_THIEF_COST_MULT[pers] || 1);
  const train = st => {
    const unitMult = raceTC * (1 - _eoCurve(EOWCF.ARM_TRAIN_RATE, st.arm, be) / 100);
    const specUnit = EOWCF.SPEC_COST * unitMult;
    const eliteUnit = (eliteBase || 0) * unitMult;
    // 1. Soldiers: def specs, off specs, thieves, the rest elites.
    let sol = st.sol;
    const dspN = Math.min(need.dsp, sol); sol -= dspN;
    const ospN = Math.min(need.osp, sol); sol -= ospN;
    const thvN = Math.min(need.thv, sol); sol -= thvN;
    // 2. Specialist credits (LOST on exit) go where one credit saves the most gc:
    //    specs (everyone), thieves (e.g. Dark Elf), elites (General, 2 credits each).
    const free = { spec: 0, thv: 0, eli: 0 };
    let credits = specCredits;
    [{ k: 'spec', n: dspN + ospN, per: 1, gc: specUnit },
     { k: 'thv',  n: thvN, per: thiefCredits, gc: thiefUnit },
     { k: 'eli',  n: sol,  per: elitePerCredits, gc: eliteUnit }]
      .filter(u => u.per > 0 && u.n > 0)
      .sort((a, b) => b.gc / b.per - a.gc / a.per)
      .forEach(u => { const f = Math.min(u.n, Math.floor(credits / u.per)); free[u.k] = f; credits -= f * u.per; });
    // 3. Gold pays for the rest, same priority — each step limited by gold left.
    let gold = Math.max(0, st.gold);
    const payU = (n, unit) => { const p = unit > 0 ? Math.min(n, Math.floor(gold / unit)) : n; gold -= p * unit; return p; };
    const specs = free.spec + payU(dspN + ospN - free.spec, specUnit);
    const dsp = Math.min(dspN, specs), osp = specs - dsp;
    const thv = free.thv + payU(thvN - free.thv, thiefUnit);
    const fixed = Math.max(0, st.gold) - gold;
    const room = st.sol - dsp - osp - thv;                 // soldiers left for elites
    const freeEli = Math.min(free.eli, room);
    const paidEli = payU(room - freeEli, eliteUnit);
    const bill = fixed + paidEli * eliteUnit;
    const fixedMissing = need.thv + need.dsp + need.osp - (thv + dsp + osp);
    const fixedNoSol = Math.max(0, need.thv + need.dsp + need.osp - st.sol);   // missing for lack of soldiers
    return {
      thv, dsp, osp, eli: freeEli + paidEli, freeSpecs: free.spec, freeThv: free.thv, freeEli,
      untrained: room - freeEli - paidEli,                 // soldiers left because gold ran out
      fixedShort: fixedMissing > 0, fixedMissing, fixedNoSol,
      bill: Math.round(bill), left: Math.round(st.gold - bill), unitMult, eliteUnit,
    };
  };
  const goldLimited = t => t.untrained + (t.fixedMissing - t.fixedNoSol) > 0;
  const spare = cfg.spareGold >= 0 ? cfg.spareGold : EOWCF.SPARE_GOLD;
  const goalMet = t => !goldLimited(t) && t.left >= spare;
  const run = (toP, mix) => { const st = step(start(toP, mix), T); return { toP, mix, arm: 0, st, tr: train(st) }; };

  // ── Build search: banks %. Homes are leadership's (setup), not the tool's.
  //    Ranked by: 1. most units trained, 2. the spare gold kept, 3. the fewest
  //    bank acres (the rest goes to WPA guilds, then unis). Training gold wins
  //    over WPA guilds when land is short (leader).
  let mix = null, buildGoal = null;
  if (canRebuild) {
    const avail = Math.max(0, Math.floor(100 - basicsPct()));
    const mk = m => mixFor(m, homesPct);
    const units = t => t.thv + t.dsp + t.osp + t.eli;
    let bestB = null;
    const consider = m => {
      const r = run(0, mk(m));
      const c = { m, u: units(r.tr), ok: r.tr.left >= spare, left: r.tr.left };
      if (!bestB || c.u > bestB.u || (c.u === bestB.u && ((c.ok && !bestB.ok)
            || (c.ok === bestB.ok && (c.ok ? c.m < bestB.m : c.left > bestB.left)))))
        bestB = c;
    };
    const stepM = Math.max(1, Math.ceil(avail / 25));
    for (let m = 0; m <= avail; m += stepM) consider(m);
    if (avail % stepM) consider(avail);
    for (let m = Math.max(0, bestB.m - stepM + 1); m < bestB.m; m++) consider(m);   // refine down
    mix = mk(bestB.m);
    buildGoal = bestB.ok ? 'met' : 'short';
  }

  // ── Release and armoury search on top of the chosen build ──
  const fixedN = c => c.tr.thv + c.tr.dsp + c.tr.osp;
  const moves  = c => (c.arm > 0 ? 1 : 0) + (c.toP > 0 ? 1 : 0);
  const better = (a, b) => {
    if (!b) return true;
    if (fixedN(a) !== fixedN(b)) return fixedN(a) > fixedN(b);
    if (a.tr.eli !== b.tr.eli) return a.tr.eli > b.tr.eli;
    if (moves(a) !== moves(b)) return moves(a) < moves(b);
    return a.tr.left > b.tr.left;
  };
  const swapAt = T - buildTicks;                            // armouries must be finished when training is ordered
  const armOK = swapAt >= (canRebuild ? buildTicks : 0);    // not before the rebuild itself is done
  const fracs = surplusO > 0 ? [0, 0.25, 0.5, 0.75, 1] : [0];
  const armOpts = armOK ? [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50] : [0];
  let best = null, baseline = null;
  for (const f of fracs) {
    const toP = Math.round(surplusO * f);
    const head = step(start(toP, mix), Math.max(0, swapAt));
    for (const x of armOpts) {
      const st = copy(head);
      if (x > 0 && !swapToArmouries(st, x)) continue;
      step(st, T);
      const cand = { toP, arm: x, st, tr: train(st) };
      if (f === 0 && x === 0) baseline = cand;
      if (better(cand, best)) best = cand;
    }
  }
  if (best.arm > 0) {                                        // refine ±4 in steps of 1
    const head = step(start(best.toP, mix), swapAt);
    for (let x = Math.max(1, best.arm - 4); x <= Math.min(50, best.arm + 4); x++) {
      if (x === best.arm) continue;
      const st = copy(head); if (!swapToArmouries(st, x)) continue; step(st, T);
      const cand = { toP: best.toP, arm: x, st, tr: train(st) };
      if (better(cand, best)) best = cand;
    }
  }
  const bt = best.tr;

  // ── Wizards with the chosen build ──
  const gNew = mix ? mix.guilds : g0;
  const wizProj = wizFor(gNew);
  const wizGap = Math.max(0, target.wiz - wizProj);

  if (best.st.pe > best.st.floor)
    warn.push(`the draft cannot reach ${ppa} PPA by training — drafting from now still ends at ${(best.st.pe / land).toFixed(1)} PPA`);
  // Soldiers are the limit when targets lack soldiers, or gold is left over that
  // could pay for more elites. State the PPA that would supply them (information
  // for leadership, not an order), bounded by a burst from NOW to PPA 0.
  let draftAdvice = null;
  if (!goldLimited(bt) && eliteBase && (bt.fixedNoSol > 0 || bt.left > spare + bt.eliteUnit * 100)) {
    const spareEli = Math.max(0, Math.floor((bt.left - spare - bt.fixedNoSol * EOWCF.SPEC_COST * bt.unitMult) / bt.eliteUnit));
    const wanted = bt.fixedNoSol + spareEli;
    const cap = step(start(best.toP, mix, 0), T);
    const canGet = Math.max(0, cap.sol - best.st.sol);
    const extra = Math.min(wanted, canGet);
    if (extra > 0) draftAdvice = {
      extra, wanted, speedLimited: canGet < wanted, spareEli,
      ppa: Math.max(0, Math.floor((best.st.pe - extra) / land * 10) / 10),
    };
  }
  const net0 = _provEconomy(prov, loc, ectx)?.net;
  if (net0 != null && net0 < 0) warn.push('income is negative right now — wages exceed income');

  // Final build as shown to the player (after any armoury swap)
  const finalBuild = mix ? { ...mix } : null;
  if (finalBuild && best.arm) {
    const tmp = { build: { ...mix }, arm: 0, gold: 0, buildCost: 0, credits: 0 };
    swapToArmouries(tmp, best.arm);
    Object.assign(finalBuild, tmp.build);
  }
  return {
    slot: prov.slot, name: prov.name, race, pers, land, N, trainAt, trainTicks, buildTicks, swapAt,
    have, target, need, surplusO, specCredits, buildCredits, inspire: insp,
    wages: { low: wageLow, high: wageHigh, raiseAt: wageRaiseAt },
    draft: { rate: rateKey || EOWCF.DRAFT_RATE_DEFAULT, patriotism: !!cfg.patriotism, ppa,
             startAt: best.st.drStart, ticks: Math.min(best.st.burst, T), drafted: best.st.drafted,
             cost: Math.round(best.st.draftCost), ppaAtTrain: best.st.pe / land, advice: draftAdvice },
    release: { toPeasants: best.toP, toSoldiers: surplusO - best.toP },
    build: mix ? {
      mix, before: b0, goal: buildGoal, spare,
      built: best.st.rebuild?.built || 0, razed: best.st.rebuild?.razed || 0, cost: Math.round(best.st.rebuild?.cost || 0),
      wpaShort: wizGap > 0, dungNeed,
    } : null,
    arm: { pct: best.arm, from: b0.armouries || 0,
           cost: best.arm ? Math.round(best.st.buildCost - (best.st.rebuild?.cost || 0)) : 0 },
    gold: { now: sot.money || 0, atTrain: Math.round(best.st.gold), min: Math.round(best.st.minGold) },
    soldiersAtTrain: best.st.sol,
    train: bt,
    baseline: { eli: baseline.tr.eli, left: baseline.tr.left },
    wiz: { have: have.wiz, proj: wizProj, target: target.wiz, gap: wizGap, guildPct: gNew, mult: wizMult },
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
    const pc = { ...cfg, tpa: setup.tpa, wpa: setup.wpa, dpa: setup.dpa, opa: setup.opa, ppa: setup.ppa,
                 guildPct: setup.guildPct ?? EOWCF.GUILD_PCT_DEFAULT, towerPct: setup.towerPct ?? EOWCF.TOWER_PCT_DEFAULT,
                 homesPct: setup.homesPct ?? null };
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
      return `<t:${unix}:f> (<t:${unix}:R>${lbl ? ', ' + lbl : ''})`;   // exact local time + live countdown
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
  steps.push([0, `Set wages to **${p.wages.low}%** NOW.`]);
  if (p.build) {
    const B = p.build, nm = { universities: 'Unis', guilds: 'Guilds', banks: 'Banks', homes: 'Homes', farms: 'Farms',
                              towers: 'Towers', dungeons: 'Dungeons', armouries: 'Armouries' };
    const order = ['banks', 'homes', 'guilds', 'universities', 'towers', 'farms', 'dungeons'];
    const mixTxt = order.filter(k => (B.mix[k] || 0) > 0).map(k => `${nm[k]} ${+B.mix[k].toFixed(1)}%`).join(' · ');
    const cap = k => k.replace(/\b\w/g, c => c.toUpperCase());
    const razeTxt = Object.entries(B.before)
      .filter(([k, v]) => k !== 'barren land' && v - (B.mix[k] || 0) >= 0.5)
      .map(([k, v]) => (B.mix[k] || 0) > 0 ? `${cap(k)} ${+v.toFixed(1)}→${+B.mix[k].toFixed(1)}%` : cap(k)).join(', ');
    steps.push([0, `**Rebuild NOW** to: ${mixTxt}`
      + (razeTxt ? `. Raze: ${razeTxt}` : '')
      + ` (≈${n(B.built)} acres, ≈${n(B.cost)} gc${p.buildCredits ? ', building credits first' : ''}).`
      + (B.goal === 'met' ? ` Banks are sized to train what you can and keep ≈${n(B.spare)} gc spare.`
                          : ` Even all spare land in banks can't keep ≈${n(B.spare)} gc spare after training.`)]);
  }
  if (p.wages.raiseAt < p.N) steps.push([p.wages.raiseAt, `Raise wages to **${p.wages.high}%** ${at(p.wages.raiseAt)} (${p.N - p.wages.raiseAt} ticks before exit).`]);
  if (p.inspire) steps.push([Math.max(0, p.trainAt) + 0.4, `Cast **${p.inspire.name}** right before training (−${Math.round((1 - p.inspire.trainMult) * 100)}% training time, already counted).`]);
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
    + (t.freeThv ? ` (${n(t.freeThv)} thieves on credits)` : '')
    + (t.freeEli ? ` (${n(t.freeEli)} elites on credits)` : '') + '.']);
  steps.sort((a, b) => a[0] - b[0]).forEach(([, s], i) => L.push(`${i + 1}. ${s}`));
  L.push(`Gold: ${n(p.gold.now)} now → ≈${n(p.gold.atTrain)} at training; bill ≈${n(t.bill)}, ${t.left >= 0 ? n(t.left) + ' left' : 'gold runs out'}.`);
  if (t.untrained > 0) L.push(`⚠ ${n(t.untrained)} soldiers stay untrained — not enough gold.`);
  if (t.fixedNoSol > 0) L.push(`⚠ ${n(t.fixedNoSol)} soldiers short of the thief/spec targets even after drafting down to ${d.ppa} PPA.`);
  else if (t.fixedShort) L.push(`⚠ Not enough gold for the thief/spec targets (${n(t.fixedMissing)} units short).`);
  const tpa = p.after.thv / p.land, wpa = p.after.wiz / p.land, dpa = p.after.dsp / p.land;
  L.push(`At exit: TPA ${tpa.toFixed(2)} · WPA ${wpa.toFixed(2)} · ${dpa.toFixed(2)} dspecs/acre · ${n(p.after.eli)} elites`);
  if (p.train.eli > p.baseline.eli) L.push(`-# The release/armoury choices train ${n(p.train.eli - p.baseline.eli)} more elites than skipping them.`);

  // What-ifs — NOT included in the numbers above, so the plan is exactly what it says
  const more = [];
  const da = p.draft.advice;
  // Information, not an order: the PPA is leadership's call.
  if (da) more.push(`Soldier gap: ≈${n(da.extra)} more soldiers`
    + (t.fixedNoSol > 0 ? ` (${n(t.fixedNoSol)} for the thief/spec targets${da.spareEli ? `, ${n(da.spareEli)} more elites the spare gold could pay for` : ''})`
                        : ` (more elites the spare gold could pay for)`)
    + ` would mean drafting down to ≈${da.ppa} PPA instead of ${d.ppa}`
    + (da.speedLimited ? ` — and even that is short of the ${n(da.wanted)} wanted.` : '.')
    + ' Ask leadership before going below the PPA target.');
  if (p.wiz.gap > 0) more.push(`Wizards: ${n(p.wiz.proj)} of ${n(p.wiz.target)} by exit — `
    + (p.build ? 'not enough land left for the guilds the WPA target needs (training gold comes first).' : 'too late for new guilds to close it.'));
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
  } else if (key === 'inspire') {
    c.inspire = !!val;
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
  else if (key === 'homesPct' && String(val).trim() === '') s.homesPct = null;   // blank = keep current homes
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
        <label style="display:flex;align-items:center;gap:6px;font-size:14px;color:#7a9090;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding-bottom:6px"
          title="Cast right before training: Inspire Army (−20% training time) or, for personalities that have it, Hero's Inspiration (−30%)">
          <input type="checkbox" ${c.inspire ? 'checked' : ''} onchange="__wpA.eoSet('inspire', this.checked)"> IA / HI for training</label>
        ${inp('spareGold', 'Spare gold', c.spareGold ?? EOWCF.SPARE_GOLD, 110, 'Gold every province should still have after training. Banks/homes are sized for this; the rest of the land goes to guilds/unis.')}
        ${inp('wageRate', 'Wages %', c.wageRate ?? EOWCF.WAGE_RATE, 70, 'Wage rate set as the ceasefire starts')}
        ${inp('wageExitRate', 'Exit wages %', c.wageExitRate ?? EOWCF.WAGE_EXIT_RATE, 70, 'Wage rate before exit, so military efficiency recovers')}
        ${inp('wageRaiseTicks', 'Raise (ticks before exit)', c.wageRaiseTicks ?? EOWCF.WAGE_RAISE_TICKS, 90, 'How many ticks before exit wages go back up')}
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
        <td>${sIn(i, 'guildPct', s.guildPct ?? EOWCF.GUILD_PCT_DEFAULT, 58, 'Base guild % for self-spells and the ritual (more if the WPA target needs it)')}</td>
        <td>${sIn(i, 'towerPct', s.towerPct ?? EOWCF.TOWER_PCT_DEFAULT, 58, 'Tower % for ritual runes')}</td>
        <td><input type="number" step="any" min="0" value="${s.homesPct == null ? '' : esc(String(s.homesPct))}" placeholder="keep"
          title="Homes % (more people to work and to draft). Blank = keep each province's current homes"
          style="width:58px;font-size:17px;padding:2px 5px;background:#2b3333;color:#fff;border:1px solid #617070;border-radius:3px"
          onchange="__wpA.eoSetupSet(${i}, 'homesPct', this.value)"></td>
        <td style="font-family:monospace;color:#7a9090">${usedBy(s.id)}</td>
        <td>${i === 0 ? '' : `<button class="wb" style="font-size:14px;padding:1px 8px" onclick="__wpA.eoSetupDel(${i})" title="Delete this setup">✕</button>`}</td>
      </tr>`).join('');
    const setupsHtml = `<div style="font-size:15px;color:#7a9090;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:4px 0 6px">Targets by setup
        <span style="text-transform:none;font-weight:400;letter-spacing:0;color:#617070"> — per acre at exit, rest = elites. A province uses the most specific match
        (race + personality › race › personality › Everyone); override it per province in the table below.</span></div>
      <table class="wtbl" style="margin-bottom:6px"><thead><tr><th>Setup</th><th>Race</th><th>Personality</th>
        <th title="Raw thieves per acre">TPA</th><th title="Raw wizards per acre">WPA</th><th title="Def specs per acre">Dspec/a</th>
        <th title="Off specs per acre to keep">Ospec/a</th><th title="Peasants per acre after the draft">PPA</th>
        <th title="Base guilds % (self-spells, ritual)">Guild%</th><th title="Towers % (ritual runes)">Tower%</th><th title="Homes % — leadership's call">Homes%</th><th>Provs</th><th></th></tr></thead>
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
        <td style="font-family:monospace;font-size:14px;line-height:1.3">${p.build
          ? `B${+p.build.mix.banks.toFixed(1)} H${+p.build.mix.homes.toFixed(1)}<br>G${+p.build.mix.guilds.toFixed(1)} U${+p.build.mix.universities.toFixed(1)}`
            + `${p.build.goal === 'short' ? ' <span style="color:#E05050" title="Even all spare land in banks/homes cannot afford every soldier">!</span>' : ''}`
          : '<span style="color:#7a9090">—</span>'}</td>
        <td style="font-family:monospace;font-size:16px">${rel}</td>
        <td style="font-family:monospace">${p.arm.pct ? `<b style="color:#ffd400">${p.arm.pct}%</b><br><span style="font-size:14px">@${tick(p.swapAt)}</span>` : '—'}</td>
        <td style="font-family:monospace">${n(p.have.thv)}→${n(p.after.thv)}<br><span style="font-size:14px;color:#7a9090">${(p.after.thv / p.land).toFixed(2)} tpa</span></td>
        <td style="font-family:monospace;color:${wizC}">${n(p.wiz.proj)}/${n(p.wiz.target)}<br><span style="font-size:14px">${+p.wiz.guildPct.toFixed(1)}% guilds</span></td>
        <td style="font-family:monospace">${n(p.have.dsp)}→${n(p.after.dsp)}</td>
        <td style="font-family:monospace"><b style="color:#fff">+${n(t.eli)}</b>${t.eli > p.baseline.eli ? `<br><span style="font-size:14px;color:#ffd400">+${n(t.eli - p.baseline.eli)} vs base</span>` : ''}</td>
        <td style="font-family:monospace">${n(p.gold.atTrain)}<br><span style="font-size:14px;color:${t.left < 0 || t.untrained ? '#E05050' : '#7a9090'}">bill ${n(t.bill)}</span></td>
        <td>${bad ? `<span style="color:#E05050">${t.untrained ? n(t.untrained) + ' untrained' : 'short of soldiers'}</span>` : '<span style="color:#60C040">✓</span>'}${p.warn.length ? ` <span title="${esc(p.warn.join('\n'))}">⚠</span>` : ''}</td>
      </tr>`;
      return row + (sel ? `<tr><td colspan="13" style="background:#2b3333;font-size:17px;line-height:1.5;padding:12px 16px">${_eoMdToHtml(_eoPlanText(p))}</td></tr>` : '');
    }).join('');

    return sectionHead(`END OF WAR CEASEFIRE — TRAINING PLAN (${S.own.location || ''})`) + controls + setupsHtml + cards
      + `<table class="wtbl"><thead><tr>
          <th>#</th><th>Province</th><th>Setup</th><th title="Ticks until training must be ordered so it finishes by exit">Train in</th>
          <th title="Recommended build: Banks / Homes / Guilds / Unis % (plus farms, towers, dungeons) — click the row for the full list">Build</th>
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
          Specialist credits (lost on exit) go where they save the most gold: specs, thieves where the race may (Dark Elf), elites for Generals (2:1).
          Assumes population stays full (EOWCF +1000% births), released specs → soldiers → peasants with no refund,
          thieves at a flat price (no armoury discount), and only Patriotism + Inspire Army / Hero's Inspiration as spells. Wizards come from guilds only (0.02/acre/tick, not BE-affected).
        </div>`;
  });
}
