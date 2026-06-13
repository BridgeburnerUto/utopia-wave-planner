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

/** Update only the sync status line in the Alerts tab without full re-render */
function _refreshBackendStatus() {
  const el = document.getElementById('__wp_backend_status');
  if (!el) return;
  if (S.lastBackendError) {
    el.innerHTML = '<span style="color:#E05050">✗ ' + esc(S.lastBackendError) + '</span>';
  } else if (S.lastBackendSync) {
    const mins = Math.round((Date.now() - S.lastBackendSync) / 60000);
    const ago  = mins < 1 ? 'just now' : mins + 'm ago';
    el.innerHTML = '<span style="color:#60C040">✓ Synced ' + ago + '</span>';
  } else {
    el.innerHTML = '<span style="color:#7a9090">Not synced yet this session</span>';
  }
}

window.__wpA = {

  setIntelInterval(v) { S.intelInterval = parseInt(v, 10); renderIntel(); },
  refreshKdNews,

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

      // ── Load war plan from Firebase ────────────────────────────────────────
      // Primary storage: Firestore warplan/{kdId}
      // One-time migration path: if Firebase has no plan yet, try the old IS
      // WarPlan API and copy whatever it returns into Firebase so subsequent
      // reloads never touch the IS API for plan data again.

      const _kdId = S.own.location.replace(':', '_');
      let _planJson = null;

      // 1. Try Firebase (the new primary store)
      try {
        const fbDoc = await fbGet(`warplan/${_kdId}`);
        _planJson = fbDoc?.fields?.json?.stringValue || null;
        if (_planJson) console.log('[WavePlanner] War plan loaded from Firebase');
      } catch(e) {
        console.warn('[WavePlanner] Firebase plan load failed:', e.message);
      }

      // 2. One-time migration: no Firebase plan yet → try old IS WarPlan API
      if (!_planJson) {
        try {
          const _wp = await postWarPlan(S.own.location, {});
          if (_wp?.warPlanId) {
            const _isplan = await getWarPlan(S.own.location, _wp.warPlanId);
            if (_isplan?.json) {
              _planJson = _isplan.json;
              // Write to Firebase immediately so this migration never runs again
              await fbWrite(`warplan/${_kdId}`, {
                json:          _planJson,
                savedAt:       Date.now(),
                savedBy:       S.own.kingdomName || S.own.location,
                migratedFrom:  'IS_WarPlan_API',
              });
              console.log('[WavePlanner] War plan migrated from IS API → Firebase');
            }
          }
        } catch(e) {
          console.warn('[WavePlanner] IS API migration attempt failed:', e.message);
        }
      }

      // 3. Parse whichever plan we ended up with
      if (_planJson) {
        try {
          const parsed = JSON.parse(_planJson);
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
          S.apiEndpoint     = parsed.apiEndpoint    || '';
          S.apiKey          = parsed.apiKey         || '';
        } catch (e) { console.warn('[WavePlanner] Malformed plan JSON — starting fresh'); }
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

      // Refresh war status cache before rendering (feeds _atWar() in all tabs)
      _refreshWarStatus();

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

      // Sync IS dump to Cloud Run backend (for mobile companion)
      this.syncBackend();

      // Background auto-sync every 2 minutes while IS tab is open.
      // War leader just needs to keep the IS tab open during a wave.
      if (!window.__wpBackendTimer) {
        window.__wpBackendTimer = setInterval(() => window.__wpA.syncBackend(), 120000);
      }

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
      _refreshWarStatus();  // refresh war status cache after own + enemy are loaded
      this.meta();
      renderRitualBadges();
      snapshotNW();
      checkAndSendDiscordAlerts();
      this.syncBackend();
      renderBoard();
      renderAlerts();
      renderSummary();
      renderPlayer();
    } catch (e) {
      setSav('Refresh failed: ' + e.message, 'err');
      setTimeout(() => setSav('', ''), 5000);
      console.error('[WavePlanner] refresh error:', e);
    }
  },

  // ── War plan persistence ────────────────────────────────────────────────

  async save() {
    if (!S.own?.location) { setSav('No KD loaded', 'err'); return; }
    setSav('Saving...', 'ing');
    try {
      const kdId = S.own.location.replace(':', '_');
      const json = JSON.stringify({
        enemyLocation:   S.eLoc,
        provinces:       S.provinces,
        columns:         S.cols,
        thresholds:      S.thresholds,
        discordWebhook:  S.discordWebhook || '',
        ageStartDate:    S.ageStartDate   || 0,
        apiEndpoint:     S.apiEndpoint    || '',
        apiKey:          S.apiKey         || '',
      });
      const r = await fbWrite(`warplan/${kdId}`, {
        json,
        savedAt: Date.now(),
        savedBy: S.own.kingdomName || S.own.location,
      });
      setSav(r ? 'Saved ✓' : 'Failed', r ? 'ok' : 'err');
      if (r) {
        setTimeout(() => setSav('', ''), 3000);
        // Keep companion in sync — push updated plan (including provinces) to backend
        this.syncBackend();
      }
    } catch (e) {
      setSav('Error: ' + e.message, 'err');
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
    ['board', 'player', 'intel', 'summary', 'nwgraph', 'alerts', 'leaderboard', 'kddb', 'aistrategy'].forEach(x => {
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
    if (t === 'aistrategy')  renderAiStrategy();
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
  lbOpFilter,
  resyncOps,
  toggleMaxGain,
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
  setProvBloat,
  toggleAssignPicker,
  toggleProvAssign,
  openOps,
  closeOps,
  togOp,
  setNote(slot, v) { if (slot != null) _pp(slot).notes = v; },
  nwView(v) { S.nwView = v; renderNwGraph(); },

  /** Read current location inputs + reload graph */
  nwLoad() {
    const inA = $id('__wpnw_locA');
    const inB = $id('__wpnw_locB');
    if (inA) S.nwLocA = inA.value.trim();
    if (inB) S.nwLocB = inB.value.trim();
    // If in custom mode, read and persist the date inputs before re-rendering
    if (S.nwCustom) {
      const fromM = parseInt($id('__wpnw_fromM')?.value);
      const fromD = parseInt($id('__wpnw_fromD')?.value);
      const fromY = parseInt($id('__wpnw_fromY')?.value);
      const toM   = parseInt($id('__wpnw_toM')?.value);
      const toD   = parseInt($id('__wpnw_toD')?.value);
      const toY   = parseInt($id('__wpnw_toY')?.value);
      if (fromM && fromD && fromY) S.nwCustomFrom = { month: fromM, day: fromD, year: fromY };
      if (toM   && toD   && toY)  S.nwCustomTo   = { month: toM,   day: toD,   year: toY   };
    }
    renderNwGraph();
  },

  /** Set lookback preset — switches off custom mode */
  nwPreset(t) {
    S.nwLookback = t;
    S.nwCustom   = false;
    const inA = $id('__wpnw_locA');
    const inB = $id('__wpnw_locB');
    if (inA) S.nwLocA = inA.value.trim();
    if (inB) S.nwLocB = inB.value.trim();
    renderNwGraph();
  },

  /**
   * Scan kd_nw_history for when KD A and KD B were mutually at war.
   * Uses the stanceLoc field stored by the snapshot script (available after the
   * first run following the stance/wars update to scripts/snapshot.js).
   * On success: enables custom mode and auto-fills From/To with the war period.
   */
  async nwFindWar() {
    const inA = $id('__wpnw_locA');
    const inB = $id('__wpnw_locB');
    if (inA) S.nwLocA = inA.value.trim();
    if (inB) S.nwLocB = inB.value.trim();

    if (!S.nwLocA || !S.nwLocB) {
      alert('Enter both KD locations first.');
      return;
    }

    // Show loading in graph area without disturbing the controls
    const area = $id('__wpnwgraph_area');
    if (area) area.innerHTML = loadingHTML('SCANNING FOR WAR PERIOD...');

    // Query last 90 days (= full age worth of data) for both KDs
    const toTs   = Date.now();
    const fromTs = toTs - 90 * 24 * 3_600_000;

    try {
      const [docsA, docsB] = await Promise.all([
        fbQueryNWHistory(S.nwLocA, fromTs, toTs),
        fbQueryNWHistory(S.nwLocB, fromTs, toTs),
      ]);

      // Round each snapshot to its hourId so A and B snapshots align even if
      // storedAt differs by a few seconds within the same batch write.
      const hourOf = ts => Math.floor(ts / 3_600_000);

      // Hours where A was at war with B
      const warHoursA = new Set(
        docsA.filter(d => d.stanceLoc === S.nwLocB).map(d => hourOf(d.storedAt))
      );
      // Hours where B was at war with A
      const warHoursB = new Set(
        docsB.filter(d => d.stanceLoc === S.nwLocA).map(d => hourOf(d.storedAt))
      );

      // Mutual war = both at war with each other in the same hour
      const mutual = [...warHoursA].filter(h => warHoursB.has(h)).sort((a, b) => a - b);

      if (!mutual.length) {
        // Check if either KD has ANY stanceLoc data at all — helps diagnose
        const hasStanceA = docsA.some(d => 'stanceLoc' in d);
        const hint = hasStanceA
          ? `No mutual war found between <b>${esc(S.nwLocA)}</b> and <b>${esc(S.nwLocB)}</b> in the last 90 days of snapshots.`
          : `No stance data in stored snapshots yet.<br><span style="font-size:17px">Stance tracking was added recently — it will appear after the next hourly GitHub Actions run.</span>`;
        if (area) area.innerHTML = `<div style="color:#7a9090;font-family:monospace;font-size:19px;padding:20px 0;text-align:center">${hint}</div>`;
        return;
      }

      // Convert first and last mutual war hours to in-game dates
      const fromTs2  = mutual[0]        * 3_600_000;
      const toTs2    = mutual[mutual.length - 1] * 3_600_000;
      const fromDate = _tsToUtoDate(fromTs2);
      const toDate   = _tsToUtoDate(toTs2);

      if (!fromDate || !toDate) {
        if (area) area.innerHTML = `<div style="color:#e09040;font-size:19px;padding:20px 0">
          War period found (${mutual.length} ticks) but could not convert to in-game dates — refresh the tool and try again.
        </div>`;
        return;
      }

      // Auto-fill custom date range and re-render the full tab
      S.nwCustom     = true;
      S.nwCustomFrom = { month: fromDate.month, day: fromDate.day, year: fromDate.year };
      S.nwCustomTo   = { month: toDate.month,   day: toDate.day,   year: toDate.year };
      renderNwGraph();

    } catch(e) {
      if (area) area.innerHTML = `<div style="color:#E05050;font-family:monospace;font-size:19px;padding:20px 0">
        Error scanning snapshots: ${esc(e.message)}
      </div>`;
    }
  },

  /**
   * Same Firebase scan as nwFindWar() but targets the leaderboard filter.
   * Uses S.own.location and S.eLoc (already in state — no inputs needed).
   * On success sets the leaderboard to a custom date range matching the war.
   */
  async lbFindWar() {
    const ownLoc = S.own?.location;
    const eneLoc = S.eLoc;
    if (!ownLoc || !eneLoc) {
      alert('Own and enemy kingdom locations must be loaded first.');
      return;
    }

    // Show loading inside the leaderboard panel while we scan
    const el = $id('__wpc_leaderboard');
    if (el) el.innerHTML = loadingHTML('SCANNING FOR WAR PERIOD...');

    try {
      const records = await fetchBackendNews();
      if (!records.length) {
        renderLeaderboard();
        setTimeout(() => alert('No kingdom news data on the backend yet — install/run the news scraper userscript.'), 100);
        return;
      }

      const eneName = (S.enemy?.kingdomName || '').toLowerCase();
      const ownName = (S.own?.kingdomName  || '').toLowerCase();

      // Gather all war declarations & withdrawals (with dates) involving the
      // enemy kingdom, from every cached news edition.
      const decls  = [];
      const withds = [];
      records.forEach(rec => {
        const p = rec.parsed || {};
        (p.war_declarations || []).forEach(w => {
          const txt = ((w.attacker||'') + ' ' + (w.defender||'')).toLowerCase();
          if (eneName && txt.includes(eneName)) decls.push(w);
        });
        (p.war_withdrawals || []).forEach(w => {
          const txt = (w.party||'').toLowerCase();
          if ((eneName && txt.includes(eneName)) || (ownName && txt.includes(ownName)) || /^we\b|^our\b/.test(txt))
            withds.push(w);
        });
      });

      const withDate = arr => arr.map(e => ({...e, _d: _parseNewsDate(e.date)})).filter(e => e._d);
      const declsD  = withDate(decls);
      const withdsD = withDate(withds);

      if (!declsD.length) {
        renderLeaderboard();
        setTimeout(() => alert(`No war declaration involving ${S.enemy?.kingdomName || eneLoc} found in cached kingdom news.`), 100);
        return;
      }

      // Most recent declaration
      declsD.sort((a,b) => _utoToAbs(b._d.month,b._d.day,b._d.year) - _utoToAbs(a._d.month,a._d.day,a._d.year));
      const start = declsD[0]._d;
      const startAbs = _utoToAbs(start.month, start.day, start.year);

      // Earliest withdrawal after the declaration
      withdsD.sort((a,b) => _utoToAbs(a._d.month,a._d.day,a._d.year) - _utoToAbs(b._d.month,b._d.day,b._d.year));
      const endEntry = withdsD.find(e => _utoToAbs(e._d.month,e._d.day,e._d.year) >= startAbs);

      const cur = _parseUtoDate(S.currentTickName || '');
      const end = endEntry ? endEntry._d : cur;

      if (!end) {
        renderLeaderboard();
        setTimeout(() => alert('War start found but could not determine end date — refresh and try again.'), 100);
        return;
      }

      lbSetFilter('custom', {
        fromYear: start.year, fromMonth: start.month,
        toYear:   end.year,   toMonth:   end.month,
      });

    } catch(e) {
      renderLeaderboard();
      setTimeout(() => alert('Error scanning kingdom news: ' + e.message), 100);
    }
  },

  /** Toggle custom date range mode */
  nwToggleCustom() {
    // Snapshot location inputs before rebuilding
    const inA = $id('__wpnw_locA');
    const inB = $id('__wpnw_locB');
    if (inA) S.nwLocA = inA.value.trim();
    if (inB) S.nwLocB = inB.value.trim();
    S.nwCustom = !S.nwCustom;
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
  async resetDiscordState() {
    await resetDiscordAlertState();
    await checkAndSendDiscordAlerts();
    renderAlerts();
    setSav('Alert state reset — active alerts re-sent', 'ok');
    setTimeout(() => setSav('', ''), 3000);
  },

  // ── Backend sync (mobile companion) ─────────────────────────────────────────
  setApiEndpoint(url) {
    S.apiEndpoint = url.trim();
    S.lastBackendError = '';
    setSav('API endpoint saved — save plan to persist', 'ok');
    setTimeout(() => setSav('',''), 3000);
    _refreshBackendStatus();
  },
  setApiKey(key) {
    S.apiKey = key.trim();
    setSav('API key saved — save plan to persist', 'ok');
    setTimeout(() => setSav('',''), 3000);
  },

  async syncBackend() {
    if (!S.apiEndpoint) {
      S.lastBackendError = 'No API endpoint set — enter it in Alerts tab and save the plan';
      _refreshBackendStatus();
      return;
    }
    if (!S.own) {
      S.lastBackendError = 'Own kingdom data not loaded yet';
      _refreshBackendStatus();
      return;
    }
    try {
      const _syncIS = JSON.parse(localStorage.getItem('IntelState') || '{}');
      const payload = JSON.stringify({
        own:             S.own,
        enemy:           S.enemy,
        provinces:       S.provinces,
        thresholds:      S.thresholds,
        currentTickName: S.currentTickName,
        kingdomNews:     _syncIS.kingdomNews || null,  // enemy Snatched News data
      });
      const url = S.apiEndpoint.replace(/\/$/, '') + '/api.php?is_dump';
      const hdrs = { 'Content-Type': 'application/json' };
      if (S.apiKey) hdrs['X-WP-Key'] = S.apiKey;
      const r = await fetch(url, { method: 'POST', headers: hdrs, body: payload });
      if (!r.ok) {
        S.lastBackendError = 'Server returned ' + r.status + (r.status === 401 ? ' — check API key' : '');
        console.warn('[WavePlanner] Backend sync failed:', r.status);
      } else {
        S.lastBackendSync  = new Date();
        S.lastBackendError = '';
        console.log('[WavePlanner] IS dump synced to backend');
      }
    } catch(e) {
      S.lastBackendError = 'Network error: ' + e.message;
      console.warn('[WavePlanner] Backend sync error:', e.message);
    }
    _refreshBackendStatus();
  },

  /**
   * Toggle the NW refresh panel below the header.
   * Shows a list of wave-target province page links the war leader can click
   * one-by-one (direct anchor clicks bypass popup blockers).  Once the pages
   * have loaded and the IS integration has POSTed their data to the backend,
   * the war leader clicks "↺ Load fresh NW" to pull the updated values.
   *
   * Province profile URL: https://utopia-game.com/wol/game/province_profile/X/Y/slot
   */
  toggleNWPanel() {
    const panel = $id('__wpnwpanel');
    if (!panel) return;

    // Second click = close
    if (panel.style.display === 'flex') {
      panel.style.display = 'none';
      return;
    }

    if (!S.enemy?.provinces) {
      setSav('Load enemy data first', 'err'); setTimeout(() => setSav('',''), 3000); return;
    }
    if (!S.eLoc) {
      setSav('Enemy location not set', 'err'); setTimeout(() => setSav('',''), 3000); return;
    }

    const targets = S.enemy.provinces.filter(p => S.provinces[p.slot]?.wave);
    if (!targets.length) {
      setSav('No wave targets assigned', 'err'); setTimeout(() => setSav('',''), 3000); return;
    }

    const eLocPath = S.eLoc.replace(':', '/');
    const links = targets.map(p => {
      const slot = parseInt((p.slot + '').replace(/\[|\]/g, ''));
      const url  = `https://utopia-game.com/wol/game/province_profile/${eLocPath}/${slot}`;
      const nw   = p.networth ? fK(p.networth) : '?';
      return `<a class="wnwlink" href="${esc(url)}" target="_blank"
        onclick="this.classList.add('wv')"
      >${esc(p.name)} <span style="color:#7a9090;font-size:14px">${esc(nw)}</span></a>`;
    }).join('');

    panel.innerHTML = `
      <span class="wnwlabel">Open pages →</span>
      ${links}
      <div class="wdiv"></div>
      <button class="wb" onclick="__wpA.fetchFreshNW()" title="Pull latest NW from backend after opening the pages">↺ Load fresh NW</button>
      <button class="wb r" onclick="document.getElementById('__wpnwpanel').style.display='none'" style="padding:7px 10px">✕</button>
    `;
    panel.style.display = 'flex';
  },

  /**
   * Pull fresh NW values from the backend's ?targets endpoint and merge into
   * S.enemy.provinces.  Only uses data backed by an actual province_profile
   * page visit (last_province_profile timestamp present).
   * Called by the "↺ Load fresh NW" button in the NW panel.
   */
  async fetchFreshNW() {
    if (!S.apiEndpoint) {
      setSav('No backend endpoint — set in Alerts tab', 'err'); setTimeout(() => setSav('',''), 3000); return;
    }
    setSav('⟳ Loading fresh NW…');
    try {
      const url  = S.apiEndpoint.replace(/\/$/, '') + '/api.php?targets';
      const hdrs = {};
      if (S.apiKey) hdrs['X-WP-Key'] = S.apiKey;
      const resp = await fetch(url, { headers: hdrs });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const fresh = await resp.json();

      let updated = 0;
      for (const ti of fresh) {
        if (!ti.last_province_profile || !ti.coords) continue;
        // Match by slot from coords (X:Y:slot) — more reliable than name matching.
        // Also filter to current enemy KD only.
        const parts   = ti.coords.split(':');
        if (parts.length < 3) continue;
        const tiLoc   = parts[0] + ':' + parts[1];
        const tiSlot  = parseInt(parts[2]);
        if (tiLoc !== S.eLoc) continue;                  // wrong KD
        if (!S.provinces[tiSlot]?.wave) continue;        // not a wave target
        const p = S.enemy.provinces?.find(
          x => parseInt((x.slot + '').replace(/\[|\]/g, '')) === tiSlot
        );
        if (p && ti.networth != null) {
          p.networth = ti.networth;
          updated++;
        }
      }

      if (updated) {
        renderPlayer();
        setSav('✓ NW refreshed — ' + updated + ' province(s) updated', 'ok');
      } else {
        setSav('⟳ No fresh profile data yet — open the pages first, then try again', 'waw');
      }
      setTimeout(() => setSav('', ''), 5000);
    } catch(e) {
      setSav('✗ NW fetch failed: ' + e.message, 'err');
      setTimeout(() => setSav('', ''), 4000);
    }
  },

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

  // ── AI Strategy ──────────────────────────────────────────────────────────
  aiStrategyAnalyze: () => aiStrategyAnalyze(),

  // Manual stat overrides + raze/massacre claims (defined in player.js)
  setManualStat,
  claimAction,
  // Note: toggleNWPanel and fetchFreshNW are defined as methods above — no shorthand needed.
};