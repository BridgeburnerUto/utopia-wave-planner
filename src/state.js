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
  thresholds: { food: 0, gc: 0, runes: 0 },

  // UI state
  tab: 'board',
  drag: null,       // {ci, ii} during drag
  openSlot: null,   // {ci, ii} for ops panel
  role: 'leader',   // 'leader' | 'player'
  playerProv: null, // selected own province object
  lbView: 'damage', // leaderboard sort: 'damage'|'ops'|'gain'
};
