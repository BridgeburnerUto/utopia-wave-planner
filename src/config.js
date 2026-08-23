// ── CONFIG ─────────────────────────────────────────────────────────────────
// All constants, data tables and CSS live here.
// Nothing in this file has side effects — safe to add to freely.

const CFG = {
  FB_PROJECT: 'utopia-leaderboard',
  FB_API_KEY: 'AIzaSyAnlkMabj-9a-fUEx66o86w2CnJaUgboIY',
  get FB_BASE() {
    return `https://firestore.googleapis.com/v1/projects/${this.FB_PROJECT}/databases/(default)/documents`;
  },
  API_BASE: 'https://api.intel.utopia.site',
};

// ── FIRESTORE QUOTA BUDGET ─────────────────────────────────────────────────
// The project runs on the Firestore Spark FREE tier: 50k document reads, 20k
// writes and 20k deletes per DAY, resetting at midnight US Pacific.
//
// A structured query is billed one read PER DOCUMENT RETURNED, so an unbounded
// read of an 800-document collection costs 800 units — and re-running it on
// every button click is what exhausted a whole day of quota on 2026-08-11.
// Two rules follow, and both are enforced in firebase.js:
//   1. A whole-collection read happens at most ONCE per session (fbCache*).
//   2. Every query is bounded — by the age window and by a hard limit — so the
//      cost cannot grow silently as the collections accumulate across ages.
const FB_QUOTA = {
  READS_PER_DAY:  50000,
  WRITES_PER_DAY: 20000,

  // Session read levels for the header meter. Amber says "something is reading
  // more than it should"; red says "at this rate the day's bucket is at risk".
  READ_AMBER: 5000,
  READ_RED:  15000,

  // How long a cached collection read is reused before a tab re-open refetches.
  // View switches (metric, sort, filter) NEVER refetch regardless of this —
  // they re-render the same rows. Only re-opening the tab consults the age.
  CACHE_TTL_MS: 15 * 60e3,

  // Hard caps on a single query. Hitting one means the age window is holding
  // more documents than expected; the UI says so rather than silently
  // truncating (the old blanket `limit: 2000` did exactly that).
  DRAGON_LIMIT: 1500,
  OPS_LIMIT:    3000,
  LIMIT:        2000,   // default for any other collection
};

// Duration ops (toggle on/off a province card)
const DOPS = [
  {c:'BLI',l:'Blizzard'},{c:'CHA',l:'Chaos'},{c:'DG',l:'Dragon'},
  {c:'DR',l:'Drought'},{c:'ET',l:'Exp Thieves'},{c:'EX',l:'Expose'},
  {c:'FOG',l:'Fog'},{c:'GL',l:'Gluttony'},{c:'GR',l:'Greed'},
  {c:'IR',l:'Inspire'},{c:'MW',l:'Mind Wipe'},{c:'MS',l:'Miser'},
  {c:'NF',l:'Night Fall'},{c:'PF',l:'Plague'},{c:'SW',l:'Shadow'},
  {c:'Slo',l:'Slow Burn'},{c:'Sto',l:'Storm'},{c:'Wra',l:'Wrath'},
];

// Instant ops
const IOPS = [
  {c:'AR',l:'Arson'},{c:'AMN',l:'Amnesia'},{c:'ARS',l:'Gr.Arson'},
  {c:'AW',l:'Assassin'},{c:'FB',l:'Fireball'},{c:'GA',l:'Grab Army'},
  {c:'INF',l:'Infiltrate'},{c:'KN',l:'Kidnap'},{c:'LS',l:'Learn'},
  {c:'MV',l:'Massacre'},{c:'NM',l:'Nightmare'},{c:'NS',l:'Night Strike'},
  {c:'PROP',l:'Propaganda'},{c:'RG',l:'Raze'},{c:'RV',l:'Reveal'},
  {c:'RT',l:'Riot'},{c:'SB',l:'Spy Bldgs'},{c:'SWH',l:'Switcharoo'},
  {c:'TOR',l:'Tornado'},{c:'WRi',l:'War Ritual'},
];

// Op type classification sets used by syncOps and leaderboard filtering
const OP_SETS = {
  // Intel / espionage ops — never tracked on leaderboard
  ESPIONAGE: new Set([
    'SPY_ON_THRONE','SPY_ON_MILITARY','SPY_ON_DEFENSE','SPY_ON_SCIENCES',
    'INFILTRATE','SURVEY_BUILDINGS','SNATCH_NEWS','SPY_ON_EXPLORATION','SHADOW_LIGHT',
    'ILLUMINATE_SHADOWS',
  ]),

  // Self-buff spells — never tracked on leaderboard
  SELF_BUFF: new Set([
    'TREE_OF_GOLD','BUILDERS_BOON','MAGIC_SHIELD','LOVE_AND_PEACE',
    'NATURES_BLESSING','FERTILE_LANDS','PATRIOTISM','MIND_FOCUS','GREATER_PROTECTION',
    'MINOR_PROTECTION','INSPIRE_ARMY','ANIMATE_DEAD','FOUNTAIN_OF_KNOWLEDGE',
    'MINERS_MYSTIQUE','GHOST_WORKERS','HEROES_INSPIRATION','SALVATION','REVELATION',
    'WRATH',
  ]),

  // Thievery sabotage ops — tracked on leaderboard
  THIEF_SAB: new Set([
    'ROB_THE_GRANARIES','ROB_THE_VAULTS','ROB_THE_TOWERS',
    'KIDNAP','ARSON','GREATER_ARSON','NIGHT_STRIKE','INCITE_RIOTS',
    'STEAL_WAR_HORSES','BRIBE_THIEVES','BRIBE_GENERALS','FREE_PRISONERS',
    'ASSASSINATE_WIZARDS','PROPAGANDA','SABOTAGE_WIZARDS','DESTABILIZE_GUILDS',
  ]),

  // Offensive spells — tracked on leaderboard
  OFFENSIVE_SPELL: new Set([
    'FIREBALL','LIGHTNING_STRIKE','LAND_LUST','TORNADOES','METEOR_SHOWERS',
    'DROUGHTS','STORMS','GLUTTONY','GREED','EXPOSE_THIEVES','BLIZZARD',
    'EXPLOSIONS','MYSTIC_VORTEX','NIGHTMARE','NIGHTMARES','FOOLS_GOLD','PITFALLS',
    'CHASTITY','VERMIN','ABOLISH_RITUAL','SOUL_BLIGHT','MAGIC_WARD',
    'SLOTH','NIGHTFALL','AMNESIA',
  ]),
};

