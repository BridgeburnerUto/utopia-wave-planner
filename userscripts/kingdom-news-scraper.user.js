// ==UserScript==
// @name         Utopia Kingdom News Scraper
// @namespace    utopia-wave-planner
// @version      2.5
// @description  Periodically sends the Kingdom News page to the Wave Planner
//               backend so the Intel tab can show acres gained/lost, razes,
//               and massacres. Runs in the background on any game page —
//               only one kingdom member needs this installed.
// @match        https://utopia-game.com/wol/game/*
// @grant        GM_xmlhttpRequest
// @connect      europe-west1.run.app
// @downloadURL  https://bridgeburneruto.github.io/utopia-wave-planner/userscripts/kingdom-news-scraper.user.js
// @updateURL    https://bridgeburneruto.github.io/utopia-wave-planner/userscripts/kingdom-news-scraper.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ── Config ───────────────────────────────────────────────────────────────
  // Should match the "Backend sync" settings in the Wave Planner's Alerts tab.
  const ENDPOINT = 'https://utopia-intel-259283383296.europe-west1.run.app/';
  const API_KEY  = ''; // set if WP_API_KEY is configured on Cloud Run

  // Minimum time between scrapes, shared across all tabs via localStorage.
  const MIN_INTERVAL_MS = 90 * 1000; // 90 seconds
  const LS_KEY = 'wp_kdnews_last_scrape';
  // What the last send came back with — shared too, so every tab's status box
  // shows the same thing whichever tab actually did the sending.
  const LS_STATUS = 'wp_kdnews_status';   // {at, ok, edition, attacks, razes, massacres, err, type}

  const readStatus = () => { try { return JSON.parse(localStorage.getItem(LS_STATUS) || '{}'); } catch (e) { return {}; } };
  const writeStatus = (s) => { localStorage.setItem(LS_STATUS, JSON.stringify(s)); render(); };

  // The backend answers `{"success":true}` followed by the parsed record
  // (intel.php echoes one, parse.php the other). The second one carries what
  // the parser made of the page, which is what the status box reports.
  function readReply(text) {
    const i = (text || '').indexOf('}{');
    if (i < 0) return null;
    try { return JSON.parse(text.slice(i + 1)); } catch (e) { return null; }
  }

  function send(html, simple, url) {
    let prov = 'unknown';
    const provEl = document.querySelector('#province_name, .province-name, #ruler_name');
    if (provEl) prov = provEl.textContent.trim();

    const body = new URLSearchParams({
      prov,
      url,
      data_simple: simple,
      data_html: html,
      key: API_KEY,
    }).toString();

    GM_xmlhttpRequest({
      method: 'POST',
      url: ENDPOINT,
      data: body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      onload: (r) => {
        console.log('[KingdomNewsScraper] Sent to backend:', r.responseText);
        if (r.status !== 200 || !/"success"\s*:\s*true/.test(r.responseText || '')) {
          writeStatus({ ...readStatus(), at: Date.now(), ok: false, err: `backend answered HTTP ${r.status}` });
          return;
        }
        const rec = readReply(r.responseText);
        const p = rec?.parsed || {};
        writeStatus({
          at: Date.now(), ok: true, err: '', type: rec?.page_type || '?',
          edition: p.news_edition || '', attacks: (p.attacks || []).length,
          razes: (p.razes || []).length, massacres: (p.massacres || []).length,
        });
      },
      onerror: (e) => {
        console.warn('[KingdomNewsScraper] Failed to send:', e);
        writeStatus({ ...readStatus(), at: Date.now(), ok: false, err: 'could not reach the backend' + (e?.error ? ` (${e.error})` : '') });
      },
    });
  }

  function extractAndSend(doc, url) {
    const el = doc.getElementById('dynamic_content') || doc.body;
    if (!el) return;
    send(el.innerHTML, el.innerText, url);
  }

  // This is a single-page app — navigating to a new kingdom_news edition via
  // in-game links does NOT trigger a full page reload, so @match only fires
  // once. Watch for SPA navigation (URL/content changes) and re-scrape
  // whenever we land on (or are already on) a kingdom_news page.
  console.log('[KingdomNewsScraper] v2.5 loaded on', location.pathname);

  let lastScrapedPath = null;
  let lastScrapedAt   = 0;
  function scrapeIfKdNews(force) {
    if (!/\/wol\/game\/kingdom_news\//.test(location.pathname)) return;
    const isNewPath = location.pathname !== lastScrapedPath;
    const dueForRescrape = Date.now() - lastScrapedAt >= MIN_INTERVAL_MS;
    if (!force && !isNewPath && !dueForRescrape) return;
    console.log('[KingdomNewsScraper] scraping kd_news path:', location.pathname);
    lastScrapedPath = location.pathname;
    lastScrapedAt   = Date.now();
    extractAndSend(document, location.href);
    localStorage.setItem(LS_KEY, String(Date.now()));
  }

  // ── Background poll ─────────────────────────────────────────────────────
  // On any other game page, periodically fetch the current kingdom news
  // edition same-origin (no CORS issue since we're on utopia-game.com) and
  // POST it to the backend. Only one tab/player needs to be logged in for
  // this to keep the whole kingdom's data fresh.
  function maybeScrape(force) {
    const last = parseInt(localStorage.getItem(LS_KEY) || '0', 10);
    if (!force && Date.now() - last < MIN_INTERVAL_MS) return;
    localStorage.setItem(LS_KEY, String(Date.now())); // claim immediately to avoid duplicate fetches across tabs

    // "/wol/game/kingdom_news/" with no year/month redirects to the current edition.
    fetch('/wol/game/kingdom_news/', { credentials: 'include' })
      .then(r => r.text().then(text => ({ text, url: r.url })))
      .then(({ text, url }) => {
        const doc = new DOMParser().parseFromString(text, 'text/html');
        extractAndSend(doc, url);
      })
      .catch(e => {
        console.warn('[KingdomNewsScraper] Background fetch failed:', e.message);
        writeStatus({ ...readStatus(), at: Date.now(), ok: false, err: `could not fetch the news page (${e.message})` });
      });
  }

  // ── Status box ──────────────────────────────────────────────────────────
  // Shares a bottom-left dock with the activity collector's box: whichever
  // script loads first creates #__wpdock and the other appends to it, so the
  // two stack instead of covering each other, in either order.
  function dock() {
    let d = document.getElementById('__wpdock');
    if (!d) {
      d = document.createElement('div');
      d.id = '__wpdock';
      d.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;display:flex;flex-direction:column;'
        + 'gap:4px;align-items:flex-start;max-width:440px;pointer-events:none';
      document.body.appendChild(d);
    }
    return d;
  }
  const box = document.createElement('div');
  box.id = '__wpnews';
  box.style.cssText = 'background:#101a1a;color:#c8d8d8;border:1px solid #3a5050;border-radius:4px;padding:5px 9px;'
    + 'font:13px/1.4 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.5);pointer-events:auto';
  dock().appendChild(box);

  const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const pad = (n) => String(n).padStart(2, '0');
  const n = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;

  function render() {
    box.innerHTML = `📰 <b>News</b> <span id="__wpnews_st" style="color:#8fa8a8"></span>`
      + `<button data-a="now" title="Send the kingdom news now" style="font:12px sans-serif;margin-left:6px;padding:1px 7px;`
      + `background:#1d2b2b;color:#c8d8d8;border:1px solid #3a5050;border-radius:3px;cursor:pointer">↻</button>`
      + `<div id="__wpnews_err"></div>`;
    renderStatus();
  }

  // The countdown ticks every second, so it only touches its own lines —
  // re-rendering the button that often would swallow clicks on it.
  function renderStatus() {
    const st = document.getElementById('__wpnews_st'), er = document.getElementById('__wpnews_err');
    if (!st) return;
    const s = readStatus();
    const last = parseInt(localStorage.getItem(LS_KEY) || '0', 10);
    const next = Math.max(0, Math.round((last + MIN_INTERVAL_MS - Date.now()) / 1000));
    const ago = s.at ? Math.round((Date.now() - s.at) / 60e3) : null;
    const what = !s.at ? 'nothing sent yet'
      : !s.ok ? `last try ${ago}m ago`
      : s.type !== 'kd_news' ? `sent ${ago}m ago · not a news page (tick?)`
      : `sent ${ago}m ago · ${s.edition || 'edition ?'} · ${n(s.attacks, 'hit')} · ${n(s.razes, 'raze')}` + (s.massacres ? ` · ${n(s.massacres, 'massacre')}` : '');
    st.textContent = `${what} · next ${Math.floor(next / 60)}:${pad(next % 60)}`;
    er.innerHTML = s.ok === false && s.err ? `<span style="color:#ff7070">⚠ ${esc(s.err)}</span>` : '';
  }

  box.addEventListener('click', (e) => {
    if (e.target.closest('button')?.dataset.a === 'now') {
      if (/\/wol\/game\/kingdom_news\//.test(location.pathname)) scrapeIfKdNews(true);
      else maybeScrape(true);
    }
  });

  render();
  setInterval(renderStatus, 1000);
  scrapeIfKdNews(true);

  // Poll for SPA navigation (URL changes when clicking to a different
  // edition, no full reload) and for periodic re-scrapes of the same page
  // (in case new news has been published since we last looked).
  setInterval(() => {
    scrapeIfKdNews(false);
  }, 1000);

  // Run shortly after page load, then periodically while the tab is open.
  setTimeout(maybeScrape, 5000);
  setInterval(maybeScrape, MIN_INTERVAL_MS);
})();
