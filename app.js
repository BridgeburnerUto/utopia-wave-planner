(function(){
'use strict';
// Token passed from bookmarklet or read directly
const TOKEN = window.__wp_token || sessionStorage.getItem('Utopia-Token');
const SERVER = window.__wp_server || parseInt(JSON.parse(localStorage.getItem('IntelState')||'{}').server||'1');
const BASE = 'https://api.intel.utopia.site';
const H = {'Utopia-Token': TOKEN, 'Content-Type': 'application/json'};

if(!TOKEN){ alert('Wave Planner: No token found.'); return; }
if(document.getElementById('__wp_overlay')){ document.getElementById('__wp_overlay').style.display='flex'; return; }

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
@keyframes __wpspin{to{transform:rotate(360deg)}}
`;

const DOPS=[{c:'BLI',l:'Blizzard'},{c:'CHA',l:'Chaos'},{c:'DG',l:'Dragon'},{c:'DR',l:'Drought'},{c:'ET',l:'Exp Thieves'},{c:'EX',l:'Expose'},{c:'FOG',l:'Fog'},{c:'GL',l:'Gluttony'},{c:'GR',l:'Greed'},{c:'IR',l:'Inspire'},{c:'MW',l:'Mind Wipe'},{c:'MS',l:'Miser'},{c:'NF',l:'Night Fall'},{c:'PF',l:'Plague'},{c:'SW',l:'Shadow'},{c:'Slo',l:'Slow Burn'},{c:'Sto',l:'Storm'},{c:'Wra',l:'Wrath'}];
const IOPS=[{c:'AR',l:'Arson'},{c:'AMN',l:'Amnesia'},{c:'ARS',l:'Gr.Arson'},{c:'AW',l:'Assassin'},{c:'FB',l:'Fireball'},{c:'GA',l:'Grab Army'},{c:'INF',l:'Infiltrate'},{c:'KN',l:'Kidnap'},{c:'LS',l:'Learn'},{c:'MV',l:'Massacre'},{c:'NM',l:'Nightmare'},{c:'NS',l:'Night Strike'},{c:'PROP',l:'Propaganda'},{c:'RG',l:'Raze'},{c:'RV',l:'Reveal'},{c:'RT',l:'Riot'},{c:'SB',l:'Spy Bldgs'},{c:'SWH',l:'Switcharoo'},{c:'TOR',l:'Tornado'},{c:'WRi',l:'War Ritual'}];

const S={token:TOKEN,server:SERVER,own:null,enemy:null,wpId:null,cols:[],tab:'board',drag:null,openSlot:null,eLoc:'5:3',role:'leader',playerProv:null};

function fK(n){if(n==null)return'—';if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1000)return Math.round(n/1000)+'k';return Math.round(n)+'';}
function fA(s){if(s==null)return'—';const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);if(h>=48)return Math.floor(h/24)+'d';if(h>0)return h+'h'+m+'m';return m+'m';}
function aC(s){if(s==null)return'wao';const h=s/3600;if(h<1)return'waf';if(h<4)return'was';if(h<12)return'waw';return'wao';}
function canHit(a,t){const r=a/t;return r>=0.75&&r<=1.33;}
function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function pd(slot){if(!S.enemy)return null;const n=parseInt((slot+'').replace(/\[|\]/g,''));return S.enemy.provinces.find(p=>p.slot===n);}
function $id(id){return document.getElementById(id);}
function setSav(m,c){const e=$id('__wpsav');if(e){e.textContent=m;e.className='wsav'+(c?' '+c:'');}}

// Build DOM
const st=document.createElement('style');st.textContent=CSS;document.head.appendChild(st);
const lk=document.createElement('link');lk.rel='stylesheet';lk.href='https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;600;700&display=swap';document.head.appendChild(lk);

const ov=document.createElement('div');ov.id='__wp_overlay';
ov.innerHTML=`
<div id="__wph"><div class="logo">⚔ WAVE PLANNER</div>
<div id="__wptick" style="font-family:monospace;font-size:11px;color:#4a6a88;display:none"></div>
<div class="wrole"><span>View as:</span>
<button class="wb" id="__wprole_leader" onclick="__wpA.setRole('leader')" style="border-color:#00d4ff;color:#00d4ff">⚔ Leader</button>
<button class="wb" id="__wprole_player" onclick="__wpA.setRole('player')">🗡 Player</button>
</div>
<div id="__wpprovpick" style="display:none;align-items:center;gap:8px">
<span style="font-size:10px;color:#4a6a88;font-weight:700;letter-spacing:1px;text-transform:uppercase">My Province:</span>
<select class="wpick" id="__wpprovsel" onchange="__wpA.pickProv(this.value)"><option value="">— select —</option></select>
</div>
<button class="wb g" id="__wpsavebtn" onclick="__wpA.save()">💾 Save</button>
<button class="wb" onclick="__wpA.refresh()">↻ Refresh</button>
<button class="wb r" onclick="document.getElementById('__wp_overlay').style.display='none'">✕ Close</button>
</div>
<div id="__wptl">
<div class="wkb"><div class="l">Own KD</div><div class="v" id="__wpown">—</div></div>
<div class="wkb"><div class="l">Enemy</div><div class="v va" id="__wpene">—</div></div>
<div class="wkb"><div class="l">War</div><div class="v" id="__wpwar">—</div></div>
<span class="wsav" id="__wpsav"></span>
</div>
<div id="__wptb">
<div class="wt on" id="__wpt_board" onclick="__wpA.tab('board')">WAR BOARD</div>
<div class="wt" id="__wpt_player" onclick="__wpA.tab('player')">MY ORDERS</div>
<div class="wt" id="__wpt_summary" onclick="__wpA.tab('summary')">SUMMARY</div>
<div class="wt" id="__wpt_alerts" onclick="__wpA.tab('alerts')">ALERTS<span id="__wpalc"></span></div>
</div>
<div id="__wpbd">
<div id="__wpc_board"></div>
<div id="__wpc_player" style="display:none"></div>
<div id="__wpc_summary" style="display:none"></div>
<div id="__wpc_alerts" style="display:none"></div>
<div class="wops" id="__wpops"></div>
</div>`;
document.body.appendChild(ov);

window.__wpA={
async init(){
  $id('__wpc_board').innerHTML='<div class="wload"><div class="wspin"></div>FETCHING INTEL...</div>';
  try{
    const or=await fetch(`${BASE}/Kingdom/v1/OwnKingdom?server=${S.server}`,{headers:H});
    if(!or.ok)throw new Error('API '+or.status+' — token may be expired. Reload the IS via game link.');
    const od=await or.json();S.own=od.kingdom;
    if(od.currentTick){const t=$id('__wptick');t.textContent='Tick '+od.currentTick.tickNumber+' · '+od.currentTick.tickName;t.style.display='';}
    const wr=await fetch(`${BASE}/WarPlan/v1/Post?server=${S.server}&location=${S.own.location}`,{method:'POST',headers:H,body:'{}'});
    if(wr.ok){const wd=await wr.json();S.wpId=wd.warPlanId;
      const gr=await fetch(`${BASE}/WarPlan/v1/Get?server=${S.server}&location=${S.own.location}&warPlanId=${S.wpId}`,{headers:H});
      if(gr.ok){const gd=await gr.json();if(gd.json){try{const p=JSON.parse(gd.json);S.cols=p.columns||[];if(p.enemyLocation)S.eLoc=p.enemyLocation;}catch(e){}}}}
    await this.loadEnemy(S.eLoc);
    if(!S.cols.length)this.initCols();
    this.meta();this.board();this.alerts();this.summary();this.player();this.setRole('leader');
  }catch(e){$id('__wpc_board').innerHTML=`<div class="wload" style="color:#ff4455">ERROR: ${esc(e.message)}</div>`;}
},
async loadEnemy(loc){
  const l=loc||$id('__wpeloc')?.value||'5:3';S.eLoc=l;
  const r=await fetch(`${BASE}/Kingdom/v1/EnemyKingdom?server=${S.server}&location=${l}`,{headers:H}).catch(()=>null);
  if(r&&r.ok){const d=await r.json();S.enemy=d.kingdom;
    $id('__wpene').textContent=S.enemy.kingdomName||l;
    const es=$id('__wpestats');
    if(es){const tl=S.enemy.provinces.reduce((s,p)=>s+(p.land||0),0);es.textContent=S.enemy.provinces.length+' provs · '+fK(tl)+' land';}
  }
},
initCols(){
  if(!S.enemy)return;
  S.cols=[{title:'Unassigned',items:S.enemy.provinces.map(p=>({id:Math.random().toString(36).slice(2),province:{id:p.id,name:p.name,race:p.race,slot:'['+p.slot+']'}}))},{title:'Wave 1',items:[]},{title:'Wave 2',items:[]}];
},
meta(){
  if(S.own){$id('__wpown').textContent=S.own.kingdomName||S.own.location;const w=$id('__wpwar');if(S.own.war){w.textContent='⚔ WAR';w.style.color='#ff4455';}else{w.textContent='Peace';w.style.color='#7a9ab8';}}
},
board(){
  const eb=`<div class="webar"><label>ENEMY:</label><input id="__wpeloc" value="${esc(S.eLoc)}" placeholder="5:3"><button class="wb" style="font-size:11px" onclick="__wpA.loadEnemy($id('__wpeloc').value);__wpA.initCols();__wpA.board();__wpA.alerts();__wpA.summary();__wpA.player()">LOAD</button><div style="color:#00d4ff;font-weight:700;font-size:13px">${esc(S.enemy?.kingdomName||'—')}</div><div style="font-size:11px;color:#4a6a88;margin-left:auto" id="__wpestats"></div></div>`;
  let b='<div class="weboard">';
  S.cols.forEach((col,ci)=>{
    const ua=ci===0;
    b+=`<div class="wcol" ondragover="event.preventDefault();$id('__wpcb${ci}').classList.add('dov')" ondragleave="$id('__wpcb${ci}').classList.remove('dov')" ondrop="__wpA.drop(event,${ci})">
    <div class="wcolh"><input class="${ua?'ua':''}" value="${esc(col.title)}" ${ua?'readonly':''} onchange="S.cols[${ci}].title=this.value">
    <span class="wcnt">${col.items.length}</span>${!ua?`<button class="wdel" onclick="__wpA.delCol(${ci})">✕</button>`:''}</div>
    <div class="wcolb" id="__wpcb${ci}">`;
    col.items.forEach((item,ii)=>{
      const p=pd(item.province.slot),def=p?.calcs?.defPointsSummary?.defPointsHome||0,da=p?.calcs?.defPointsSummary?.ageSeconds,away=p?.som?.armiesAway?.length>0,ops=item.province.requiredOps||[];
      b+=`<div class="wcard${ops.length?' hop':''}" draggable="true" ondragstart="__wpA.ds(event,${ci},${ii})" ondragend="this.classList.remove('wdrag')" onclick="__wpA.openOps(${ci},${ii})">
      <div class="wct"><div class="wcn">${esc(item.province.name)}</div><div class="wcr">${esc(item.province.race||'')}</div></div>
      <div class="wcs">${def?`<span class="def">${fK(def)}</span>`:''}${away?'<span class="away">↗away</span>':''}${da!=null?`<span class="${aC(da)}">${fA(da)}</span>`:''}</div>
      ${ops.length?`<div style="margin-top:4px">${ops.map(o=>`<span class="wtag" onclick="event.stopPropagation();__wpA.rmOp(${ci},${ii},'${o}')">${o}</span>`).join('')}</div>`:''}</div>`;
    });
    b+=`</div></div>`;
  });
  b+=`<div class="waddcol" onclick="__wpA.addCol()">+</div></div>`;
  $id('__wpc_board').innerHTML=eb+b;
  // Update enemy stats if enemy loaded
  if(S.enemy){const tl=S.enemy.provinces.reduce((s,p)=>s+(p.land||0),0);const es=$id('__wpestats');if(es)es.textContent=S.enemy.provinces.length+' provs · '+fK(tl)+' land';}
},
ds(e,ci,ii){S.drag={ci,ii};e.currentTarget.classList.add('wdrag');e.dataTransfer.effectAllowed='move';},
drop(e,ci){
  e.preventDefault();$id('__wpcb'+ci)?.classList.remove('dov');
  if(!S.drag||S.drag.ci===ci)return;
  const item=S.cols[S.drag.ci].items.splice(S.drag.ii,1)[0];
  S.cols[ci].items.push(item);S.drag=null;this.board();this.summary();
},
addCol(){S.cols.push({title:'Wave '+S.cols.length,items:[]});this.board();},
delCol(ci){S.cols[0].items.push(...S.cols[ci].items);S.cols.splice(ci,1);this.board();this.summary();},
openOps(ci,ii){
  S.openSlot={ci,ii};
  const item=S.cols[ci].items[ii],p=pd(item.province.slot),ops=item.province.requiredOps||[];
  const def=p?.calcs?.defPointsSummary?.defPointsHome,da=p?.calcs?.defPointsSummary?.ageSeconds;
  let h=`<div class="wopsh"><h3>// OPS</h3><button onclick="__wpA.closeOps()" style="background:none;border:none;color:#4a6a88;cursor:pointer;font-size:16px">✕</button></div>
  <div class="wopsb">
  <div style="font-size:15px;font-weight:700;margin-bottom:3px">${esc(item.province.name)}</div>
  <div style="font-family:monospace;font-size:10px;color:#4a6a88;margin-bottom:12px">${esc(item.province.race||'')} · ${esc(p?.sot?.personality||'')} · Slot ${esc(item.province.slot)}</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">
  <div class="wsb"><div class="l">OPA</div><div class="v">${p?.sot?.opa||'—'}</div></div>
  <div class="wsb"><div class="l">DPA</div><div class="v">${p?.sot?.dpa||'—'}</div></div>
  <div class="wsb"><div class="l">Def Home</div><div class="v">${fK(def)}</div></div>
  <div class="wsb"><div class="l">Intel Age</div><div class="v"><span class="${aC(da)}">${fA(da)}</span></div></div>
  </div>
  ${p?.sot?.badSpells?.length?`<div style="font-size:10px;color:#ff4455;margin-bottom:8px">⚠ ${p.sot.badSpells.map(s=>s.name).join(', ')}</div>`:''}
  ${p?.som?.armiesAway?.length?`<div style="font-size:10px;color:#00ff88;margin-bottom:8px">↗ Army away — ${fA(p.som.armiesAway[0].secondsRemaining)} to return</div>`:''}
  <div class="wopsec">Duration Ops</div><div class="wopsg">${DOPS.map(o=>`<div class="wop${ops.includes(o.c)?' sel':''}" onclick="__wpA.togOp('${o.c}')" title="${esc(o.l)}">${esc(o.c)}</div>`).join('')}</div>
  <div class="wopsec">Instant Ops</div><div class="wopsg">${IOPS.map(o=>`<div class="wop i${ops.includes(o.c)?' sel':''}" onclick="__wpA.togOp('${o.c}')" title="${esc(o.l)}">${esc(o.c)}</div>`).join('')}</div>
  <div class="wopsec">Notes</div>
  <textarea style="width:100%;background:#151a22;border:1px solid #2a3f55;color:#c8d8e8;font-family:monospace;font-size:10px;padding:6px;border-radius:2px;resize:vertical;min-height:50px;outline:none" onchange="__wpA.setNote(this.value)">${esc(item.province.notes||'')}</textarea>
  </div>`;
  $id('__wpops').innerHTML=h;$id('__wpops').classList.add('open');
},
closeOps(){$id('__wpops').classList.remove('open');S.openSlot=null;},
togOp(c){
  if(!S.openSlot)return;
  const{ci,ii}=S.openSlot,item=S.cols[ci].items[ii];
  if(!item.province.requiredOps)item.province.requiredOps=[];
  const idx=item.province.requiredOps.indexOf(c);
  if(idx>=0)item.province.requiredOps.splice(idx,1);else item.province.requiredOps.push(c);
  document.querySelectorAll('#__wpops .wop').forEach(b=>{const bc=b.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];if(bc)b.classList.toggle('sel',item.province.requiredOps.includes(bc));});
  this.board();
},
rmOp(ci,ii,c){const ops=S.cols[ci].items[ii].province.requiredOps||[];const i=ops.indexOf(c);if(i>=0)ops.splice(i,1);this.board();},
setNote(v){if(S.openSlot)S.cols[S.openSlot.ci].items[S.openSlot.ii].province.notes=v;},
async save(){
  if(!S.wpId){setSav('No plan ID','err');return;}setSav('Saving...','ing');
  try{
    const json=JSON.stringify({title:'Wave Plan',content:'',enemyLocation:S.eLoc,columns:S.cols});
    const r=await fetch(`${BASE}/WarPlan/v1/Post?server=${S.server}&location=${S.own.location}`,{method:'POST',headers:H,body:JSON.stringify({json,warPlanId:S.wpId})});
    setSav(r.ok?'Saved ✓':'Failed',r.ok?'ok':'err');if(r.ok)setTimeout(()=>setSav('',''),3000);
  }catch(e){setSav('Error','err');}
},
async refresh(){
  $id('__wpc_board').innerHTML='<div class="wload"><div class="wspin"></div>REFRESHING...</div>';
  try{const r=await fetch(`${BASE}/Kingdom/v1/OwnKingdom?server=${S.server}`,{headers:H});if(r.ok){const d=await r.json();S.own=d.kingdom;if(d.currentTick){const t=$id('__wptick');t.textContent='Tick '+d.currentTick.tickNumber+' · '+d.currentTick.tickName;}}await this.loadEnemy(S.eLoc);this.meta();this.board();this.alerts();this.summary();this.player();}catch(e){}
},
tab(t){
  S.tab=t;
  ['board','player','summary','alerts'].forEach(x=>{
    $id('__wpc_'+x).style.display=x===t?'':'none';
    const el=$id('__wpt_'+x);el.className='wt'+(x===t?(x==='player'?' on ong':' on'):'');
  });
  if(t==='player')this.player();if(t==='summary')this.summary();if(t==='alerts')this.alerts();
},
setRole(role){
  S.role=role;
  const isLeader=role==='leader';
  // Update buttons
  $id('__wprole_leader').style.borderColor=isLeader?'#00d4ff':'';
  $id('__wprole_leader').style.color=isLeader?'#00d4ff':'';
  $id('__wprole_player').style.borderColor=!isLeader?'#00ff88':'';
  $id('__wprole_player').style.color=!isLeader?'#00ff88':'';
  // Show/hide save button and province picker
  $id('__wpsavebtn').style.display=isLeader?'':'none';
  $id('__wpprovpick').style.display=isLeader?'none':'flex';
  // Rebuild province dropdown
  if(!isLeader&&S.own){
    const sel=$id('__wpprovsel');
    sel.innerHTML='<option value="">— select your province —</option>';
    S.own.provinces.forEach(p=>{
      const opt=document.createElement('option');
      opt.value=p.slot;
      opt.textContent=p.name+(p.discord?' ('+p.discord+')':'');
      if(S.playerProv&&S.playerProv.slot===p.slot)opt.selected=true;
      sel.appendChild(opt);
    });
  }
  // Switch to appropriate tab
  if(!isLeader){this.tab('player');}else{this.tab('board');}
},
pickProv(slot){
  if(!slot){S.playerProv=null;this.player();return;}
  S.playerProv=S.own.provinces.find(p=>p.slot===parseInt(slot))||null;
  this.player();
},
// Attack plan calculator
calcAttacks(prov){
  // Returns an ordered list of recommended attacks using available generals
  const waveTargets=S.cols.slice(1).flatMap(c=>c.items.map(item=>({...item,waveName:c.title})));
  if(!waveTargets.length)return{attacks:[],reason:'no_targets'};

  const aOff=prov.som?.offPointsHome||0;
  const aNW=prov.networth||0;
  const generals=prov.som?.standingArmy?.generals||prov.sot?.generals||5;
  const totalGenerals=5; // standard max

  if(!aOff)return{attacks:[],reason:'no_off'};

  // Score each target
  const scored=waveTargets.map(item=>{
    const tp=pd(item.province.slot);
    const tDef=tp?.calcs?.defPointsSummary?.defPointsHome||0;
    const tNW=tp?.networth||prov.networth||1;
    const nwOk=canHit(aNW,tNW);
    const away=tp?.som?.armiesAway?.length>0;
    const breaks=aOff>tDef*1.01;
    const pct=tDef>0?aOff/tDef:0;
    const dAge=tp?.calcs?.defPointsSummary?.ageSeconds;
    // Score: prioritise breakable + NW ok + army away + lower def (easier repeat hits)
    const score=(nwOk?100:0)+(breaks?80:0)+(away?30:0)+(pct>1.5?20:pct>1.2?10:0)-(tDef/10000);
    return{item,tp,tDef,tNW,nwOk,away,breaks,pct,dAge,score,waveName:item.waveName};
  }).sort((a,b)=>b.score-a.score);

  // Best hittable target
  const best=scored.find(t=>t.nwOk&&t.breaks)||scored.find(t=>t.nwOk)||scored[0];
  if(!best)return{attacks:[],reason:'no_range'};

  // Calculate minimum generals per attack needed to break
  // In Utopia: generals scale the offensive force proportionally
  // offWithN = totalOff * (n/totalGenerals) — simplified model
  // We want the fewest generals that still break (offWithN > tDef * 1.01)
  function mingen(off,def,maxG){
    if(!def||!off)return maxG;
    for(let n=1;n<=maxG;n++){
      const scaled=off*(n/maxG);
      if(scaled>def*1.01)return n;
    }
    return maxG;
  }

  const attacks=[];
  let gensAvailable=generals; // generals currently home
  let attackNum=0;

  // Build attack sequence — use all available generals efficiently
  // Each attack commits generals for ~12 ticks, but we can still send more attacks
  // with remaining generals. Show up to 5 attacks total.
  const targetList=scored.filter(t=>t.nwOk&&t.breaks);
  if(!targetList.length){
    // Can't break anything — show best options anyway with warning
    const t=best;
    const mg=mingen(aOff,t.tDef,totalGenerals);
    attacks.push({n:1,target:t,gens:mg,result:'marginal',pct:Math.round(t.pct*100),note:'Cannot cleanly break — consider waiting for enemy army to return or fresher intel'});
    return{attacks,prov,totalGenerals,gensHome:generals,best};
  }

  // Greedy: assign attacks in sequence, cycling targets
  const cycleTargets=[...targetList];
  for(let i=0;i<Math.min(5,gensAvailable>0?gensAvailable:1);i++){
    const t=cycleTargets[i%cycleTargets.length];
    const mg=mingen(aOff,t.tDef,totalGenerals);
    const actualGens=Math.min(mg,gensAvailable);
    attackNum++;
    const scaledOff=aOff*(actualGens/totalGenerals);
    const breaks=scaledOff>t.tDef*1.01;
    attacks.push({
      n:attackNum,
      target:t,
      gens:actualGens,
      minGens:mg,
      result:breaks?'yes':'close',
      pct:Math.round(scaledOff/(t.tDef||1)*100),
      scaledOff,
      note:i>0?'Send after previous attack is away':null
    });
    gensAvailable-=actualGens;
    if(gensAvailable<=0)break;
  }

  return{attacks,prov,totalGenerals,gensHome:generals,best};
},
player(){
  const el=$id('__wpc_player');
  if(!S.own||!S.enemy){el.innerHTML='<div class="watk-noprov">Loading data...</div>';return;}

  // Province selector prompt if none selected
  if(!S.playerProv){
    const provs=S.own.provinces;
    el.innerHTML=`<div style="max-width:480px">
      <div style="font-family:monospace;font-size:11px;color:#4a6a88;letter-spacing:2px;text-transform:uppercase;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #1e2d3d">// SELECT YOUR PROVINCE</div>
      <div style="display:grid;gap:8px">
      ${provs.map(p=>{
        const off=p.som?.offPointsHome||p.sot?.offPoints||0;
        const gens=p.som?.standingArmy?.generals||'?';
        return`<div onclick="__wpA.pickProv(${p.slot})" style="background:#151a22;border:1px solid #1e2d3d;border-radius:3px;padding:12px 14px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;transition:border-color .15s" onmouseover="this.style.borderColor='#2a3f55'" onmouseout="this.style.borderColor='#1e2d3d'">
          <div>
            <div style="font-size:14px;font-weight:700">${esc(p.name)}</div>
            <div style="font-family:monospace;font-size:10px;color:#4a6a88">${esc(p.race||'')} · ${esc(p.sot?.personality||'')}</div>
          </div>
          <div style="text-align:right">
            <div style="font-family:monospace;font-size:13px;color:#00d4ff">${fK(off)} off</div>
            <div style="font-family:monospace;font-size:10px;color:#4a6a88">${gens} generals home · ${fK(p.networth)} NW</div>
          </div>
        </div>`;
      }).join('')}
      </div></div>`;
    return;
  }

  const prov=S.playerProv;
  const{attacks,totalGenerals,gensHome,best,reason}=this.calcAttacks(prov);
  const waveTargets=S.cols.slice(1).flatMap(c=>c.items);
  const aOff=prov.som?.offPointsHome||0;

  let h=`
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
    <div>
      <div style="font-size:18px;font-weight:700">${esc(prov.name)}</div>
      <div style="font-family:monospace;font-size:11px;color:#4a6a88">${esc(prov.race||'')} · ${esc(prov.sot?.personality||'')} · ${fK(prov.networth)} NW</div>
    </div>
    <button onclick="__wpA.pickProv('')" style="padding:5px 10px;background:#151a22;border:1px solid #2a3f55;color:#7a9ab8;font-size:11px;font-weight:700;cursor:pointer;border-radius:3px">↩ Change</button>
  </div>

  <div class="watk-summary">
    <div class="watk-sstat"><div class="l">Off Home</div><div class="v">${fK(aOff)}</div></div>
    <div class="watk-sstat"><div class="l">Generals Home</div><div class="v" style="color:${gensHome>=3?'#00ff88':gensHome>=1?'#ffaa00':'#ff4455'}">${gensHome}<span style="font-size:12px;color:#4a6a88"> / ${totalGenerals}</span></div></div>
    <div class="watk-sstat"><div class="l">Own NW</div><div class="v">${fK(prov.networth)}</div></div>
    <div class="watk-sstat"><div class="l">Targets Set</div><div class="v">${waveTargets.length}</div><div class="s">by war leader</div></div>
  </div>`;

  if(!waveTargets.length){
    h+=`<div class="watk-notarget">// No wave targets assigned yet<br><span style="font-size:11px">The war leader needs to set targets in the WAR BOARD tab first</span></div>`;
    el.innerHTML=h;return;
  }

  if(reason==='no_off'){
    h+=`<div class="watk-notarget">// No offensive data available for this province<br><span style="font-size:11px">SoM data needed to calculate attacks</span></div>`;
    el.innerHTML=h;return;
  }

  if(!attacks.length){
    h+=`<div class="watk-notarget">// No valid targets in NW range<br><span style="font-size:11px">Your NW (${fK(prov.networth)}) doesn't overlap with any wave target</span></div>`;
    el.innerHTML=h;return;
  }

  // Group by wave
  const byWave={};
  attacks.forEach(atk=>{
    const wn=atk.target.waveName||'Wave';
    if(!byWave[wn])byWave[wn]=[];
    byWave[wn].push(atk);
  });

  h+=`<div style="font-family:monospace;font-size:10px;color:#4a6a88;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #1e2d3d">// ATTACK PLAN</div>`;

  Object.entries(byWave).forEach(([wave,atkList])=>{
    h+=`<div class="watk-card">
    <div class="watk-header">
      <span class="watk-wave">// ${esc(wave.toUpperCase())}</span>
      <span style="font-family:monospace;font-size:10px;color:#4a6a88">${atkList.length} attack${atkList.length>1?'s':''}</span>
    </div>
    <div class="watk-body">`;

    atkList.forEach((atk,i)=>{
      const t=atk.target;
      const tp=t.tp;
      const away=tp?.som?.armiesAway?.length>0;
      const ops=t.item.province.requiredOps||[];
      const da=t.dAge;
      const genColor=atk.gens<=2?'#00ff88':atk.gens<=3?'#ffaa00':'#c8d8e8';
      const resultCls=atk.result==='yes'?'watk-yes':atk.result==='close'?'watk-cl':'watk-no';
      const resultLabel=atk.result==='yes'?'BREAKS':atk.result==='close'?'CLOSE':'RISKY';

      h+=`<div class="watk-row">
        <div class="watk-num" style="color:#4a6a88">${atk.n}</div>
        <div class="watk-main">
          <div class="watk-target">${esc(t.item.province.name)}${away?' <span style="color:#00ff88;font-size:11px">↗ army away</span>':''}</div>
          <div class="watk-detail">
            ${fK(t.tDef)} def · ${fK(atk.scaledOff||aOff*(atk.gens/totalGenerals))} off sent · ${atk.pct}% ratio
            ${da!=null?' · intel <span class="'+aC(da)+'">'+fA(da)+'</span> old':''}
            ${atk.note?'<br><span style="color:#ffaa00">⚠ '+esc(atk.note)+'</span>':''}
          </div>
          ${ops.length?`<div class="watk-ops">${ops.map(o=>`<span class="wtag" style="cursor:default">${o}</span>`).join('')}</div>`:''}
          ${t.item.province.notes?`<div style="margin-top:4px;font-size:10px;color:#7a9ab8;background:#151a22;padding:4px 6px;border-radius:2px;border-left:2px solid #00d4ff">${esc(t.item.province.notes)}</div>`:''}
        </div>
        <div class="watk-gen">
          <div class="watk-gen-num" style="color:${genColor}">${atk.gens}</div>
          <div class="watk-gen-label">generals</div>
        </div>
        <div class="watk-result ${resultCls}">${resultLabel}<br>${atk.pct}%</div>
      </div>`;
    });

    h+=`</div></div>`;
  });

  // Show all wave targets for context at the bottom
  h+=`<div style="margin-top:20px;font-family:monospace;font-size:10px;color:#4a6a88;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #1e2d3d">// ALL WAVE TARGETS (context)</div>
  <table style="width:100%;border-collapse:collapse;font-size:11px">
  <thead><tr>
    <th style="text-align:left;padding:5px 8px;font-size:9px;font-weight:700;color:#4a6a88;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #1e2d3d">Province</th>
    <th style="text-align:left;padding:5px 8px;font-size:9px;font-weight:700;color:#4a6a88;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #1e2d3d">Def Home</th>
    <th style="text-align:left;padding:5px 8px;font-size:9px;font-weight:700;color:#4a6a88;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #1e2d3d">NW</th>
    <th style="text-align:left;padding:5px 8px;font-size:9px;font-weight:700;color:#4a6a88;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #1e2d3d">Off/Def</th>
    <th style="text-align:left;padding:5px 8px;font-size:9px;font-weight:700;color:#4a6a88;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #1e2d3d">NW Range</th>
    <th style="text-align:left;padding:5px 8px;font-size:9px;font-weight:700;color:#4a6a88;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #1e2d3d">Army</th>
  </tr></thead><tbody>`;
  waveTargets.forEach(item=>{
    const tp=pd(item.province.slot);
    const tDef=tp?.calcs?.defPointsSummary?.defPointsHome||0;
    const tNW=tp?.networth||0;
    const nwOk=canHit(prov.networth,tNW);
    const breaks=aOff>tDef*1.01;
    const pct=tDef>0?Math.round(aOff/tDef*100):0;
    const away=tp?.som?.armiesAway?.length>0;
    const cls=!nwOk?'wmno':breaks?'wmyes':'wmcl';
    h+=`<tr style="border-bottom:1px solid #1e2d3d">
      <td style="padding:6px 8px;font-weight:600">${esc(item.province.name)}</td>
      <td style="padding:6px 8px;font-family:monospace">${fK(tDef)}</td>
      <td style="padding:6px 8px;font-family:monospace">${fK(tNW)}</td>
      <td style="padding:6px 8px"><span class="wmatch ${cls}">${pct}%</span></td>
      <td style="padding:6px 8px"><span class="wmatch ${nwOk?'wmyes':'wmno'}">${nwOk?'✓ in range':'✗ out'}</span></td>
      <td style="padding:6px 8px">${away?'<span style="color:#00ff88;font-family:monospace;font-size:10px">AWAY</span>':'—'}</td>
    </tr>`;
  });
  h+=`</tbody></table>`;

  el.innerHTML=h;
},
summary(){
  const el=$id('__wpc_summary');if(!S.own||!S.enemy){el.innerHTML='';return;}
  const wt=S.cols.slice(1).flatMap(c=>c.items),ua=S.cols[0]?.items.length||0;
  const atts=S.own.provinces.filter(p=>(p.som?.offPointsHome||0)>0);
  const totO=atts.reduce((s,p)=>s+(p.som?.offPointsHome||0),0);
  const totD=S.enemy.provinces.reduce((s,p)=>s+(p.calcs?.defPointsSummary?.defPointsHome||0),0);
  let h=`<div class="wsum">
  <div class="wscard"><div class="l">Targets</div><div class="v">${wt.length}</div><div class="s">${ua} unassigned</div></div>
  <div class="wscard"><div class="l">Attackers</div><div class="v">${atts.length}</div><div class="s">with SoM data</div></div>
  <div class="wscard"><div class="l">Total Off</div><div class="v">${fK(totO)}</div></div>
  <div class="wscard"><div class="l">Enemy Def</div><div class="v">${fK(totD)}</div><div class="s">known</div></div>
  </div><div class="wsech">Target Coverage</div>
  <table class="wtbl"><thead><tr><th>Province</th><th>Race</th><th>Def Home</th><th>Ops</th><th>Breakers</th><th>Intel</th><th>Army</th></tr></thead><tbody>`;
  wt.forEach(item=>{
    const p=pd(item.province.slot),def=p?.calcs?.defPointsSummary?.defPointsHome||0,da=p?.calcs?.defPointsSummary?.ageSeconds,ops=item.province.requiredOps||[],away=p?.som?.armiesAway?.length>0;
    const brk=atts.filter(a=>canHit(a.networth,p?.networth||1)&&(a.som?.offPointsHome||0)>def*1.01).length;
    const pct=atts.length>0?Math.round(brk/atts.length*100):0;
    h+=`<tr><td style="font-weight:700">${esc(item.province.name)}</td><td style="color:#4a6a88">${esc(item.province.race||'')}</td><td>${fK(def)}</td><td>${ops.map(o=>`<span class="wtag" style="cursor:default;font-size:8px">${o}</span>`).join('')||'—'}</td><td>${brk}/${atts.length} <span style="color:${pct>=50?'#00ff88':pct>0?'#ffaa00':'#ff4455'}">(${pct}%)</span></td><td><span class="${aC(da)}">${fA(da)}</span></td><td>${away?'<span style="color:#00ff88">AWAY</span>':'—'}</td></tr>`;
  });
  h+=`</tbody></table>`;el.innerHTML=h;
},
alerts(){
  const el=$id('__wpc_alerts');const al=[];
  if(S.enemy){S.enemy.provinces.forEach(p=>{
    const opa=p.sot?.opa||0;
    if(opa>80&&!p.som)al.push({c:'w',t:`Missing SoM: <b>${esc(p.name)}</b> — ${opa} OPA attacker`});
    p.som?.armiesAway?.forEach(a=>{al.push({c:'i',t:`Army away: <b>${esc(p.name)}</b> — ${a.oSpecs||0} oSpecs, ${a.land||0} acres, ${a.secondsRemaining>0?fA(a.secondsRemaining)+' to return':'overdue'}`});});
    if(p.sot?.food===0&&opa>0)al.push({c:'u',t:`No food: <b>${esc(p.name)}</b>`});
    if((p.sot?.money||0)<1000&&p.som)al.push({c:'w',t:`Low GC: <b>${esc(p.name)}</b> — ${fK(p.sot.money)} gc`});
    const da=p.calcs?.defPointsSummary?.ageSeconds;if(da!=null&&da>28800)al.push({c:'w',t:`Stale intel: <b>${esc(p.name)}</b> — ${fA(da)} old`});
  });}
  if(S.own){S.own.provinces.forEach(p=>{
    p.som?.armiesAway?.forEach(a=>{al.push({c:'i',t:`Own army away: <b>${esc(p.name)}</b> — ${a.secondsRemaining>0?fA(a.secondsRemaining)+' to return':'overdue'}`});});
    if((p.sot?.money||0)<500&&p.sot)al.push({c:'u',t:`Own low GC: <b>${esc(p.name)}</b> — ${fK(p.sot.money)} gc`});
  });}
  const ac=$id('__wpalc');if(ac){ac.textContent=al.length?' ('+al.length+')':'';ac.style.color=al.some(a=>a.c==='u')?'#ff4455':'#ffaa00';}
  el.innerHTML=al.length?al.map(a=>`<div class="walt"><span class="wabg ${a.c==='u'?'wau':a.c==='w'?'waw2':'wai'}">${a.c==='u'?'URGENT':a.c==='w'?'WARN':'INFO'}</span><span>${a.t}</span></div>`).join(''):`<div style="color:#4a6a88;font-family:monospace;font-size:11px;padding:20px 0">// No active alerts</div>`;
}
};

// Close ops on outside click
$id('__wpbd').addEventListener('click',e=>{const op=$id('__wpops');if(op.classList.contains('open')&&!op.contains(e.target)&&!e.target.closest('.wcard'))op.classList.remove('open');});

window.__wpA.init();
})();
