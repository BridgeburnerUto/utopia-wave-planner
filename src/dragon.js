// ── DRAGON CONTRIBUTIONS ───────────────────────────────────────────────────
// Per-province dragon FUNDING (gold + food donated) and SLAYING (troops sent,
// damage dealt), ranked as a top list with /acre and /NW normalisations.
//
// WHERE THE DATA COMES FROM
// Not the IS: OwnKingdom exposes only kdEffects.dragon (type name) and
// kdEffects.dragonDuration, and the IS news endpoints are paste-parsers that
// report kingdom-level dragon COUNTS with no province breakdown. The game's
// fund_dragon page shows the donate form and what is still needed, never who
// gave it.
//
// The source is the utopiabot DRAGON feed in Discord, one message per event:
//
//   DRAGON Ankylosaurus Rex [bridg#] donated 62,093 gold coins to fund dragon!
//   DRAGON Indominus rex [indominus re#] donated 28,000 bushels to fund dragon!
//   DRAGON Dilophosaurus [borwhack] sent 350 troops and weakened dragon by 3723 points!
//
// The leading name is the full PROVINCE name (matched exactly against the
// roster); the bracketed one is the ruler, often truncated by a character, and
// is stored only for reference. Amounts are exact — unlike the in-game bot's
// `dragon` command, which rounds to "386.0k". That command is still accepted
// here as a CROSS-CHECK paste: it reports cumulative per-province totals, so
// comparing it against the event sum shows what the feed missed.
//
// CAVEAT kept visible in the UI: utopiabot does not see players acting from the
// mobile app, so every total here is a floor, not a certainty.

// ── Event parsing (Discord feed — the primary source) ──────────────────────

const DRG_EVENT_RE = new RegExp(
  'DRAGON\\s+(.+?)\\s+\\[([^\\]]*)\\]\\s+' +
  '(?:donated\\s+([\\d,]+)\\s+(gold coins?|bushels?)' +
  '|sent\\s+([\\d,]+)\\s+troops?\\s+and\\s+weakened\\s+dragon\\s+by\\s+([\\d,]+)\\s+points?)',
  'gi'
);

/** Discord message headers: "utopiabotAPP — 12:38" — used to timestamp events */
const DRG_HEADER_RE = /—\s*([^\n]{1,40}?)\s*$/gm;

function _drgInt(s) { return parseInt(String(s || '0').replace(/,/g, ''), 10) || 0; }

/** djb2 — stable short hash for event de-duplication across pastes */
function _drgHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Parse a pasted block of the Discord DRAGON feed.
 * Events are matched across the whole text, not line by line — a single Discord
 * line can carry two events, and copy/paste wraps them arbitrarily.
 * Returns {ok, events:[{prov, ruler, type, amount, troops, tsLabel, id}], error}
 *   type: 'gc' | 'food' | 'slay'
 */
