// ── ACTIVITY TAB ───────────────────────────────────────────────────────────
// When is each province of a kingdom online? Built from the online (*) markers
// on the game's kingdom page, sampled every few minutes by
// scripts/activity-collector.user.js running in someone's utopia-game.com tab.
//
// DATA: activity/{K_I}_{YYYYMMDD}, one document per kingdom per UTC day:
//   {loc, day, kdName, names: {slot: name}, updatedAt,
//    samples: [{t, on: [slots with a star], mt: [slots with TWO stars]}]}
// Two stars = the province's MENTOR is logged in for them (a mentor gets 4h out
// of every 12h), so mt is always a subset of on. "Active" counts both; the
// mentor share is shown separately because a province minded by its mentor is
// covered, but its player is not at the keyboard.
//
// WHAT A STAR MEANS IN TIME is not known -- probably "active in the last N
// minutes", not "has the page open". The tab therefore reports the share of
// SAMPLES in which a province was starred, never minutes online.
//
// ABSENCE: a province is only judged in samples taken while it held that slot
// (the day doc's names map). A day with no document means the collector was
// not running, never that the kingdom was offline -- hours without samples are
// drawn empty, not dark-green-zero.
//
// QUOTA: one read per UTC day in the window, fetched in one batchGet and cached
// per day. A closed day never changes and is never re-read; only the day still
// being written (normally just today) is refreshed -- on ⟳, or on re-opening
// the tab after ACTIVITY.TODAY_TTL_MS. View switches cost nothing. The enemy
// view also needs kd_identities for earlier-war profiles: the KD DATABASE tab's
// once-per-session read, shared. Saving a profile is one write. The collector
// batches its writes (every 15 min, ~96/day per tracked kingdom).

const _ACT_GREEN  = '96,192,64';
const _ACT_MENTOR = '176,120,255';

function _actLoc() {
  return S.actView === 'own' ? (S.own?.location || '') : (S.eLoc || '');
}

