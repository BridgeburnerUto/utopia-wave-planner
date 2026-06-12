// ==UserScript==
// @name         Utopia Kingdom News Scraper
// @namespace    utopia-wave-planner
// @version      2.0
// @description  Periodically sends the Kingdom News page to the Wave Planner
//               backend so the Intel tab can show acres gained/lost, razes,
//               and massacres. Runs in the background on any game page —
//               only one kingdom member needs this installed.
// @match        https://utopia-game.com/wol/game/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ── Config ───────────────────────────────────────────────────────────────
  // Should match the "Backend sync" settings in the Wave Planner's Alerts tab.
  const ENDPOINT = 'https://utopia-intel-259283383296.europe-west1.run.app/';
  const API_KEY  = ''; // set if WP_API_KEY is configured on Cloud Run

  // Minimum time between scrapes, shared across all tabs via localStorage.
  const MIN_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
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
    });

    fetch(ENDPOINT, { method: 'POST', body })
      .then(r => r.json())
      .then(j => console.log('[KingdomNewsScraper] Sent to backend:', j))
      .catch(e => console.warn('[KingdomNewsScraper] Failed to send:', e.message));
  }

  function extractAndSend(doc, url) {
    const el = doc.getElementById('dynamic_content') || doc.body;
    if (!el) return;
    send(el.innerHTML, el.innerText, url);
  }

  // If we're already on a kingdom_news page, scrape it directly — no need to fetch.
  if (/\/wol\/game\/kingdom_news\//.test(location.pathname)) {
    extractAndSend(document, location.href);
    localStorage.setItem(LS_KEY, String(Date.now()));
    return;
  }

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

  // Run shortly after page load, then every few minutes while the tab is open.
  setTimeout(maybeScrape, 5000);
  setInterval(maybeScrape, 5 * 60 * 1000);
})();
