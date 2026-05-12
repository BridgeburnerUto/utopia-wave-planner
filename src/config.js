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
    'EXPLOSIONS','MYSTIC_VORTEX','NIGHTMARES','FOOLS_GOLD','PITFALLS',
    'CHASTITY','VERMIN','ABOLISH_RITUAL','SOUL_BLIGHT','MAGIC_WARD',
    'SLOTH','NIGHTFALL','AMNESIA',
  ]),
};

// Combined set of all ops we want to track on the leaderboard
// Anything NOT in this set gets skipped during syncOps
const TRACKED_OPS = new Set([...OP_SETS.THIEF_SAB, ...OP_SETS.OFFENSIVE_SPELL]);

const CSS = `
#__wp_overlay{position:fixed;inset:0;z-index:2147483647;background:#0a0c10;color:#c8d8e8;font-family:Rajdhani,sans-serif;display:flex;flex-direction:column;overflow:hidden}
#__wp_overlay *{box-sizing:border-box;margin:0;padding:0}
#__wph{background:#0f1218;border-bottom:1px solid #1e2d3d;height:48px;display:flex;align-items:center;padding:0 20px;gap:12px;flex-shrink:0}
#__wph .logo{font-family:monospace;font-size:16px;color:#00d4ff;letter-spacing:2px;flex:1}
.wb{padding:5px 12px;background:#151a22;border:1px solid #2a3f55;color:#7a9ab8;font-size:12px;font-weight:700;cursor:pointer;border-radius:3px;transition:all .15s}
.wb:hover{border-color:#00d4ff;color:#00d4ff}
.wb.g{border-color:#00cc66;color:#00ff88}.wb.g:hover{background:rgba(0,255,136,.1)}
.wb.r{border-color:#cc2233;color:#ff4455}.wb.r:hover{background:rgba(255,68,85,.1)}
#__wptb{background:#0f1218;border-bottom:1px solid #1e2d3d;display:flex;padding:0 20px;flex-shrink:0}
.wt{padding:10px 16px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#4a6a88;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .15s}
.wt:hover{color:#7a9ab8}.wt.on{color:#00d4ff;border-bottom-color:#00d4ff}.wt.ong{color:#00ff88;border-bottom-color:#00ff88}
#__wptl{background:#0f1218;border-bottom:1px solid #1e2d3d;padding:8px 20px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex-shrink:0}
.wkb{background:#151a22;border:1px solid #1e2d3d;border-radius:3px;padding:4px 10px;font-size:11px}
.wkb .l{color:#4a6a88;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase}
.wkb .v{color:#c8d8e8;font-weight:600}.wkb .va{color:#00d4ff;font-family:monospace}
.wsav{font-family:monospace;font-size:11px;color:#4a6a88}
.wsav.ok{color:#00cc66}.wsav.err{color:#ff4455}.wsav.ing{color:#ffaa00}
#__wpbd{flex:1;overflow-y:auto;padding:16px 20px;position:relative}
.webar{display:flex;align-items:center;gap:10px;margin-bottom:14px;background:#0f1218;border:1px solid #1e2d3d;border-radius:4px;padding:10px 14px}
.webar label{font-size:10px;font-weight:700;color:#4a6a88;letter-spacing:1px;text-transform:uppercase;white-space:nowrap}
.webar input{background:#151a22;border:1px solid #2a3f55;color:#c8d8e8;font-family:monospace;font-size:13px;padding:5px 8px;border-radius:3px;width:70px;outline:none}
.webar input:focus{border-color:#00d4ff}
.weboard{display:flex;gap:10px;overflow-x:auto;padding-bottom:10px;min-height:300px}
.wcol{background:#0f1218;border:1px solid #1e2d3d;border-radius:4px;width:220px;flex-shrink:0;display:flex;flex-direction:column}
.wcolh{padding:8px 10px;border-bottom:1px solid #1e2d3d;display:flex;align-items:center;gap:6px}
.wcolh input{background:transparent;border:none;color:#00d4ff;font-family:monospace;font-size:11px;letter-spacing:1px;outline:none;flex:1;min-width:0}
.wcolh input.ua{color:#4a6a88;pointer-events:none}
.wcnt{font-family:monospace;font-size:10px;color:#4a6a88;background:#151a22;border:1px solid #1e2d3d;padding:1px 5px;border-radius:2px}
.wdel{background:none;border:none;color:#4a6a88;cursor:pointer;font-size:13px;line-height:1;transition:color .15s}
.wdel:hover{color:#ff4455}
.wcolb{flex:1;padding:6px;display:flex;flex-direction:column;gap:3px;min-height:50px}
.wcolb.dov{background:rgba(0,212,255,.05)}
.wcard{background:#151a22;border:1px solid #1e2d3d;border-radius:3px;padding:7px 9px;cursor:grab;user-select:none;transition:border-color .15s}
.wcard:hover{border-color:#2a3f55}
.wcard.hop{border-left:2px solid #00d4ff}
.wcard.wdrag{opacity:.3}
.wct{display:flex;align-items:center;justify-content:space-between;margin-bottom:3px}
.wcn{font-size:12px;font-weight:700;color:#c8d8e8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px}
.wcr{font-family:monospace;font-size:9px;color:#4a6a88}
.wcs{font-family:monospace;font-size:10px;color:#4a6a88;display:flex;gap:6px}
.wcs .def{color:#7a9ab8}.wcs .away{color:#00ff88}
.wtag{display:inline-block;font-family:monospace;font-size:9px;padding:1px 4px;border-radius:2px;background:rgba(0,212,255,.12);color:#00d4ff;border:1px solid rgba(0,212,255,.2);cursor:pointer;margin:1px}
.wtag:hover{background:rgba(255,68,85,.15);color:#ff4455}
.waddcol{width:42px;flex-shrink:0;background:#0f1218;border:1px dashed #2a3f55;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#4a6a88;font-size:20px;transition:all .2s}
.waddcol:hover{border-color:#00d4ff;color:#00d4ff}
.wops{position:absolute;right:0;top:0;bottom:0;width:290px;background:#0f1218;border-left:1px solid #1e2d3d;transform:translateX(100%);transition:transform .2s;display:flex;flex-direction:column;overflow:hidden}
.wops.open{transform:none}
.wopsh{padding:12px 14px;border-bottom:1px solid #1e2d3d;display:flex;align-items:center;justify-content:space-between}
.wopsh h3{font-family:monospace;font-size:11px;color:#00d4ff;letter-spacing:1px}
.wopsb{flex:1;overflow-y:auto;padding:12px 14px}
.wopsec{font-size:10px;font-weight:700;color:#4a6a88;letter-spacing:1px;text-transform:uppercase;margin:10px 0 6px}
.wopsg{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
.wop{padding:5px 3px;background:#151a22;border:1px solid #1e2d3d;color:#7a9ab8;font-family:monospace;font-size:9px;cursor:pointer;border-radius:2px;text-align:center;transition:all .12s}
.wop:hover{border-color:#00d4ff;color:#00d4ff}
.wop.sel{background:rgba(0,212,255,.12);border-color:#00d4ff;color:#00d4ff}
.wop.i:hover{border-color:#aa66ff;color:#aa66ff}
.wop.i.sel{background:rgba(170,102,255,.12);border-color:#aa66ff;color:#aa66ff}
.wsb{background:#151a22;border:1px solid #1e2d3d;border-radius:3px;padding:7px 9px;margin-bottom:6px}
.wsb .l{font-size:9px;font-weight:700;color:#4a6a88;letter-spacing:1px;text-transform:uppercase}
.wsb .v{font-family:monospace;font-size:16px;color:#00d4ff}
.waf{color:#00ff88}.was{color:#00d4ff}.waw{color:#ffaa00}.wao{color:#ff4455}
.walt{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:1px solid #1e2d3d;font-size:12px}
.wabg{font-family:monospace;font-size:9px;font-weight:700;padding:2px 6px;border-radius:2px;white-space:nowrap;flex-shrink:0;margin-top:1px}
.wau{background:rgba(255,68,85,.2);color:#ff4455;border:1px solid #cc2233}
.waw2{background:rgba(255,170,0,.2);color:#ffaa00;border:1px solid #cc8800}
.wai{background:rgba(0,212,255,.12);color:#00d4ff;border:1px solid #0099cc}
.wsum{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px}
.wscard{background:#0f1218;border:1px solid #1e2d3d;border-radius:4px;padding:12px 14px}
.wscard .l{font-size:9px;font-weight:700;color:#4a6a88;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px}
.wscard .v{font-family:monospace;font-size:22px;color:#00d4ff}
.wscard .s{font-size:11px;color:#4a6a88;margin-top:2px}
.wtbl{width:100%;border-collapse:collapse;font-size:11px;background:#0f1218;border:1px solid #1e2d3d;border-radius:4px;overflow:hidden}
.wtbl th{background:#151a22;padding:7px 10px;text-align:left;font-size:9px;font-weight:700;color:#4a6a88;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #1e2d3d}
.wtbl td{padding:7px 10px;border-bottom:1px solid #1e2d3d;font-family:monospace}
.wtbl tr:last-child td{border-bottom:none}
.wtbl tr:hover td{background:#151a22}
.wpc{background:#0f1218;border:1px solid #1e2d3d;border-radius:4px;margin-bottom:10px;overflow:hidden}
.wpch{padding:10px 14px;border-bottom:1px solid #1e2d3d;display:flex;align-items:center;justify-content:space-between}
.wpcb{padding:14px}
.wmatch{font-family:monospace;font-size:10px;padding:2px 7px;border-radius:2px;display:inline-block;margin:2px}
.wmyes{background:rgba(0,255,136,.12);color:#00ff88;border:1px solid #00cc66}
.wmno{background:rgba(255,68,85,.12);color:#ff4455;border:1px solid #cc2233}
.wmcl{background:rgba(255,170,0,.12);color:#ffaa00;border:1px solid #cc8800}
.wrole{display:flex;gap:6px;align-items:center}
.wrole span{font-size:10px;color:#4a6a88;font-weight:700;letter-spacing:1px;text-transform:uppercase}
.wpick{background:#151a22;border:1px solid #2a3f55;color:#c8d8e8;font-family:monospace;font-size:12px;padding:5px 8px;border-radius:3px;outline:none;cursor:pointer;max-width:180px}
.wpick:focus{border-color:#00d4ff}
.watk-card{background:#0f1218;border:1px solid #1e2d3d;border-radius:4px;margin-bottom:12px;overflow:hidden}
.watk-header{padding:12px 16px;border-bottom:1px solid #1e2d3d;background:#151a22;display:flex;align-items:center;justify-content:space-between}
.watk-wave{font-family:monospace;font-size:10px;color:#00d4ff;letter-spacing:1px}
.watk-body{padding:0}
.watk-row{display:flex;align-items:center;padding:10px 16px;border-bottom:1px solid #1e2d3d;gap:12px}
.watk-row:last-child{border-bottom:none}
.watk-num{font-family:monospace;font-size:22px;font-weight:700;color:#00d4ff;width:28px;flex-shrink:0;text-align:center}
.watk-main{flex:1;min-width:0}
.watk-target{font-size:15px;font-weight:700;color:#c8d8e8;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.watk-detail{font-family:monospace;font-size:11px;color:#4a6a88;line-height:1.6}
.watk-gen{display:flex;flex-direction:column;align-items:center;flex-shrink:0;text-align:center}
.watk-gen-num{font-family:monospace;font-size:28px;font-weight:700;line-height:1}
.watk-gen-label{font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#4a6a88;margin-top:2px}
.watk-result{font-family:monospace;font-size:10px;padding:3px 8px;border-radius:2px;text-align:center;flex-shrink:0}
.watk-yes{background:rgba(0,255,136,.12);color:#00ff88;border:1px solid #00cc66}
.watk-cl{background:rgba(255,170,0,.12);color:#ffaa00;border:1px solid #cc8800}
.watk-no{background:rgba(255,68,85,.12);color:#ff4455;border:1px solid #cc2233}
.watk-ops{margin-top:4px;display:flex;flex-wrap:wrap;gap:3px}
.watk-summary{background:#151a22;border:1px solid #1e2d3d;border-radius:4px;padding:14px 16px;margin-bottom:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.watk-sstat .l{font-size:9px;font-weight:700;color:#4a6a88;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px}
.watk-sstat .v{font-family:monospace;font-size:20px;color:#00d4ff}
.watk-sstat .s{font-size:11px;color:#4a6a88;margin-top:1px}
.watk-noprov{color:#4a6a88;font-family:monospace;font-size:12px;padding:30px 0;text-align:center}
.watk-notarget{background:#0f1218;border:1px solid #1e2d3d;border-radius:4px;padding:24px;text-align:center;color:#4a6a88;font-family:monospace;font-size:12px}
.wspin{display:inline-block;width:28px;height:28px;border:2px solid #1e2d3d;border-top-color:#00d4ff;border-radius:50%;animation:__wpspin .7s linear infinite}
.wload{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:200px;gap:12px;color:#4a6a88;font-family:monospace;font-size:12px;letter-spacing:1px}
.wsech{font-family:monospace;font-size:10px;color:#4a6a88;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #1e2d3d}
.wthr{background:#0f1218;border:1px solid #1e2d3d;border-radius:4px;padding:14px 16px;margin-bottom:16px}
.wthr-title{font-size:10px;font-weight:700;color:#4a6a88;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between}
.wthr-title span{color:#ffaa00;font-size:10px;font-weight:400;letter-spacing:0;text-transform:none}
.wthr-row{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.wthr-row:last-child{margin-bottom:0}
.wthr-label{font-size:12px;font-weight:700;color:#c8d8e8;width:50px;flex-shrink:0}
.wthr-input{background:#151a22;border:1px solid #2a3f55;color:#c8d8e8;font-family:monospace;font-size:13px;padding:5px 8px;border-radius:3px;width:110px;outline:none}
.wthr-input:focus{border-color:#ffaa00}
.wthr-hint{font-size:11px;color:#4a6a88;flex:1}
.wres-alert{background:rgba(255,170,0,.08);border:1px solid rgba(255,170,0,.2);border-radius:3px}
@keyframes __wpspin{to{transform:rotate(360deg)}}
.writ-badge{position:relative;cursor:pointer;transition:border-color .15s}
.writ-badge:hover{border-color:#2a3f55!important}
.writ-drop{position:absolute;top:100%;left:0;z-index:100;background:#0f1218;border:1px solid #2a3f55;border-radius:4px;padding:12px 14px;min-width:200px;margin-top:4px;box-shadow:0 4px 20px rgba(0,0,0,.6)}
.writ-drop-title{font-family:monospace;font-size:12px;color:#00d4ff;letter-spacing:1px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #1e2d3d}
.writ-drop-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:12px}
.writ-drop-row:last-child{margin-bottom:0}
.writ-drop-l{color:#4a6a88;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase}
#__wprit{display:contents}
`;
