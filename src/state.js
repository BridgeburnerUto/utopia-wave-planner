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
  provinces: {},    // war plan per province: {[slot]: {wave, needsRaze, needsMassacre, requiredOps, notes}}
                    // wave: null | 'current' | 'preplan'
  eLoc: '5:3',      // current enemy location string
  thresholds: {
    // Enemy thresholds
    enemyFoodRich:  0,   // above X → steal/vermin target
    enemyFoodLow:   0,   // below X → starvation risk (vermin+drought+gluttony)
    enemyGcRich:    0,   // above X → fools gold/steal target
    enemyRunesRich: 0,   // above X → lightning strike/steal target
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
};
