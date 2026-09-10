// ==UserScript==
// @name         Utopia KD Activity Collector (War Planner)
// @namespace    https://bridgeburneruto.github.io/utopia-wave-planner/
// @version      1.1.0
// @description  Samples the online (*) markers on one kingdom's page every few minutes and stores them for the War Planner's ACTIVITY tab.
// @match        https://utopia-game.com/wol/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://bridgeburneruto.github.io/utopia-wave-planner/scripts/activity-collector.user.js
// @updateURL    https://bridgeburneruto.github.io/utopia-wave-planner/scripts/activity-collector.user.js
// ==/UserScript==
//
// KD activity collector — run on utopia-game.com, records which provinces of
// ONE kingdom show the online marker, so the War Planner can draw when each
// enemy province is usually on (ACTIVITY tab).
//
// WHAT THE MARKER IS (verified on the live kingdom_details page, 2026-09-10):
// the page legend reads "Protection^ Monarch (M) Steward (S) You Online*", and
// each row is `<td class="province-name"><a>Name</a> (S)*</td>` -- the star is
// in the text AFTER the link, behind any (M)/(S) tag. TWO stars ("Name**")
// mean the province's MENTOR is logged in for them, not the owner (leader,
// 2026-09-10: a mentor can log in for 4h out of every 12h). Both count as
// online; the mentor ones are also listed separately so the planner can tell
// "the player is on" from "someone is minding the province". How long a star
// stays lit after the clicking stops is NOT known; it probably means "active
// in the last N minutes" rather than "has the page open". Keep the sample
// interval shorter than that window or sessions fall between samples.
//
// HOW IT SAMPLES: a same-origin fetch of /wol/game/kingdom_details/K/I every
// few minutes, parsed with DOMParser. It never reloads or navigates the tab, so
// the tab stays usable, and it sends no game actions -- it only reads the page.
// SIDE EFFECT: every fetch is a page view, so YOUR province shows the online
// star around the clock while this runs.
//
// HOW TO RUN
//   Tampermonkey: install from the @downloadURL above. It starts on any
//     utopia-game.com page and resumes by itself after a reload.
//   Console: paste this whole file on any utopia-game.com page. It runs until
//     that tab navigates away (the game's Ajax navigation is fine).
//   Then click "📡 Track" in the small panel at the bottom left and give the
//   kingdom location (defaults to the kingdom page you are on).
//   Keep the tab open. Chrome's Memory Saver can discard a background tab --
//   exclude utopia-game.com from it, or keep the tab pinned and visible.
//
// ONE TAB SAMPLES. With several utopia-game.com tabs open, they elect one
// sampler through a localStorage lock, so a kingdom is not sampled twice.
//
// WHAT IT SENDS: one Firestore document per kingdom per UTC day,
// activity/{K_I}_{YYYYMMDD}: {loc, day, kdName, names: {slot: name}, updatedAt,
// samples: [{t, on: [slots online], mt: [the subset where the MENTOR is on]}]}.
// Nothing else on the page is read, and nothing is sent anywhere but Firestore.
//
// WRITES ARE BATCHED (leader's call, 2026-09-11 -- keep the Firestore cost
// down). Samples queue in localStorage and are flushed every FLUSH_MIN minutes
// as ONE write per day document: ~96 writes/day at 15 minutes instead of 288
// with one write per sample. The queue survives a reload or a closed browser
// and goes out on the next flush. A flush that fails keeps the queue; re-sending
// a sample that did land is harmless, because appendMissingElements skips an
// element that is already in the array. The planner's "online now" can
// therefore trail by up to FLUSH_MIN.