function parseDragonDiscord(text) {
  // Raw Discord text is not what the client renders. utopiabot actually sends
  // ":dragon_face: __DRAGON__ Spinosaurus [royc#] donated __5,000 gold coins__ ..."
  // and those emphasis markers sit exactly where the pattern expects spaces, so
  // strip Discord markup first. Newlines are preserved — the timestamp headers
  // are matched line by line.
  const raw = String(text || '')
    .replace(/:[a-z0-9_+\-]+:/gi, ' ')   // :emoji_shortcodes:
    .replace(/[*_`~]+/g, '')             // bold / italic / underline / strike / code
    .replace(/[ \t]+/g, ' ');
  if (!raw.trim()) return { ok: false, error: 'Nothing pasted.' };

  // Index every "— <time>" header so each event can inherit the latest one.
  const heads = [];
  DRG_HEADER_RE.lastIndex = 0;
  for (let h; (h = DRG_HEADER_RE.exec(raw)) !== null; ) heads.push({ at: h.index, label: h[1].trim() });

  const labelFor = (idx) => {
    let lbl = '';
    for (const h of heads) { if (h.at <= idx) lbl = h.label; else break; }
    return lbl;
  };

  const events = [];
  const seen   = {}; // tuple → occurrence count, so genuine repeats stay distinct
  DRG_EVENT_RE.lastIndex = 0;
  for (let m; (m = DRG_EVENT_RE.exec(raw)) !== null; ) {
    const prov  = m[1].trim();
    const ruler = (m[2] || '').trim();
    let type, amount, troops = 0;

    if (m[3]) {                                   // donation
      amount = _drgInt(m[3]);
      type   = /bushel/i.test(m[4]) ? 'food' : 'gc';
    } else {                                      // slay
      troops = _drgInt(m[5]);
      amount = _drgInt(m[6]);
      type   = 'slay';
    }

    const tsLabel = labelFor(m.index);
    const tuple   = `${tsLabel}|${prov}|${type}|${amount}|${troops}`;
    seen[tuple]   = (seen[tuple] || 0) + 1;

    events.push({
      prov, ruler, type, amount, troops, tsLabel,
      id: _drgHash(`${tuple}|${seen[tuple]}`),
    });
  }

  if (!events.length) {
    return { ok: false, error: 'No DRAGON lines found — paste the utopiabot messages, headers and all.' };
  }
  return { ok: true, events };
}

// ── Cross-check parsing (in-game bot `dragon` command) ─────────────────────

/** "386.0k" → 386000 (rounded by the bot); "897" → 897 */
function _drgNum(s) {
  const m = String(s).trim().replace(/,/g, '').match(/^([\d.]+)\s*([kmb])?$/i);
  if (!m) return null;
  const base = parseFloat(m[1]);
  if (!isFinite(base)) return null;
  const suf  = (m[2] || '').toLowerCase();
  return Math.round(base * (suf === 'b' ? 1e9 : suf === 'm' ? 1e6 : suf === 'k' ? 1e3 : 1));
}

/**
 * Parse the in-game bot's cumulative `dragon` list:
 *   Dragon started Jul17YR1
 *   bassma# 386.0k |bridg# 173.5k |... |# 0 |
 *   Total: 1.3m
 * Names here are RULERS, truncated by one character.
 * Returns {ok, project, total, byRuler:{ruler: amount}}
 */
function parseDragonBotList(text) {
  const raw = String(text || '');
  if (!/Dragon\s+started/i.test(raw)) return { ok: false };

  const proj = raw.match(/Dragon\s+started\s+([A-Za-z]{3,9}\s*\d{1,2}\s*YR\d+)/i);
  const tot  = raw.match(/Total:\s*([\d.,]+\s*[kmb]?)/i);

  const body = raw
    .replace(/^.*?Command:.*$/gim, '')
    .replace(/^.*?Dragon\s+started.*$/gim, '')
    .replace(/Total:\s*[\d.,]+\s*[kmb]?/i, '');

  const byRuler = {};
  let sum = 0;
  body.split('|').forEach(chunk => {
    const c = chunk.replace(/\s+/g, ' ').trim();
    const m = c.match(/^(.*?)#\s*([\d.,]+\s*[kmb]?)$/i);
    if (!m || !m[1].trim()) return;
    const v = _drgNum(m[2]);
    if (v == null) return;
    byRuler[m[1].trim().toLowerCase()] = v;
    sum += v;
  });

  if (!Object.keys(byRuler).length) return { ok: false };
  return {
    ok: true,
    project: proj ? proj[1].replace(/\s+/g, '') : '',
    total:   tot ? _drgNum(tot[1]) : sum,
    listSum: sum,
    byRuler,
  };
}

/** Optional context from the fund_dragon page: type, target, what is still needed */
function parseDragonFundPage(text) {
  const t = String(text || '');
  const type = t.match(/development of the\s+(\w+)\s+Dragon/i);
  const targ = t.match(/to be sent to .*?\((\d+:\d+)\)/i);
  const need = t.match(/([\d,]+)\s+gold coins?\s+and\s+([\d,]+)\s+bushels?\s+are still needed/i);
  if (!type && !need) return null;
  return {
    dragonType: type ? type[1] : '',
    targetKd:   targ ? targ[1] : '',
    goldNeeded: need ? _drgInt(need[1]) : -1,
    foodNeeded: need ? _drgInt(need[2]) : -1,
  };
}

// ── Storage ────────────────────────────────────────────────────────────────
// Events are individual docs in `dragon_events`, keyed by their content hash,
// so re-pasting an overlapping range is idempotent — same event, same doc id.
// This mirrors how the ops leaderboard stores and aggregates client-side.

function _drgKdId() { return (S.own?.location || '').replace(':', '_'); }

/** Province lookup by exact name (the Discord feed gives the full name) */
function _drgProv(name) {
  const key = String(name || '').toLowerCase().trim();
  return (S.own?.provinces || []).find(p => (p.name || '').toLowerCase() === key) || null;
}

/** Parse the pasted text and write every new event; returns a status string */
async function dragonSave() {
  const ta = $id('__wpdrg_in');
  const st = $id('__wpdrg_status');
  const say = (msg, col) => { if (st) { st.textContent = msg; st.style.color = col || '#7a9090'; } };
  const txt = ta ? ta.value : '';

  const kdId = _drgKdId();
  if (!kdId) { say('Own kingdom not loaded yet.', '#ff4455'); return; }

  // A paste may contain the Discord feed, the bot cross-check list, the fund
  // page, or several at once — handle whatever is in there.
  const feed  = parseDragonDiscord(txt);
  const list  = parseDragonBotList(txt);
  const page  = parseDragonFundPage(txt);

  if (!feed.ok && !list.ok && !page) { say(feed.error, '#ff4455'); return; }

  const done = [];

  if (feed.ok) {
    say(`Saving ${feed.events.length} events…`);
    let matched = 0;
    for (const e of feed.events) {
      const prov = _drgProv(e.prov);
      if (prov) matched++;
      await fbWrite(`dragon_events/${kdId}_${e.id}`, {
        kdId,
        prov:    e.prov,
        ruler:   e.ruler,
        slot:    prov ? prov.slot : -1,
        type:    e.type,
        amount:  e.amount,
        troops:  e.troops,
        tsLabel: e.tsLabel,
        land:    prov ? (prov.land || 0) : 0,
        nw:      prov ? (prov.networth || 0) : 0,
        storedAt: Date.now(),
      });
    }
    done.push(`${feed.events.length} events (${matched} matched)`);
  }

  if (list.ok) {
    await fbWrite(`dragon_check/${kdId}_${(list.project || 'current').replace(/[^A-Za-z0-9]/g, '')}`, {
      kdId,
      project:  list.project,
      total:    list.total,
      listSum:  list.listSum,
      byRuler:  list.byRuler,
      storedAt: Date.now(),
    });
    done.push('bot cross-check list');
  }

  if (page) {
    await fbWrite(`dragon_check/${kdId}_page`, {
      kdId,
      dragonType: page.dragonType,
      targetKd:   page.targetKd,
      goldNeeded: page.goldNeeded,
      foodNeeded: page.foodNeeded,
      storedAt:   Date.now(),
    });
    done.push('fund page status');
  }

  say(`Saved: ${done.join(' · ')}.`, '#00ff88');
  if (ta) ta.value = '';
  renderLeaderboard();
}

// ── Slay chase-up (shared by the board button and the Discord auto-reminder) ─

/** Hours between automatic "not slayed yet" posts while a dragon is on us */
const WP_DRAGON_REMIND_HOURS = 6;

/**
 * Quiet stretch that separates one dragon from the next, in hours.
 * A dragon lives at most 48 ticks and funding runs a day or two ahead of it, so
 * a gap this long means the next event belongs to a different dragon. Raise it
 * if two campaigns ever get split apart; lower it if two get merged.
 */
const WP_DRAGON_CAMPAIGN_GAP_H = 36;

/**
 * Provinces that have not slayed at all, biggest first.
 * Returns null when the event store cannot be read — the caller must stay
 * quiet rather than accuse the whole kingdom off a failed query.
 */
async function _drgSlayLaggards() {
  const kdId = _drgKdId();
  const roster = S.own?.provinces || [];
  if (!kdId || !roster.length) return null;

  let events;
  try {
    events = await fbQuery('dragon_events', [{ field: 'kdId', value: kdId }]);
  } catch (e) {
    console.warn('[WavePlanner] dragon laggard query failed:', e.message);
    return null;
  }
  // A failed read returns null, not []. Treating [] as "nobody slayed" would
  // post the ENTIRE roster to Discord as slackers off a quota error.
  if (!events) { console.warn('[WavePlanner] dragon laggard query failed:', S.fbLastError); return null; }

  // Only the CURRENT dragon counts. The store holds the whole age, and someone
  // who slayed a dragon three weeks ago has done nothing about the one on us
  // now — counting them as done would silently drop them from the chase list.
  const camps  = _drgCampaigns(events);
  const latest = camps[0];
  const recent = latest
    ? events.filter(e => { const t = _drgTs(e); return t >= latest.from - 60e3 && t <= latest.to + 60e3; })
    : events;

  const slayed = new Set();
  recent.forEach(ev => {
    if (ev.type === 'slay' && (ev.amount > 0 || ev.troops > 0) && ev.prov) {
      slayed.add(String(ev.prov).toLowerCase());
    }
  });

  return roster
    .filter(p => !slayed.has((p.name || '').toLowerCase()))
    .map(p => ({ slot: p.slot, name: p.name, discord: p.discord || '', land: p.land || 0 }))
    .sort((a, b) => b.land - a.land);
}

// ── Backend ingest (no paste needed) ───────────────────────────────────────
// The Cloud Run backend polls the DRAGON Discord channel with a bot token and
// stores the events (api.php ?dragon_poll / ?dragon). We mirror them into
// Firestore so the board keeps a single read model and still works when the
// backend is down. Event ids are "{messageId}_{n}", so mirroring repeatedly is
// idempotent — the same event always lands on the same doc.

/**
 * Pull dragon events from the backend and mirror new ones into Firestore.
 * Returns {ok, added, total, error}. Silent no-op when no endpoint configured.
 */
async function dragonPull(quiet) {
  const st  = $id('__wpdrg_status');
  const say = (m, c) => { if (!quiet && st) { st.textContent = m; st.style.color = c || '#7a9090'; } };

  if (!S.apiEndpoint) { say('No backend endpoint set (Alerts tab).', '#ff4455'); return { ok: false, error: 'no endpoint' }; }
  const kdId = _drgKdId();
  if (!kdId) return { ok: false, error: 'own kingdom not loaded' };

  const base = S.apiEndpoint.replace(/\/$/, '') + '/api.php';
  const hdrs = S.apiKey ? { 'X-WP-Key': S.apiKey } : {};

  try {
    say('Polling Discord…');
    // Ask the backend to poll first, then read what it holds. A failed poll is
    // not fatal — previously ingested events are still worth showing.
    const pollRes = await fetch(`${base}?dragon_poll=1`, { headers: hdrs }).catch(() => null);
    const poll    = pollRes && pollRes.ok ? await pollRes.json().catch(() => null) : null;
    if (poll?.error) console.warn('[WavePlanner] dragon_poll:', poll.error, poll.message || '');

    const r = await fetch(`${base}?dragon=1`, { headers: hdrs });
    if (!r.ok) { say(`Backend returned ${r.status}.`, '#ff4455'); return { ok: false, error: 'HTTP ' + r.status }; }
    const data = await r.json();
    const events = data?.events || [];
    if (!events.length) { say('Backend has no dragon events yet.', '#ffaa00'); return { ok: true, added: 0, total: 0 }; }

    // Only write what Firestore does not already have. The id set is cached for
    // the session: this runs on the 2-minute sync timer, and re-reading a whole
    // age of events (765+ docs) every cycle is ~23k document reads an hour —
    // the free tier allows 50k a DAY. With the cache a quiet cycle costs zero
    // reads, and Firestore is only consulted when the backend has ids we have
    // not seen yet.
    let have = S.drgHaveKd === kdId ? S.drgHave : null;
    if (!have || events.some(e => e.id && !have.has(e.id))) {
      const docs = await fbQuery('dragon_events', [{ field: 'kdId', value: kdId }]);
      // null = the read FAILED (quota, network). Mirroring against a failed read
      // would treat every event as missing and re-write the entire collection.
      if (!docs) { say('Could not read the event store — skipped mirroring.', '#ffaa00'); return { ok: false, error: 'firestore read failed' }; }
      have = new Set(docs.map(d => d.evId).filter(Boolean));
      S.drgHave = have; S.drgHaveKd = kdId;
    }

    const missing = events.filter(e => e.id && !have.has(e.id));

    // Written in parallel batches: a backfill of a whole age is hundreds of
    // events, and one-at-a-time would stall the sync timer for minutes.
    const BATCH = 10;
    let added = 0, failed = 0;
    for (let i = 0; i < missing.length; i += BATCH) {
      const slice = missing.slice(i, i + BATCH);
      const res = await Promise.all(slice.map(e => {
        const prov = _drgProv(e.prov);
        return fbWrite(`dragon_events/${kdId}_${e.id.replace(/[^A-Za-z0-9_]/g, '')}`, {
          kdId,
          evId:    e.id,
          prov:    e.prov  || '',
          ruler:   e.ruler || '',
          slot:    prov ? prov.slot : -1,
          type:    e.type   || 'gc',
          amount:  e.amount || 0,
          troops:  e.troops || 0,
          tsLabel: (e.ts || '').slice(11, 16),
          ts:      e.ts || '',
          land:    prov ? (prov.land || 0) : 0,
          nw:      prov ? (prov.networth || 0) : 0,
          storedAt: Date.now(),
        });
      }));
      // Only a written event goes into the cache — caching a failed write would
      // hide it until the next reload, and caching nothing would re-write it
      // every two minutes.
      slice.forEach((e, k) => { if (res[k] && !res[k].error) { have.add(e.id); added++; } else failed++; });
      if (!quiet) say(`Mirroring ${added}/${missing.length}…`);
      if (failed) break; // writes are failing (quota?) — stop hammering
    }
    if (failed) { say(`Mirrored ${added}, then writes failed — stopped.`, '#ffaa00'); return { ok: false, added, error: 'write failed' }; }
    say(added ? `Pulled ${added} new event${added === 1 ? '' : 's'}.` : 'Up to date.', '#00ff88');
    return { ok: true, added, total: events.length };
  } catch (e) {
    say('Pull failed: ' + e.message, '#ff4455');
    return { ok: false, error: e.message };
  }
}

/** Pull, then re-render — the button on the dragon board */
async function dragonPullAndRender() {
  const res = await dragonPull(false);
  if (res.added) renderLeaderboard();
}

// ── Time filtering: per dragon, or an explicit range ───────────────────────
// The store holds the whole age, and a leader usually wants one dragon at a
// time. Events are not tagged with a project id — the bot never says which
// dragon a line belongs to — so campaigns are inferred from gaps in activity.
// A dragon lives at most 48 ticks, and funding runs for a day or two before
// that, so a quiet stretch this long means the next event is a new dragon.

/** Event timestamp in ms. Backend events carry ts; pasted ones only storedAt. */
function _drgTs(ev) {
  const t = ev.ts ? Date.parse(ev.ts) : NaN;
  return isFinite(t) ? t : (ev.storedAt || 0);
}

/**
 * Split events into campaigns, newest first.
 * Returns [{from, to, label, n}] — the label is what the picker shows.
 */
function _drgCampaigns(events) {
  const ts = events.map(_drgTs).filter(Boolean).sort((a, b) => a - b);
  if (!ts.length) return [];

  const gapMs = WP_DRAGON_CAMPAIGN_GAP_H * 3600e3;
  const runs  = [];
  let start = ts[0], prev = ts[0], n = 1;
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] - prev > gapMs) { runs.push({ from: start, to: prev, n }); start = ts[i]; n = 0; }
    prev = ts[i]; n++;
  }
  runs.push({ from: start, to: prev, n });

  const fmt = ms => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return runs.reverse().map(r => ({
    ...r,
    label: fmt(r.from) === fmt(r.to) ? fmt(r.from) : `${fmt(r.from)} – ${fmt(r.to)}`,
  }));
}

/** Apply the active range filter to the event list */
function _drgInRange(events, camps) {
  const r = S.drgRange || 'all';
  if (r === 'all') return events;

  if (r === 'custom') {
    const from = S.drgFrom ? Date.parse(S.drgFrom + 'T00:00:00') : 0;
    const to   = S.drgTo   ? Date.parse(S.drgTo   + 'T23:59:59') : Infinity;
    return events.filter(e => { const t = _drgTs(e); return t >= from && t <= to; });
  }

  const c = camps[parseInt(String(r).replace('c', ''), 10)];
  if (!c) return events;
  // Pad the bounds by a minute so the first and last event are never clipped.
  return events.filter(e => { const t = _drgTs(e); return t >= c.from - 60e3 && t <= c.to + 60e3; });
}

// ── View state ─────────────────────────────────────────────────────────────

function lbSection(v) { S.lbSection = v; renderLeaderboard(); }
function drgMetric(v) { S.drgMetric = v; renderLeaderboard(); }
function drgSort(v)   { S.drgSort   = v; renderLeaderboard(); }
function drgRange(v)  { S.drgRange  = v; renderLeaderboard(); }

/** Read both date inputs, switch to custom mode, re-render */
function drgDates() {
  const f = $id('__wpdrg_from'), t = $id('__wpdrg_to');
  if (f) S.drgFrom = f.value || '';
  if (t) S.drgTo   = t.value || '';
  S.drgRange = 'custom';
  renderLeaderboard();
}

// ── Render ─────────────────────────────────────────────────────────────────

const DRG_METRICS = {
  gc:   { label: '💰 Fund (gc)',   col: 'Funded (gc)', unit: 'gc',  bar: '#ffd400' },
  food: { label: '🌾 Fund (food)', col: 'Food',        unit: 'bu',  bar: '#88cc44' },
  slay: { label: '🗡 Slay',        col: 'Damage',      unit: 'dmg', bar: '#ff8844' },
};

async function renderDragonBoard(el) {
  el.innerHTML = loadingHTML('LOADING DRAGON CONTRIBUTIONS...');
  let events = [], checks = [];
  try {
    const kdId = _drgKdId();
    const [ev, ch] = await Promise.all([
      fbQuery('dragon_events', [{ field: 'kdId', value: kdId }]),
      fbQuery('dragon_check',  [{ field: 'kdId', value: kdId }]),
    ]);
    // null = read failed. An empty board would read as "nobody contributed",
    // which is a very different message from "we could not look".
    if (!ev) throw new Error(S.fbLastError || 'Firestore read failed');
    events = ev; checks = ch || [];
  } catch (e) {
    el.innerHTML = _drgSectionSwitch()
      + `<div style="color:#ff4455;font-family:monospace;font-size:19px;padding:20px 0">Error loading dragon data: ${esc(e.message)}</div>`
      + _drgPasteBox();
    return;
  }
  el.innerHTML = _drgSectionSwitch() + _buildDragonBoard(events, checks) + _drgPasteBox();
}

/** Range picker: whole age, one dragon, or an explicit from/to */
function _drgRangeBar(camps, totalN, shownN) {
  const r = S.drgRange || 'all';
  const btn = (val, label, title) =>
    `<button class="wb${r === val ? ' g' : ''}" onclick="__wpA.drgRange('${val}')"
      style="font-size:17px;padding:3px 9px"${title ? ` title="${title}"` : ''}>${label}</button>`;

  const campBtns = camps.map((c, i) =>
    btn('c' + i, `🐉 ${esc(c.label)}`, `${c.n} events`)).join('');

  const dateInputs = r === 'custom' ? `
    <div style="display:flex;align-items:center;gap:6px;margin-top:8px">
      <span style="font-size:17px;color:#7a9090;text-transform:uppercase;letter-spacing:1px">From</span>
      <input type="date" id="__wpdrg_from" value="${esc(S.drgFrom || '')}" onchange="__wpA.drgDates()"
        style="background:#1a2020;border:1px solid #617070;border-radius:3px;color:#b8c8c8;font-family:monospace;font-size:17px;padding:2px 6px">
      <span style="font-size:17px;color:#7a9090;text-transform:uppercase;letter-spacing:1px">To</span>
      <input type="date" id="__wpdrg_to" value="${esc(S.drgTo || '')}" onchange="__wpA.drgDates()"
        style="background:#1a2020;border:1px solid #617070;border-radius:3px;color:#b8c8c8;font-family:monospace;font-size:17px;padding:2px 6px">
      <span style="font-family:monospace;font-size:15px;color:#617070">// blank = open-ended</span>
    </div>` : '';

  const counter = shownN < totalN
    ? `<span style="font-family:monospace;font-size:15px;color:#7a9090">${shownN} of ${totalN} events</span>`
    : `<span style="font-family:monospace;font-size:15px;color:#617070">${totalN} events</span>`;

  return `
    <div style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        ${btn('all', 'Whole age')}
        ${campBtns}
        ${btn('custom', '📅 Custom')}
        ${counter}
      </div>
      ${dateInputs}
      ${camps.length > 1 ? `<div style="font-family:monospace;font-size:15px;color:#617070;margin-top:4px">
        // dragons are inferred from gaps in activity (${WP_DRAGON_CAMPAIGN_GAP_H}h+), since the bot never names the project
      </div>` : ''}
    </div>`;
}

function _drgSectionSwitch() {
  const on = S.lbSection === 'dragon';
  return `<div style="display:flex;gap:6px;margin-bottom:14px">
    <button class="wb${on?'':' g'}" onclick="__wpA.lbSection('ops')"    style="font-size:17px;padding:3px 12px">⚔ Ops</button>
    <button class="wb${on?' g':''}" onclick="__wpA.lbSection('dragon')" style="font-size:17px;padding:3px 12px">🐉 Dragon</button>
  </div>`;
}

function _buildDragonBoard(allEvents, checks) {
  const metric = S.drgMetric || 'gc';
  const M      = DRG_METRICS[metric];

  // Campaigns are derived from the FULL set, so the picker does not change
  // shape as you move between dragons.
  const camps  = _drgCampaigns(allEvents);
  const events = _drgInRange(allEvents, camps);

  const metricSwitch = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div style="display:flex;gap:6px">
        ${Object.entries(DRG_METRICS).map(([k, m]) =>
          `<button class="wb${metric===k?' g':''}" onclick="__wpA.drgMetric('${k}')" style="font-size:17px;padding:3px 9px">${m.label}</button>`
        ).join('')}
      </div>
      <div style="display:flex;gap:6px">
        <button class="wb${(S.drgSort||'total')==='total'?' g':''}" onclick="__wpA.drgSort('total')" style="font-size:17px;padding:3px 9px">Total</button>
        <button class="wb${S.drgSort==='acre'?' g':''}" onclick="__wpA.drgSort('acre')" style="font-size:17px;padding:3px 9px">/ Acre</button>
        <button class="wb${S.drgSort==='nw'  ?' g':''}" onclick="__wpA.drgSort('nw')"   style="font-size:17px;padding:3px 9px">/ NW</button>
      </div>
    </div>`;

  const rangeBar = _drgRangeBar(camps, allEvents.length, events.length);

  if (!events.length) {
    // Still show the chase list — "nobody has slayed at all" is exactly the
    // case the leader needs to see, and it needs no events to compute.
    const msg = allEvents.length
      ? `// No dragon events in the selected range (${allEvents.length} stored in total).`
      : '// No dragon events stored yet — the backend pulls them from Discord automatically.';
    return metricSwitch + rangeBar + `<div style="color:#7a9090;font-family:monospace;font-size:19px;padding:20px 0">
      ${msg}
    </div>` + _drgNotYetSection({}, metric);
  }

  // ── Aggregate per province ────────────────────────────────────────────────
  const byProv = {};
  events.forEach(ev => {
    const key = ev.prov || ev.ruler || '?';
    if (!byProv[key]) byProv[key] = {
      name: ev.prov, ruler: ev.ruler, slot: ev.slot >= 0 ? ev.slot : null,
      gc: 0, food: 0, slay: 0, troops: 0, n: { gc: 0, food: 0, slay: 0 },
      land: ev.land || 0, nw: ev.nw || 0,
    };
    const p = byProv[key];
    p[ev.type] += ev.amount;
    p.n[ev.type]++;
    if (ev.type === 'slay') p.troops += ev.troops || 0;
    if (ev.slot >= 0) p.slot = ev.slot;
    if (ev.land) p.land = ev.land;
    if (ev.nw)   p.nw   = ev.nw;
  });

  // Live land/NW where the province is still in the roster; the snapshot taken
  // when the event was recorded otherwise, so a chained-out or departed
  // province keeps a sensible per-acre figure instead of dropping to "—".
  const rows = Object.values(byProv).map(p => {
    const prov = p.slot != null ? (S.own?.provinces || []).find(x => x.slot === p.slot) : null;
    const land = prov?.land     || p.land || 0;
    const nw   = prov?.networth || p.nw   || 0;
    const val  = p[metric] || 0;
    return {
      ...p, land, nw, live: !!prov, val,
      perAcre: land ? val / land : null,
      // Per 1,000 NW, not per NW: provinces run to ~1M networth, so a raw
      // ratio collapses everyone into 0.0x and the column stops discriminating.
      perNW:   nw   ? val / nw * 1000 : null,
    };
  }).filter(r => r.val > 0);

  if (!rows.length) {
    return metricSwitch + rangeBar + `<div style="color:#7a9090;font-family:monospace;font-size:19px;padding:20px 0">
      // ${events.length} dragon events in range, but none of type "${esc(M.col)}".
    </div>` + _drgNotYetSection(byProv, metric);
  }

  const sortKey = S.drgSort || 'total';
  rows.sort((a, b) =>
    sortKey === 'acre' ? (b.perAcre ?? -1) - (a.perAcre ?? -1) :
    sortKey === 'nw'   ? (b.perNW   ?? -1) - (a.perNW   ?? -1) :
                         b.val - a.val);

  const total   = rows.reduce((s, r) => s + r.val, 0);
  const maxVal  = Math.max(...rows.map(r => r.val), 1);
  const matched = rows.filter(r => r.slot != null).length;
  const roster  = (S.own?.provinces || []).length;
  const troops  = rows.reduce((s, r) => s + (r.troops || 0), 0);

  // ── Cross-check against the in-game bot's cumulative list ────────────────
  const page  = checks.find(c => c.dragonType != null && c.goldNeeded != null);
  const list  = checks.filter(c => c.byRuler).sort((a, b) => (b.storedAt || 0) - (a.storedAt || 0))[0];
  const gcSum = Object.values(byProv).reduce((s, p) => s + p.gc, 0);
  const gap   = list && metric === 'gc' ? list.listSum - gcSum : null;

  const cards = `
    <div class="wsum" style="margin-bottom:16px">
      <div class="wscard"><div class="l">Total ${esc(M.col)}</div><div class="v">${fK(total)}</div>
        <div class="s">${rows.length} contributors</div></div>
      ${metric === 'slay' ? `<div class="wscard"><div class="l">Troops Sent</div><div class="v">${fK(troops)}</div>
        <div class="s">${total && troops ? (total / troops).toFixed(1) + ' dmg/troop' : ''}</div></div>` : ''}
      <div class="wscard"><div class="l">Matched</div>
        <div class="v" style="color:${matched === rows.length ? '#00ff88' : '#ffaa00'}">${matched}/${rows.length}</div>
        <div class="s">of ${roster} in roster</div></div>
      ${gap != null ? `<div class="wscard" title="The in-game bot's cumulative dragon list minus what the Discord feed captured. A positive gap is donations the feed never saw — typically mobile-app players.">
        <div class="l">Feed Gap</div>
        <div class="v" style="color:${gap > total * 0.05 ? '#ffaa00' : '#00ff88'}">${gap > 0 ? fK(gap) : '0'}</div>
        <div class="s">vs bot list ${fK(list.listSum)}</div></div>` : ''}
      ${page && page.goldNeeded >= 0 ? `<div class="wscard"><div class="l">Still Needed</div>
        <div class="v">${fK(page.goldNeeded)}</div>
        <div class="s">gc${page.foodNeeded >= 0 ? ' · ' + fK(page.foodNeeded) + ' bu' : ''}</div></div>` : ''}
      <div class="wscard"><div class="l">Events</div><div class="v">${events.length}</div>
        <div class="s">${page && page.dragonType ? esc(page.dragonType) + (page.targetKd ? ' → ' + esc(page.targetKd) : '') : 'all stored'}</div></div>
    </div>`;

  const body = rows.map((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1);
    const barW  = Math.round(r.val / maxVal * 100);
    const share = total ? (r.val / total * 100) : 0;
    const label = r.slot != null
      ? esc(pnum(r.slot, r.name))
      : `<span style="color:#ffaa00" title="No province of this name in the current roster — left the kingdom, or the feed name differs">${esc(r.name || r.ruler)}</span>`;
    const dim = r.live ? '' : 'color:#7a9090';
    return `<tr>
      <td style="font-family:monospace;font-size:19px">${medal}</td>
      <td style="font-weight:700">${label}</td>
      <td style="text-align:right;font-family:monospace">
        ${fK(r.val)}
        <div style="height:3px;background:#617070;border-radius:2px;margin-top:2px">
          <div style="height:100%;width:${barW}%;background:${M.bar};border-radius:2px"></div>
        </div>
      </td>
      <td style="text-align:right;font-family:monospace;color:#7a9090">${share.toFixed(1)}%</td>
      <td style="text-align:right;font-family:monospace;${dim}">${r.perAcre == null ? '—' : (r.perAcre >= 100 ? fK(Math.round(r.perAcre)) : r.perAcre.toFixed(1))}</td>
      <td style="text-align:right;font-family:monospace;${dim}">${r.perNW == null ? '—' : (r.perNW >= 100 ? Math.round(r.perNW) : r.perNW.toFixed(1))}</td>
      ${metric === 'slay' ? `<td style="text-align:right;font-family:monospace;color:#7a9090">${fK(r.troops)}</td>` : ''}
      <td style="text-align:right;font-family:monospace;color:#7a9090">${r.land ? fK(r.land) : '—'}</td>
      <td style="text-align:right;font-family:monospace;color:#7a9090">${r.nw ? fK(r.nw) : '—'}</td>
      <td style="text-align:right;font-family:monospace;color:#7a9090">${r.n[metric]}</td>
    </tr>`;
  }).join('');

  const table = `
    <table class="wtbl">
      <thead><tr>
        <th style="width:24px">#</th><th>Province</th>
        <th style="text-align:right">${esc(M.col)}</th>
        <th style="text-align:right">Share</th>
        <th style="text-align:right">${esc(M.unit)}/Acre</th>
        <th style="text-align:right" title="Per 1,000 networth">${esc(M.unit)}/kNW</th>
        ${metric === 'slay' ? '<th style="text-align:right">Troops</th>' : ''}
        <th style="text-align:right">Acres</th>
        <th style="text-align:right">NW</th>
        <th style="text-align:right">Events</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    <div style="font-family:monospace;font-size:15px;color:#617070;margin-top:8px">
      // Per-acre and per-1,000-NW use each province's CURRENT land and networth; greyed rows are
      // provinces no longer in the roster, normalised against their size when the event was recorded.
      // utopiabot does not report players acting from the mobile app — treat every total as a floor.
    </div>`;

  return metricSwitch + rangeBar + cards + table + _drgNotYetSection(byProv, metric);
}

// ── "Hasn't contributed yet" chase list ────────────────────────────────────
// The point of the top list during a dragon is not the ranking, it's spotting
// who has done nothing. Ranked by size, because a 3k-acre province sitting out
// costs the kingdom far more than a 300-acre one.

function _drgNotYetSection(byProv, metric) {
  const M      = DRG_METRICS[metric];
  const roster = S.own?.provinces || [];
  if (!roster.length) return '';

  // Contribution is looked up by province NAME — the feed's leading field —
  // so a province that never appears in it counts as having done nothing.
  const did = {};
  Object.values(byProv).forEach(p => {
    if (!p.name) return;
    did[p.name.toLowerCase()] = p;
  });

  const missing = roster
    .map(p => ({ p, c: did[(p.name || '').toLowerCase()] }))
    .filter(x => !x.c || !(x.c[metric] > 0))
    .map(x => ({
      slot:    x.p.slot,
      name:    x.p.name,
      discord: x.p.discord || '',
      land:    x.p.land || 0,
      nw:      x.p.networth || 0,
      // What they DID do — "funded but never slayed" is a different
      // conversation from "did nothing at all".
      gc:   x.c?.gc   || 0,
      food: x.c?.food || 0,
      slay: x.c?.slay || 0,
    }))
    .sort((a, b) => b.land - a.land);

  // Stashed for the reminder button — inline onclick cannot carry an array.
  S._drgNotYet = { metric, list: missing };

  const dragonOn = S.own?.kdEffects?.dragon || '';
  const slayNote = metric === 'slay' && !dragonOn
    ? `<div style="font-family:monospace;font-size:15px;color:#617070;margin-bottom:8px">
         // No dragon is currently on our lands, so there is nothing to slay right now.
       </div>`
    : '';

  if (!missing.length) {
    return `<div class="wsech" style="margin-top:24px">Hasn't ${metric === 'slay' ? 'slayed' : 'funded'} yet</div>
      ${slayNote}
      <div style="color:#00ff88;font-family:monospace;font-size:19px;padding:8px 0">
        // Everyone in the roster has contributed. Nothing to chase.
      </div>`;
  }

  const rows = missing.map(m => {
    const otherBits = [
      m.gc   ? `${fK(m.gc)} gc`      : '',
      m.food ? `${fK(m.food)} bu`    : '',
      m.slay ? `${fK(m.slay)} dmg`   : '',
    ].filter(Boolean).join(' · ');
    return `<tr>
      <td style="font-weight:700">${esc(pnum(m.slot, m.name))}</td>
      <td style="font-family:monospace;color:${m.discord ? '#b8c8c8' : '#617070'}">${esc(m.discord || '—')}</td>
      <td style="text-align:right;font-family:monospace">${fK(m.land)}</td>
      <td style="text-align:right;font-family:monospace">${fK(m.nw)}</td>
      <td style="font-family:monospace;font-size:15px;color:#7a9090">${otherBits || '<span style="color:#ff4455">nothing at all</span>'}</td>
    </tr>`;
  }).join('');

  const acresIdle = missing.reduce((s, m) => s + m.land, 0);

  return `
    <div class="wsech" style="margin-top:24px">Hasn't ${metric === 'slay' ? 'slayed' : 'funded'} yet — ${missing.length} of ${roster.length}</div>
    ${slayNote}
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
      <span style="font-family:monospace;font-size:17px;color:#7a9090">
        ${fK(acresIdle)} acres sitting out ${esc(M.col.toLowerCase())}
      </span>
      <button class="wb" onclick="__wpA.dragonRemind()" style="font-size:17px;padding:3px 12px"
        title="${S.discordWebhook ? 'Post this chase list to the configured Discord webhook' : 'No Discord webhook configured — set one in the Alerts tab'}"
        ${S.discordWebhook ? '' : 'disabled'}>📣 Post reminder to Discord</button>
      <span id="__wpdrg_remind" style="font-family:monospace;font-size:17px;color:#7a9090"></span>
    </div>
    <table class="wtbl">
      <thead><tr>
        <th>Province</th><th>Discord</th>
        <th style="text-align:right">Acres</th>
        <th style="text-align:right">NW</th>
        <th>Did contribute</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Post the current chase list to the war Discord webhook */
async function dragonRemind() {
  const st  = $id('__wpdrg_remind');
  const say = (m, c) => { if (st) { st.textContent = m; st.style.color = c || '#7a9090'; } };
  const stash = S._drgNotYet;
  if (!stash?.list?.length) { say('Nothing to remind about.', '#7a9090'); return; }
  if (!S.discordWebhook)    { say('No webhook configured (Alerts tab).', '#ff4455'); return; }

  const verb    = stash.metric === 'slay' ? 'slayed' : 'funded the dragon';
  const dragon  = S.own?.kdEffects?.dragon || '';
  const lines   = stash.list.map(m =>
    `\`${String(m.slot).padStart(2)}\` **${m.name}**${m.discord ? ` (${m.discord})` : ''} — ${fK(m.land)} acres`
  );

  // Discord hard-limits an embed description to 4096 characters.
  let desc = '', dropped = 0;
  for (const l of lines) {
    if (desc.length + l.length + 1 > 3800) { dropped++; continue; }
    desc += l + '\n';
  }
  if (dropped) desc += `\n_…and ${dropped} more._`;

  const ok = await sendDiscordEmbed(S.discordWebhook, {
    embeds: [{
      title: `🐉 Not ${verb} yet — ${stash.list.length} province${stash.list.length === 1 ? '' : 's'}`,
      description: desc,
      color: 0xffaa00,
      footer: { text: dragon
        ? `${dragon} is on our lands — every troop sent shortens it`
        : 'Sorted by acres — the big ones cost us most by sitting out' },
    }],
  });
  say(ok ? 'Reminder posted.' : 'Discord post failed — see console.', ok ? '#00ff88' : '#ff4455');
}

