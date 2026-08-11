// Old IS wage-rate collector — run on intel.utopia-game.com, pushes the board's
// economy columns to Firestore so the War Planner (which lives on the OTHER
// intel site) can use exact wage rates instead of estimating them.
//
// WHY THIS EXISTS: the new IS API exposes som.eff but never the wage rate, so
// tabs/economy.js has to invert the efficiency curve to guess it — which yields
// the EFFECTIVE rate, trailing the paid rate by up to ~96h. The old IS parses
// the rate straight out of the SoM and puts it in the board's "Wages" column
// (verified: [7] Jabba the Pizza Hutt reads 100, matching that province's SoM
// text "Our wage rate is 100.0% of normal levels"). No cross-origin fetch can
// reach it — the old IS answers "You can only login from in-game" and sends no
// CORS headers — so the value has to be collected from inside its own origin.
//
// HOW TO RUN
//   1. Log into the old IS from in-game and open the board (?p=intel) showing
//      the kingdom you care about. Run it again on each KD you want covered —
//      own and enemy are separate pages, and the script keys everything by the
//      location it reads off each row, so the order does not matter.
//   2. Paste this whole file into the browser console there.
//   3. It reports what it found and asks before writing anything.
//
// WHAT IT SENDS: one Firestore doc per kingdom — location, province slots,
// names, wage rate %, and the board's income/wages/net figures (kept as a
// cross-check against our own model). Nothing else on the page is read, and
// nothing is sent anywhere except Firestore.

(async () => {
  const FB_PROJECT = 'utopia-leaderboard';
  const FB_API_KEY = 'AIzaSyAnlkMabj-9a-fUEx66o86w2CnJaUgboIY';
  const FB_BASE = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;

  // ── Firestore value encoding (mirrors src/firebase.js _toFB) ──────────────
  const toFB = (v) => {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toFB) } };
    if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toFB(x)])) } };
    return { stringValue: String(v) };
  };

  // ── Locate the board ──────────────────────────────────────────────────────
  const table = document.querySelector('#board table.tablesorter')
             || document.querySelector('#board table')
             || [...document.querySelectorAll('table')].find(t => /\bWages\b/.test(t.innerText));
  if (!table) return alert('No board table found. Open the old IS board (?p=intel) first, then re-run.');

  const headRow = table.querySelector('thead tr') || table.querySelector('tr');
  const heads = [...headRow.querySelectorAll('th,td')].map(c => c.innerText.trim());
  // Match on header TEXT, not position — the board's column order is user
  // draggable (jquery.dragtables.js), and "Wages #" has a space in its id so it
  // cannot be used as a CSS selector.
  const col = (label) => heads.findIndex(h => h.toLowerCase() === label.toLowerCase());
  const iSlot = col('Slot'), iProv = col('Prov'), iWage = col('Wages');
  const iWageGc = col('Wages #'), iIncome = col('Income'), iNet = col('Netto gc');
  // The board's own intel-age column ("2.5h|7.2h|5.9h|95.5h"). Stored raw: its
  // four fields are not identified yet, so the planner dates these figures by
  // when this script ran instead. Identify them and the staleness rule in
  // economy.js can use the real age of the wage figure.
  const iIntel = col('Intel');
  if (iProv < 0 || iWage < 0) {
    return alert(`Could not find the Prov/Wages columns.\nHeaders seen:\n${heads.join(' | ')}`);
  }

  // "10.5k" / "1,044" / "-537" → number. The board abbreviates large values, so
  // the k/m forms are lossy — fine for the cross-check figures, and wage rates
  // are always small integers.
  const num = (s) => {
    const t = (s || '').trim().replace(/,/g, '');
    if (!t || t === '-') return null;
    const m = t.match(/^(-?[\d.]+)\s*([km])?$/i);
    if (!m) return null;
    const v = parseFloat(m[1]);
    if (!isFinite(v)) return null;
    return m[2] ? Math.round(v * (m[2].toLowerCase() === 'k' ? 1e3 : 1e6)) : v;
  };

  // ── Parse rows, grouped by the kingdom each province belongs to ───────────
  const kds = {};
  let skipped = 0;
  for (const tr of table.querySelectorAll('tbody tr')) {
    const cells = [...tr.querySelectorAll('td')];
    if (cells.length < heads.length - 2) { skipped++; continue; }
    const provTxt = (cells[iProv]?.innerText || '').trim();
    // "[13]Aimiadalas Organa (4:6)"
    const m = provTxt.match(/^\[?(\d+)\]?\s*(.+?)\s*\((\d+:\d+)\)\s*$/);
    if (!m) { skipped++; continue; }
    const [, slotStr, name, loc] = m;
    const slot = parseInt(cells[iSlot] ? (num(cells[iSlot].innerText) ?? slotStr) : slotStr, 10);
    const wagePct = num(cells[iWage]?.innerText);
    if (wagePct == null) { skipped++; continue; }

    (kds[loc] ||= {})[slot] = {
      name,
      wagePct,
      wagesGc: iWageGc >= 0 ? num(cells[iWageGc]?.innerText) : null,
      incomeGc: iIncome >= 0 ? num(cells[iIncome]?.innerText) : null,
      nettoGc: iNet >= 0 ? num(cells[iNet]?.innerText) : null,
      intelRaw: iIntel >= 0 ? (cells[iIntel]?.innerText || '').trim() : null,
    };
  }

  const locs = Object.keys(kds);
  if (!locs.length) return alert(`Parsed no province rows (${skipped} skipped).\nHeaders seen:\n${heads.join(' | ')}`);

  // ── Confirm before writing ────────────────────────────────────────────────
  const preview = locs.map(loc => {
    const provs = kds[loc];
    const slots = Object.keys(provs).map(Number).sort((a, b) => a - b);
    const sample = slots.slice(0, 3).map(s => `  [${s}] ${provs[s].name} — ${provs[s].wagePct}%`).join('\n');
    return `${loc}: ${slots.length} provinces\n${sample}${slots.length > 3 ? '\n  …' : ''}`;
  }).join('\n\n');
  console.log(preview);
  if (!confirm(`Send these wage rates to Firestore?\n\n${preview}\n\n${skipped} rows skipped (headers/totals).`)) {
    return console.log('[oldis-collector] cancelled — nothing sent');
  }

  // ── Write one doc per kingdom ─────────────────────────────────────────────
  for (const loc of locs) {
    const path = `meta/oldis_econ_${loc.replace(':', '_')}`;
    const data = {
      loc,
      provs: kds[loc],
      n: Object.keys(kds[loc]).length,
      updatedAt: Date.now(),
      source: 'oldis-board',
    };
    const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toFB(v)]));
    const r = await fetch(`${FB_BASE}/${path}?key=${FB_API_KEY}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    }).catch(e => ({ ok: false, status: e.message }));
    console.log(r.ok ? `[oldis-collector] ✓ ${loc} → ${path} (${data.n} provinces)`
                     : `[oldis-collector] ✗ ${loc} FAILED ${r.status}`);
  }
  alert(`Done — ${locs.length} kingdom(s) sent. Reload the War Planner to pick them up.`);
})();