// Combined set of all ops we want to track on the leaderboard
// Anything NOT in this set gets skipped during syncOps
const TRACKED_OPS = new Set([...OP_SETS.THIEF_SAB, ...OP_SETS.OFFENSIVE_SPELL]);

// ── Race & personality combat modifiers ──────────────────────────────────────
// VERIFIED 2026-07-14 by regression on a real IS dump (end of Age 115):
//   sot.offPoints ≈ (units × raw unit values) × som.ome/100
// i.e. the API's offense/defense points ALREADY include the full military
// efficiency (race, personality, science, honor, active spells). som.ome and
// som.dme expose the multiplier as a percentage (e.g. 157 = 157%).
//
// Therefore these tables must stay EMPTY (all lookups fall back to 1.0) —
// applying OME/DME multipliers on top of API points double-counts. They are
// kept only because player.js references them; the mechanism allows a manual
// correction if a future age breaks the "already effective" property.

const RACE_OFF_MULT        = {};
const RACE_DEF_MULT        = {};
const PERSONALITY_OFF_MULT = {};
const PERSONALITY_DEF_MULT = {};

// Fanaticism self-spell: +5% OME / −5% DME. The wave planner assumes every
// attacker casts it before hitting.
const FANATICISM_OFF_MULT = 1.05;

// ═══════════════════════════════════════════════════════════════════════════
// ── AGE-VARYING SOLVER CONSTANTS — UPDATE EVERY AGE ─────────────────────────
// Single source of truth for the numbers that change when the game is
// rebalanced each age. Previously these were duplicated inline across
// utils.js / player.js / waveplan.js / kingdom.js / tabs/tmmatchup.js; every
// consumer now references the constants below so an age update is a one-file
// edit. Cross-check against the "AGE nnn FINAL CHANGES" doc each age.
// ═══════════════════════════════════════════════════════════════════════════

// NW ratio bands (attackerNW / targetNW). Optimal = full combat gains; the war
// range is the acceptable 75–133% window the solver keeps every hit inside.
const NW_OPTIMAL   = { min: 0.90, max: 1.10 };
const NW_WAR_RANGE = { min: 0.75, max: 1.33 };

// Each extra general sent adds +5% to the offense sent (and to troops needed).
const GEN_OFF_BONUS = 0.05;

// Race max-population multiplier (living-space bonus). Only races that differ
// from ×1.0 are listed; every other race falls back to 1.0.
//   Age 116: Halfling +12.5% Population, Faery −5% Population.
const RACE_POP_MULT = { halfling: 1.125, faery: 0.95 };

