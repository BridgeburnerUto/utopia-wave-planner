// ── STATE ──────────────────────────────────────────────────────────────────
// Single mutable state object shared across all modules.
// Add new fields here when features need persistent in-memory state.
// Never create module-local state that other modules need to read.

const S = {
  // Auth / server
  token: null,      // set during bootstrap
  server: 1,        // set during bootstrap

  // Loaded data
  own: null,        // OwnKingdom response
  enemy: null,      // EnemyKingdom response

  // War plan
  // wpId removed — war plan now stored directly in Firestore (warplan/{kdId})
  cols: [],         // LEGACY kanban columns (kept for migration only)
  provinces: {},    // war plan per province: {[slot]: {wave, needsRaze, needsMassacre, requiredOps,
                    //   notes, bloat, targetAcres (chain goal), shrink (0-3 shrink-wave hits)}}
                    // wave: null | 'current' | 'preplan'
  eLoc: '5:3',      // current enemy location string
  thresholds: {
    // Enemy thresholds
    enemyFoodRich:  0,   // above X → steal/vermin target
    enemyFoodLow:   0,   // below X → starvation risk (vermin+drought+gluttony)
    enemyGcRich:    0,   // above X → fools gold/steal target
    enemyRunesRich: 0,   // above X → lightning strike/steal target
    solds:          0,   // above X → soldier stack — nightmares/meteor showers target
    // Own kingdom thresholds
    ownFoodLow:     0,   // below X → send aid alert
    ownPeasLow:     0,   // below X → beware alert
  },

  // UI state
  tab: 'board',
  drag: null,       // {ci, ii} during drag
  openSlot: null,   // {ci, ii} for ops panel
  role: 'leader',   // 'leader' | 'player'
  playerProv: null, // selected own province object
  lbView: 'damage',
  currentTickName: null, // e.g. "July 18, YR1" — used for ritual expiry calc
  snLastAck: 0,          // real timestamp of last Snatch News acknowledgement
  nwView: 'total',
  econView: 'enemy',  // Economy tab KD switch — enemy econ matters most in war
  nwLocA: '',         // KD A location for world NW graph (defaults to own on first open)
  nwLocB: '',         // KD B location for world NW graph (defaults to enemy on first open)
  nwLookback: 24,     // lookback in hours/ticks for world NW graph (preset mode)
  nwCustom: false,    // true = custom in-game date range active
  nwCustomFrom: null, // { month, day, year } in-game date
  nwCustomTo:   null, // { month, day, year } in-game date
  ageStartDate: 0,    // Unix ms — when current age started; GitHub Actions cleans data before this
  kddbAge:       '',             // current age string e.g. "a114" — persisted in localStorage
  intelSort:     { col: 'slot', dir: 1 },
  boardSort:     { col: 'slot', dir: 1 },
  discordWebhook: '',    // Discord webhook URL — saved with war plan
  apiEndpoint:    '',    // Cloud Run backend URL for mobile companion sync
  apiKey:         '',    // API key matching WP_API_KEY env var on Cloud Run
  lastBackendSync: null, // Date of last successful IS dump POST (runtime only)
  lastBackendError: '',  // Error message from last failed sync (runtime only)
  _warFromNews: null,    // cached war status from kingdomNews scan (null=uncached)
  _kdNewsCache: null,    // cached latest kd_news record from backend (null=not yet loaded)
  _kdNewsLoading: false, // true while fetchBackendNews() is in flight
  intelInterval: 24,     // Intel tab: lookback window (ticks) for news stats
  maxGainMode:  false,   // My Orders: true = show max-gain plan instead of wave plan

  // leaderboard sort: 'damage'|'ops'|'gain'
  lbFilter: {
    mode: 'all',       // 'all' | 'war' | 'custom'
    fromYear: null,    // in-game year number (e.g. 1 for YR1)
    fromMonth: null,   // 1-12
    toYear: null,
    toMonth: null,
  },
  lbOpFilter: 'all',   // 'all' | opType string e.g. 'ns', 'fb' — filters province table to one op type

  lbSection: 'ops',    // Leaderboard tab section: 'ops' | 'dragon'
  drgMetric: 'gc',     // Dragon board metric: 'gc' (fund gold) | 'food' | 'slay' (damage)
  drgSort:   'total',  // Dragon board ranking: 'total' | 'acre' | 'nw'
  drgRange:  'all',    // Dragon board time filter: 'all' | 'c<N>' (campaign index) | 'custom'
  drgFrom:   '',       // custom range start, YYYY-MM-DD ('' = open-ended)
  drgTo:     '',       // custom range end,   YYYY-MM-DD ('' = open-ended)
  drgHave:   null,     // Set of event ids known to be mirrored into Firestore — session cache so the 2-min sync does not re-read the whole collection (quota)
  drgHaveKd: '',       // kingdom the drgHave cache belongs to
  drgHaveComplete: false, // true when drgHave was built from a COMPLETE read of the collection (so it can be trusted to decide what needs mirroring)
  drgMirrorMark: null, // {minTs, maxTs, n} from meta/{kdId}_dragon_mirror — what has already been mirrored, so a fresh session costs 1 read instead of the whole collection
  drgMirrorKd:   '',   // kingdom the mirror mark belongs to
  drgMarkWroteAt: 0,   // last time the mark DOC was persisted — throttled, the in-memory window advances every pull
  _nwCleanedAt:  0,    // last nw_snapshots cleanup sweep (runs from init; without this it re-read the collection every load)
  nwLegacyDrained: false, // meta/nw_cleanup.legacyDrained — set by the snapshot Action once kd_nw_history is empty; the NW graph then stops querying it entirely

  fbLastError: '',         // last Firestore read failure, e.g. quota exhausted — surfaced by the tabs that read it

  // ── Firestore quota accounting (firebase.js) ───────────────────────────────
  // Free tier is a DAILY bucket (50k reads / 20k writes). Nothing warned when
  // reads ran hot before, so a runaway took a day to spot — these counters feed
  // the header meter and name the heaviest source in its tooltip.
  fbReads:   0,            // documents read this session
  fbWrites:  0,            // documents written this session
  fbReadLog: {},           // source → documents read, for the meter tooltip
  fbReadWarned: false,     // console warning already emitted for this session
  fbMissingIndex: '',      // console URL from the last "needs a composite index" 400
  fbNoIndex: {},           // 'collection|orderBy' → true once the bounded form is known to lack an index

  oldisEcon: {},           // exact wage rates from the OLD IS board, {[loc]: {provs: {[slot]: {wagePct, ...}}, updatedAt}} — meta/oldis_econ_{loc}, written by scripts/oldis-collector.js

  locLock: null,           // kingdom location lock — allowed enemy location from meta/{kdId}_loc_lock (null = no lock)
  locLockOverride: false,  // user confirmed working past a lock mismatch (this session only)
  _locLockWarned: false,   // mismatch confirm dialog already shown this session

  atkSettings: {},         // per-province attacker settings {[slot]: {elitePct, eliteCount?, setAt}} — shared via meta/{kdId}_atk_settings
  atkSettingsLoaded: false, // true once loadAtkSettings() has run (success or not)

  // Raw IS KingdomOps list from the last syncOps fetch (~24h window), kept so
  // the Economy tab can find the riots we incited without a Firestore read —
  // a riot lasts at most RIOTS_MAX_TICKS ticks, which is inside this window.
  recentOps:   null,   // array of raw IS ops, or null when never fetched
  recentOpsAt: 0,      // Unix ms of that fetch

  waveSeq: null,     // PUBLISHED wave sequence (array of hit objects) — persisted in war plan JSON
  waveDraft: null,   // generated-but-unpublished sequence (leader's working copy, session only)
  waveGenAt: 0,      // Unix ms when the draft/published seq was generated
  waveType: 'standard', // wave type: 'standard' | 'shrink' (leader-picked shrink targets)
                        // | 'shrinkai' (solver picks them) — see waveplan.js header

  aiStrategyResult: null, // cached result from AI Strategy analysis (null = not yet run)
  tmMatchupShowAll: false, // T/M Matchup: true = show all own provinces, false = T/M only
  tmMatchupOp: 'ns',      // T/M Matchup: active op id (see TM_OPS in tmmatchup.js)
};
