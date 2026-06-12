// ==UserScript==
// @name         Utopia Kingdom News Scraper
// @namespace    utopia-wave-planner
// @version      2.4
// @description  Periodically sends the Kingdom News page to the Wave Planner
//               backend so the Intel tab can show acres gained/lost, razes,
//               and massacres. Runs in the background on any game page —
//               only one kingdom member needs this installed.
// @match        https://utopia-game.com/wol/game/*
// @grant        GM_xmlhttpRequest
// @connect      europe-west1.run.app
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
      onload: (r) => console.log('[KingdomNewsScraper] Sent to backend:', r.responseText),
      onerror: (e) => console.warn('[KingdomNewsScraper] Failed to send:', e),
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
  console.log('[KingdomNewsScraper] v2.3 loaded on', location.pathname);

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

  scrapeIfKdNews(true);

  // Poll for SPA navigation (URL changes when clicking to a different
  // edition, no full reload) and for periodic re-scrapes of the same page
  // (in case new news has been published since we last looked).
  setInterval(() => {
    scrapeIfKdNews(false);
  }, 1000);

  // ── Background poll ─────────────────────────────────────────────────────
  // On any other game page, periodically fetch the current kingdom news
  // edition same-origin (no CORS issue since we're on utopia-game.com) and
  // POST it to the backend. Only one tab/player needs to be logged in for
  // this to keep the whole kingdom's data fresh.
  function maybeScrape() {
    const last = parseInt(localStorage.getItem(LS_KEY) || '0', 10);
    if (Date.now() - last < MIN_INTERVAL_MS) return;
    localStorage.setItem(LS_KEY, String(Date.now())); // claim immediately to avoid duplicate fetches across tabs

    // "/wol/game/kingdom_news/" with no year/month redirects to the current edition.
    fetch('/wol/game/kingdom_news/', { credentials: 'include' })
      .then(r => r.text().then(text => ({ text, url: r.url })))
      .then(({ text, url }) => {
        const doc = new DOMParser().parseFromString(text, 'text/html');
        extractAndSend(doc, url);
      })
      .catch(e => console.warn('[KingdomNewsScraper] Background fetch failed:', e.message));
  }

  // Run shortly after page load, then periodically while the tab is open.
  setTimeout(maybeScrape, 5000);
  setInterval(maybeScrape, MIN_INTERVAL_MS);
})();