// ── Economy (income / wages) — base formulas from utopiawiki.com Economy +
// Growth pages, age-specific modifiers from the AGE 116 doc. Used by
// tabs/economy.js. Wage rate comes from the Military Advisor when we have it,
// else it is recovered from the SoM's military efficiency (see MIL_EFF_* below);
// ritual income effects are not modeled (dragons, plague and riots are).
const INCOME_PER_EMPLOYED   = 3.0;   // gc per employed peasant per tick
const INCOME_PER_UNEMPLOYED = 1.0;
const INCOME_PER_PRISONER   = 0.75;
const JOBS_PER_ACRE         = 25;    // jobs per built non-home acre
const BANK_FLAT_GC          = 25;    // gc per bank acre × BE
const BANK_INCOME_RATE      = 1.5;   // % income per % built (x·(1−x) curve, max 37.5%)
const ARMOURY_WAGE_RATE     = 2.0;   // % wage cut per % built (x·(1−x) curve, max 50%)
const WAGE_PER_SPEC         = 0.5;   // gc/tick per off+def spec (soldiers/mercs unpaid)
const WAGE_PER_ELITE        = 0.75;  // gc/tick per elite
const WAGE_RATE_ASSUMED     = 200;   // % assumed when nothing at all is known
// Military efficiency ⇄ wage rate. The SoM reports efficiency, not the wage
// rate, but the two are tied by the published curve (strategy-context.md):
//   base eff% = MIL_EFF_BASE + MIL_EFF_WAGE_COEF × (effective wage%/100)^MIL_EFF_WAGE_EXP
// economy.js inverts it (`_wageRateFromEff`) to recover the wage rate of any
// province we have a SoM on. Caveats baked into the clamp: the recovered value
// is the EFFECTIVE wage rate, which drifts toward the paid rate over ~96h, and
// Ruby dragon (×0.875) / multi-attack protection (>1) scale eff without
// touching wages — hence WAGE_RATE_MAX.
const MIL_EFF_BASE      = 33;
const MIL_EFF_WAGE_COEF = 67;
const MIL_EFF_WAGE_EXP  = 0.25;
const WAGE_RATE_MAX     = 200;   // % — game cap on the wage setting
// ── Race / personality ECONOMY modifiers (Age 116) ───────────────────────────
// Everything a race or personality changes about income or wages lives in these
// tables, so tabs/economy.js can both APPLY and DISPLAY a modifier from one
// place (`_econMods` builds the Mods column out of exactly these lookups — the
// column cannot drift from the Net figure). 1.0 / absent = no effect.
//
// AUDITED 2026-08-12 against the AGE 116 FINAL CHANGES doc (Races +
// Personalities sections) — this is the COMPLETE set for the age. The wiki's
// Modified Income formula is raw × Plague × Riots × Bank% × Income Science ×
// Honor × Race × Personality × Dragon × Ritual, so Race/Personality enter at
// exactly one place each.
//
// Deliberately NOT here — they reach the economy by another route, or not at all:
//   Dwarf +30% Building Efficiency (and the Dwarf war doctrine's +12.5% BE):
//     `sot.be` is the province's EFFECTIVE building efficiency and already
//     carries both, the same "API reports it post-modifier" property that keeps
//     the OME/DME tables empty. Applying them here would double-count.
//   Artisan +25% Economy Science / Sage +15% Science Efficiency: `sos.books[]
//     .effect` is the reported effect and already includes them.
//   Artisan immunity to Greed / Incite Riots / Fool's Gold: Incite Riots IS
//     modeled now and the immunity with it — it lives in PERS_RIOTS_IMMUNE
//     next to the riots term it cancels, the same way Undead's plague
//     immunity does. Greed and Fool's Gold are still not modeled.
//     (Dragon income/wage terms are race-independent and live in DRAGON_ECON
//      above; they are applied per kingdom, not per province.)
// (Undead's plague immunity IS a race economy modifier and lives in
//  RACE_PLAGUE_IMMUNE above, next to the plague term it cancels.)
// ── Dragon economy effects (Age 116) ─────────────────────────────────────────
// A dragon is a KINGDOM-wide effect: `kdEffects.dragon` holds the type name
// (empty string when none) and `kdEffects.dragonDuration` the ticks left.
// Only two of the five touch income or wages:
//   Ruby   +20% Military Wages
//   Topaz  −25% Income
// Matched case-insensitively as a SUBSTRING of the reported name, because the
// IS may report either "Ruby" or "Ruby Dragon" — the field was empty in every
// dump captured so far, so the exact form is UNCONFIRMED. Substring matching
// makes both work; if a live dragon ever reads as something else entirely, the
// Economy tab shows "🐉 <name> — no economy effect" rather than silently
// dropping it, which is the signal to fix this table.
// NOT applied here: Topaz's −25% Building Efficiency (already inside `sot.be`,
// same rule as Dwarf), Ruby's −12.5% Military Effectiveness (inside
// som.ome/dme — and note MIL_EFF_* above already mentions it as a reason the
// wage-rate inversion is clamped), and Amethyst / Emerald / Sapphire, which
// have no income or wage term at all.
const DRAGON_ECON = {
  ruby:  { wageMult:   1.20 },
  topaz: { incomeMult: 0.75 },
};

// The Plague's income term (utopiawiki "The Plague": "−15% Income (applied as
// −15% Tax Collection)"). The AGE 116 FINAL CHANGES doc does not touch it, so
// the wiki value stands for this age. Plague's other effects are already
// handled or out of scope: −15% DME / −10% OME are inside the reported
// som.dme/ome, "no population growth" and "−10% prisoners each tick" change
// future ticks rather than this tick's income (sot.peasants/prisoners are
// already the current counts).
// APPLIED TO OUR OWN KINGDOM ONLY (economy.js `ctx.plague`) — `sot.plague` is a
// snapshot boolean with no timer, and plague is usually cured on the spot with
// Nature's Blessing, so on a hours- or days-old enemy SoT it would show income
// permanently lower than it really is.
const PLAGUE_INCOME_MULT = 0.85;
// Races immune to the plague's EFFECTS. Age 116: Undead has Plague Immunity and
// "always carries Plague" — so an Undead province reads as plagued on every SoT
// while taking no income hit. Without this every Undead province would be
// permanently and wrongly docked 15%.
const RACE_PLAGUE_IMMUNE = { undead: true };

// ── Incite Riots (Age 116) ───────────────────────────────────────────────────
// Thievery op, −20% income for the duration (AGE 116 FINAL CHANGES: was −15%;
// the age doc wins over the wiki). It is the last unmodelled term in the wiki's
// Modified Income formula.
//
// TIMING is what makes it modellable at all. One tick = one real hour = one
// in-game day, and the op's duration is capped at 18 in-game days — so a riot
// can never be older than 18 real hours, which fits INSIDE the ~24h window the
// IS KingdomOps endpoint returns. Enemy riots are therefore read off our own op
// log (economy.js `_riotsFromOps`), with no Firestore read and no guessing
// about ops we cannot see. Riots on OUR provinces come from the province's own
// SoT instead (`_riotsFromSot`) — the enemy's ops are not in our log.
//
// The duration itself scales with the thieves sent and NOTHING WE RECEIVE
// REPORTS IT: the op log has no duration field (`damage` is deliberately not
// read as one — a value in range would be indistinguishable from a real
// duration and silently wrong). So an enemy riot is assumed to last
// RIOTS_TICKS_ASSUMED ticks from the tick it landed, and every enemy riot chip
// says "est". Change this ONE constant when the real figure is known.
const RIOTS_INCOME_MULT   = 0.80;
const RIOTS_MAX_TICKS     = 18;   // game cap on the duration, in ticks (= real hours)
const RIOTS_TICKS_ASSUMED = 12;   // ESTIMATE — see above. Enemy side only.
// How a riot announces itself in `sot.badSpells`. UNVERIFIED against a live SoT
// with riots on it — no capture so far has had one — so the match is a loose
// prefix ("Riots", "Rioting", "Incite Riots" all hit) and economy.js logs the
// badSpells names it sees once per session (`_riotsSotProbe`) to pin the real
// wording down. The word boundary is not decoration: a bare /riot/ also matches
// PATRIOTISM, which is a self-buff and would have flagged half the kingdom as
// rioting the moment it turned up in the wrong array.
const RIOTS_SOT_RE = /\briot/i;
// Ticks-left field on a badSpells entry, in the order they are tried. Also
// unverified: the shape of a badSpells entry beyond `name` is unknown, so every
// plausible key is checked and a missing one just means "active, no timer".
const RIOTS_SOT_TICK_KEYS = ['duration', 'ticks', 'ticksLeft', 'ticksRemaining',
                             'daysRemaining', 'remaining', 'days', 'length'];
