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
.wspin{display:inline-block;width:28px;height:28px;border:2px solid #1e2d3d;border-top-color:#00d4ff;border-radius:50%;animation:__wpspin .7s linear infinite}
.wload{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:200px;gap:12px;color:#4a6a88;font-family:monospace;font-size:12px;letter-spacing:1px}
.wsech{font-family:monospace;font-size:10px;color:#4a6a88;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #1e2d3d}
@keyframes __wpspin{to{transform:rotate(360deg)}}
`;

const DOPS=[{c:'BLI',l:'Blizzard'},{c:'CHA',l:'Chaos'},{c:'DG',l:'Dragon'},{c:'DR',l:'Drought'},{c:'ET',l:'Exp Thieves'},{c:'EX',l:'Expose'},{c:'FOG',l:'Fog'},{c:'GL',l:'Gluttony'},{c:'GR',l:'Greed'},{c:'IR',l:'Inspire'},{c:'MW',l:'Mind Wipe'},{c:'MS',l:'Miser'},{c:'NF',l:'Night Fall'},{c:'PF',l:'Plague'},{c:'SW',l:'Shadow'},{c:'Slo',l:'Slow Burn'},{c:'Sto',l:'Storm'},{c:'Wra',l:'Wrath'}];
const IOPS=[{c:'AR',l:'Arson'},{c:'AMN',l:'Amnesia'},{c:'ARS',l:'Gr.Arson'},{c:'AW',l:'Assassin'},{c:'FB',l:'Fireball'},{c:'GA',l:'Grab Army'},{c:'INF',l:'Infiltrate'},{c:'KN',l:'Kidnap'},{c:'LS',l:'Learn'},{c:'MV',l:'Massacre'},{c:'NM',l:'Nightmare'},{c:'NS',l:'Night Strike'},{c:'PROP',l:'Propaganda'},{c:'RG',l:'Raze'},{c:'RV',l:'Reveal'},{c:'RT',l:'Riot'},{c:'SB',l:'Spy Bldgs'},{c:'SWH',l:'Switcharoo'},{c:'TOR',l:'Tornado'},{c:'WRi',l:'War Ritual'}];

const S={token:TOKEN,server:SERVER,own:null,enemy:null,wpId:null,cols:[],tab:'board',drag:null,openSlot:null,eLoc:'5:3'};

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
<button class="wb g" onclick="__wpA.save()">💾 Save</button>
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
    this.meta();this.board();this.alerts();this.summary();this.player();
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
player(){
  const el=$id('__wpc_player');if(!S.own||!S.enemy){el.innerHTML='';return;}
  const waves=S.cols.slice(1).filter(c=>c.items.length>0);
  const atts=S.own.provinces.filter(p=>(p.som?.offPointsHome||0)>0);
  let h='';
  waves.forEach(col=>{
    h+=`<div class="wpc"><div class="wpch"><span style="font-family:monospace;font-size:10px;color:#00d4ff;letter-spacing:1px">// ${esc(col.title.toUpperCase())}</span><span style="font-family:monospace;font-size:10px;color:#4a6a88">${col.items.length} targets</span></div><div class="wpcb">`;
    col.items.forEach(item=>{
      const p=pd(item.province.slot),def=p?.calcs?.defPointsSummary?.defPointsHome||0,da=p?.calcs?.defPointsSummary?.ageSeconds,away=p?.som?.armiesAway?.length>0,ops=item.province.requiredOps||[];
      h+=`<div style="padding:8px 0;border-bottom:1px solid #1e2d3d">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
      <div><div style="font-size:14px;font-weight:700">${esc(item.province.name)}</div>
      <div style="font-family:monospace;font-size:10px;color:#4a6a88">${esc(item.province.race||'')} · ${fK(def)} def${away?' · <span style="color:#00ff88">ARMY AWAY</span>':''}</div></div>
      <span class="${aC(da)}" style="font-family:monospace;font-size:10px">${fA(da)}</span></div>`;
      if(atts.length&&def>0){
        h+=`<div style="margin-top:6px"><div style="font-size:9px;font-weight:700;color:#4a6a88;letter-spacing:1px;margin-bottom:4px">ATTACK MATCHUPS</div>`;
        atts.forEach(a=>{const aOff=a.som?.offPointsHome||0,nwOk=canHit(a.networth,p?.networth||1),brk=aOff>def*1.01,pct=def>0?Math.round(aOff/def*100):0;h+=`<span class="wmatch ${!nwOk?'wmno':brk?'wmyes':'wmcl'}">${esc(a.name.substring(0,10))} ${pct}%</span>`;});
        h+=`</div>`;
      }
      if(ops.length)h+=`<div style="margin-top:6px"><div style="font-size:9px;font-weight:700;color:#4a6a88;letter-spacing:1px;margin-bottom:3px">REQUIRED OPS</div>${ops.map(o=>`<span class="wtag" style="cursor:default">${o}</span>`).join('')}</div>`;
      if(item.province.notes)h+=`<div style="margin-top:6px;font-family:monospace;font-size:10px;color:#7a9ab8;background:#151a22;padding:5px 7px;border-radius:2px;border-left:2px solid #00d4ff">${esc(item.province.notes)}</div>`;
      h+=`</div>`;
    });
    h+=`</div></div>`;
  });
  if(!h)h=`<div style="color:#4a6a88;font-family:monospace;font-size:12px;padding:30px 0;text-align:center">// No wave targets set yet — war leader assigns them in WAR BOARD tab</div>`;
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
