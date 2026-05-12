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
#__wp_overlay{position:fixed;inset:0;z-index:2147483647;background:#120d04;color:#c8a060;font-family:Rajdhani,sans-serif;display:flex;flex-direction:column;overflow:hidden}
#__wp_overlay *{box-sizing:border-box;margin:0;padding:0}
#__wph{background:#1a1208;border-bottom:1px solid #8B6914;height:48px;display:flex;align-items:center;padding:0 20px;gap:10px;flex-shrink:0}
#__wph .logo{font-family:Rajdhani,sans-serif;font-size:17px;font-weight:700;color:#D4A017;letter-spacing:2px;flex:1}
.wb{padding:4px 11px;background:#1a1510;border:1px solid #4a3a1a;color:#907050;font-size:12px;font-weight:700;cursor:pointer;border-radius:3px;transition:all .15s}
.wb:hover{border-color:#D4A017;color:#D4A017}
.wb.g{border-color:#2a6614;color:#60C040}.wb.g:hover{background:rgba(96,192,64,.1)}
.wb.r{border-color:#8B1414;color:#E05050}.wb.r:hover{background:rgba(224,80,80,.1)}
#__wptb{background:#120d04;border-bottom:1px solid #4a3010;display:flex;padding:0 20px;flex-shrink:0}
.wt{padding:10px 16px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#7a5a2a;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .15s}
.wt:hover{color:#c8a060}.wt.on{color:#D4A017;border-bottom-color:#D4A017}.wt.ong{color:#60C040;border-bottom-color:#60C040}
#__wptl{background:#150f05;border-bottom:1px solid #3a2810;padding:6px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;flex-shrink:0}
.wkb{background:#1a1208;border:1px solid #3a2810;border-radius:3px;padding:4px 10px;font-size:11px}
.wkb .l{color:#7a5a2a;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase}
.wkb .v{color:#c8a060;font-weight:600}.wkb .va{color:#D4A017;font-family:monospace}
.wsav{font-family:monospace;font-size:11px;color:#7a5a2a}
.wsav.ok{color:#60C040}.wsav.err{color:#E05050}.wsav.ing{color:#e09040}
#__wpbd{flex:1;overflow-y:auto;padding:16px 20px;position:relative}
.webar{display:flex;align-items:center;gap:10px;margin-bottom:14px;background:#1a1208;border:1px solid #3a2810;border-radius:4px;padding:10px 14px}
.webar label{font-size:10px;font-weight:700;color:#7a5a2a;letter-spacing:1px;text-transform:uppercase;white-space:nowrap}
.webar input{background:#120d04;border:1px solid #3a2810;color:#c8a060;font-size:13px;padding:5px 8px;border-radius:3px;width:70px;outline:none}
.webar input:focus{border-color:#D4A017}
.weboard{display:flex;gap:10px;overflow-x:auto;padding-bottom:10px;min-height:300px}
.wcol{background:#1a1208;border:1px solid #3a2810;border-radius:4px;width:220px;flex-shrink:0;display:flex;flex-direction:column}
.wcolh{padding:8px 10px;border-bottom:1px solid #3a2810;display:flex;align-items:center;gap:6px}
.wcolh input{background:transparent;border:none;color:#D4A017;font-family:Rajdhani,sans-serif;font-size:11px;letter-spacing:1px;outline:none;flex:1;min-width:0}
.wcolh input.ua{color:#7a5a2a;pointer-events:none}
.wcnt{font-size:10px;color:#7a5a2a;background:#120d04;border:1px solid #3a2810;padding:1px 5px;border-radius:2px}
.wdel{background:none;border:none;color:#7a5a2a;cursor:pointer;font-size:13px;line-height:1;transition:color .15s}
.wdel:hover{color:#E05050}
.wcolb{flex:1;padding:6px;display:flex;flex-direction:column;gap:3px;min-height:50px}
.wcolb.dov{background:rgba(212,160,23,.05)}
.wcard{background:#120d04;border:1px solid #3a2810;border-radius:3px;padding:7px 9px;cursor:grab;user-select:none;transition:border-color .15s}
.wcard:hover{border-color:#4a3010}
.wcard.hop{border-left:2px solid #D4A017}
.wcard.wdrag{opacity:.3}
.wct{display:flex;align-items:center;justify-content:space-between;margin-bottom:3px}
.wcn{font-size:12px;font-weight:700;color:#c8a060;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px}
.wcr{font-size:9px;color:#7a5a2a}
.wcs{font-size:10px;color:#7a5a2a;display:flex;gap:6px}
.wcs .def{color:#c8a060}.wcs .away{color:#60C040}
.wtag{display:inline-block;font-size:9px;padding:1px 4px;border-radius:2px;background:rgba(212,160,23,.12);color:#D4A017;border:1px solid rgba(212,160,23,.2);cursor:pointer;margin:1px}
.wtag:hover{background:rgba(224,80,80,.15);color:#E05050}
.waddcol{width:42px;flex-shrink:0;background:#1a1208;border:1px dashed #3a2810;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#4a3010;font-size:20px;transition:all .2s}
.waddcol:hover{border-color:#D4A017;color:#D4A017}
.wops{position:absolute;right:0;top:0;bottom:0;width:290px;background:#1a1208;border-left:1px solid #3a2810;transform:translateX(100%);transition:transform .2s;display:flex;flex-direction:column;overflow:hidden}
.wops.open{transform:none}
.wopsh{padding:12px 14px;border-bottom:1px solid #3a2810;display:flex;align-items:center;justify-content:space-between}
.wopsh h3{font-size:11px;color:#D4A017;letter-spacing:1px}
.wopsb{flex:1;overflow-y:auto;padding:12px 14px}
.wopsec{font-size:10px;font-weight:700;color:#7a5a2a;letter-spacing:1px;text-transform:uppercase;margin:10px 0 6px}
.wopsg{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
.wop{padding:5px 3px;background:#120d04;border:1px solid #3a2810;color:#907050;font-size:9px;cursor:pointer;border-radius:2px;text-align:center;transition:all .12s}
.wop:hover{border-color:#D4A017;color:#D4A017}
.wop.sel{background:rgba(212,160,23,.12);border-color:#D4A017;color:#D4A017}
.wop.i:hover{border-color:#c87030;color:#e09040}
.wop.i.sel{background:rgba(200,112,48,.12);border-color:#c87030;color:#e09040}
.wsb{background:#120d04;border:1px solid #3a2810;border-radius:3px;padding:7px 9px;margin-bottom:6px}
.wsb .l{font-size:9px;font-weight:700;color:#7a5a2a;letter-spacing:1px;text-transform:uppercase}
.wsb .v{font-size:16px;color:#D4A017}
.waf{color:#60C040}.was{color:#D4A017}.waw{color:#e09040}.wao{color:#E05050}
.walt{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:1px solid #3a2810;font-size:12px}
.wabg{font-size:9px;font-weight:700;padding:2px 6px;border-radius:2px;white-space:nowrap;flex-shrink:0;margin-top:1px}
.wau{background:rgba(160,30,30,.2);color:#f08080;border:1px solid #8B1414}
.waw2{background:rgba(180,100,20,.2);color:#e09040;border:1px solid #c87030}
.wai{background:rgba(40,80,160,.12);color:#80a8f0;border:1px solid #304880}
.wsum{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px}
.wscard{background:#1a1208;border:1px solid #3a2810;border-radius:4px;padding:12px 14px}
.wscard .l{font-size:9px;font-weight:700;color:#7a5a2a;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px}
.wscard .v{font-size:22px;color:#D4A017}
.wscard .s{font-size:11px;color:#7a5a2a;margin-top:2px}
.wtbl{width:100%;border-collapse:collapse;font-size:11px;background:#1a1208;border:1px solid #3a2810;border-radius:4px;overflow:hidden}
.wtbl th{background:#120d04;padding:7px 10px;text-align:left;font-size:9px;font-weight:700;color:#7a5a2a;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #3a2810}
.wtbl td{padding:7px 10px;border-bottom:1px solid #3a2810}
.wtbl tr:last-child td{border-bottom:none}
.wtbl tr:hover td{background:#120d04}
.wpc{background:#1a1208;border:1px solid #3a2810;border-radius:4px;margin-bottom:10px;overflow:hidden}
.wpch{padding:10px 14px;border-bottom:1px solid #3a2810;display:flex;align-items:center;justify-content:space-between}
.wpcb{padding:14px}
.wmatch{font-size:10px;padding:2px 7px;border-radius:2px;display:inline-block;margin:2px}
.wmyes{background:rgba(96,192,64,.12);color:#60C040;border:1px solid #2a6614}
.wmno{background:rgba(160,30,30,.12);color:#E05050;border:1px solid #8B1414}
.wmcl{background:rgba(180,100,20,.12);color:#e09040;border:1px solid #c87030}
.wrole{display:flex;gap:6px;align-items:center}
.wrole span{font-size:10px;color:#7a5a2a;font-weight:700;letter-spacing:1px;text-transform:uppercase}
.wpick{background:#120d04;border:1px solid #3a2810;color:#c8a060;font-size:12px;padding:5px 8px;border-radius:3px;outline:none;cursor:pointer;max-width:180px}
.wpick:focus{border-color:#D4A017}
.watk-card{background:#1a1208;border:1px solid #3a2810;border-radius:4px;margin-bottom:12px;overflow:hidden}
.watk-header{padding:12px 16px;border-bottom:1px solid #3a2810;background:#120d04;display:flex;align-items:center;justify-content:space-between}
.watk-wave{font-size:10px;color:#D4A017;letter-spacing:1px}
.watk-body{padding:0}
.watk-row{display:flex;align-items:center;padding:10px 16px;border-bottom:1px solid #3a2810;gap:12px}
.watk-row:last-child{border-bottom:none}
.watk-num{font-size:22px;font-weight:700;color:#D4A017;width:28px;flex-shrink:0;text-align:center}
.watk-main{flex:1;min-width:0}
.watk-target{font-size:15px;font-weight:700;color:#c8a060;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.watk-detail{font-size:11px;color:#7a5a2a;line-height:1.6}
.watk-gen{display:flex;flex-direction:column;align-items:center;flex-shrink:0;text-align:center}
.watk-gen-num{font-size:28px;font-weight:700;line-height:1}
.watk-gen-label{font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#7a5a2a;margin-top:2px}
.watk-result{font-size:10px;padding:3px 8px;border-radius:2px;text-align:center;flex-shrink:0}
.watk-yes{background:rgba(96,192,64,.12);color:#60C040;border:1px solid #2a6614}
.watk-cl{background:rgba(180,100,20,.12);color:#e09040;border:1px solid #c87030}
.watk-no{background:rgba(160,30,30,.12);color:#E05050;border:1px solid #8B1414}
.watk-ops{margin-top:4px;display:flex;flex-wrap:wrap;gap:3px}
.watk-summary{background:#120d04;border:1px solid #3a2810;border-radius:4px;padding:14px 16px;margin-bottom:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.watk-sstat .l{font-size:9px;font-weight:700;color:#7a5a2a;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px}
.watk-sstat .v{font-size:20px;color:#D4A017}
.watk-sstat .s{font-size:11px;color:#7a5a2a;margin-top:1px}
.watk-noprov{color:#7a5a2a;font-size:12px;padding:30px 0;text-align:center}
.watk-notarget{background:#1a1208;border:1px solid #3a2810;border-radius:4px;padding:24px;text-align:center;color:#7a5a2a;font-size:12px}
.wspin{display:inline-block;width:28px;height:28px;border:2px solid #3a2810;border-top-color:#D4A017;border-radius:50%;animation:__wpspin .7s linear infinite}
.wload{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:200px;gap:12px;color:#7a5a2a;font-size:12px;letter-spacing:1px}
.wsech{font-size:10px;color:#7a5a2a;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #3a2810}
.wthr{background:#1a1208;border:1px solid #3a2810;border-radius:4px;padding:14px 16px;margin-bottom:16px}
.wthr-title{font-size:10px;font-weight:700;color:#7a5a2a;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between}
.wthr-title span{color:#e09040;font-size:10px;font-weight:400;letter-spacing:0;text-transform:none}
.wthr-row{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.wthr-row:last-child{margin-bottom:0}
.wthr-label{font-size:12px;font-weight:700;color:#c8a060;width:50px;flex-shrink:0}
.wthr-input{background:#120d04;border:1px solid #3a2810;color:#c8a060;font-size:13px;padding:5px 8px;border-radius:3px;width:110px;outline:none}
.wthr-input:focus{border-color:#D4A017}
.wthr-hint{font-size:11px;color:#7a5a2a;flex:1}
.wres-alert{background:rgba(180,100,20,.08);border:1px solid rgba(180,100,20,.2);border-radius:3px}
.writ-badge{position:relative;cursor:pointer;transition:border-color .15s}
.writ-badge:hover{border-color:#8B6914!important}
.writ-drop{position:absolute;top:calc(100% + 6px);left:0;z-index:99999;background:#1a1208;border:1px solid #8B6914;border-radius:4px;padding:12px 14px;min-width:220px;box-shadow:0 8px 24px rgba(0,0,0,.8)}
.writ-drop-title{font-size:12px;color:#D4A017;letter-spacing:1px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #3a2810}
.writ-drop-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:12px}
.writ-drop-row:last-child{margin-bottom:0}
.writ-drop-l{color:#7a5a2a;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase}
#__wprit{display:flex;gap:8px;align-items:center}
@keyframes __wpspin{to{transform:rotate(360deg)}}
`;