// Personalities immune to the riots income hit. Age 116: Artisan is immune to
// Greed / Incite Riots / Fool's Gold — the immunity the race/pers audit noted as
// "only matters once those ops are modeled". Riots is now modeled, so it does.
const PERS_RIOTS_IMMUNE = { artisan: true };

const RACE_INCOME_MULT       = { human: 1.30 };            // Human +30% Income
const RACE_WAGE_MULT         = { human: 1.25, avian: 0.75 };  // +25% / −25% Military Wages
const RACE_PRISONER_EXTRA_GC = { human: 2.0 };             // Civil Administration
const PERS_INCOME_MULT       = {};                 // none this age
const PERS_WAGE_MULT         = {};                 // none this age
const PERS_BANK_PROD_MULT    = { artisan: 1.25 };  // +25% Building Production (Banks)
const PERS_HONOR_MULT        = { 'war hero': 2 };  // +100% Honor Effects

// Race WAR DOCTRINE effects that the economy model applies itself. Doctrines
// are kingdom-wide and active only AT WAR; strength scales with the kingdom's
// same-race province count (WAR_DOCTRINES / _wdStrength). Unlike OME/DME there
// is nothing to double-count here — wages are computed by this tool, not read
// off the API — so a doctrine wage cut has to be applied or it is simply
// missing. Matched by the doctrine effect's label.
//   Age 116: Avian "up to −12.5% Military Wage Cost to you and your kingdom".
const WD_ECON_WAGE_LABEL = 'Military Wage';
// Honor income % by title (cumulative; War Hero's +100% Honor Effects doubles it)
const HONOR_INCOME_PCT = {
  peasant: 0, knight: 2, lady: 2, lord: 4, 'noble lady': 4,
  baron: 6, baroness: 6, viscount: 8, viscountess: 8, count: 12, countess: 12,
  marquis: 16, marchioness: 16, duke: 20, duchess: 20, prince: 24, princess: 24,
};

// TM land-gain estimate (_estimateTMGain in tabs/player.js). Piecewise curves +
// modifier factors, all game-tuned. rawGain = tLand × BASE_PCT × rpnwF × rknwF
// × relF × mapF × castleF × ritualF × raceF × persF, floored at tLand × MIN_PCT
// and capped at min(ownLand,tLand) × CAP_PCT.
//
// Wiki gains formula (verified 2026-08-10):
//   Gains = TargetResource × AttackType% × RPNW × RKNW × Multi-Attack Protection
//         × Race × Personality × Castles × Relations × Stance × Siege Science
//         × Emerald Dragon × Attack Time Adjustment × Ritual × Anonymity × Mist
// MODELLED here: AttackType (BASE_PCT), RPNW, RKNW, MAP (MAP_F), Race, Personality,
//   Castles, Relations/Stance at war (WAR_F), Ritual.
// NOT modelled (estimates run low/high when these are in play): Stance, Siege
//   Science, Emerald Dragon, Attack Time Adjustment (arriving late is a real
//   gains bonus), Anonymity, Mist, and the enemy Undead war doctrine
//   (-12.5% enemy battle gains, scales with their Undead province count).
const TM_GAIN = {
  BASE_PCT: 0.12,          // base share of target land taken
  CAP_PCT:  0.20,          // hard cap vs the smaller of the two lands
  // Out-of-range floor. The published formula makes the RPNW factor exactly 0
  // outside 0.567-1.6, i.e. no acres at all — but in practice a successful land
  // attack ALWAYS nets something (leader-reported, 2026-08-10). Modelled as a
  // minimum share of the target's land, still subject to CAP_PCT.
  // UNVERIFIED VALUE — tune this from real out-of-range hit results.
  MIN_PCT:  0.005,
  // Relative province NW (target/attacker) → gain factor (piecewise linear):
  //   [FLOOR,LOW_MAX): LOW_SLOPE·r + LOW_INT · [LOW_MAX,HIGH_MIN]: flat 1
  //   (HIGH_MIN,CEIL]: HIGH_SLOPE·r + HIGH_INT · else 0
  RPNW: { FLOOR: 0.567, LOW_MAX: 0.9, HIGH_MIN: 1.1, CEIL: 1.6,
          LOW_SLOPE: 3, LOW_INT: -1.7, HIGH_SLOPE: -2, HIGH_INT: 3.2 },
  // Relative kingdom NW (enemyKdAvg/ownKdAvg) → gain factor:
  //   < LOW: LOW_F · [LOW,MID): MID_SLOPE·r + MID_INT · ≥ MID: 1
  RKNW: { LOW: 0.5, MID: 0.9, LOW_F: 0.8, MID_SLOPE: 0.5, MID_INT: 0.55 },
  // Target map ("science")-based reduction: none/"Not much"=1.0.
  MAP_F: { LITTLE: 0.90, LOTS: 0.80 },
  CASTLE_MULT: 2.25,       // castleF = max(0, 1 − castlePct/100 × CASTLE_MULT)
  // War stance/relations bonus: attacking at WAR gives +10% gains. The wave
  // planner ALWAYS assumes war — it only ever plans war attacks. (For
  // reference: out of war it is a penalty instead, raised to -15% in Age 116,
  // i.e. OOW_F below — not used by the planner.)
  WAR_F: 1.10,
  OOW_F: 0.85,             // out-of-war gains penalty (Age 116) — reference only
  RITUAL_FLOOR: 0.5,       // floor for an enemy protection-ritual reduction
  RITUAL_DEFAULT_EFF: 15,  // assumed ritual effectiveness % when unknown
};

