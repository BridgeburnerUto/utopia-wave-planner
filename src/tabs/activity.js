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
// the tab after ACTIVITY.TODAY_TTL_MS. View switches cost nothing.

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

function _actDocPath(loc, id) { return `activity/${String(loc).replace(':', '_')}_${id}`; }

/**
 * Make sure the window's day docs are in the cache.
 *   default       fetch missing days, plus open days older than TODAY_TTL_MS
 *   {cached:true} fetch missing days only (a view switch widening the range)
 *   {force:true}  fetch missing days and every open day (⟳ Refresh)
 * Returns false when the read failed; the cache is left as it was, so a failure
 * can never turn loaded history into "no data".
 */
async function _actLoad(loc, days, opts = {}) {
  const c = S.actCache[loc] || (S.actCache[loc] = { docs: {}, readAt: {} });
  const now = Date.now();
  const want = _actDayIds(days, now).filter(id => {
    if (!(id in c.docs)) return true;
    if (opts.cached) return false;
    const open = c.readAt[id] < _actDayEnd(id);
    if (!open) return false;
    return opts.force || now - c.readAt[id] > ACTIVITY.TODAY_TTL_MS;
  });
  if (!want.length) return true;
  const got = await fbBatchGet(want.map(id => _actDocPath(loc, id)), `activity ${loc}`);
  if (!got) { S.actErr = S.fbLastError || 'Firestore read failed'; return false; }
  S.actErr = '';
  want.forEach(id => { c.docs[id] = got[_actDocPath(loc, id)] || null; c.readAt[id] = now; });
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
function _actAggregate(loc, days, tz, roster, now = Date.now()) {
  const c = S.actCache[loc];
  const ids = _actDayIds(days, now);
  const docs = ids.map(id => c?.docs[id]).filter(Boolean);
  const hourOf = t => tz === 'utc' ? new Date(t).getUTCHours() : new Date(t).getHours();
  const blank = () => Array.from({ length: 24 }, () => ({ n: 0, on: 0, mt: 0 }));

  // Roster: the live IS kingdom when it is loaded, else the newest names seen
  if (!roster?.length) {
    const last = docs[docs.length - 1];
    roster = Object.entries(last?.names || {}).map(([slot, name]) => ({ slot: +slot, name }));
  }
  const rows = roster
    .map(p => ({ slot: +p.slot, name: p.name || '', h: blank(), n: 0, on: 0, mt: 0, lastSeen: 0, lastSeenMt: false }))
    .sort((a, b) => a.slot - b.slot);

  const binMs = ACTIVITY.TIMELINE_BIN_MIN * 60e3;
  const nBins = Math.round(ACTIVITY.TIMELINE_H * 60 / ACTIVITY.TIMELINE_BIN_MIN);
  const bin0  = Math.floor(now / binMs) * binMs - (nBins - 1) * binMs;
  rows.forEach(r => { r.tl = Array.from({ length: nBins }, () => ({ n: 0, on: 0, mt: 0 })); });

  const kdH = blank();
  let nSamples = 0, lastT = 0, last = null, kdName = '';
  const daysWithData = docs.length;

  for (const d of docs) {
    if (d.kdName) kdName = d.kdName;
    const names = d.names || {};
    for (const s of (d.samples || [])) {
      if (!s || !s.t) continue;
      const on = new Set(s.on || []), mt = new Set(s.mt || []);
      const h = hourOf(s.t);
      nSamples++;
      kdH[h].n++; kdH[h].on += on.size; kdH[h].mt += mt.size;
      if (s.t > lastT) { lastT = s.t; last = { t: s.t, on, mt, names }; }
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

  const live = lastT && now - lastT < ACTIVITY.LIVE_MIN * 60e3;
  rows.forEach(r => {
    r.pct   = r.n ? r.on / r.n : null;
    r.mtPct = r.n ? r.mt / r.n : null;
    r.nowOn = live && last.on.has(r.slot) && _actSameName(last.names[r.slot], r.name);
    r.nowMt = r.nowOn && last.mt.has(r.slot);
  });
  kdH.forEach(x => { x.avg = x.n ? x.on / x.n : null; x.avgMt = x.n ? x.mt / x.n : null; });

  return { rows, kdH, nSamples, daysWithData, days, lastT, live, last, kdName, bin0, binMs, nBins };
}

// ── Rendering ──────────────────────────────────────────────────────────────

const _actPad = n => String(n).padStart(2, '0');
function _actClock(t, tz) {
  const d = new Date(t);
  return tz === 'utc' ? `${_actPad(d.getUTCHours())}:${_actPad(d.getUTCMinutes())}` : `${_actPad(d.getHours())}:${_actPad(d.getMinutes())}`;
}
function _actStamp(t, tz) {
  const d = new Date(t);
  const md = tz === 'utc' ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : `${d.getMonth() + 1}/${d.getDate()}`;
  return `${md} ${_actClock(t, tz)}${tz === 'utc' ? ' UTC' : ''}`;
}

function _actBtn(on, label, click, tip) {
  return `<button class="wb${on ? ' g' : ''}" style="font-size:16px;padding:3px 10px"${tip ? ` title="${esc(tip)}"` : ''} onclick="${click}">${label}</button>`;
}

function _actControls() {
  const lab = (t, first) => `<span style="font-size:16px;color:#7a9090;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 2px 0 ${first ? 0 : 10}px">${t}</span>`;
  return `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px">
    ${lab('Kingdom', true)}
    ${_actBtn(S.actView !== 'own', 'Enemy' + (S.eLoc ? ' (' + esc(S.eLoc) + ')' : ''), "__wpA.actView('enemy')")}
    ${_actBtn(S.actView === 'own', 'Own' + (S.own?.location ? ' (' + esc(S.own.location) + ')' : ''), "__wpA.actView('own')")}
    ${lab('Days')}
    ${[1, 3, 7, ACTIVITY.DAYS_MAX].map(d => _actBtn(S.actDays === d, d, `__wpA.actDays(${d})`, `Last ${d} UTC day${d > 1 ? 's' : ''} (${d} read${d > 1 ? 's' : ''} the first time)`)).join('')}
    ${lab('View')}
    ${_actBtn(S.actMode === 'hours', 'By hour', "__wpA.actMode('hours')", 'Share of samples online, per hour of day, over the whole range')}
    ${_actBtn(S.actMode === 'timeline', 'Timeline', "__wpA.actMode('timeline')", `Every ${ACTIVITY.TIMELINE_BIN_MIN} minutes over the last ${ACTIVITY.TIMELINE_H}h`)}
    ${lab('Time')}
    ${_actBtn(S.actTz === 'local', 'Local', "__wpA.actTz('local')", 'Your browser\'s time zone')}
    ${_actBtn(S.actTz === 'utc', 'UTC', "__wpA.actTz('utc')", 'Game time — ticks fall on the UTC hour')}
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
  const tz = S.actTz;
  const ago = a.lastT ? fA((Date.now() - a.lastT) / 1000) : '';
  const coll = !a.lastT
    ? `<div class="v" style="color:#E05050;font-size:21px">no samples</div><div class="s">collector has not run for ${esc(loc)}</div>`
    : a.live
      ? `<div class="v" style="color:#60C040;font-size:21px">● live</div><div class="s">last sample ${ago} ago</div>`
      : `<div class="v" style="color:#ffaa00;font-size:21px">idle</div><div class="s">last sample ${ago} ago — ${_actStamp(a.lastT, tz)}</div>`;

  const nowOn = a.rows.filter(r => r.nowOn).length, nowMt = a.rows.filter(r => r.nowMt).length;
  const now = a.live
    ? `<div class="v">${nowOn} <span style="font-size:19px;color:#7a9090">/ ${a.rows.length}</span></div>
       <div class="s">${nowMt ? `<span style="color:rgb(${_ACT_MENTOR})">${nowMt} by mentor</span> · ` : ''}at ${_actClock(a.lastT, tz)}</div>`
    : `<div class="v" style="color:#617070">—</div><div class="s">only shown while the collector is live</div>`;

  // Quietest / busiest hours by the kingdom-wide average, among hours that
  // actually have samples. With under 2 samples an hour says nothing yet.
  const hrs = a.kdH.map((x, h) => ({ h, ...x })).filter(x => x.n >= 2);
  const lab = x => `${_actPad(x.h)}–${_actPad((x.h + 1) % 24)}`;
  const quiet = [...hrs].sort((p, q) => p.avg - q.avg).slice(0, 3);
  const busy  = [...hrs].sort((p, q) => q.avg - p.avg)[0];
  const tzTag = tz === 'utc' ? 'UTC' : 'local';
  const quietCard = quiet.length
    ? `<div class="v" style="font-size:21px">${lab(quiet[0])}</div><div class="s">${quiet.map(x => `${lab(x)} ${x.avg.toFixed(1)}`).join(' · ')} avg online (${tzTag})</div>`
    : `<div class="v" style="color:#617070">—</div><div class="s">not enough samples yet</div>`;
  const busyCard = busy
    ? `<div class="v" style="font-size:21px">${lab(busy)}</div><div class="s">${busy.avg.toFixed(1)} avg online (${tzTag})</div>`
    : `<div class="v" style="color:#617070">—</div><div class="s">not enough samples yet</div>`;

  const covered = a.kdH.filter(x => x.n > 0).length;
  return `<div class="wsum" style="margin-bottom:10px">
    <div class="wscard"><div class="l">Collector</div>${coll}</div>
    <div class="wscard"><div class="l">Online now</div>${now}</div>
    <div class="wscard" title="The hours with the fewest provinces starred on average — the best time to land a hit unanswered"><div class="l">Quietest hour</div>${quietCard}</div>
    <div class="wscard"><div class="l">Busiest hour</div>${busyCard}</div>
    <div class="wscard"><div class="l">Coverage</div><div class="v" style="font-size:21px">${covered}/24 h</div>
      <div class="s">${a.nSamples} samples · ${a.daysWithData}/${a.days} day${a.days > 1 ? 's' : ''} with data</div></div>
  </div>`;
}

function _actSortRows(rows) {
  const r = [...rows];
  if (S.actSort === 'active') r.sort((p, q) => (q.pct ?? -1) - (p.pct ?? -1) || p.slot - q.slot);
  else if (S.actSort === 'seen') r.sort((p, q) => (q.nowOn - p.nowOn) || (q.lastSeen - p.lastSeen) || p.slot - q.slot);
  return r;
}

function _actNowCell(r) {
  if (r.nowMt) return `<span style="color:rgb(${_ACT_MENTOR})" title="Starred twice in the latest sample — the MENTOR is logged in">●●</span>`;
  if (r.nowOn) return `<span style="color:#60C040" title="Starred in the latest sample">●</span>`;
  return '';
}

function _actSeenCell(r, tz) {
  if (!r.lastSeen) return `<span style="color:#617070" title="Not starred in any sample in this range">never</span>`;
  const ago = fA((Date.now() - r.lastSeen) / 1000);
  return `<span title="${esc(_actStamp(r.lastSeen, tz) + (r.lastSeenMt ? ' — mentor' : ''))}">${ago}${r.lastSeenMt ? ` <span style="color:rgb(${_ACT_MENTOR})">m</span>` : ''}</span>`;
}

const _actTh  = (t, extra = '', tip = '') => `<th style="padding:6px 8px;text-align:left;color:#7a9090;font-size:14px;letter-spacing:1px;text-transform:uppercase;white-space:nowrap${extra}"${tip ? ` title="${esc(tip)}"` : ''}>${t}</th>`;
const _actTd  = (t, extra = '') => `<td style="padding:4px 8px;white-space:nowrap${extra}">${t}</td>`;

function _actHoursTable(a) {
  const tz = S.actTz;
  const nowH = tz === 'utc' ? new Date().getUTCHours() : new Date().getHours();
  const hourTh = Array.from({ length: 24 }, (_, h) =>
    `<th style="padding:4px 0;width:26px;min-width:26px;text-align:center;font-size:13px;color:${h === nowH ? '#ffd400' : '#7a9090'}">${_actPad(h)}</th>`).join('');
  const hourCell = (x, tip) => `<td title="${esc(tip)}" style="padding:0;height:22px;border:1px solid #0f1515;${_actCellStyle(x.n, x.on, x.mt)}"></td>`;
  const tzTag = tz === 'utc' ? ' UTC' : '';

  // Kingdom row: average number of provinces starred in that hour
  const maxAvg = Math.max(0.01, ...a.kdH.map(x => x.avg || 0));
  const kdCells = a.kdH.map((x, h) => {
    const tip = `${_actPad(h)}:00–${_actPad((h + 1) % 24)}:00${tzTag} — ` + (x.n
      ? `${x.avg.toFixed(1)} provinces online on average (${x.avgMt.toFixed(1)} by mentor), ${x.n} samples`
      : 'no samples in this hour');
    const bg = x.n ? `rgba(255,212,0,${(0.08 + (x.avg / maxAvg) * 0.6).toFixed(2)})` : '#141c1c';
    return `<td title="${esc(tip)}" style="padding:0;height:24px;border:1px solid #0f1515;background:${bg};text-align:center;font-size:12px;color:#e8e0b0">${x.n ? x.avg.toFixed(x.avg < 10 ? 1 : 0) : ''}</td>`;
  }).join('');

  const body = _actSortRows(a.rows).map(r => {
    const cells = r.h.map((x, h) => hourCell(x, `${r.name} · ${_actPad(h)}:00–${_actPad((h + 1) % 24)}:00${tzTag} — `
      + (x.n ? `online in ${x.on} of ${x.n} samples (${_actPctTxt(x.on / x.n)})${x.mt ? `, ${x.mt} of them by the mentor` : ''}` : 'no samples in this hour'))).join('');
    return `<tr style="border-bottom:1px solid #1a2424">
      ${_actTd(`[${r.slot}] ${esc(r.name)}`, ';max-width:230px;overflow:hidden;text-overflow:ellipsis')}
      ${_actTd(_actNowCell(r), ';text-align:center')}
      ${_actTd(_actSeenCell(r, tz), ';text-align:right;color:#b8c8c8')}
      ${_actTd(_actPctTxt(r.pct), ';text-align:right;font-weight:700;color:' + (r.pct ? '#60C040' : '#617070'))}
      ${_actTd(r.mt ? _actPctTxt(r.mtPct) : '—', `;text-align:right;color:${r.mt ? `rgb(${_ACT_MENTOR})` : '#617070'}`)}
      ${cells}
    </tr>`;
  }).join('');

  return `<div style="overflow-x:auto;margin-bottom:14px">
    <table style="border-collapse:collapse;font-size:16px">
      <thead><tr style="border-bottom:1px solid #617070">
        ${_actTh('Province')}${_actTh('Now', ';text-align:center')}${_actTh('Last seen', ';text-align:right')}
        ${_actTh('Active', ';text-align:right', 'Share of samples in which the province was starred (player or mentor)')}
        ${_actTh('Mentor', ';text-align:right', 'Share of samples in which the MENTOR was logged in (two stars)')}
        ${hourTh}
      </tr></thead>
      <tbody>
        <tr style="border-bottom:1px solid #617070">
          ${_actTd('<b style="color:#ffd400">KINGDOM</b> <span style="color:#7a9090;font-size:14px">avg online</span>')}
          <td></td><td></td><td></td><td></td>${kdCells}
        </tr>
        ${body}
      </tbody>
    </table></div>`;
}

function _actTimelineTable(a) {
  const tz = S.actTz;
  const cellW = 7;
  // Hour ticks along the top: a label every 6h, a faint divider every hour
  const heads = [];
  for (let b = 0; b < a.nBins; b++) {
    const t = a.bin0 + b * a.binMs;
    const d = new Date(t);
    const h = tz === 'utc' ? d.getUTCHours() : d.getHours();
    const m = tz === 'utc' ? d.getUTCMinutes() : d.getMinutes();
    const lab = m === 0 && h % 6 === 0 ? (h === 0 ? _actStamp(t, tz).split(' ')[0] : _actPad(h)) : '';
    heads.push(`<th style="padding:0;width:${cellW}px;min-width:${cellW}px;font-size:12px;color:#7a9090;text-align:left;overflow:visible;white-space:nowrap">${lab}</th>`);
  }
  const cell = (x, b, r) => {
    const t = a.bin0 + b * a.binMs;
    const tip = `${r.name} · ${_actStamp(t, tz)} — ` + (x.n ? (x.on ? `online in ${x.on}/${x.n} samples${x.mt ? ' (mentor)' : ''}` : `offline (${x.n} samples)`) : 'no samples');
    const d = new Date(t);
    const hourEdge = (tz === 'utc' ? d.getUTCMinutes() : d.getMinutes()) === 0 ? 'border-left:1px solid #2a3838;' : '';
    const bg = !x.n ? '#101616' : x.mt && x.mt === x.on ? `rgba(${_ACT_MENTOR},.85)` : x.on ? `rgba(${_ACT_GREEN},.9)` : '#1f2b2b';
    return `<td title="${esc(tip)}" style="padding:0;height:18px;${hourEdge}background:${bg}"></td>`;
  };
  const body = _actSortRows(a.rows).map(r => `<tr style="border-bottom:1px solid #0f1515">
      ${_actTd(`[${r.slot}] ${esc(r.name)}`, ';max-width:230px;overflow:hidden;text-overflow:ellipsis;font-size:15px')}
      ${_actTd(_actNowCell(r), ';text-align:center')}
      ${r.tl.map((x, b) => cell(x, b, r)).join('')}
    </tr>`).join('');
  return `<div style="overflow-x:auto;margin-bottom:14px">
    <table style="border-collapse:collapse;font-size:16px;table-layout:fixed">
      <thead><tr>${_actTh('Province', ';width:230px')}${_actTh('Now', ';width:40px;text-align:center')}${heads.join('')}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

function _actHelp() {
  return `<div style="font-size:15px;color:#7a9090;line-height:1.5;margin-top:4px">
    Built from the online marker on the game's kingdom page: <b style="color:#8fa8a8">Name*</b> = online,
    <b style="color:rgb(${_ACT_MENTOR})">Name**</b> = the province's <b>mentor</b> is logged in for them
    (4h out of every 12h). Green = share of samples the province was starred, in steps:
    ${[[0.05, '<10%'], [0.15, '10–25%'], [0.35, '25–50%'], [0.6, '50%+']].map(([f, t]) =>
      `<span style="background:rgba(${_ACT_GREEN},${_actStep(f)});padding:0 5px;color:#dfe">${t}</span>`).join(' ')},
    <span style="box-shadow:inset 0 -4px 0 rgb(${_ACT_MENTOR});background:#1d2626;padding:0 6px">&nbsp;</span>
    purple underline = mentor share, hatched = no samples in that hour (collector not running — <i>not</i> the same as offline).
    How long a star stays lit after the player stops clicking is not known, so read this as "seen active", not minutes online.
    <br>Samples come from <span style="font-family:monospace;color:#b8c8c8">scripts/activity-collector.user.js</span>, run in any
    member's utopia-game.com tab (Tampermonkey, or pasted into the console). It reads the kingdom page every few minutes and
    stores one document per kingdom per day. While it runs, that member's own province shows as online around the clock.
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
  const have = _actDayIds(days).every(id => id in (S.actCache[loc]?.docs || {}));
  if (!have) renderTab('__wpc_activity', () => _actControls() + loadingHTML('LOADING ACTIVITY...'));

  const ok = await _actLoad(loc, days, opts);
  if (S.tab !== 'activity' || _actLoc() !== loc) return;   // the view moved on while reading

  const kd = S.actView === 'own' ? S.own : S.enemy;
  const roster = (kd?.provinces || []).map(p => ({ slot: p.slot, name: p.name }));
  const a = _actAggregate(loc, days, S.actTz, roster);

  renderTab('__wpc_activity', () => {
    const fail = !ok ? `<div style="color:#E05050;font-size:17px;margin-bottom:10px">⚠ Could not read activity for ${esc(loc)} — ${esc(S.actErr)}.
        The stored samples are untouched — this is a read failure, not missing data.
        <button class="wb" style="font-size:15px;padding:2px 10px;margin-left:6px" onclick="__wpA.actRefresh()">⟳ Try again</button></div>` : '';
    const title = `${S.actView === 'own' ? 'OWN' : 'ENEMY'} KINGDOM ACTIVITY — ${a.kdName || kd?.kingdomName || ''} (${loc})`;
    if (!a.nSamples) {
      return _actControls() + fail + sectionHead(title)
        + (ok ? `<div style="color:#b8c8c8;font-size:18px;padding:10px 0 16px">No activity samples for ${esc(loc)} in the last
            ${days} UTC day${days > 1 ? 's' : ''}. The collector has not been run against this kingdom — start it on
            utopia-game.com with this kingdom's location (see below).</div>` : '')
        + _actHelp();
    }
    const readAt = Math.max(0, ...Object.values(S.actCache[loc]?.readAt || {}));
    return _actControls() + fail + sectionHead(title) + _actCards(a, loc)
      + `<div style="font-size:14px;color:#617070;margin:-4px 0 8px">Read from Firestore at ${_actClock(readAt, 'local')} — ⟳ Refresh for newer samples.</div>`
      + (S.actMode === 'timeline' ? _actTimelineTable(a) : _actHoursTable(a))
      + _actHelp();
  });
}

/** Explicit re-read of the open day(s) — the only control here that spends quota on purpose */
function actRefresh() { renderActivity({ force: true }); }
