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