/** 'YYYYMMDD' for the UTC day containing ms */
function _actDayId(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** End of that UTC day, in ms — a doc read before this may still grow */
function _actDayEnd(id) {
  return Date.UTC(+id.slice(0, 4), +id.slice(4, 6) - 1, +id.slice(6, 8) + 1);
}

/** The last `days` UTC day ids, oldest first, today last */
function _actDayIds(days, now = Date.now()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(_actDayId(now - i * 864e5));
  return out;
}

/**
 * Which store a view reads. The ENEMY view is the collector's star samples
 * (`activity`). The OWN view is built from the IS's SoT archive
 * (`activity_is`, see the IS section below) — own provinces post a SoT to the
 * IS every time their player logs in (login lands on the throne page), so the
 * IS already knows when each of our players was on, with no collector at all.
 */
function _actColl(view = S.actView) { return view === 'own' ? 'activity_is' : 'activity'; }

function _actDocPath(loc, id, coll = _actColl()) { return `${coll}/${String(loc).replace(':', '_')}_${id}`; }

function _actCacheOf(loc, coll = _actColl()) {
  const k = `${coll}|${loc}`;
  return S.actCache[k] || (S.actCache[k] = { docs: {}, readAt: {} });
}

/**
 * Make sure the window's day docs are in the cache.
 *   default       fetch missing days, plus open days older than TODAY_TTL_MS
 *   {cached:true} fetch missing days only (a view switch widening the range)
 *   {force:true}  fetch missing days and every open day (⟳ Refresh)
 * Returns false when the read failed; the cache is left as it was, so a failure
 * can never turn loaded history into "no data".
 */
async function _actLoad(loc, days, opts = {}, coll = _actColl()) {
  const c = _actCacheOf(loc, coll);
  const now = Date.now();
  const want = _actDayIds(days, now).filter(id => {
    if (!(id in c.docs)) return true;
    if (opts.cached) return false;
    const open = c.readAt[id] < _actDayEnd(id);
    if (!open) return false;
    return opts.force || now - c.readAt[id] > ACTIVITY.TODAY_TTL_MS;
  });
  if (!want.length) return true;
  const got = await fbBatchGet(want.map(id => _actDocPath(loc, id, coll)), `${coll} ${loc}`);
  if (!got) { S.actErr = S.fbLastError || 'Firestore read failed'; return false; }
  S.actErr = '';
  want.forEach(id => { c.docs[id] = got[_actDocPath(loc, id, coll)] || null; c.readAt[id] = now; });
  return true;
}

// ── OWN kingdom: the IS SoT archive ────────────────────────────────────────
// Province/v1/SotArchive returns "SoTs over last 72 ticks" for one province —
// ONLY the ticks in which a fresh SoT arrived (verified live 2026-09-11 on 5:11:
// gappy tickIds, no nulls, no entry identical to the one before; 63, 34, 11
// and 6 entries for four provinces). An own province's SoT arrives when its
// player loads the throne page, which is where a login lands, so an entry is
// "this player was on during that tick". It is a LOGIN measure, not a session
// length: someone who stays on for three hours without reloading the throne
// shows the first hour only. Hourly resolution (one cell per tick). Players
// whose game does not forward intel to the IS (intel sending off; probably the
// mobile app) never appear — a floor, like the dragon feed. A tool that
// reloads the throne by itself would make its player look on every tick.
//
// TICK → CLOCK: a SoT's tickId is the tick number MINUS ONE during the hour it
// was posted (fresh SoT = tickId 1109 while currentTick.tickNumber is 1110;
// fixture: tickNumber 1680, a 14.7h-old SoT has tickId 1665). Ticks fall on
// the UTC hour. The offset is re-checked against every province's current SoT
// age on each pull, and a consistent disagreement is corrected, so a wrong
// assumption shifts nothing.
//
// STORAGE: the archive only reaches 72 ticks back, so what a pull sees is
// merged into activity_is/{K_I}_{YYYYMMDD}: {loc, day, names, updatedAt,
// covered: [UTC hours the archive spanned], seen: {slot: [UTC hours with a
// SoT]}}. Only NEW hours are sent (arrayUnion), one write per day doc that
// gained something — a pull every 30 minutes costs ~1 write, the IS calls cost
// no Firestore at all. The CURRENT hour is never stored (it is not over yet —
// storing it would record everyone who logs in later this hour as "off"); it
// is shown live as "this hour" from the pull instead.

/** Stored IS day doc → the sample shape the aggregator reads (one sample per covered hour) */
function _actDocSamples(d) {
  if (d.samples) return d.samples;
  const day0 = Date.UTC(+d.day.slice(0, 4), +d.day.slice(4, 6) - 1, +d.day.slice(6, 8));
  const seen = Object.entries(d.seen || {}).map(([slot, hrs]) => [+slot, new Set(hrs)]);
  return [...new Set(d.covered || [])].sort((a, b) => a - b).map(h => ({
    t: day0 + h * 3600e3 + 30 * 60e3,
    on: seen.filter(([, hrs]) => hrs.has(h)).map(([slot]) => slot),
    mt: [],
  }));
}

/**
 * Pull the SoT archive of every own province and merge what is new into
 * activity_is. Throttled to once per ACTIVITY.IS_PULL_MIN unless forced.
 * Returns false (with S.actErr) when the IS could not be read in full — a
 * province whose archive failed would otherwise be stored as "never on".
 */
async function _actIsPull(loc, opts = {}) {
  const now = Date.now();
  if (!opts.force && now - (S.actIsPulledAt[loc] || 0) < ACTIVITY.IS_PULL_MIN * 60e3) return true;
  const od = await fetchOwnKingdom().catch(() => null);
  const kd = od?.kingdom, tickNo = od?.currentTick?.tickNumber;
  if (!kd?.provinces?.length || !tickNo) { S.actErr = 'could not read the own kingdom from the IS'; return false; }
  if (od.currentTick.tickName) { S.currentTickName = od.currentTick.tickName; S.tickAt = now; }   // fresher Utopia-time anchor

  const hourNow = Math.floor(now / 3600e3) * 3600e3;
  // Calibrate: where each province's current SoT says tick T sits, vs the rule
  const est = kd.provinces.filter(p => p.sot?.tickId != null && p.sot?.ageSeconds != null)
    .map(p => Math.round((Math.floor((now - p.sot.ageSeconds * 1000) / 3600e3) * 3600e3
      - (hourNow - (tickNo - 1 - p.sot.tickId) * 3600e3)) / 3600e3))
    .sort((a, b) => a - b);
  const corrH = est.length ? est[Math.floor(est.length / 2)] : 0;
  const hourOfTick = T => hourNow - (tickNo - 1 - T) * 3600e3 + corrH * 3600e3;

  const arch = {};
  let failed = 0;
  for (let i = 0; i < kd.provinces.length; i += 4) {       // 4 at a time — ~24 small GETs, polite to the IS
    await Promise.all(kd.provinces.slice(i, i + 4).map(async p => {
      const a = await fetchSotArchive(loc, p.slot);
      if (a) arch[p.slot] = a; else failed++;
    }));
  }
  if (failed) { S.actErr = `the IS SoT archive failed for ${failed} of ${kd.provinces.length} provinces — nothing stored, try ⟳ again`; return false; }

  // Completed hours the archive spans; the current hour is held back (see above)
  const firstT = hourOfTick(tickNo - ACTIVITY.IS_ARCHIVE_TICKS);
  const byDay = {};
  const dayOf = t => byDay[_actDayId(t)] || (byDay[_actDayId(t)] = { covered: new Set(), seen: {} });
  for (let t = firstT; t < hourNow; t += 3600e3) dayOf(t).covered.add(new Date(t).getUTCHours());
  const thisHour = new Set();
  for (const [slot, entries] of Object.entries(arch)) {
    for (const e of entries) {
      if (e?.tickId == null) continue;
      const t = hourOfTick(e.tickId);
      if (t >= hourNow) { thisHour.add(+slot); continue; }
      if (t < firstT) continue;
      (dayOf(t).seen[slot] || (dayOf(t).seen[slot] = new Set())).add(new Date(t).getUTCHours());
    }
  }

  // Merge into the stored days: read what is there (cached per day), send only what is new
  const ids = Object.keys(byDay).sort();
  const need = Math.round((_actDayEnd(_actDayId(now)) - _actDayEnd(ids[0])) / 864e5) + 1;   // oldest pulled day → today
  if (!await _actLoad(loc, need, { cached: true }, 'activity_is')) return false;
  const c = _actCacheOf(loc, 'activity_is');
  const names = Object.fromEntries(kd.provinces.map(p => [String(p.slot), p.name]));
  for (const id of ids) {
    const have = c.docs[id] || { covered: [], seen: {} };
    const d = byDay[id];
    const newCov = [...d.covered].filter(h => !(have.covered || []).includes(h));
    const newSeen = Object.entries(d.seen)
      .map(([slot, hrs]) => [slot, [...hrs].filter(h => !(have.seen?.[slot] || []).includes(h))])
      .filter(([, hrs]) => hrs.length);
    if (!newCov.length && !newSeen.length) continue;
    const ok = await fbAppend(_actDocPath(loc, id, 'activity_is'),
      { loc, day: id, names, updatedAt: now, src: 'is-sot-archive' },
      [[['covered'], newCov], ...newSeen.map(([slot, hrs]) => [['seen', slot], hrs])]);
    if (!ok) { S.actErr = S.fbLastError || 'Firestore write failed'; return false; }
    const seen = { ...(have.seen || {}) };
    newSeen.forEach(([slot, hrs]) => { seen[slot] = [...(seen[slot] || []), ...hrs]; });
    c.docs[id] = { ...have, loc, day: id, names, updatedAt: now, covered: [...(have.covered || []), ...newCov], seen };
  }

  S.actIsPulledAt[loc] = now;
  S.actIsNow[loc] = {
    at: now, hourStart: hourNow, on: thisHour, corrH,
    // Exact last-seen from each province's current SoT age — finer than the hour cells
    lastSeen: Object.fromEntries(kd.provinces.filter(p => p.sot?.ageSeconds != null)
      .map(p => [p.slot, now - p.sot.ageSeconds * 1000])),
  };
  S.actErr = '';
  return true;
}

function _actSameName(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/**
 * Fold the window's samples into per-province and kingdom-wide tallies.
 * Pure: reads S.actCache and the roster passed in, touches nothing.
 * Hours are bucketed in the viewer's local time or UTC (tick-aligned).
 */
function _actAggregate(loc, days, tz, roster, now = Date.now(), coll = _actColl()) {
  const c = _actCacheOf(loc, coll);
  const ids = _actDayIds(days, now);
  const docs = ids.map(id => c?.docs[id]).filter(Boolean);
  const hourOf = t => _actIdx(t);   // column = Utopian day of the month; `tz` is kept for callers, unused
  const blank = () => Array.from({ length: 24 }, () => ({ n: 0, on: 0, mt: 0 }));

  // Roster: the live IS kingdom when it is loaded, else the newest names seen
  if (!roster?.length) {
    const last = docs[docs.length - 1];
    roster = Object.entries(last?.names || {}).map(([slot, name]) => ({ slot: +slot, name }));
  }
  const rows = roster
    .map(p => ({ slot: +p.slot, name: p.name || '', ruler: p.ruler || '', h: blank(), n: 0, on: 0, mt: 0, lastSeen: 0, lastSeenMt: false }))
    .sort((a, b) => a.slot - b.slot);

  // The IS archive is hourly, so its timeline cells are hours; half-hour cells
  // would leave every other one empty.
  const binMin = coll === 'activity_is' ? 60 : ACTIVITY.TIMELINE_BIN_MIN;
  const binMs = binMin * 60e3;
  const nBins = Math.round(ACTIVITY.TIMELINE_H * 60 / binMin);
  const bin0  = Math.floor(now / binMs) * binMs - (nBins - 1) * binMs;
  rows.forEach(r => { r.tl = Array.from({ length: nBins }, () => ({ n: 0, on: 0, mt: 0 })); });

  const kdH = blank();
  let nSamples = 0, lastT = 0, firstT = 0, last = null, kdName = '';
  const daysWithData = docs.length;

  for (const d of docs) {
    if (d.kdName) kdName = d.kdName;
    const names = d.names || {};
    for (const s of _actDocSamples(d)) {
      if (!s || !s.t) continue;
      const on = new Set(s.on || []), mt = new Set(s.mt || []);
      const h = hourOf(s.t);
      nSamples++;
      kdH[h].n++; kdH[h].on += on.size; kdH[h].mt += mt.size;
      if (s.t > lastT) { lastT = s.t; last = { t: s.t, on, mt, names }; }
      if (!firstT || s.t < firstT) firstT = s.t;
      const b = Math.floor((s.t - bin0) / binMs);
      for (const r of rows) {
        const nm = names[r.slot];
        if (nm == null || !_actSameName(nm, r.name)) continue;   // slot empty / another province that day
        const isOn = on.has(r.slot), isMt = mt.has(r.slot);
        r.n++; r.h[h].n++;
        if (isOn) { r.on++; r.h[h].on++; if (s.t > r.lastSeen) { r.lastSeen = s.t; r.lastSeenMt = isMt; } }
        if (isMt) { r.mt++; r.h[h].mt++; }
        if (b >= 0 && b < nBins) { r.tl[b].n++; if (isOn) r.tl[b].on++; if (isMt) r.tl[b].mt++; }
      }
    }
  }

  const src = coll === 'activity_is' ? 'is' : 'collector';
  // IS source: "now" is the current hour from the last pull (never stored), and
  // last-seen is each province's exact current SoT time rather than an hour cell.
  const isNow = src === 'is' ? S.actIsNow[loc] : null;
  const isFresh = !!isNow && isNow.hourStart === Math.floor(now / 3600e3) * 3600e3;
  const live = src === 'is' ? isFresh : !!(lastT && now - lastT < ACTIVITY.LIVE_MIN * 60e3);
  rows.forEach(r => {
    r.pct   = r.n ? r.on / r.n : null;
    r.mtPct = r.n ? r.mt / r.n : null;
    if (src === 'is') {
      r.nowOn = isFresh && isNow.on.has(r.slot);
      r.nowMt = false;
      if (isNow?.lastSeen[r.slot] > r.lastSeen) { r.lastSeen = isNow.lastSeen[r.slot]; r.lastSeenMt = false; }
    } else {
      r.nowOn = live && last.on.has(r.slot) && _actSameName(last.names[r.slot], r.name);
      r.nowMt = r.nowOn && last.mt.has(r.slot);
    }
  });
  kdH.forEach(x => { x.avg = x.n ? x.on / x.n : null; x.avgMt = x.n ? x.mt / x.n : null; });

  return { rows, kdH, nSamples, daysWithData, days, firstT, lastT: isFresh ? isNow.at : lastT, live, last, kdName,
           bin0, binMs, nBins, src };
}

// ── War activity profile → KD Database ─────────────────────────────────────
// At the end of a war the leader saves a compact summary of the samples onto
// the enemy's identity in kd_identities, under activity.{age}. It rides inside
// a document the KD DATABASE tab reads anyway, so showing it later costs
// nothing, and saving it is ONE write (fbPatch touches only that field, so the
// rest of the identity is left alone). Hours are stored in UTC — tick time,
// independent of whoever looks at it.
//
//   activity.{age}: {age, loc, kdName, from, to, n, days, savedAt,
//     kd:     {on: [24 avg provinces online], mt: [24 avg by mentor], hn: [24 samples]},
//     rulers: [{r: ruler, p: province, slot, n, pct, mtPct, on: [24 %], mt?: [24 %]}]}
//
// PER RULER, not per province: the ruler is what KD Database fingerprints a
// kingdom by across ages, and a player keeps it when the province name, the
// kingdom and the slot all change. Rulers come from the IS SoT; a province
// without one is kept under its province name (r: '') and cannot be carried
// over to another age. null in an hour array = no samples in that hour.

const _actR1 = x => Math.round(x * 10) / 10;

function _actEnemyRoster() {
  return (S.enemy?.provinces || []).map(p => ({ slot: p.slot, name: p.name, ruler: p.sot?.ruler || '' }));
}

/** Profile for loc from the cached day docs, or null when there is too little */
function _actBuildProfile(loc, age, roster, now = Date.now()) {
  const a = _actAggregate(loc, ACTIVITY.DAYS_MAX, 'utc', roster, now, 'activity');
  if (a.nSamples < ACTIVITY.PROFILE_MIN_SAMPLES) return null;
  const pct = (x, k) => x.n ? Math.round(x[k] / x.n * 100) : null;
  return {
    age, loc, kdName: a.kdName || '', from: a.firstT, to: a.lastT, n: a.nSamples, days: a.daysWithData, savedAt: now,
    kd: {
      on: a.kdH.map(x => x.n ? _actR1(x.avg) : null),
      mt: a.kdH.map(x => x.n ? _actR1(x.avgMt) : null),
      hn: a.kdH.map(x => x.n),
    },
    rulers: a.rows.filter(r => r.n).map(r => {
      const e = { r: r.ruler, p: r.name, slot: r.slot, n: r.n, pct: Math.round(r.pct * 100), mtPct: Math.round(r.mtPct * 100),
                  on: r.h.map(x => pct(x, 'on')) };
      if (r.mt) e.mt = r.h.map(x => pct(x, 'mt'));   // only mentored provinces carry the second array
      return e;
    }),
  };
}

/** The KD Database identity this age+location was tagged as, if any */
function _actIdentityFor(age, loc) {
  if (!age || !loc) return null;
  return _kddbIdentities.find(i => (i.kdHistory || []).some(h => h.age === age && h.location === loc)) || null;
}

/**
 * Which identity the current enemy is: the one tagged for this age+location,
 * else the best ruler match (the same scoring KD Database uses, 2+ rulers).
 */
function _actKnownIdentity(loc) {
  const tagged = _actIdentityFor(_kddbGetAge(), loc);
  if (tagged) return { identity: tagged, how: 'tagged' };
  const provs = (S.enemy?.provinces || []).map(p => ({ ruler: p.sot?.ruler || '', race: p.race || '' }));
  const best = _kddbScore(provs)[0];
  if (best && best.rulerHits >= 2) {
    const identity = _kddbIdentities.find(i => i.id === best.identityId);
    if (identity) return { identity, how: `${best.rulerHits} rulers match` };
  }
  return null;
}

/**
 * ruler (lowercase) → newest saved profile entry for that ruler, across every
 * identity. `skip(prof)` leaves profiles out — the ACTIVITY tab skips the war
 * it is showing, or saving this war would hide every earlier one behind it.
 */
function _actRulerIndex(skip) {
  const idx = new Map();
  for (const idn of _kddbIdentities) {
    for (const prof of Object.values(idn.activity || {})) {
      if (skip && skip(prof)) continue;
      for (const e of (prof.rulers || [])) {
        if (!e.r) continue;
        const k = e.r.trim().toLowerCase();
        const cur = idx.get(k);
        if (!cur || prof.savedAt > cur.prof.savedAt) idx.set(k, { e, prof, identity: idn });
      }
    }
  }
  return idx;
}

// ── Utopian clock ───────────────────────────────────────────────────────────
// Everything on this tab is shown in UTOPIA TIME (leader, 2026-09-11: "it works
// for everyone" — no time zones to translate). One tick = one real hour = one
// Utopian day, so a real day is a Utopian month and the hour-of-day axis is the
// DAY OF THE MONTH, 1–24 ("they log in around the 5th"). The mapping is
// anchored on the tick name the IS last reported (S.currentTickName, read at
// S.tickAt), and ticks fall on the UTC hour. Storage stays in UTC hours: a
// player's habits follow the real clock, and the day that a given UTC hour
// becomes shifts from age to age with the age's start hour — so a profile from
// an earlier age is re-mapped onto THIS age's days when it is shown.

/** Utopian date of the tick running at real time t: {day, month, year, label}, or null without an anchor */
function _actUto(t) {
  const cur = _parseUtoDate(S.currentTickName || '');
  if (!cur || !S.tickAt) return null;
  const dh = Math.floor(t / 3600e3) - Math.floor(S.tickAt / 3600e3);
  return _absToUto(_utoToAbs(cur.month, cur.day, cur.year) + dh);
}

/** Display column 0–23 (Utopian day − 1) for real time t; falls back to the UTC hour */
function _actIdx(t) {
  const u = _actUto(t);
  return u ? u.day - 1 : new Date(t).getUTCHours();
}

/** Display column for a UTC hour of day */
function _actUtcToIdx(h) {
  const base = Math.floor(Date.now() / 86400e3) * 86400e3;
  return _actIdx(base + h * 3600e3);
}

/** Column label: the Utopian day of the month */
function _actDayLab(i) { return String(i + 1); }

/** "May 6 +23m" — the Utopian day and how far into that tick */
function _actWhen(t) {
  const u = _actUto(t);
  const m = Math.floor((t % 3600e3) / 60e3);
  if (!u) return new Date(t).toISOString().slice(11, 16) + ' UTC';
  return `${MONTHS_LIST[u.month - 1].slice(0, 3)} ${u.day}` + (m ? ` +${m}m` : '');
}

/** "May 6, YR6 +23m" */
function _actStamp(t) {
  const u = _actUto(t);
  const m = Math.floor((t % 3600e3) / 60e3);
  return u ? u.label + (m ? ` +${m}m` : '') : new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

/** Re-index a stored 24-value UTC-hour array into display columns (Utopian days) */
function _actToTz(arr) {
  const out = Array(24).fill(null);
  if (!arr) return out;
  for (let h = 0; h < 24; h++) out[_actUtcToIdx(h)] = arr[h] ?? null;
  return out;
}

/** Quietest hours of a stored KD profile, in display time */
function _actProfileQuiet(prof, k = 3) {
  const on = _actToTz(prof.kd?.on), hn = _actToTz(prof.kd?.hn);
  return on.map((v, h) => ({ h, v, n: hn[h] || 0 })).filter(x => x.v != null && x.n >= 2)
    .sort((p, q) => p.v - q.v).slice(0, k);
}

/**
 * A 24-cell strip from a stored profile. kind 'kd' = average provinces online
 * (yellow, relative to the strip's max), 'ruler' = % online (green steps,
 * purple underline for the mentor).
 */
function _actStrip(on, mt, kind, cellW = 14, tipPrefix = '') {
  const v = _actToTz(on), m = mt ? _actToTz(mt) : null;
  const max = Math.max(0.01, ...v.map(x => x || 0));
  return `<span style="display:inline-flex;vertical-align:middle;border:1px solid #0f1515">` + v.map((x, h) => {
    const hr = `day ${_actDayLab(h)}`;
    let style, tip;
    if (x == null) { style = 'background:#141c1c'; tip = `${hr} — no samples`; }
    else if (kind === 'kd') {
      style = `background:rgba(255,212,0,${(0.08 + (x / max) * 0.6).toFixed(2)})`;
      tip = `${hr} — ${x} provinces online on average`;
    } else {
      style = _actCellStyle(100, x, m?.[h] || 0);
      tip = `${hr} — online in ${x}% of samples` + (m?.[h] ? ` (${m[h]}% mentor)` : '');
    }
    return `<span title="${esc(tipPrefix + tip)}" style="display:inline-block;width:${cellW}px;height:14px;${style}"></span>`;
  }).join('') + `</span>`;
}

function _actFmtDate(t) {
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * "Jul 28–Aug 10 · 3,204 samples · quietest day 5" for one saved profile. The
 * war's span is in real dates (it may be another age, whose Utopian calendar
 * we cannot place); the quietest day is mapped onto this age's days.
 */
function _actProfileLine(prof) {
  const q = _actProfileQuiet(prof, 1)[0];
  return `${_actFmtDate(prof.from)}–${_actFmtDate(prof.to)} · ${(prof.n || 0).toLocaleString()} samples`
    + (q ? ` · quietest day ${_actDayLab(q.h)}` : '');
}

/** Leader button: summarise the loaded samples onto the enemy's KD Database identity */
async function actSaveProfile() {
  if (S.actView === 'own') return;
  const loc = S.eLoc;
  if (!_kddbLoaded) {
    try { await _kddbLoadAll(); } catch (e) { alert(`Could not load KD Database: ${e.message}`); return; }
  }
  const age = _kddbGetAge();
  if (!age) { alert('Set the current age in the KD DATABASE tab first (e.g. a116) — profiles are stored per age.'); return; }
  const kdName = S.enemy?.kingdomName || loc;
  const idn = _actIdentityFor(age, loc);
  if (!idn) {
    alert(`${kdName} (${loc}) is not tagged in KD Database for ${age} yet.\n\n`
      + `Open KD DATABASE → Save & Analyze → Confirm (or Create & Tag), then save the activity again.`);
    return;
  }
  // Whole lookback: the profile should cover the war, not just the days on screen
  if (!await _actLoad(loc, ACTIVITY.DAYS_MAX, {})) { alert(`Could not read the samples: ${S.actErr}`); return; }
  const prof = _actBuildProfile(loc, age, _actEnemyRoster());
  if (!prof) { alert(`Too few samples to save a profile (need ${ACTIVITY.PROFILE_MIN_SAMPLES}).`); return; }
  const noRuler = prof.rulers.filter(e => !e.r).length;
  const prev = idn.activity?.[age];
  if (!confirm(`Save war activity for ${prof.kdName || kdName} to KD Database identity "${idn.label}" (${age})?\n\n`
    + `${prof.n.toLocaleString()} samples over ${prof.days} day(s), ${_actFmtDate(prof.from)} – ${_actFmtDate(prof.to)}\n`
    + `${prof.rulers.length - noRuler} provinces with a known ruler`
    + (noRuler ? `, ${noRuler} without a SoT (kept under the province name, not matchable next age)` : '') + '\n'
    + (prev ? `\nReplaces the ${age} profile saved ${new Date(prev.savedAt).toLocaleString()}.\n` : '')
    + `\n1 Firestore write.`)) return;
  if (!await fbPatch(`kd_identities/${idn.id}`, ['activity', age], prof)) {
    alert(`Save failed: ${S.fbLastError}`); return;
  }
  idn.activity = { ...(idn.activity || {}), [age]: prof };   // kddb's own full-doc writes must carry it
  renderActivity({ cached: true });
}

/** The "known from earlier wars" section, enemy view. '' when there is nothing to show. */
function _actHistorySection(loc) {
  if (S.actView === 'own') return '';
  if (S.actKddbErr) return `<div style="color:#e09040;font-size:15px;margin:6px 0 14px">KD Database could not be read (${esc(S.actKddbErr)}) — earlier-war activity not shown.</div>`;
  if (!_kddbLoaded) return '';
  const known = _actKnownIdentity(loc);
  const age = _kddbGetAge();
  const profs = known ? Object.values(known.identity.activity || {}).sort((p, q) => q.savedAt - p.savedAt) : [];
  const thisWar = p => p.age === age && p.loc === loc;   // already on screen above
  const idx = _actRulerIndex(thisWar);
  const provRows = (S.enemy?.provinces || [])
    .map(p => ({ p, hit: p.sot?.ruler ? idx.get(p.sot.ruler.trim().toLowerCase()) : null }))
    .filter(x => x.hit);
  const pastProfs = profs.filter(p => !thisWar(p));
  if (!pastProfs.length && !provRows.length) return '';

  const kdRows = pastProfs.map(prof => `<tr>
      ${_actTd(`<b style="color:#ffd400">${esc(prof.age)}</b> ${esc(prof.kdName || '')} <span style="color:#7a9090">(${esc(prof.loc)})</span>`)}
      ${_actTd(_actStrip(prof.kd?.on, null, 'kd', 18, `${prof.age} ${prof.kdName} · `))}
      ${_actTd(esc(_actProfileLine(prof)), ';color:#8fa8a8;font-size:15px')}
    </tr>`).join('');
  const rRows = provRows.sort((a, b) => a.p.slot - b.p.slot).map(({ p, hit }) => `<tr>
      ${_actTd(`[${p.slot}] ${esc(p.name)}`, ';max-width:220px;overflow:hidden;text-overflow:ellipsis')}
      ${_actTd(esc(hit.e.r), ';color:#ffd400')}
      ${_actTd(`${esc(hit.prof.age)} · ${esc(hit.e.p)} <span style="color:#7a9090">in ${esc(hit.prof.kdName || hit.prof.loc)}</span>`, ';font-size:15px;color:#b8c8c8')}
      ${_actTd(hit.e.pct + '%', ';text-align:right;font-weight:700;color:#60C040')}
      ${_actTd(_actStrip(hit.e.on, hit.e.mt, 'ruler', 18, `${hit.e.r} (${hit.prof.age}) · `))}
    </tr>`).join('');

  return sectionHead('KNOWN FROM EARLIER WARS — KD DATABASE')
    + `<div style="font-size:15px;color:#7a9090;margin-bottom:8px">`
    + (known ? `This kingdom is <b style="color:#ffd400">${esc(known.identity.label)}</b> in KD Database (${esc(known.how)}). ` : '')
    + `War activity saved from earlier wars, laid onto this month's Utopian days 1–24. It is what these players did in THAT war — a starting point until this war's samples build up.</div>`
    + (kdRows ? `<div style="overflow-x:auto;margin-bottom:10px"><table style="border-collapse:collapse;font-size:16px"><tbody>${kdRows}</tbody></table></div>` : '')
    + (rRows ? `<div style="overflow-x:auto;margin-bottom:14px"><table style="border-collapse:collapse;font-size:16px">
        <thead><tr style="border-bottom:1px solid #617070">${_actTh('Province now')}${_actTh('Ruler')}${_actTh('Seen as')}${_actTh('Active', ';text-align:right')}${_actTh('By Utopian day (1–24)')}</tr></thead>
        <tbody>${rRows}</tbody></table></div>` : '');
}

/** Save button + what is already saved for this war */
function _actSaveBar(loc) {
  if (S.actView === 'own') return '';
  const age = _kddbGetAge();
  const idn = _kddbLoaded ? _actIdentityFor(age, loc) : null;
  const saved = idn?.activity?.[age];
  const note = !_kddbLoaded ? ''
    : !age ? 'set the age in KD DATABASE to enable'
    : !idn ? `not tagged in KD Database for ${esc(age)} yet`
    : saved ? `saved to “${esc(idn.label)}” ${new Date(saved.savedAt).toLocaleString()} · ${(saved.n || 0).toLocaleString()} samples`
    : `→ “${esc(idn.label)}” (${esc(age)}), not saved yet`;
  return `<div style="display:flex;align-items:center;gap:10px;margin:-2px 0 10px;flex-wrap:wrap">
    <button class="wb" style="font-size:16px;padding:3px 12px" onclick="__wpA.actSaveProfile()"
      title="Summarise this war's samples (up to ${ACTIVITY.DAYS_MAX} days) onto the enemy's KD Database identity — 1 Firestore write. Do it when the war ends.">💾 Save to KD Database</button>
    <span style="font-size:15px;color:#7a9090">${note}</span>
  </div>`;
}

// ── Rendering ──────────────────────────────────────────────────────────────

const _actPad = n => String(n).padStart(2, '0');

function _actBtn(on, label, click, tip) {
  return `<button class="wb${on ? ' g' : ''}" style="font-size:16px;padding:3px 10px"${tip ? ` title="${esc(tip)}"` : ''} onclick="${click}">${label}</button>`;
}

function _actControls() {
  const lab = (t, first) => `<span style="font-size:16px;color:#7a9090;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 2px 0 ${first ? 0 : 10}px">${t}</span>`;
  return `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px">
    ${lab('Kingdom', true)}
    ${_actBtn(S.actView !== 'own', 'Enemy' + (S.eLoc ? ' (' + esc(S.eLoc) + ')' : ''), "__wpA.actView('enemy')")}
    ${_actBtn(S.actView === 'own', 'Own' + (S.own?.location ? ' (' + esc(S.own.location) + ')' : ''), "__wpA.actView('own')")}
    ${lab('Months')}
    ${[1, 3, 7, ACTIVITY.DAYS_MAX].map(d => _actBtn(S.actDays === d, d, `__wpA.actDays(${d})`, `Last ${d} Utopian month${d > 1 ? 's' : ''} = ${d} real day${d > 1 ? 's' : ''} (${d} read${d > 1 ? 's' : ''} the first time)`)).join('')}
    ${lab('View')}
    ${_actBtn(S.actMode === 'hours', 'By day', "__wpA.actMode('hours')", 'Per Utopian day of the month (1–24, one tick each), over the whole range')}
    ${_actBtn(S.actMode === 'timeline', 'Timeline', "__wpA.actMode('timeline')", `The last ${ACTIVITY.TIMELINE_H} ticks, tick by tick`)}
    ${lab('Sort')}
    ${_actBtn(S.actSort === 'slot', 'Slot', "__wpA.actSort('slot')")}
    ${_actBtn(S.actSort === 'active', 'Most active', "__wpA.actSort('active')")}
    ${_actBtn(S.actSort === 'seen', 'Last seen', "__wpA.actSort('seen')")}
    <button class="wb" style="font-size:16px;padding:3px 10px;margin-left:10px" onclick="__wpA.actRefresh()" title="Re-read today's samples from Firestore (1 read). Closed days are never re-read.">⟳ Refresh</button>
  </div>`;
}

/**
 * Share of samples online → colour strength, in steps rather than a linear
 * ramp. What a wave planner needs to read off is "never / now and then /
 * usually", and on a dark background a linear alpha makes 3% and 30% look alike.
 */
function _actStep(f) {
  return f <= 0 ? 0 : f < 0.10 ? 0.16 : f < 0.25 ? 0.34 : f < 0.50 ? 0.60 : 0.92;
}

/** Cell colour: green = the player, purple underline = the mentor */
function _actCellStyle(n, on, mt) {
  if (!n) return 'background:repeating-linear-gradient(45deg,#141c1c,#141c1c 3px,#1b2525 3px,#1b2525 6px)';
  const own = _actStep((on - mt) / n), men = _actStep(mt / n);
  const bg  = own ? `rgba(${_ACT_GREEN},${own})` : '#1a2323';
  const bar = men ? `;box-shadow:inset 0 -4px 0 rgba(${_ACT_MENTOR},${Math.max(0.45, men)})` : '';
  return `background:${bg}${bar}`;
}

function _actPctTxt(p) { return p == null ? '—' : Math.round(p * 100) + '%'; }

function _actCards(a, loc) {
  const ago = a.lastT ? fA((Date.now() - a.lastT) / 1000) : '';
  if (a.src === 'is') return _actCardsIs(a, ago);
  const coll = !a.lastT
    ? `<div class="v" style="color:#E05050;font-size:21px">no samples</div><div class="s">collector has not run for ${esc(loc)}</div>`
    : a.live
      ? `<div class="v" style="color:#60C040;font-size:21px">● live</div><div class="s">last sample ${ago} ago</div>`
      : `<div class="v" style="color:#ffaa00;font-size:21px">idle</div><div class="s">last sample ${ago} ago — ${_actStamp(a.lastT)}</div>`;

  const nowOn = a.rows.filter(r => r.nowOn).length, nowMt = a.rows.filter(r => r.nowMt).length;
  const now = a.live
    ? `<div class="v">${nowOn} <span style="font-size:19px;color:#7a9090">/ ${a.rows.length}</span></div>
       <div class="s">${nowMt ? `<span style="color:rgb(${_ACT_MENTOR})">${nowMt} by mentor</span> · ` : ''}at ${_actWhen(a.lastT)}</div>`
    : `<div class="v" style="color:#617070">—</div><div class="s">only shown while the collector is live</div>`;

  // Quietest / busiest days by the kingdom-wide average, among days that
  // actually have samples. With under 2 samples a day says nothing yet.
  const hrs = a.kdH.map((x, h) => ({ h, ...x })).filter(x => x.n >= 2);
  const lab = x => `day ${_actDayLab(x.h)}`;
  const quiet = [...hrs].sort((p, q) => p.avg - q.avg).slice(0, 3);
  const busy  = [...hrs].sort((p, q) => q.avg - p.avg)[0];
  const quietCard = quiet.length
    ? `<div class="v" style="font-size:21px">${lab(quiet[0])}</div><div class="s">${quiet.map(x => `${_actDayLab(x.h)}: ${x.avg.toFixed(1)}`).join(' · ')} avg online</div>`
    : `<div class="v" style="color:#617070">—</div><div class="s">not enough samples yet</div>`;
  const busyCard = busy
    ? `<div class="v" style="font-size:21px">${lab(busy)}</div><div class="s">${busy.avg.toFixed(1)} avg online</div>`
    : `<div class="v" style="color:#617070">—</div><div class="s">not enough samples yet</div>`;

  const covered = a.kdH.filter(x => x.n > 0).length;
  return `<div class="wsum" style="margin-bottom:10px">
    <div class="wscard"><div class="l">Collector</div>${coll}</div>
    <div class="wscard"><div class="l">Online now</div>${now}</div>
    <div class="wscard" title="The Utopian days (ticks) with the fewest provinces starred on average — the best time to land a hit unanswered"><div class="l">Quietest day</div>${quietCard}</div>
    <div class="wscard"><div class="l">Busiest day</div>${busyCard}</div>
    <div class="wscard" title="How many of the month's 24 days (ticks) have samples"><div class="l">Coverage</div><div class="v" style="font-size:21px">${covered}/24 days</div>
      <div class="s">${a.nSamples} samples · ${a.daysWithData}/${a.days} day${a.days > 1 ? 's' : ''} with data</div></div>
  </div>`;
}

/** Summary cards for the OWN view, built from the IS SoT archive */
function _actCardsIs(a, ago) {
  const cur = S.actIsNow[_actLoc()];
  const src = a.live
    ? `<div class="v" style="color:#60C040;font-size:21px">IS archive</div><div class="s">read ${ago || '0m'} ago · ${ACTIVITY.IS_ARCHIVE_TICKS} ticks back + stored</div>`
    : `<div class="v" style="color:#ffaa00;font-size:21px">stored only</div><div class="s">IS not read this tick — ⟳ Refresh</div>`;
  const nowOn = a.rows.filter(r => r.nowOn).length;
  const now = a.live
    ? `<div class="v">${nowOn} <span style="font-size:19px;color:#7a9090">/ ${a.rows.length}</span></div>
       <div class="s">logged in on ${esc(_actWhen(cur.hourStart))}</div>`
    : `<div class="v" style="color:#617070">—</div><div class="s">read the IS to see this tick</div>`;
  const hrs = a.kdH.map((x, h) => ({ h, ...x })).filter(x => x.n >= 1);
  const lab = x => `day ${_actDayLab(x.h)}`;
  const quiet = [...hrs].sort((p, q) => p.avg - q.avg).slice(0, 3);
  const busy  = [...hrs].sort((p, q) => q.avg - p.avg)[0];
  const covered = a.kdH.filter(x => x.n > 0).length;
  return `<div class="wsum" style="margin-bottom:10px">
    <div class="wscard" title="Own provinces post a SoT to the IS when their player logs in (login lands on the throne page). The IS keeps the last ${ACTIVITY.IS_ARCHIVE_TICKS} ticks; older ones come from what this tab stored on earlier reads."><div class="l">Source</div>${src}</div>
    <div class="wscard"><div class="l">On this tick</div>${now}</div>
    <div class="wscard" title="The Utopian days (ticks) in which the fewest of our players log in — where the kingdom is thinnest on the ground"><div class="l">Quietest day</div>${quiet.length
      ? `<div class="v" style="font-size:21px">${lab(quiet[0])}</div><div class="s">${quiet.map(x => `${_actDayLab(x.h)}: ${x.avg.toFixed(1)}`).join(' · ')} provinces on</div>`
      : `<div class="v" style="color:#617070">—</div><div class="s">nothing stored yet</div>`}</div>
    <div class="wscard"><div class="l">Busiest day</div>${busy
      ? `<div class="v" style="font-size:21px">${lab(busy)}</div><div class="s">${busy.avg.toFixed(1)} provinces on</div>`
      : `<div class="v" style="color:#617070">—</div><div class="s">nothing stored yet</div>`}</div>
    <div class="wscard" title="How many of the month's 24 days (ticks) are covered"><div class="l">Coverage</div><div class="v" style="font-size:21px">${covered}/24 days</div>
      <div class="s">${a.nSamples} ticks · ${a.daysWithData}/${a.days} month${a.days > 1 ? 's' : ''} with data</div></div>
  </div>`;
}

function _actSortRows(rows) {
  const r = [...rows];
  if (S.actSort === 'active') r.sort((p, q) => (q.pct ?? -1) - (p.pct ?? -1) || p.slot - q.slot);
  else if (S.actSort === 'seen') r.sort((p, q) => (q.nowOn - p.nowOn) || (q.lastSeen - p.lastSeen) || p.slot - q.slot);
  return r;
}

function _actNowCell(r, is) {
  if (is) return r.nowOn ? `<span style="color:#60C040" title="Posted a fresh SoT to the IS this tick — logged in">●</span>` : '';
  if (r.nowMt) return `<span style="color:rgb(${_ACT_MENTOR})" title="Starred twice in the latest sample — the MENTOR is logged in">●●</span>`;
  if (r.nowOn) return `<span style="color:#60C040" title="Starred in the latest sample">●</span>`;
  return '';
}

function _actSeenCell(r) {
  if (!r.lastSeen) return `<span style="color:#617070" title="Not starred in any sample in this range">never</span>`;
  const ago = fA((Date.now() - r.lastSeen) / 1000);
  return `<span title="${esc(_actStamp(r.lastSeen) + (r.lastSeenMt ? ' — mentor' : ''))}">${ago}${r.lastSeenMt ? ` <span style="color:rgb(${_ACT_MENTOR})">m</span>` : ''}</span>`;
}

const _actTh  = (t, extra = '', tip = '') => `<th style="padding:6px 8px;text-align:left;color:#7a9090;font-size:14px;letter-spacing:1px;text-transform:uppercase;white-space:nowrap${extra}"${tip ? ` title="${esc(tip)}"` : ''}>${t}</th>`;
const _actTd  = (t, extra = '') => `<td style="padding:4px 8px;white-space:nowrap${extra}">${t}</td>`;

function _actHoursTable(a) {
  // Columns are the Utopian days of the month, 1–24 — one tick each
  const nowIdx = _actIdx(Date.now());
  const hourTh = Array.from({ length: 24 }, (_, h) =>
    `<th title="Day ${_actDayLab(h)} of the Utopian month" style="padding:4px 0;width:26px;min-width:26px;text-align:center;font-size:13px;color:${h === nowIdx ? '#ffd400' : '#7a9090'}">${_actDayLab(h)}</th>`).join('');
  const hourCell = (x, tip) => `<td title="${esc(tip)}" style="padding:0;height:22px;border:1px solid #0f1515;${_actCellStyle(x.n, x.on, x.mt)}"></td>`;

  // IS source: one "sample" per stored tick, so N of a day-of-month cell is the
  // number of MONTHS (real days) that day is covered, and "on" means a SoT (login).
  const is = a.src === 'is';
  const cellTip = (x) => !x.n ? 'no samples on this day'
    : is ? `logged in on this day in ${x.on} of ${x.n} months (${_actPctTxt(x.on / x.n)})`
    : `online in ${x.on} of ${x.n} samples (${_actPctTxt(x.on / x.n)})${x.mt ? `, ${x.mt} of them by the mentor` : ''}`;

  // Kingdom row: average number of provinces starred (IS: logged in) on that day
  const maxAvg = Math.max(0.01, ...a.kdH.map(x => x.avg || 0));
  const kdCells = a.kdH.map((x, h) => {
    const tip = `Day ${_actDayLab(h)} — ` + (!x.n ? 'no samples on this day'
      : is ? `${x.avg.toFixed(1)} provinces logged in on average, over ${x.n} months`
      : `${x.avg.toFixed(1)} provinces online on average (${x.avgMt.toFixed(1)} by mentor), ${x.n} samples`);
    const bg = x.n ? `rgba(255,212,0,${(0.08 + (x.avg / maxAvg) * 0.6).toFixed(2)})` : '#141c1c';
    return `<td title="${esc(tip)}" style="padding:0;height:24px;border:1px solid #0f1515;background:${bg};text-align:center;font-size:12px;color:#e8e0b0">${x.n ? x.avg.toFixed(x.avg < 10 ? 1 : 0) : ''}</td>`;
  }).join('');

  const body = _actSortRows(a.rows).map(r => {
    const cells = r.h.map((x, h) => hourCell(x, `${r.name} · day ${_actDayLab(h)} — ` + cellTip(x))).join('');
    return `<tr style="border-bottom:1px solid #1a2424">
      ${_actTd(`[${r.slot}] ${esc(r.name)}`, ';max-width:230px;overflow:hidden;text-overflow:ellipsis')}
      ${_actTd(_actNowCell(r, is), ';text-align:center')}
      ${_actTd(_actSeenCell(r), ';text-align:right;color:#b8c8c8')}
      ${_actTd(_actPctTxt(r.pct), ';text-align:right;font-weight:700;color:' + (r.pct ? '#60C040' : '#617070'))}
      ${is ? '' : _actTd(r.mt ? _actPctTxt(r.mtPct) : '—', `;text-align:right;color:${r.mt ? `rgb(${_ACT_MENTOR})` : '#617070'}`)}
      ${cells}
    </tr>`;
  }).join('');

  return `<div style="overflow-x:auto;margin-bottom:14px">
    <table style="border-collapse:collapse;font-size:16px">
      <thead><tr style="border-bottom:1px solid #617070">
        ${_actTh('Province')}${_actTh('Now', ';text-align:center')}${_actTh('Last seen', ';text-align:right')}
        ${_actTh('Active', ';text-align:right', is
          ? 'Share of stored ticks in which the province posted a SoT (logged in / loaded the throne)'
          : 'Share of samples in which the province was starred (player or mentor)')}
        ${is ? '' : _actTh('Mentor', ';text-align:right', 'Share of samples in which the MENTOR was logged in (two stars)')}
        ${hourTh}
      </tr></thead>
      <tbody>
        <tr style="border-bottom:1px solid #617070">
          ${_actTd(`<b style="color:#ffd400">KINGDOM</b> <span style="color:#7a9090;font-size:14px">avg ${is ? 'logged in' : 'online'}</span>`)}
          <td></td><td></td><td></td>${is ? '' : '<td></td>'}${kdCells}
        </tr>
        ${body}
      </tbody>
    </table></div>`;
}

function _actTimelineTable(a) {
  const cellW = a.src === 'is' ? 14 : 7;   // tick cells vs half-tick cells
  // Along the top: the month's name where a new month starts (day 1), and days
  // 7 / 13 / 19; a faint divider at every tick
  const heads = [];
  for (let b = 0; b < a.nBins; b++) {
    const t = a.bin0 + b * a.binMs;
    const u = _actUto(t);
    const tickStart = t % 3600e3 === 0;
    const lab = !u || !tickStart ? ''
      : u.day === 1 ? MONTHS_LIST[u.month - 1].slice(0, 3)
      : (u.day - 1) % 6 === 0 ? String(u.day) : '';
    heads.push(`<th style="padding:0;width:${cellW}px;min-width:${cellW}px;font-size:12px;color:${u?.day === 1 ? '#ffd400' : '#7a9090'};text-align:left;overflow:visible;white-space:nowrap">${lab}</th>`);
  }
  const cell = (x, b, r) => {
    const t = a.bin0 + b * a.binMs;
    const tip = `${r.name} · ${_actStamp(t)} — ` + (!x.n ? 'no samples'
      : a.src === 'is' ? (x.on ? 'logged in (fresh SoT on the IS)' : 'no SoT this tick')
      : x.on ? `online in ${x.on}/${x.n} samples${x.mt ? ' (mentor)' : ''}` : `offline (${x.n} samples)`);
    const hourEdge = t % 3600e3 === 0 ? 'border-left:1px solid #2a3838;' : '';
    const bg = !x.n ? '#101616' : x.mt && x.mt === x.on ? `rgba(${_ACT_MENTOR},.85)` : x.on ? `rgba(${_ACT_GREEN},.9)` : '#1f2b2b';
    return `<td title="${esc(tip)}" style="padding:0;height:18px;${hourEdge}background:${bg}"></td>`;
  };
  const body = _actSortRows(a.rows).map(r => `<tr style="border-bottom:1px solid #0f1515">
      ${_actTd(`[${r.slot}] ${esc(r.name)}`, ';max-width:230px;overflow:hidden;text-overflow:ellipsis;font-size:15px')}
      ${_actTd(_actNowCell(r, a.src === 'is'), ';text-align:center')}
      ${r.tl.map((x, b) => cell(x, b, r)).join('')}
    </tr>`).join('');
  return `<div style="overflow-x:auto;margin-bottom:14px">
    <table style="border-collapse:collapse;font-size:16px;table-layout:fixed">
      <thead><tr>${_actTh('Province', ';width:230px')}${_actTh('Now', ';width:40px;text-align:center')}${heads.join('')}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

function _actHelp() {
  if (S.actView === 'own') return `<div style="font-size:15px;color:#7a9090;line-height:1.5;margin-top:4px">
    Our own kingdom comes straight from the Intel Site, no collector needed: every own province posts a fresh SoT when its
    player logs in (login lands on the throne page), and the IS keeps the last ${ACTIVITY.IS_ARCHIVE_TICKS} ticks of them.
    Each read stores the ticks it saw, so history builds up beyond that. All times are <b style="color:#8fa8a8">Utopia
    time</b>: one tick = one Utopian day, so the columns are the days of the month, 1–24.
    Green = share of months the player logged in on that day, in steps:
    ${[[0.05, '<10%'], [0.15, '10–25%'], [0.35, '25–50%'], [0.6, '50%+']].map(([f, t]) =>
      `<span style="background:rgba(${_ACT_GREEN},${_actStep(f)});padding:0 5px;color:#dfe">${t}</span>`).join(' ')};
    hatched = day not covered yet. It measures <b style="color:#8fa8a8">logins</b>, not time spent: a player who stays on
    for several ticks without going back to the throne shows only the first one. Players whose game does not send intel to the IS
    (intel sending off, probably the mobile app) never show up, and mentor logins cannot be told apart from the owner's.
    The current tick is shown live (● = logged in this tick) and stored once it is over. Reading the IS costs no
    Firestore; storing costs about one write per read.
  </div>`;
  return `<div style="font-size:15px;color:#7a9090;line-height:1.5;margin-top:4px">
    Built from the online marker on the game's kingdom page: <b style="color:#8fa8a8">Name*</b> = online,
    <b style="color:rgb(${_ACT_MENTOR})">Name**</b> = the province's <b>mentor</b> is logged in for them
    (4h out of every 12h). All times are <b style="color:#8fa8a8">Utopia time</b>: one tick = one Utopian day, so the
    columns are the days of the month, 1–24. Green = share of samples the province was starred, in steps:
    ${[[0.05, '<10%'], [0.15, '10–25%'], [0.35, '25–50%'], [0.6, '50%+']].map(([f, t]) =>
      `<span style="background:rgba(${_ACT_GREEN},${_actStep(f)});padding:0 5px;color:#dfe">${t}</span>`).join(' ')},
    <span style="box-shadow:inset 0 -4px 0 rgb(${_ACT_MENTOR});background:#1d2626;padding:0 6px">&nbsp;</span>
    purple underline = mentor share, hatched = no samples on that day (collector not running — <i>not</i> the same as offline).
    How long a star stays lit after the player stops clicking is not known, so read this as "seen active", not minutes online.
    <br>Samples come from <span style="font-family:monospace;color:#b8c8c8">scripts/activity-collector.user.js</span>, run in any
    member's utopia-game.com tab (Tampermonkey, or pasted into the console). It reads the kingdom page every few minutes and
    writes every 15 minutes into one document per kingdom per day, so the newest samples here can be up to ~20 minutes old.
    While it runs, that member's own province shows as online around the clock.
    <br>When the war ends, <b style="color:#8fa8a8">💾 Save to KD Database</b> stores a summary (kingdom + every ruler, by tick)
    on the enemy's KD Database identity — 1 write — and it shows up in the KD DATABASE tab and here in every later war
    against the same players.
  </div>`;
}

async function renderActivity(opts = {}) {
  const el = $id('__wpc_activity');
  if (!el) return;
  const loc = _actLoc();
  if (!loc) {
    renderTab('__wpc_activity', () => _actControls()
      + `<div style="color:#7a9090;font-size:19px;padding:20px 0;font-style:italic">No ${S.actView === 'own' ? 'own' : 'enemy'} kingdom loaded.</div>`);
    return;
  }
  const days = S.actMode === 'timeline' ? Math.max(S.actDays, Math.ceil(ACTIVITY.TIMELINE_H / 24) + 1) : S.actDays;
  const own = S.actView === 'own';
  // Own view: read the IS SoT archive first. `cached` does not stop it — it is
  // about Firestore reads, and the IS costs none; the IS_PULL_MIN throttle is
  // what keeps view switches from re-reading it (and its ~1 write).
  const pullDue = own && (opts.force || Date.now() - (S.actIsPulledAt[loc] || 0) >= ACTIVITY.IS_PULL_MIN * 60e3);
  const have = _actDayIds(days).every(id => id in _actCacheOf(loc).docs);
  if (!have || pullDue) renderTab('__wpc_activity', () => _actControls() + loadingHTML(pullDue ? 'READING THE IS SOT ARCHIVE...' : 'LOADING ACTIVITY...'));

  let ok = true;
  if (pullDue) ok = await _actIsPull(loc, { force: opts.force });
  const pullErr = ok ? '' : S.actErr;
  ok = (await _actLoad(loc, days, own ? { ...opts, cached: true } : opts)) && ok;
  if (pullErr && !S.actErr) S.actErr = pullErr;
  // The enemy view shows what KD Database knows about this kingdom from earlier
  // wars. kd_identities is the same once-per-session read the KD DATABASE tab
  // makes (shared, guarded by _kddbLoaded) — ~20 documents, not per render.
  if (S.actView !== 'own' && !_kddbLoaded && !S.actKddbErr) {
    try { await _kddbLoadAll(); } catch (e) { S.actKddbErr = e.message; }
  }
  if (S.tab !== 'activity' || _actLoc() !== loc) return;   // the view moved on while reading

  const kd = S.actView === 'own' ? S.own : S.enemy;
  const roster = (kd?.provinces || []).map(p => ({ slot: p.slot, name: p.name, ruler: p.sot?.ruler || '' }));
  const a = _actAggregate(loc, days, 'uto', roster);

  renderTab('__wpc_activity', () => {
    const fail = !ok ? `<div style="color:#E05050;font-size:17px;margin-bottom:10px">⚠ Could not read activity for ${esc(loc)} — ${esc(S.actErr)}.
        The stored samples are untouched — this is a read failure, not missing data.
        <button class="wb" style="font-size:15px;padding:2px 10px;margin-left:6px" onclick="__wpA.actRefresh()">⟳ Try again</button></div>` : '';
    const title = `${S.actView === 'own' ? 'OWN' : 'ENEMY'} KINGDOM ACTIVITY — ${a.kdName || kd?.kingdomName || ''} (${loc})`;
    if (!a.nSamples) {
      // Exactly when earlier-war history is worth the most: a new war, no samples yet
      return _actControls() + fail + sectionHead(title)
        + (ok ? `<div style="color:#b8c8c8;font-size:18px;padding:10px 0 16px">No activity samples for ${esc(loc)} in the last
            ${days} Utopian month${days > 1 ? 's' : ''}. ${S.actView === 'own'
              ? 'The IS SoT archive had nothing for this window.'
              : 'The collector has not been run against this kingdom — start it on utopia-game.com with this kingdom\'s location (see below).'}</div>` : '')
        + _actHistorySection(loc)
        + _actHelp();
    }
    const readAt = S.actView === 'own' ? (S.actIsPulledAt[loc] || 0) : Math.max(0, ...Object.values(_actCacheOf(loc).readAt));
    return _actControls() + fail + sectionHead(title) + _actCards(a, loc)
      + `<div style="font-size:14px;color:#617070;margin:-4px 0 8px">${S.actView === 'own'
          ? `IS archive read ${readAt ? fA((Date.now() - readAt) / 1000) + ' ago' : '—'} (re-read at most every ${ACTIVITY.IS_PULL_MIN} min) — ⟳ Refresh to read it now.`
          : `Read from Firestore ${fA((Date.now() - readAt) / 1000)} ago — ⟳ Refresh for newer samples.`}
          Now: <b style="color:#b8c8c8">${esc(_actStamp(Date.now()))}</b></div>`
      + _actSaveBar(loc)
      + (S.actMode === 'timeline' ? _actTimelineTable(a) : _actHoursTable(a))
      + _actHistorySection(loc)
      + _actHelp();
  });
}

/** Explicit re-read of the open day(s) — the only control here that spends quota on purpose */
function actRefresh() { renderActivity({ force: true }); }
