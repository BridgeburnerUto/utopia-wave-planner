// ── APP ────────────────────────────────────────────────────────────────────
// Top-level orchestration: init, refresh, save, tab switching, role, meta.
// This is the only file that touches window.__wpA.

window.__wpA = {

  // ── Initialisation ──────────────────────────────────────────────────────

  async init() {
    $id('__wpc_board').innerHTML = loadingHTML('FETCHING INTEL...');
    try {
      // Load own kingdom
      const od = await fetchOwnKingdom();
      S.own = od.kingdom;
      if (od.currentTick) {
        const t = $id('__wptick');
        t.textContent = `Tick ${od.currentTick.tickNumber} · ${od.currentTick.tickName}`;
        t.style.display = '';
      }

      // Create/load war plan
      const wp = await postWarPlan(S.own.location, {});
      if (wp) {
        S.wpId = wp.warPlanId;
        const plan = await getWarPlan(S.own.location, S.wpId);
        if (plan?.json) {
          try {
            const parsed = JSON.parse(plan.json);
            S.cols      = parsed.columns      || [];
            S.eLoc      = parsed.enemyLocation || S.eLoc;
            S.thresholds = parsed.thresholds   || S.thresholds;
          } catch (e) { /* malformed saved plan — start fresh */ }
        }
      }

      // Load enemy and seed cols if needed
      await this.loadEnemy(S.eLoc);
      if (!S.cols.length) initCols();

      // Render all tabs
      this.meta();
      renderBoard();
      renderAlerts();
      renderSummary();
      renderPlayer();
      this.setRole('leader');

      // Silent background op sync — never blocks UI
      syncOps();

    } catch (e) {
      $id('__wpc_board').innerHTML = `<div class="wload" style="color:#ff4455">ERROR: ${esc(e.message)}</div>`;
    }
  },

  // ── Data loading ────────────────────────────────────────────────────────

  async loadEnemy(loc) {
    const l = loc || $id('__wpeloc')?.value || '5:3';
    S.eLoc  = l;
    const d = await fetchEnemyKingdom(l);
    if (d) {
      S.enemy = d.kingdom;
      $id('__wpene').textContent = S.enemy.kingdomName || l;
      const tl = S.enemy.provinces.reduce((s, p) => s + (p.land || 0), 0);
      const es = $id('__wpestats');
      if (es) es.textContent = `${S.enemy.provinces.length} provs · ${fK(tl)} land`;
    }
  },

  async refresh() {
    $id('__wpc_board').innerHTML = loadingHTML('REFRESHING...');
    try {
      const od = await fetchOwnKingdom();
      S.own = od.kingdom;
      if (od.currentTick) {
        const t = $id('__wptick');
        t.textContent = `Tick ${od.currentTick.tickNumber} · ${od.currentTick.tickName}`;
      }
      await this.loadEnemy(S.eLoc);
      this.meta();
      renderBoard();
      renderAlerts();
      renderSummary();
      renderPlayer();
    } catch (e) { /* silent — board will show stale data */ }
  },

  // ── War plan persistence ────────────────────────────────────────────────

  async save() {
    if (!S.wpId) { setSav('No plan ID', 'err'); return; }
    setSav('Saving...', 'ing');
    try {
      const json = JSON.stringify({
        title:         'Wave Plan',
        content:       '',
        enemyLocation: S.eLoc,
        columns:       S.cols,
        thresholds:    S.thresholds,
      });
      const r = await postWarPlan(S.own.location, { json, warPlanId: S.wpId });
      setSav(r ? 'Saved ✓' : 'Failed', r ? 'ok' : 'err');
      if (r) setTimeout(() => setSav('', ''), 3000);
    } catch (e) {
      setSav('Error', 'err');
    }
  },

  // ── Header / meta ───────────────────────────────────────────────────────

  meta() {
    if (!S.own) return;
    $id('__wpown').textContent = S.own.kingdomName || S.own.location;
    const w = $id('__wpwar');
    if (S.own.war) { w.textContent = '⚔ WAR'; w.style.color = '#ff4455'; }
    else           { w.textContent = 'Peace'; w.style.color = '#7a9ab8'; }
  },

  // ── Tab switching ───────────────────────────────────────────────────────

  tab(t) {
    S.tab = t;
    ['board', 'player', 'summary', 'alerts', 'leaderboard'].forEach(x => {
      $id('__wpc_' + x).style.display = x === t ? '' : 'none';
      const el = $id('__wpt_' + x);
      el.className = 'wt' + (x === t ? (x === 'player' ? ' on ong' : ' on') : '');
    });
    // Trigger renders that are async or need fresh data
    if (t === 'player')      renderPlayer();
    if (t === 'summary')     renderSummary();
    if (t === 'alerts')      renderAlerts();
    if (t === 'leaderboard') renderLeaderboard();
  },

  // ── Role switching ──────────────────────────────────────────────────────

  setRole(role) {
    S.role = role;
    const isLeader = role === 'leader';

    $id('__wprole_leader').style.borderColor = isLeader ? '#00d4ff' : '';
    $id('__wprole_leader').style.color       = isLeader ? '#00d4ff' : '';
    $id('__wprole_player').style.borderColor = !isLeader ? '#00ff88' : '';
    $id('__wprole_player').style.color       = !isLeader ? '#00ff88' : '';

    $id('__wpsavebtn').style.display    = isLeader ? '' : 'none';
    $id('__wpprovpick').style.display   = isLeader ? 'none' : 'flex';

    if (!isLeader && S.own) {
      const sel = $id('__wpprovsel');
      sel.innerHTML = '<option value="">— select your province —</option>';
      S.own.provinces.forEach(p => {
        const opt     = document.createElement('option');
        opt.value     = p.slot;
        opt.textContent = p.name + (p.discord ? ' (' + p.discord + ')' : '');
        if (S.playerProv && S.playerProv.slot === p.slot) opt.selected = true;
        sel.appendChild(opt);
      });
    }

    if (!isLeader) this.tab('player');
    else           this.tab('board');
  },

  // ── Delegated public methods (called from inline onclick= in HTML) ──────
  // These thin wrappers keep window.__wpA as the single public API surface.

  initCols,
  ds:       boardDragStart,
  drop:     boardDrop,
  addCol,
  delCol,
  openOps,
  closeOps,
  togOp,
  rmOp,
  setNote,
  pickProv,
  setThr,
  lbView,
};