// Attacker race/personality battle-gain modifiers ("Race Modifier" and
// "Personality Modifier" in the wiki gains formula). WAR values — the wave
// planner only ever plans war attacks. UPDATE EVERY AGE.
//   Age 116: Orc +10% gains OOW / +15% in war; War Hero +10% battle gains (war only).
const RACE_GAIN_MULT = { 'orc': 1.15 };
const PERS_GAIN_MULT = { 'war hero': 1.10 };

// ── Age 116 unit stats: [offense, defense] per unit ──────────────────────────
// Used to subtract withheld-elite offense from sot.offPoints and to compute
// per-army offense for wave slots (units × values × ome). UPDATE EVERY AGE.
const RACE_UNITS = {
  'avian':    { soldier: [3,0], ospec: [12,0], dspec: [0,10], elite: [16,2],  horse: [0,0] }, // no war horses
  'dark elf': { soldier: [3,0], ospec: [14,0], dspec: [0,12], elite: [16,2],  horse: [2,0] },
  'dryad':    { soldier: [3,0], ospec: [10,0], dspec: [0,11], elite: [16,3],  horse: [2,0] },
  'dwarf':    { soldier: [3,0], ospec: [10,0], dspec: [0,10], elite: [15,7],  horse: [2,0] },
  'elf':      { soldier: [3,0], ospec: [10,0], dspec: [0,13], elite: [14,4],  horse: [2,0] },
  'faery':    { soldier: [3,0], ospec: [10,0], dspec: [0,10], elite: [4,16],  horse: [2,0] },
  'halfling': { soldier: [3,0], ospec: [11,0], dspec: [0,10], elite: [10,13], horse: [2,0] },
  'human':    { soldier: [3,0], ospec: [15,0], dspec: [0,12], elite: [15,5],  horse: [3,0] },
  'orc':      { soldier: [3,0], ospec: [13,0], dspec: [0,10], elite: [18,3],  horse: [2,0] },
  'undead':   { soldier: [3,0], ospec: [11,0], dspec: [0,10], elite: [16,4],  horse: [2,0] },
};

// Unit-strength bonuses that raise a unit's OFFENSE value ("Affects NW", so the
// game already folds them into sot.offPoints / offPointsHome). They matter here
// ONLY where the tool REBUILDS offense from raw unit counts — the withheld-elite
// subtraction and the per-army wave slots (_wpUnitsOff) — so those match the API
// total. NEVER add them on top of offPoints/offPointsHome (that double-counts).
// UPDATE EVERY AGE.
//
// Elite offense (Age 116):  The General +2.
const PERS_ELITE_OFF_BONUS = { 'general': 2 };
// Offensive-specialist offense (Age 116):  The War Hero +2 (always active).
const PERS_OSPEC_OFF_BONUS = { 'war hero': 2 };
// Race ospec bonuses that apply ONLY in war. The wave planner always plans war
// attacks, so these are treated as active in the offense split.
//   Avian "Dive Bomb": +2 offensive-specialist offense (war only).
const RACE_WAR_OSPEC_OFF_BONUS = { 'avian': 2 };
// (Defensive personality bonuses — Cleric +1 elite def / +1 dspec — are not used
//  by the offense model; the game already reflects them in defPointsHome.)