function _drgPasteBox() {
  return `
    <div class="wsech" style="margin-top:24px">Ingest</div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap">
      <button class="wb g" onclick="__wpA.dragonPullAndRender()" style="font-size:17px;padding:3px 12px"
        title="${S.apiEndpoint ? 'Ask the backend to poll the DRAGON Discord channel, then mirror new events in' : 'No backend endpoint configured — set it in the Alerts tab'}"
        ${S.apiEndpoint ? '' : 'disabled'}>⟳ Pull from Discord</button>
      <span style="font-family:monospace;font-size:15px;color:#617070">
        // also runs with each backend sync — the paste box below is the manual fallback
      </span>
    </div>

    <div class="wsech" style="margin-top:16px">Paste dragon data</div>
    <div style="font-family:monospace;font-size:17px;color:#7a9090;margin-bottom:8px">
      // Copy the utopiabot <b style="color:#ffd400">DRAGON</b> messages from Discord and paste them here —
      // re-pasting an overlapping range is safe, events de-duplicate on content.
      // <b style="color:#ffaa00">Only for history the backend cannot reach</b>: pasted events are keyed by
      // content, backend-pulled ones by Discord message id, so an event that arrives both ways counts twice.
      // Optional extras in the same paste: the in-game bot's <b style="color:#ffd400">dragon</b> list
      // (cumulative totals, used as a cross-check) and the fund_dragon page text (dragon type,
      // target kingdom, what is still needed).
    </div>
    <textarea id="__wpdrg_in" rows="6" placeholder="DRAGON Ankylosaurus Rex [bridg#] donated 62,093 gold coins to fund dragon!&#10;DRAGON Dilophosaurus [borwhack] sent 350 troops and weakened dragon by 3723 points!"
      style="width:100%;background:#1a2020;border:1px solid #617070;border-radius:4px;color:#b8c8c8;
             font-family:monospace;font-size:17px;padding:8px;resize:vertical"></textarea>
    <div style="display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap">
      <button class="wb g" onclick="__wpA.dragonSave()" style="font-size:17px;padding:3px 12px">💾 Parse &amp; Save</button>
      <span id="__wpdrg_status" style="font-family:monospace;font-size:17px;color:#7a9090"></span>
    </div>`;
}
