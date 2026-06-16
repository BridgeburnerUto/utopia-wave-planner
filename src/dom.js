// ── DOM ────────────────────────────────────────────────────────────────────
// Builds the overlay structure and injects styles.
// Called once during init. No business logic here.

function injectStyles() {
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  const lk = document.createElement('link');
  lk.rel = 'stylesheet';
  lk.href = 'https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;600;700&display=swap';
  document.head.appendChild(lk);
}

function buildOverlay() {
  const ov = document.createElement('div');
  ov.id = '__wp_overlay';
  ov.innerHTML = `
<div id="__wph">
  <div class="logo">⚔ WAVE PLANNER</div>
  <div id="__wptick" style="font-family:monospace;font-size:17px;color:#7a9090;display:none"></div>
  <div class="wrole">
    <span>View as:</span>
    <button class="wb" id="__wprole_leader" onclick="__wpA.setRole('leader')" style="border-color:#ffd400;color:#ffd400">⚔ Leader</button>
    <button class="wb" id="__wprole_player" onclick="__wpA.setRole('player')">🗡 Player</button>
  </div>
  <div id="__wpprovpick" style="display:none;align-items:center;gap:8px">
    <span style="font-size:17px;color:#7a9090;font-weight:700;letter-spacing:1px;text-transform:uppercase">My Province:</span>
    <select class="wpick" id="__wpprovsel" onchange="__wpA.pickProv(this.value)">
      <option value="">— select —</option>
    </select>
  </div>
  <button class="wb g" id="__wpsavebtn" onclick="__wpA.save()">💾 Save</button>
  <button class="wb" id="__wpsynbtn" onclick="__wpA.syncBackend()" title="Push current data to the companion app">⟳ Sync</button>
  <button class="wb" id="__wpnwbtn"  onclick="__wpA.toggleNWPanel()" title="Open wave target province pages to get real-time NW during a wave">⟳ NW</button>
  <button class="wb" onclick="__wpA.refresh()">↻ Refresh</button>
  <button class="wb r" onclick="document.getElementById('__wp_overlay').style.display='none'">✕ Close</button>
</div>

<div id="__wpnwpanel"></div>

<div id="__wptl">
  <div class="wkb"><div class="l">Own KD</div><div class="v" id="__wpown">—</div></div>
  <div class="wkb"><div class="l">Enemy</div><div class="v va" id="__wpene">—</div></div>
  <div class="wkb"><div class="l">War</div><div class="v" id="__wpwar">—</div></div>
  <div id="__wprit" style="display:contents"></div>
  <span class="wsav" id="__wpsav"></span>
</div>

<div id="__wptb">
  <div class="wt on"  id="__wpt_board"       onclick="__wpA.tab('board')">WAR BOARD</div>
  <div class="wt"     id="__wpt_player"      onclick="__wpA.tab('player')">MY ORDERS</div>
  <div class="wt"     id="__wpt_intel"       onclick="__wpA.tab('intel')">INTEL</div>
  <div class="wt"     id="__wpt_summary"     onclick="__wpA.tab('summary')">SUMMARY</div>
  <div class="wt"     id="__wpt_nwgraph"     onclick="__wpA.tab('nwgraph')">NW GRAPH</div>
  <div class="wt"     id="__wpt_alerts"      onclick="__wpA.tab('alerts')">ALERTS<span id="__wpalc"></span></div>
  <div class="wt"     id="__wpt_leaderboard" onclick="__wpA.tab('leaderboard')">LEADERBOARD</div>
  <div class="wt"     id="__wpt_kddb"        onclick="__wpA.tab('kddb')">KD DATABASE</div>
  <div class="wt"     id="__wpt_aistrategy"  onclick="__wpA.tab('aistrategy')">AI STRATEGY</div>
  <div class="wt"     id="__wpt_tmmatchup"  onclick="__wpA.tab('tmmatchup')">T/M MATCHUP</div>
</div>

<div id="__wpbd">
  <div id="__wpc_board"></div>
  <div id="__wpc_player"      style="display:none"></div>
  <div id="__wpc_intel"       style="display:none"></div>
  <div id="__wpc_summary"     style="display:none"></div>
  <div id="__wpc_nwgraph"     style="display:none"></div>
  <div id="__wpc_alerts"      style="display:none"></div>
  <div id="__wpc_leaderboard" style="display:none"></div>
  <div id="__wpc_kddb"        style="display:none"></div>
  <div id="__wpc_aistrategy"  style="display:none"></div>
  <div id="__wpc_tmmatchup"   style="display:none"></div>
  <div class="wops" id="__wpops"></div>
</div>`;

  document.body.appendChild(ov);

  // Close ritual dropdowns when clicking outside
  document.addEventListener('click', e => {
    if (!e.target.closest('.writ-badge') && !e.target.closest('.writ-drop')) {
      ['own','ene'].forEach(w => {
        const d = $id('__wprit_' + w + '_drop');
        if (d) d.style.display = 'none';
      });
    }
  });

  // Close ops panel when clicking outside it
  $id('__wpbd').addEventListener('click', e => {
    const op = $id('__wpops');
    if (op.classList.contains('open') && !op.contains(e.target) && !e.target.closest('.wcard')) {
      op.classList.remove('open');
    }
  });
}