// ── Race war doctrines (Age 116) ─────────────────────────────────────────────
// A kingdom-wide bonus each race grants WHILE AT WAR. Strength scales with how
// many provinces of that race you have: 1st province +2.0%, each additional +1%
// (Elf/Faery/Halfling +2%), capped per effect (global cap 12.5%). Each effect's
// `cap` is its "up to" ceiling from the FINAL doc.
// DISPLAY-ONLY in this tool: while at war the API's som.ome/som.dme already
// include the active doctrine, so this NEVER feeds the offense math (only Orc's
// OME would, and it is already inside som.ome). UPDATE EVERY AGE.
const WAR_DOCTRINE_FIRST     = 2.0;    // % from the 1st province of a race
const WAR_DOCTRINE_MAX       = 12.5;   // global strength cap
const WAR_DOCTRINE_PER_EXTRA = { elf: 2, faery: 2, halfling: 2 };  // per extra prov (else 1)
const WAR_DOCTRINES = {
  'avian':    { effects: [{ label: 'Attack Time',       sign: '-', cap: 10   }, { label: 'Military Wage',      sign: '-', cap: 12.5 }] },
  'dark elf': { effects: [{ label: 'Instant Spell Dmg', sign: '+', cap: 12.5 }, { label: 'Rune Cost',          sign: '-', cap: 12.5 }] },
  'dryad':    { effects: [{ label: 'DME',               sign: '+', cap: 10   }, { label: 'Def Casualties',     sign: '-', cap: 12.5 }] },
  'dwarf':    { effects: [{ label: 'Construction Cost', sign: '-', cap: 12.5 }, { label: 'Building Eff',       sign: '+', cap: 12.5 }] },
  'elf':      { effects: [{ label: 'Enemy Sorcery Dmg', sign: '-', cap: 12.5 }, { label: 'Spell Duration',     sign: '+', cap: 12.5 }] },
  'faery':    { effects: [{ label: 'Def WPA',           sign: '+', cap: 12.5 }, { label: 'Enemy Thievery Dmg', sign: '-', cap: 12.5 }] },
  'halfling': { effects: [{ label: 'Sabotage Dmg',      sign: '+', cap: 12.5 }, { label: 'Thief Losses',       sign: '-', cap: 12.5 }] },
  'human':    { effects: [{ label: 'Spec Credit Gains', sign: '+', cap: 12.5 }, { label: 'Training Cost',      sign: '-', cap: 12.5 }] },
  'orc':      { effects: [{ label: 'OME',               sign: '+', cap: 10   }, { label: 'Raze Dmg',           sign: '+', cap: 12.5 }], offense: true },
  'undead':   { effects: [{ label: 'Enemy Battle Gains',sign: '-', cap: 12.5 }, { label: 'Plague Spread',      sign: '+', cap: 12.5 }] },
};

