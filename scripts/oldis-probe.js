// Old IS probe — reconnaissance for hooking intel.utopia-game.com up as a second
// wage-rate source (the new IS exposes som.eff but never the wage rate itself).
//
// HOW TO RUN: log into the old IS from in-game (it answers "You can only login
// from in-game", so the session must come from a game click-through), open your
// kingdom's province list there, then paste this into the browser console ON
// THAT PAGE. Output lands in a full-screen textarea, pre-selected — Ctrl+C, Esc.
//
// Nothing is sent anywhere. This only reads the page you are already looking at
// plus, optionally, same-origin URLs you approve one at a time (see FETCH below).
//
// What we need from the output, in priority order:
//   1. Whether the old IS has a JSON API (a fetch/XHR we can call directly), or
//      whether the wage rate only exists as rendered HTML we must scrape.
//   2. Where the per-province wage rate lives — the selector or JSON path.
//   3. How a province is identified there (slot? name? kd location?) so the
//      values can be joined onto S.provinces.

(() => {
  const out = [];
  const MAX = 4000;
  const cut = (s, n = MAX) => (s || '').length > n ? s.slice(0, n) + `\n… (+${s.length - n} chars)` : s;

  out.push(`==== ${location.origin}${location.pathname}${location.search} ====`);
  out.push(`title: ${document.title}`);

  // ── 1. Is there a JSON app underneath? ────────────────────────────────────
  // Modern SPA → look for a bootstrap blob; classic PHP → nothing here.
  const blobs = [];
  for (const s of document.querySelectorAll('script')) {
    const t = s.textContent || '';
    if (/wage/i.test(t)) blobs.push(`[inline script, ${t.length} chars, matches /wage/i]\n` + cut(t, 1500));
    const src = s.getAttribute('src');
    if (src) blobs.push(`[src] ${src}`);
  }
  for (const k of ['__INITIAL_STATE__', '__NEXT_DATA__', '__NUXT__', 'initialState', 'appData']) {
    if (window[k]) blobs.push(`[window.${k}]\n` + cut(JSON.stringify(window[k]), 2000));
  }
  out.push(`--- scripts / bootstrap ---\n${blobs.join('\n') || '(none)'}`);

  // ── 2. Where does the string "wage" appear in the rendered page? ──────────
  const hits = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!/wage/i.test(n.nodeValue || '')) continue;
    const el = n.parentElement;
    const path = [];
    for (let e = el; e && e !== document.body && path.length < 6; e = e.parentElement) {
      path.unshift(e.tagName.toLowerCase()
        + (e.id ? '#' + e.id : '')
        + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''));
    }
    hits.push(`${path.join(' > ')}\n    text: ${n.nodeValue.trim().replace(/\s+/g, ' ').slice(0, 200)}`
      + `\n    row: ${(el.closest('tr')?.innerText || '').replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  out.push(`--- "wage" in the DOM (${hits.length} hits) ---\n${cut(hits.join('\n') || '(none on this page)')}`);

  // ── 3. Tables (province list shape + how provinces are keyed) ─────────────
  const tables = [...document.querySelectorAll('table')].map((t, i) => {
    const rows = [...t.querySelectorAll('tr')].slice(0, 6).map(tr =>
      [...tr.querySelectorAll('th,td')].map(c => c.innerText.trim().replace(/\s+/g, ' ')).join(' | ')
    ).filter(Boolean);
    return `-- table ${i} (${t.querySelectorAll('tr').length} rows, first 6) --\n` + rows.join('\n');
  });
  out.push(`--- tables ---\n${cut(tables.join('\n') || '(no tables)')}`);

  // ── 4. Links — the province/SoM detail pages we would have to walk ────────
  const links = [...new Set([...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')))]
    .filter(h => h && !/^(#|javascript:)/.test(h)).slice(0, 60);
  out.push(`--- links (first 60) ---\n${links.join('\n') || '(none)'}`);

  // ── 5. FETCH (optional) — same-origin only, off by default ────────────────
  // If the probe above shows an API path, set PROBE_URLS to those paths and
  // re-run. Same-origin GETs with your existing session; nothing leaves the
  // old IS. Leave empty on the first run.
  const PROBE_URLS = [];
  const finish = () => {
    const text = out.join('\n\n');
    console.log(text);
    const ta = document.createElement('textarea');
    ta.value = text;
    Object.assign(ta.style, {
      position: 'fixed', inset: '0', zIndex: 999999, width: '100%', height: '100%',
      fontFamily: 'monospace', fontSize: '12px', background: '#111', color: '#eee',
    });
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const esc = (e) => { if (e.key === 'Escape') { ta.remove(); document.removeEventListener('keydown', esc); } };
    document.addEventListener('keydown', esc);
    console.log('>>> textarea open and selected — Ctrl+C to copy, Esc to close');
  };

  if (!PROBE_URLS.length) return finish();
  Promise.all(PROBE_URLS.map(u =>
    fetch(u, { credentials: 'same-origin' })
      .then(r => r.text().then(t => `--- GET ${u} → ${r.status} ${r.headers.get('content-type')} ---\n${cut(t, 3000)}`))
      .catch(e => `--- GET ${u} → FAILED: ${e.message} ---`)
  )).then(rs => { out.push(...rs); finish(); });
})();
