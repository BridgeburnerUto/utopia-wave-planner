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
  wpId: null,       // warPlanId from IS API
  cols: [],         // kanban columns [{title, items:[{id, province:{name,race,slot,requiredOps,notes}}]}]
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
  nwView: 'total',       // NW graph view: 'total'|'war'  // leaderboard sort: 'damage'|'ops'|'gain'
  lbFilter: {
    mode: 'all',       // 'all' | 'war' | 'custom'
    fromYear: null,    // in-game year number (e.g. 1 for YR1)
    fromMonth: null,   // 1-12
    toYear: null,
    toMonth: null,
  },
};
