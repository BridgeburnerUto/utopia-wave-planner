// ── UTILS ──────────────────────────────────────────────────────────────────
// Pure helper functions. No DOM access, no state mutation, no API calls.
// Safe to unit-test independently. Add helpers here freely.

/** Format a large number: 1234567 → "1.2M", 12345 → "12k" */
function fK(n) {
  if (n == null) return '—';
  if (n >= 1e6)  return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'k';
  return Math.round(n) + '';
}

/** Format seconds as human duration: 3700 → "1h1m", 90000 → "1d" */
function fA(s) {
  if (s == null) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 48) return Math.floor(h / 24) + 'd';
  if (h > 0)   return h + 'h' + m + 'm';
  return m + 'm';
}

/** CSS class name for intel age colour: fresh=green, old=red */
function aC(s) {
  if (s == null) return 'wao';
  const h = s / 3600;
  if (h < 1)  return 'waf';
  if (h < 4)  return 'was';
  if (h < 12) return 'waw';
  return 'wao';
}

/** NW range check: can attacker NW a hit target NW? (75–133% rule) */
function canHit(attackerNW, targetNW) {
  const r = attackerNW / targetNW;
  return r >= 0.75 && r <= 1.33;
}

/** HTML-escape a string to prevent XSS in innerHTML strings */
function esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/**
 * Look up the live enemy province object for a card's slot string.
 * slot may be "[18]" or 18 — normalised inside.
 */
function pd(slot) {
  if (!S.enemy) return null;
  const n = parseInt((slot + '').replace(/\[|\]/g, ''));
  return S.enemy.provinces.find(p => p.slot === n);
}

/** Shorthand for document.getElementById */
function $id(id) {
  return document.getElementById(id);
}

/**
 * True if own KD is currently at war.
 *
 * Checks multiple sources in priority order — the IS API does not consistently
 * populate S.own.war or S.own.stance, so we fall through to richer sources:
 *
 *  1. S.own.war          — boolean from IS OwnKingdom API (unreliable but fast)
 *  2. S.own.stance       — string "war" or ["war","X:Y"] from world dump format
 *  3. S.enemy.war        — enemy KD data often carries this field more reliably
 *  4. S.enemy.stance     — same format as own stance
 *  5. S._warFromNews     — cached result of kingdomNews scan (set by _refreshWarStatus)
 *
 * Call _refreshWarStatus() after loading own/enemy data to keep the cache fresh.
 */
function _atWar() {
  if (!S.own) return false;

  // 1. Direct IS API boolean
  if (S.own.war === true) return true;

  // 2 & 3. Stance fields (own and enemy)
  for (const stance of [S.own.stance, S.enemy?.stance]) {
    if (!stance) continue;
    if (Array.isArray(stance) && stance[0]?.toLowerCase() === 'war') return true;
    if (typeof stance === 'string' && stance.toLowerCase() === 'war') return true;
  }

  // 4. Enemy boolean
  if (S.enemy?.war === true) return true;

  // 5. Cached kingdomNews scan result
  if (S._warFromNews === true) return true;

  return false;
}

/**
 * Scan kingdomNews.parseString for the most recent war/peace events.
 * Caches the result in S._warFromNews so _atWar() can read it without
 * re-scanning. Call once per refresh cycle.
 */
function _refreshWarStatus() {
  try {
    const IS   = JSON.parse(localStorage.getItem('IntelState') || '{}');
    const news = IS.kingdomNews?.parseString;
    if (!news) { S._warFromNews = false; return; }

    // Walk every line: track the absolute date of the most recent war declaration
    // and the most recent peace event.  If latest war > latest peace → still at war.
    let lastWarAbs   = -1;
    let lastPeaceAbs = -1;

    news.split('\n').forEach(line => {
      const parts = line.split('\t');
      if (parts.length < 2) return;
      // _parseUtoDate is defined in leaderboard.js / ritual.js (hoisted, available at runtime)
      const d = _parseUtoDate(parts[0].trim());
      if (!d) return;
      const abs  = _utoToAbs(d.month, d.day, d.year);
      const text = parts[1].toLowerCase();
      if (text.includes('declared war') || text.includes('at war with')) {
        if (abs > lastWarAbs) lastWarAbs = abs;
      } else if (text.includes('peace') || text.includes('ceasefire') || text.includes('white peace')) {
        if (abs > lastPeaceAbs) lastPeaceAbs = abs;
      }
    });

    S._warFromNews = lastWarAbs > 0 && lastWarAbs > lastPeaceAbs;
    if (S._warFromNews) console.log('[WavePlanner] War status from kingdomNews: AT WAR');
  } catch(e) {
    S._warFromNews = false;
  }
}

/** Update the save status indicator in the header */
function setSav(msg, cls) {
  const el = $id('__wpsav');
  if (el) {
    el.textContent = msg;
    el.className = 'wsav' + (cls ? ' ' + cls : '');
  }
}

/**
 * Safely render a tab content area.
 * Wraps the render function in try/catch so one broken tab can't crash others.
 * @param {string} elId  — DOM id of the tab content div
 * @param {Function} fn  — function that returns an HTML string
 */
function renderTab(elId, fn) {
  const el = $id(elId);
  if (!el) return;
  try {
    el.innerHTML = fn();
  } catch (e) {
    el.innerHTML = `<div class="wload" style="color:#ff4455">
      RENDER ERROR: ${esc(e.message)}<br>
      <span style="font-size:10px;color:#4a6a88">${esc(e.stack ? e.stack.split('\n')[1] : '')}</span>
    </div>`;
    console.error('[WavePlanner] render error in', elId, e);
  }
}

/** Loading spinner HTML — used while async data is in-flight */
function loadingHTML(msg) {
  return `<div class="wload"><div class="wspin"></div>${esc(msg || 'LOADING...')}</div>`;
}

/** Section heading HTML used in multiple tabs */
function sectionHead(label) {
  return `<div class="wsech">${esc(label)}</div>`;
}
