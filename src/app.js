// ═══ app.js ═══
// ── APP ────────────────────────────────────────────────────────────────────
// Top-level orchestration: init, refresh, save, tab switching, role, meta.
// This is the only file that touches window.__wpA.

/** Run backfill once per kingdom — stores a flag in Firebase so it never repeats */
async function _runBackfillOnce() {
  const kdId = S.own?.location.replace(':', '_');
  if (!kdId) return;
  try {
    const flag = await fbGet(`meta/${kdId}_backfill_v1`);
    if (flag?.fields?.done?.booleanValue) return; // already done
    await backfillOpDates();
    await fbWrite(`meta/${kdId}_backfill_v1`, { done: true, ranAt: Date.now() });
  } catch(e) {
    console.log('[WavePlanner] Backfill check failed:', e.message);
  }
}

window.__wpA = {

  // ── Initialisation ──────────────────────────────────────────────────────

  async init() {
    $id('__wpc_board').innerHTML = loadingHTML('FETCHING INTEL...');
    try {
      // Load own kingdom
      const od = await fetchOwnKingdom();
      S.own = od.kingdom;
      if (od.currentTick) {
        S.own.currentTick = od.currentTick;
        S.currentTickName = od.currentTick.tickName;
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
            // Load new provinces format
            if (parsed.provinces) {
              S.provinces = parsed.provinces;
            } else {
              // Migrate old kanban cols format
              S.cols = parsed.columns || [];
            }
            // IS.enemyKd wins on load; plan's saved enemy is fallback only
            if (!S.eLoc && parsed.enemyLocation) S.eLoc = parsed.enemyLocation;
            // Merge saved thresholds — also migrate old format {food,gc,runes} to new keys
            if (parsed.thresholds) {
              const t = parsed.thresholds;
              S.thresholds = {
                ...S.thresholds,
                enemyFoodRich:  t.enemyFoodRich  ?? t.food  ?? 0,
                enemyFoodLow:   t.enemyFoodLow   ?? 0,
                enemyGcRich:    t.enemyGcRich    ?? t.gc    ?? 0,
                enemyRunesRich: t.enemyRunesRich ?? t.runes ?? 0,
                ownFoodLow:     t.ownFoodLow     ?? 0,
                ownPeasLow:     t.ownPeasLow     ?? 0,
              };
            }
            S.discordWebhook  = parsed.discordWebhook || '';
            S.ageStartDate    = parsed.ageStartDate   || 0;
          } catch (e) { /* malformed saved plan — start fresh */ }
        }
      }

      // IS enemy overrides only when IS explicitly has one set
      const _isAfterLoad = JSON.parse(localStorage.getItem('IntelState') || '{}');
      if (_isAfterLoad.enemyKd) {
        if (_isAfterLoad.enemyKd !== S.eLoc)
          console.log(`[WavePlanner] IS enemy override: ${S.eLoc} → ${_isAfterLoad.enemyKd}`);
        S.eLoc = _isAfterLoad.enemyKd;
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

      // Load age start date from Firestore (authoritative source for GitHub Actions)
      fbGet('meta/nw_cleanup').then(doc => {
        const ts = doc?.fields?.ageStartDate ? parseInt(doc.fields.ageStartDate.integerValue || 0) : 0;
        if (ts > S.ageStartDate) S.ageStartDate = ts; // Firestore wins if newer
      }).catch(() => {});

      // Discord alert check — only fires on state changes
      checkAndSendDiscordAlerts();

      // NW snapshot (war only) + cleanup old snapshots
      snapshotNW();
      cleanOldSnapshots();

      // Backfill utoYear/utoMonth on old ops (runs once, skips if already done)
      _runBackfillOnce();

      // Render ritual badges and load SN ack state
      renderRitualBadges();
      loadSnAck().then(() => renderAlerts());

      // Silent background op sync — never blocks UI
      syncOps();

    } catch (e) {
      $id('__wpc_board').innerHTML = `<div class="wload" style="color:#E05050">ERROR: ${esc(e.message)}</div>`;
    }
  },

  // ── Data loading ────────────────────────────────────────────────────────

  async loadEnemy(loc) {
    const l = loc || $id('__wpeloc')?.value || '';
    if (!l) return; // no enemy set — wait for user to enter one on IS
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
      // Always re-read enemy from IS — IS is the source of truth for current enemy
      const _is = JSON.parse(localStorage.getItem('IntelState') || '{}');
      if (_is.enemyKd) {
        if (_is.enemyKd !== S.eLoc) console.log(`[WavePlanner] Enemy: ${S.eLoc} → ${_is.enemyKd}`);
        S.eLoc = _is.enemyKd;
      }
      const od = await fetchOwnKingdom();
      S.own = od.kingdom;
      if (od.currentTick) {
        S.own.currentTick = od.currentTick;
        S.currentTickName = od.currentTick.tickName;
        const t = $id('__wptick');
        t.textContent = `Tick ${od.currentTick.tickNumber} · ${od.currentTick.tickName}`;
      }
      await this.loadEnemy(S.eLoc);
      this.meta();
      renderRitualBadges();
      snapshotNW();
      checkAndSendDiscordAlerts();
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
        enemyLocation:   S.eLoc,
        provinces:       S.provinces,
        columns:         S.cols,
        thresholds:      S.thresholds,
        discordWebhook:  S.discordWebhook || '',
        ageStartDate:    S.ageStartDate   || 0,
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
    if (_atWar()) { w.textContent = '⚔ WAR'; w.style.color = '#E05050'; }
    else          { w.textContent = 'Peace'; w.style.color = '#c8a060'; }
  },

  // ── Tab switching ───────────────────────────────────────────────────────

  tab(t) {
    S.tab = t;
    ['board', 'player', 'intel', 'summary', 'nwgraph', 'alerts', 'leaderboard', 'kddb'].forEach(x => {
      $id('__wpc_' + x).style.display = x === t ? '' : 'none';
      const el = $id('__wpt_' + x);
      el.className = 'wt' + (x === t ? (x === 'player' ? ' on ong' : ' on') : '');
    });
    // Trigger renders that are async or need fresh data
    if (t === 'player')      renderPlayer();
    if (t === 'intel')       renderIntel();
    if (t === 'summary')     renderSummary();
    if (t === 'nwgraph')     renderNwGraph();
    if (t === 'alerts')      renderAlerts();
    if (t === 'leaderboard') renderLeaderboard();
    if (t === 'kddb')        renderKddb();
  },

  // ── Role switching ──────────────────────────────────────────────────────

  setRole(role) {
    S.role = role;
    const isLeader = role === 'leader';

    $id('__wprole_leader').style.borderColor = isLeader ? '#D4A017' : '';
    $id('__wprole_leader').style.color       = isLeader ? '#D4A017' : '';
    $id('__wprole_player').style.borderColor = !isLeader ? '#60C040' : '';
    $id('__wprole_player').style.color       = !isLeader ? '#60C040' : '';

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
  pickProv,
  setThr,
  lbView,
  lbSetFilter,
  // Render functions exposed for use in edge cases
  renderBoard,
  renderAlerts,
  renderSummary,
  renderPlayer,
  renderIntel,
  renderNwGraph,
  renderLeaderboard,
  intelSort,
  boardSort,
  setProvWave,
  setProvNeedsRaze,
  setProvNeedsMassacre,
  openOps,
  closeOps,
  togOp,
  setNote(slot, v) { if (slot != null) _pp(slot).notes = v; },
  setIntelInterval(v) { S.intelInterval = v; renderIntel(); },
  nwView(v) { S.nwView = v; renderNwGraph(); },

  /** Read current location inputs + reload graph */
  nwLoad() {
    const inA = $id('__wpnw_locA');
    const inB = $id('__wpnw_locB');
    if (inA) S.nwLocA = inA.value.trim();
    if (inB) S.nwLocB = inB.value.trim();
    renderNwGraph();
  },

  /** Set lookback preset (reads current location inputs too) */
  nwPreset(t) {
    S.nwLookback = t;
    const inA = $id('__wpnw_locA');
    const inB = $id('__wpnw_locB');
    if (inA) S.nwLocA = inA.value.trim();
    if (inB) S.nwLocB = inB.value.trim();
    renderNwGraph();
  },

  /** Set the age start date (leader action) — writes to Firestore for GitHub Actions */
  async setAgeStart(dateStr) {
    const ts = dateStr ? new Date(dateStr).getTime() : 0;
    S.ageStartDate = ts;
    // Write to dedicated meta doc so GitHub Actions can read it
    await fbWrite('meta/nw_cleanup', {
      ageStartDate: ts,
      setBy:        S.own?.kingdomName || S.own?.location || '',
      setAt:        Date.now(),
    });
    setSav(ts ? 'Age start saved — Actions will clean old data next run' : 'Age start cleared', 'ok');
    setTimeout(() => setSav('', ''), 4000);
    renderAlerts(); // refresh the hint text under the date input
  },
  setDiscordWebhook(url) { S.discordWebhook = url.trim(); setSav('Webhook saved — save plan to persist', 'ok'); setTimeout(() => setSav('',''), 3000); },
  testDiscord() { testDiscordWebhook(S.discordWebhook).then(ok => alert(ok ? '✅ Test ping sent!' : '❌ Failed — check webhook URL')); },

  async clearPlan() {
    if (!confirm('Clear all war plan data?\n\nThis will:\n• Reset all wave assignments\n• Clear all raze/massacre targets\n• Clear all op assignments and notes\n• Reset thresholds\n\nDiscord webhook is kept.\nThis cannot be undone.')) return;
    // Reset in-memory state
    S.provinces  = {};
    S.cols       = [];
    S.thresholds = { enemyFoodRich:0, enemyFoodLow:0, enemyGcRich:0, enemyRunesRich:0, ownFoodLow:0, ownPeasLow:0 };
    // Keep Discord webhook — user doesn't want to re-enter it each war
    // Save empty plan to IS backend to overwrite the saved one
    await this.save();
    // Re-init columns from current enemy
    if (S.enemy) initCols();
    // Re-render everything
    this.meta();
    renderBoard();
    renderAlerts();
    renderSummary();
    renderPlayer();
    setSav('War plan cleared', 'ok');
    setTimeout(() => setSav('', ''), 3000);
  },
  toggleRitual,
  snAck,

  // Custom period picker — accumulates field changes then applies on button click
  _lbCustom(field, val) {
    S.lbFilter[field] = parseInt(val) || null;
  },
  _lbApplyCustom() {
    S.lbFilter.mode = 'custom';
    renderLeaderboard();
  },

  // ── Kingdom Database tab ─────────────────────────────────────────────────
  kddbSave:       () => _kddbSaveSnapshot(),
  kddbSetAge:     (v) => _kddbSetAge(v),
  kddbConfirm:    (snapId, identityId) => _kddbConfirm(snapId, identityId),
  kddbWrong:      (identityId) => { _kddbMatches = _kddbMatches.filter(m => m.identityId !== identityId); renderKddb(); },
  kddbCreate:     (label, snapId) => _kddbCreateIdentity(label, snapId),
  kddbCreateNew:  async () => { const l = prompt('New identity name:'); if (l?.trim()) await _kddbCreateIdentity(l.trim(), null); },
  kddbDelete:     (id) => _kddbDeleteIdentity(id),
  kddbRename:     (id) => _kddbRenameIdentity(id),
  kddbSearch:     (q) => { _kddbSearch = q; const el = $id('__wpkddb_idlist'); if (el) el.innerHTML = _kddbBuildIdRows(); },
  kddbTagAll:     () => _kddbOpenTagView(),
  kddbTagBack:    () => { _kddbView = 'main'; renderKddb(); },
  kddbTagConfirm: (snapId, identityId) => _kddbConfirm(snapId, identityId),
};