(() => {
  if (window.__wpActivity) { window.__wpActivity.show(); return; }   // pasted twice

  const FB_PROJECT = 'utopia-leaderboard';
  const FB_API_KEY = 'AIzaSyAnlkMabj-9a-fUEx66o86w2CnJaUgboIY';
  const FB_DB   = `projects/${FB_PROJECT}/databases/(default)/documents`;
  const FB_BASE = `https://firestore.googleapis.com/v1/${FB_DB}`;

  const STATE_KEY = 'wpActivity';       // {loc, everyMin, on, lastAt, lastN, lastOn, lastMt, kdName, err, nextAt, flushedAt}
  const QUEUE_KEY = 'wpActivityQueue';  // {[docId]: {loc, day, kdName, names, samples: [{t, on, mt}]}}
  const LOCK_KEY  = 'wpActivityLock';   // {id, ts} -- which tab samples
  // A tab that has not ticked for this long lost the lock. Chrome throttles a
  // hidden tab's timers to about once a minute, so this must be well above 60s.
  const LOCK_STALE_MS = 150e3;
  const TICK_MS = 20e3;                 // how often the loop checks whether a sample is due
  const JITTER_MS = 30e3;               // +- spread so samples do not land on the same second
  const DEFAULT_MIN = 5;
  const FLUSH_MIN = 15;                 // oldest queued sample may wait this long before a write

  const TAB_ID = Math.random().toString(36).slice(2);

  const readJson = (k, dflt) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? dflt; } catch (e) { return dflt; } };
  const load = () => readJson(STATE_KEY, {});
  const save = (patch) => { const s = { ...load(), ...patch }; localStorage.setItem(STATE_KEY, JSON.stringify(s)); return s; };
  const loadQueue = () => readJson(QUEUE_KEY, {});
  const queued = (q = loadQueue()) => Object.values(q).reduce((n, d) => n + d.samples.length, 0);

  // ── Firestore value encoding (mirrors src/firebase.js _toFB) ────────────────
  const toFB = (v) => {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toFB) } };
    if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toFB(x)])) } };
    return { stringValue: String(v) };
  };

  const pad = (n) => String(n).padStart(2, '0');
  const dayId = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`; };
  const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const normLoc = (s) => { const m = String(s || '').match(/(\d+)\s*[:_/]\s*(\d+)/); return m ? `${+m[1]}:${+m[2]}` : ''; };

  // ── Parse one kingdom page ──────────────────────────────────────────────────
  // Returns {kdName, names: {slot: name}, on: [slots], mt: [slots]} or throws
  // with a reason. `on` = any star, `mt` = two stars (mentor), a subset of on.
  // Every province link is checked against the requested location: an unknown
  // kingdom must not be recorded as the one we asked for if the game ever
  // answers with a different page.
  function parseKingdom(html, loc) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const cells = [...doc.querySelectorAll('table.tablesorter td.province-name')];
    if (!cells.length) {
      const loginish = /login|sign in|password/i.test(doc.title + ' ' + (doc.body?.textContent || '').slice(0, 3000));
      throw new Error(loginish ? 'not logged in to the game' : 'no province table on the kingdom page');
    }
    const [k, i] = loc.split(':');
    const names = {}, on = [], mt = [];
    let wrongKd = 0;
    for (const td of cells) {
      const a = td.querySelector('a');
      if (!a) continue;                                   // empty slot ("-")
      const m = (a.getAttribute('href') || '').match(/\/(\d+)\/(\d+)\/(\d+)(?:[/?#]|$)/);
      if (!m) continue;
      if (m[1] !== k || m[2] !== i) { wrongKd++; continue; }
      const slot = parseInt(m[3], 10);
      names[slot] = a.textContent.trim();
      // The markers live in the bare text nodes after the link: " (S)*", "^", "**"
      const tail = [...td.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
      const stars = (tail.match(/\*/g) || []).length;
      if (stars >= 1) on.push(slot);
      if (stars >= 2) mt.push(slot);
    }
    if (!Object.keys(names).length) {
      throw new Error(wrongKd ? `the game served a different kingdom than ${loc}` : 'parsed no provinces');
    }
    const title = [...doc.querySelectorAll('h1,h2,h3,p,div')]
      .map(e => e.textContent.replace(/\s+/g, ' ').trim())
      .find(s => s.length < 160 && /kingdom of .+\(\d+:\d+\)/i.test(s)) || '';
    const kdName = (title.match(/kingdom of (.+?)\s*\(\d+:\d+\)/i) || [])[1] || '';
    return { kdName, names, on: on.sort((a, b) => a - b), mt: mt.sort((a, b) => a - b) };
  }

  // ── Queue + flush ───────────────────────────────────────────────────────────
  function enqueue(loc, t, parsed) {
    const q = loadQueue();
    const day = dayId(t);
    const id = `${loc.replace(':', '_')}_${day}`;
    const d = q[id] || (q[id] = { loc, day, samples: [] });
    d.kdName = parsed.kdName;              // latest wins, like the document fields
    d.names = parsed.names;
    d.samples.push({ t, on: parsed.on, mt: parsed.mt });
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  }

  // names/kdName are overwritten, the samples APPENDED (appendMissingElements),
  // so two collectors on the same kingdom merge instead of clobbering each
  // other. One commit, one write per day document in the queue.
  async function flush() {
    const q = loadQueue();
    const ids = Object.keys(q);
    if (!ids.length) return;
    const writes = ids.map(id => {
      const d = q[id];
      const last = Math.max(...d.samples.map(s => s.t));
      const fields = { loc: d.loc, day: d.day, kdName: d.kdName || '', names: d.names || {}, updatedAt: last };
      return {
        update: {
          name: `${FB_DB}/activity/${id}`,
          fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, toFB(v)])),
        },
        updateMask: { fieldPaths: Object.keys(fields) },
        updateTransforms: [{ fieldPath: 'samples', appendMissingElements: { values: d.samples.map(toFB) } }],
      };
    });
    const r = await fetch(`${FB_BASE}:commit?key=${FB_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writes }),
    }).catch(e => ({ ok: false, status: e.message }));
    if (!r.ok) {
      const hint = r.status === 429 ? ' (Firestore daily quota -- resets midnight US Pacific)' : '';
      throw new Error(`Firestore write failed: HTTP ${r.status}${hint} -- ${queued(q)} samples kept for the next try`);
    }
    // Drop only what was sent: a sample queued while the request was in flight stays.
    const now = loadQueue();
    ids.forEach(id => {
      const sent = new Set(q[id].samples.map(s => s.t));
      if (!now[id]) return;
      now[id].samples = now[id].samples.filter(s => !sent.has(s.t));
      if (!now[id].samples.length) delete now[id];
    });
    localStorage.setItem(QUEUE_KEY, JSON.stringify(now));
    // A write that went through settles an earlier write error (not a sample error)
    const stale = /^Firestore write failed/.test(load().err || '');
    save({ flushedAt: Date.now(), ...(stale ? { err: '' } : {}) });
    console.log(`[activity] flushed ${writes.length} document write(s)`);
  }

  function flushDue() {
    // After a failure, wait a minute -- a 429 must not be retried every tick.
    if (Date.now() - (load().errAt || 0) < 60e3) return false;
    const q = loadQueue();
    const oldest = Math.min(Infinity, ...Object.values(q).flatMap(d => d.samples.map(s => s.t)));
    return oldest !== Infinity && Date.now() - oldest >= FLUSH_MIN * 60e3 - TICK_MS;
  }

  let busy = false;
  async function run(opts = {}) {
    if (busy) return;
    busy = true;
    const s = load();
    const loc = normLoc(s.loc);
    const t = Date.now();
    try {
      if (loc && (opts.sample || (s.on && t >= (s.nextAt || 0)))) {
        const [k, i] = loc.split(':');
        const r = await fetch(`/wol/game/kingdom_details/${k}/${i}`, { credentials: 'include', cache: 'no-store' });
        if (!r.ok) throw new Error(`kingdom page HTTP ${r.status}`);
        const parsed = parseKingdom(await r.text(), loc);
        enqueue(loc, t, parsed);
        save({ lastAt: t, lastN: Object.keys(parsed.names).length, lastOn: parsed.on.length, lastMt: parsed.mt.length,
               kdName: parsed.kdName, err: '', nextAt: t + (s.everyMin || DEFAULT_MIN) * 60e3 + (Math.random() * 2 - 1) * JITTER_MS });
        console.log(`[activity] ${loc} ${hhmm(t)} — ${parsed.on.length}/${Object.keys(parsed.names).length} online: [${parsed.on.join(', ')}]`
          + (parsed.mt.length ? ` (mentor: [${parsed.mt.join(', ')}])` : '') + ` · ${queued()} queued`);
      }
      if (opts.flush || flushDue()) await flush();
    } catch (e) {
      // Retry sooner than a full interval, but never hammer: 1 minute.
      save({ err: e.message, errAt: t, nextAt: Math.max(load().nextAt || 0, t + 60e3) });
      console.warn(`[activity] ${loc}: ${e.message}`);
    } finally {
      busy = false;
      render();
    }
  }

  // ── Loop + tab lock ─────────────────────────────────────────────────────────
  function holdLock() {
    const lock = readJson(LOCK_KEY, null);
    const now = Date.now();
    if (!lock || lock.id === TAB_ID || now - lock.ts > LOCK_STALE_MS) {
      localStorage.setItem(LOCK_KEY, JSON.stringify({ id: TAB_ID, ts: now }));
      return true;
    }
    return false;
  }
  function releaseLock() {
    const l = readJson(LOCK_KEY, null);
    if (l?.id === TAB_ID) localStorage.removeItem(LOCK_KEY);
  }

  let isSampler = false;
  function tick() {
    const s = load();
    // A stopped collector still owes Firestore whatever it had queued.
    if (!s.on || !normLoc(s.loc)) {
      isSampler = false;
      if (queued() && holdLock()) { isSampler = true; run(); return; }
      releaseLock(); render(); return;
    }
    isSampler = holdLock();
    if (isSampler && (Date.now() >= (s.nextAt || 0) || flushDue())) run();
    else render();
  }

  // ── Panel ───────────────────────────────────────────────────────────────────
  const box = document.createElement('div');
  box.id = '__wpact';
  box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;background:#101a1a;color:#c8d8d8;'
    + 'border:1px solid #3a5050;border-radius:4px;padding:5px 9px;font:13px/1.4 sans-serif;'
    + 'box-shadow:0 2px 8px rgba(0,0,0,.5);max-width:440px';
  document.body.appendChild(box);

  function render() {
    const s = load();
    const loc = normLoc(s.loc);
    const btn = (id, label, tip) => `<button data-a="${id}" title="${tip || ''}" style="font:12px sans-serif;margin-left:6px;`
      + `padding:1px 7px;background:#1d2b2b;color:#c8d8d8;border:1px solid #3a5050;border-radius:3px;cursor:pointer">${label}</button>`;
    const err = s.err ? `<div style="color:#ff7070" title="${s.err}">⚠ ${s.err}</div>` : '';
    if (!s.on || !loc) {
      const q = queued();
      box.innerHTML = `📡 <b>Activity</b> <span style="color:#7a9090">off${q ? ` · ${q} samples waiting to be written` : ''}</span>`
        + btn('start', 'Track…', 'Start sampling a kingdom\'s online markers') + err;
      return;
    }
    box.innerHTML = `📡 <b>${loc}</b>${s.kdName ? ' ' + s.kdName.replace(/</g, '&lt;') : ''} · every ${s.everyMin || DEFAULT_MIN}m`
      + btn('now', '↻', 'Sample now and write everything queued') + btn('stop', 'Stop', 'Stop sampling (what is queued is still written)')
      + `<div id="__wpact_st" style="color:#8fa8a8"></div>${err}`;
    renderStatus();
  }

  // The countdown ticks every second, so it only touches its own line: replacing
  // the whole panel that often would swallow clicks on its buttons.
  function renderStatus() {
    const el = document.getElementById('__wpact_st');
    if (!el) return;
    const s = load();
    const age = s.lastAt ? Math.round((Date.now() - s.lastAt) / 60e3) : null;
    const next = s.nextAt ? Math.max(0, Math.round((s.nextAt - Date.now()) / 1000)) : 0;
    const q = queued();
    el.textContent = !isSampler ? 'another tab is sampling'
      : s.lastAt ? `${s.lastOn}/${s.lastN} online${s.lastMt ? ` (${s.lastMt} mentor)` : ''} · ${age}m ago · next ${Math.floor(next / 60)}:${pad(next % 60)}`
        + (q ? ` · ${q} queued` : '')
      : 'first sample…';
  }

  box.addEventListener('click', (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'start') {
      const here = normLoc((location.pathname.match(/kingdom_details\/(\d+\/\d+)/) || [])[1]);
      const loc = normLoc(prompt('Kingdom location to track (e.g. 6:1):', here || load().loc || ''));
      if (!loc) return;
      const every = parseInt(prompt('Sample every how many minutes? (shorter than the online window; 5 is a good start)',
        String(load().everyMin || DEFAULT_MIN)), 10);
      save({ loc, on: true, everyMin: Math.min(60, Math.max(2, every || DEFAULT_MIN)), nextAt: 0, err: '',
             lastAt: 0, lastN: 0, lastOn: 0, lastMt: 0, kdName: '' });
      tick();
    } else if (a === 'stop') {
      save({ on: false });
      if (queued() && holdLock()) { isSampler = true; run({ flush: true }); } else { releaseLock(); render(); }
    } else if (a === 'now') {
      if (holdLock()) { isSampler = true; run({ sample: true, flush: true }); }
    }
  });

  window.addEventListener('beforeunload', releaseLock);
  window.__wpActivity = { show: render, run, flush, parseKingdom, tick, state: load, queue: loadQueue };
  setInterval(tick, TICK_MS);
  setInterval(renderStatus, 1000);   // countdown only; sampling is driven by tick()
  tick();
})();