const CSS = `
#__wp_overlay{position:fixed;inset:0;z-index:2147483647;background:#2b3333;color:#ffffff;font-family:Rajdhani,sans-serif;font-size:19px;display:flex;flex-direction:column;overflow:hidden}
#__wp_overlay *{box-sizing:border-box;margin:0;padding:0}
#__wph{background:#2b3333;border-bottom:1px solid #617070;height:58px;display:flex;align-items:center;padding:0 24px;gap:12px;flex-shrink:0}
#__wph .logo{font-family:Rajdhani,sans-serif;font-size:22px;font-weight:700;color:#ffd400;letter-spacing:2px;flex:1}
.wb{padding:7px 16px;background:#2b3333;border:1px solid #617070;color:#b8c8c8;font-size:17px;font-weight:700;cursor:pointer;border-radius:3px;transition:all .15s}
.wb:hover{border-color:#ffd400;color:#ffd400}
.wb.g{border-color:#2a6614;color:#60C040}.wb.g:hover{background:rgba(96,192,64,.1)}
.wb.r{border-color:#8B1414;color:#E05050}.wb.r:hover{background:rgba(224,80,80,.1)}
#__wpnwpanel{background:#1e2a2a;border-bottom:2px solid #4a6060;padding:10px 24px;display:none;align-items:center;gap:10px;flex-wrap:wrap;flex-shrink:0}
#__wpnwpanel .wnwlabel{font-size:14px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#7a9090;white-space:nowrap}
.wnwlink{color:#7adcdc;font-size:16px;font-weight:600;text-decoration:none;padding:5px 11px;border:1px solid #4a6060;border-radius:3px;transition:all .15s;white-space:nowrap}
.wnwlink:hover{border-color:#7adcdc;background:rgba(122,220,220,.08)}
.wnwlink.wv{color:#60C040;border-color:#2a6614}
#__wpnwpanel .wdiv{width:1px;height:24px;background:#4a6060;flex-shrink:0}
#__wptb{background:#2b3333;border-bottom:1px solid #617070;display:flex;padding:0 24px;flex-shrink:0;gap:4px}
.wt{padding:14px 22px;font-size:17px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#7a9090;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .15s}
.wt:hover{color:#b8c8c8}.wt.on{color:#ffd400;border-bottom-color:#ffd400}.wt.ong{color:#60C040;border-bottom-color:#60C040}
#__wptl{background:#2b3333;border-bottom:1px solid #617070;padding:10px 24px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;flex-shrink:0}
.wkb{background:#3c4545;border:1px solid #617070;border-radius:3px;padding:7px 14px;font-size:17px}
.wkb .l{color:#7a9090;font-size:17px;font-weight:700;letter-spacing:1px;text-transform:uppercase;display:block;margin-bottom:2px}
.wkb .v{color:#ffffff;font-weight:600;font-size:21px}.wkb .va{color:#ffd400;font-size:21px}
.wsav{font-size:17px;color:#7a9090}
.wsav.ok{color:#60C040}.wsav.err{color:#E05050}.wsav.ing{color:#e09040}
#__wpbd{flex:1;overflow-y:auto;padding:20px 24px;position:relative}
.webar{display:flex;align-items:center;gap:12px;margin-bottom:16px;background:#3c4545;border:1px solid #617070;border-radius:4px;padding:12px 16px}
.webar label{font-size:17px;font-weight:700;color:#7a9090;letter-spacing:1px;text-transform:uppercase;white-space:nowrap}
.webar input{background:#2b3333;border:1px solid #617070;color:#ffffff;font-size:19px;padding:6px 10px;border-radius:3px;width:80px;outline:none}
.webar input:focus{border-color:#ffd400}
.wtag{display:inline-block;font-size:17px;padding:2px 6px;border-radius:2px;background:#7a6500;color:#ffd400;border:1px solid rgba(255,212,0,.3);cursor:pointer;margin:1px}
.wtag:hover{background:rgba(224,80,80,.15);color:#E05050}
.wops{position:absolute;right:0;top:0;bottom:0;width:340px;background:#3c4545;border-left:1px solid #617070;transform:translateX(100%);transition:transform .2s;display:flex;flex-direction:column;overflow:hidden}
.wops.open{transform:none}
.wopsh{padding:14px 18px;border-bottom:1px solid #617070;display:flex;align-items:center;justify-content:space-between}
.wopsh h3{font-size:19px;color:#ffd400;letter-spacing:1px}
.wopsb{flex:1;overflow-y:auto;padding:14px 18px}
.wopsec{font-size:17px;font-weight:700;color:#7a9090;letter-spacing:1px;text-transform:uppercase;margin:12px 0 8px}
.wopsg{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}
.wop{padding:7px 4px;background:#2b3333;border:1px solid #617070;color:#b8c8c8;font-size:17px;cursor:pointer;border-radius:2px;text-align:center;transition:all .12s}
.wop:hover{border-color:#ffd400;color:#ffd400}
.wop.sel{background:rgba(255,212,0,.12);border-color:#ffd400;color:#ffd400}
.wop.i:hover{border-color:#c87030;color:#e09040}
.wop.i.sel{background:rgba(200,112,48,.12);border-color:#c87030;color:#e09040}
.wsb{background:#2b3333;border:1px solid #617070;border-radius:3px;padding:9px 11px;margin-bottom:8px}
.wsb .l{font-size:17px;font-weight:700;color:#7a9090;letter-spacing:1px;text-transform:uppercase}
.wsb .v{font-size:21px;color:#ffd400}
.waf{color:#60C040}.was{color:#ffd400}.waw{color:#e09040}.wao{color:#E05050}
.walt{display:flex;align-items:flex-start;gap:12px;padding:12px 16px;border-radius:3px;border:1px solid #617070;margin-bottom:5px;font-size:19px}
.wabg{font-size:17px;font-weight:700;padding:3px 8px;border-radius:2px;white-space:nowrap;flex-shrink:0;margin-top:1px}
.wau{background:rgba(160,30,30,.2);color:#f08080;border:1px solid #8B1414}
.waw2{background:rgba(180,100,20,.2);color:#e09040;border:1px solid #c87030}
.wai{background:rgba(40,80,160,.12);color:#80a8f0;border:1px solid #304880}
.wsum{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:18px}
.wscard{background:#3c4545;border:1px solid #617070;border-radius:4px;padding:14px 16px}
.wscard .l{font-size:17px;font-weight:700;color:#7a9090;letter-spacing:1px;text-transform:uppercase;margin-bottom:5px}
.wscard .v{font-size:26px;color:#ffd400}
.wscard .s{font-size:17px;color:#7a9090;margin-top:3px}
.wtbl{width:100%;border-collapse:collapse;font-size:19px;background:#3c4545;border:1px solid #617070;border-radius:4px;overflow:hidden}
.wtbl th{background:#2b3333;padding:9px 12px;text-align:left;font-size:15px;font-weight:700;color:#7a9090;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #617070}
.wtbl td{padding:9px 12px;border-bottom:1px solid rgba(97,112,112,.3)}
.wtbl tr:last-child td{border-bottom:none}
.wtbl tr:hover td{background:rgba(255,212,0,.04)}
.wmatch{font-size:17px;padding:3px 9px;border-radius:2px;display:inline-block;margin:2px}
.wmyes{background:rgba(96,192,64,.12);color:#60C040;border:1px solid #2a6614}
.wmno{background:rgba(160,30,30,.12);color:#E05050;border:1px solid #8B1414}
.wmcl{background:rgba(180,100,20,.12);color:#e09040;border:1px solid #c87030}
.wrole{display:flex;gap:8px;align-items:center}
.wrole span{font-size:17px;color:#7a9090;font-weight:700;letter-spacing:1px;text-transform:uppercase}
.wpick{background:#2b3333;border:1px solid #617070;color:#ffffff;font-size:19px;padding:6px 10px;border-radius:3px;outline:none;cursor:pointer;max-width:200px}
.wpick:focus{border-color:#ffd400}
.watk-card{background:#3c4545;border:1px solid #617070;border-radius:4px;margin-bottom:14px;overflow:hidden}
.watk-header{padding:14px 18px;border-bottom:1px solid #617070;background:#2b3333;display:flex;align-items:center;justify-content:space-between}
.watk-wave{font-size:17px;color:#ffd400;letter-spacing:1px}
.watk-body{padding:0}
.watk-row{display:flex;align-items:center;padding:12px 18px;border-bottom:1px solid rgba(97,112,112,.3);gap:14px}
.watk-row:last-child{border-bottom:none}
.watk-num{font-size:26px;font-weight:700;color:#ffd400;width:32px;flex-shrink:0;text-align:center}
.watk-main{flex:1;min-width:0}
.watk-target{font-size:21px;font-weight:700;color:#ffffff;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.watk-detail{font-size:19px;color:#7a9090;line-height:1.6}
.watk-gen{display:flex;flex-direction:column;align-items:center;flex-shrink:0;text-align:center}
.watk-gen-num{font-size:32px;font-weight:700;line-height:1}
.watk-gen-label{font-size:17px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#7a9090;margin-top:2px}
.watk-result{font-size:17px;padding:4px 10px;border-radius:2px;text-align:center;flex-shrink:0}
.watk-yes{background:rgba(96,192,64,.12);color:#60C040;border:1px solid #2a6614}
.watk-cl{background:rgba(180,100,20,.12);color:#e09040;border:1px solid #c87030}
.watk-no{background:rgba(160,30,30,.12);color:#E05050;border:1px solid #8B1414}
.watk-ops{margin-top:5px;display:flex;flex-wrap:wrap;gap:4px}
.watk-task{margin-top:6px;padding:5px 8px;background:rgba(224,80,80,.07);border:1px solid rgba(224,80,80,.22);border-radius:2px;display:flex;align-items:center;gap:8px;font-size:17px}
.watk-task.claimed{background:rgba(255,212,0,.06);border-color:rgba(255,212,0,.22)}
.watk-claim{display:flex;align-items:center;gap:5px;margin-left:auto;cursor:pointer}
.watk-summary{background:#2b3333;border:1px solid #617070;border-radius:4px;padding:16px 18px;margin-bottom:18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}
.watk-sstat .l{font-size:17px;font-weight:700;color:#7a9090;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px}
.watk-sstat .v{font-size:22px;color:#ffd400}
.watk-sstat .s{font-size:17px;color:#7a9090;margin-top:2px}
.watk-noprov{color:#7a9090;font-size:19px;padding:30px 0;text-align:center}
.watk-notarget{background:#3c4545;border:1px solid #617070;border-radius:4px;padding:24px;text-align:center;color:#7a9090;font-size:19px}
.wspin{display:inline-block;width:32px;height:32px;border:2px solid #617070;border-top-color:#ffd400;border-radius:50%;animation:__wpspin .7s linear infinite}
.wload{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:200px;gap:14px;color:#7a9090;font-size:19px;letter-spacing:1px}
.wsech{font-size:17px;color:#7a9090;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;margin-top:20px;padding-bottom:8px;border-bottom:1px solid #617070}
.wthr{background:#3c4545;border:1px solid #617070;border-radius:4px;padding:16px 18px;margin-bottom:18px}
.wthr-title{font-size:17px;font-weight:700;color:#7a9090;letter-spacing:2px;text-transform:uppercase;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between}
.wthr-title span{color:#e09040;font-size:17px;font-weight:400;letter-spacing:0;text-transform:none}
.wthr-row{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.wthr-row:last-child{margin-bottom:0}
.wthr-label{font-size:19px;font-weight:700;color:#ffffff;width:60px;flex-shrink:0}
.wthr-input{background:#2b3333;border:1px solid #617070;color:#ffffff;font-size:19px;padding:6px 10px;border-radius:3px;width:120px;outline:none}
.wthr-input:focus{border-color:#ffd400}
.wthr-hint{font-size:19px;color:#7a9090;flex:1}
.writ-badge{position:relative;cursor:pointer;transition:border-color .15s;padding:6px 14px;border-radius:3px;border:1px solid}
.writ-badge:hover{border-color:#7a6500!important}
.writ-drop{position:absolute;top:calc(100% + 8px);left:0;z-index:99999;background:#3c4545;border:1px solid #617070;border-radius:4px;padding:14px 16px;min-width:240px;box-shadow:0 8px 24px rgba(0,0,0,.8)}
.writ-drop-title{font-size:21px;color:#ffd400;letter-spacing:1px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #617070}
.writ-drop-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:19px}
.writ-drop-row:last-child{margin-bottom:0}
.writ-drop-l{color:#7a9090;font-size:17px;font-weight:700;letter-spacing:1px;text-transform:uppercase}
#__wprit{display:flex;gap:10px;align-items:center}
@keyframes __wpspin{to{transform:rotate(360deg)}}
/* ── Attack type badges ─────────────────────────────────────────────────── */
.watk-type{font-size:13px;padding:2px 7px;border-radius:2px;font-weight:700;letter-spacing:1px;text-transform:uppercase;display:inline-block;margin-right:4px}
.watk-type-tm{background:rgba(40,80,160,.15);color:#80a8f0;border:1px solid #304880}
.watk-type-rz{background:rgba(200,112,48,.18);color:#e09040;border:1px solid #c87030}
.watk-type-ms{background:rgba(160,30,30,.18);color:#E05050;border:1px solid #8B1414}
/* ── Attack source badges ───────────────────────────────────────────────── */
.watk-src{font-size:13px;padding:2px 7px;border-radius:2px;font-weight:700;letter-spacing:1px;text-transform:uppercase;display:inline-block;margin-right:4px}
.watk-src-a{background:rgba(255,212,0,.08);color:#ffd400;border:1px solid rgba(255,212,0,.3)}
.watk-src-p{background:rgba(97,112,112,.12);color:#7a9090;border:1px solid #617070}
/* ── Bloat row tint (board table) ───────────────────────────────────────── */
.wp-bloat-row{background:rgba(100,60,130,.07)!important}
/* ── Assignment picker ──────────────────────────────────────────────────── */
.wp-assign-wrap{position:relative;display:inline-block;vertical-align:top}
.wp-assign-btn{cursor:pointer;font-size:15px;padding:3px 8px;border:1px solid #617070;border-radius:3px;background:#2b3333;color:#7a9090;white-space:nowrap;min-width:60px;display:block}
.wp-assign-btn:hover{border-color:#ffd400;color:#b8c8c8}
.wp-assign-drop{position:absolute;z-index:9999;background:#3c4545;border:1px solid #617070;border-radius:4px;padding:6px;min-width:200px;box-shadow:0 6px 20px rgba(0,0,0,.8);top:calc(100% + 2px);left:0}
.wp-assign-drop-hd{display:flex;align-items:center;justify-content:space-between;padding:3px 5px 7px;border-bottom:1px solid #617070;margin-bottom:5px}
.wp-assign-item{display:flex;align-items:center;gap:8px;padding:5px 7px;cursor:pointer;font-size:17px;border-radius:2px;color:#b8c8c8}
.wp-assign-item:hover{background:rgba(255,212,0,.08)}
.wp-assign-item input{cursor:pointer;accent-color:#ffd400;width:14px;height:14px;flex-shrink:0}
`;
