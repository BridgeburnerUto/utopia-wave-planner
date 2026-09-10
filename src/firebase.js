// ── FIREBASE ───────────────────────────────────────────────────────────────
// Firestore REST API helpers. No SDK required — plain fetch.
// All functions return parsed JS objects, not raw Firestore field maps.

/** Convert a plain JS value to a Firestore field value */
function _toFB(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')  return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string')  return { stringValue: v };
  if (v instanceof Set)       return { arrayValue: { values: [...v].map(_toFB) } };
  if (Array.isArray(v))       return { arrayValue: { values: v.map(_toFB) } };
  if (typeof v === 'object')  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, val]) => [k, _toFB(val)])) } };
  return { stringValue: String(v) };
}

/** Convert a Firestore field value back to a plain JS value */
function _fromFB(v) {
  if (!v) return null;
  if ('stringValue'  in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue);
  if ('doubleValue'  in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue'   in v) return (v.arrayValue.values || []).map(_fromFB);
  if ('mapValue'     in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, val]) => [k, _fromFB(val)]));
  return null;
}

function _fbUrl(path) {
  return `${CFG.FB_BASE}/${path}?key=${CFG.FB_API_KEY}`;
}

// ── Quota accounting ───────────────────────────────────────────────────────
// Nothing warned when reads were running hot, so the 2026-08-11 blowout took a
// day to notice. Every read and write is now counted and shown in the header,
// with a per-source breakdown in the tooltip — a runaway names itself.
//
// Firestore bills one read per document RETURNED, plus a minimum of one for a
// query that matches nothing, so that is what is counted here.

/** Bill n document reads to the session counter, attributed to `what` */
function _fbBillReads(n, what) {
  const cost = Math.max(1, n || 0);
  S.fbReads += cost;
  S.fbReadLog[what] = (S.fbReadLog[what] || 0) + cost;
  if (S.fbReads >= FB_QUOTA.READ_RED && !S.fbReadWarned) {
    S.fbReadWarned = true;
    const worst = Object.entries(S.fbReadLog).sort((a, b) => b[1] - a[1])[0];
    console.warn(`[WavePlanner] Firestore reads this session: ${S.fbReads} of the ${FB_QUOTA.READS_PER_DAY}/day free tier.` +
      (worst ? ` Heaviest source: ${worst[0]} (${worst[1]})` : ''), S.fbReadLog);
  }
  _refreshFbMeter();
}

function _fbBillWrites(n) { S.fbWrites += (n || 1); _refreshFbMeter(); }

/**
 * Header meter: "2.1k reads · 34 writes".
 * Grey while the session is cheap, amber once something is reading more than it
 * should, red once the day's bucket is genuinely at risk.
 */
function _refreshFbMeter() {
  const box = (typeof document === 'undefined') ? null : document.getElementById('__wpfbq');
  if (!box) return;
  const v = document.getElementById('__wpfbv');
  if (!v) return;
  box.style.display = S.fbReads || S.fbWrites ? '' : 'none';
  const col = S.fbReads >= FB_QUOTA.READ_RED   ? '#E05050'
            : S.fbReads >= FB_QUOTA.READ_AMBER ? '#ffaa00'
            : '#7a9090';
  v.style.color   = col;
  v.textContent   = `${fK(S.fbReads)} r · ${fK(S.fbWrites)} w`;
  const lines = Object.entries(S.fbReadLog).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}: ${n}`).join('\n');
  box.title = `Firestore documents read and written this session.\n`
    + `Free tier: ${FB_QUOTA.READS_PER_DAY} reads / ${FB_QUOTA.WRITES_PER_DAY} writes per DAY, resets midnight US Pacific.\n\n`
    + (lines || 'nothing read yet');
}

/** Write (PATCH/upsert) a document at path with plain JS data object */
async function fbWrite(path, data) {
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, _toFB(v)]));
  const r = await fetch(_fbUrl(path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  }).catch(() => null);
  if (!r) return null;
  const json = await r.json().catch(() => ({ error: { message: `HTTP ${r.status}` } }));
  if (!r.ok) { console.error('[WavePlanner] fbWrite error', r.status, path, json?.error?.message); }
  else _fbBillWrites(1);
  return json;
}

/** A Firestore field path segment, backtick-quoted unless it is a plain identifier */
function _fbFieldSeg(s) {
  return /^[A-Za-z_][A-Za-z_0-9]*$/.test(s) ? s : '`' + String(s).replace(/[`\\]/g, m => '\\' + m) + '`';
}

/**
 * Write ONLY the given nested fields of a document, leaving the rest as it is
 * (`updateMask`). fbWrite replaces the whole document, which is wrong whenever
 * one feature owns one field of a document another feature also writes — e.g.
 * the activity profile inside a kd_identities doc.
 *   fbPatch('kd_identities/x', ['activity', 'a116'], profile)
 * sets activity.a116 and nothing else. One write. Returns true on success.
 */
async function fbPatch(path, fieldPath, value) {
  let fields = { [fieldPath[fieldPath.length - 1]]: _toFB(value) };
  for (let i = fieldPath.length - 2; i >= 0; i--) fields = { [fieldPath[i]]: { mapValue: { fields } } };
  const mask = fieldPath.map(_fbFieldSeg).join('.');
  const url = `${CFG.FB_BASE}/${path}?updateMask.fieldPaths=${encodeURIComponent(mask)}&key=${CFG.FB_API_KEY}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  }).catch(() => null);
  if (!r || !r.ok) {
    const hint = r?.status === 429 ? ' — Firestore daily free quota exhausted, resets at midnight US Pacific' : '';
    console.error('[WavePlanner] fbPatch failed', r?.status, path, mask);
    S.fbLastError = `Firestore write failed (${r ? 'HTTP ' + r.status : 'network'})${hint}`;
    return false;
  }
  _fbBillWrites(1);
  return true;
}

/**
 * ONE document write that sets some top-level fields (leaving the rest alone)
 * and adds values to arrays without duplicates (arrayUnion / appendMissingElements).
 *   fbAppend('activity_is/5_11_20260911', {loc, day, names, updatedAt},
 *            [[['covered'], [5, 6]], [['seen', '13'], [5]]])
 * An array element that is already there is skipped by Firestore, so re-sending
 * something that did land costs nothing but the write. Creates the document if
 * it does not exist. Returns true on success.
 */
async function fbAppend(path, fields, appends) {
  const root = CFG.FB_BASE.replace(/^https:\/\/firestore\.googleapis\.com\/v1\//, '');
  const write = {
    update: { name: `${root}/${path}`, fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, _toFB(v)])) },
    updateMask: { fieldPaths: Object.keys(fields).map(_fbFieldSeg) },
    updateTransforms: appends.filter(([, vals]) => vals?.length).map(([fp, vals]) => ({
      fieldPath: fp.map(_fbFieldSeg).join('.'),
      appendMissingElements: { values: vals.map(_toFB) },
    })),
  };
  const r = await fetch(`${CFG.FB_BASE}:commit?key=${CFG.FB_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes: [write] }),
  }).catch(() => null);
  if (!r || !r.ok) {
    const hint = r?.status === 429 ? ' — Firestore daily free quota exhausted, resets at midnight US Pacific' : '';
    console.error('[WavePlanner] fbAppend failed', r?.status, path);
    S.fbLastError = `Firestore write failed (${r ? 'HTTP ' + r.status : 'network'})${hint}`;
    return false;
  }
  _fbBillWrites(1);
  return true;
}

/** Read a single document at path, returns plain JS object or null */
async function fbGet(path) {
  const r = await fetch(_fbUrl(path)).catch(() => null);
  if (!r || !r.ok) return null;
  _fbBillReads(1, path.split('/')[0]);
  return r.json();
}

/**
 * Run a structuredQuery and unwrap the documents.
 * Returns an array on success, **null** on failure — the two must never be
 * confused. Returning [] for a failed read once cost us the whole Firestore
 * daily quota: dragonPull read [] instead of the 765 events it already had,
 * concluded every event was missing and re-wrote the entire collection every
 * two minutes. Callers must treat null as "unknown", never as "empty".
 */
async function _fbRunQuery(body, what) {
  const url = `${CFG.FB_BASE}:runQuery?key=${CFG.FB_API_KEY}`;
  S.fbMissingIndex = '';
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(e => { console.warn(`[WavePlanner] ${what} query network error:`, e.message); return null; });
  if (!r) return null;
  if (!r.ok) {
    const raw  = await r.text().catch(() => '');
    const hint = r.status === 429 ? ' — Firestore daily free quota exhausted, resets at midnight US Pacific' : '';
    // A bounded query needs a composite index. Firestore answers 400 with the
    // console URL that creates it — surface that instead of a bare failure, so
    // the caller can fall back and the leader can fix it in one click.
    if (r.status === 400 && /index/i.test(raw)) {
      S.fbMissingIndex = (raw.match(/https:\/\/console\.firebase\.google\.com\/[^\s"\\]+/) || [''])[0] || 'unknown';
      console.warn(`[WavePlanner] ${what}: Firestore needs a composite index for this bounded query.\n` +
        `Create it here (one click, then it applies for good):\n${S.fbMissingIndex}`);
      return null;
    }
    console.error(`[WavePlanner] ${what} query failed: HTTP ${r.status}${hint}`);
    S.fbLastError = `Firestore read failed (HTTP ${r.status})${hint}`;
    return null;
  }
  const data = await r.json().catch(() => null);
  if (!data) return null;
  const rows = (data || [])
    .filter(d => d.document)
    .map(d => Object.fromEntries(Object.entries(d.document.fields || {}).map(([k, v]) => [k, _fromFB(v)])));
  _fbBillReads(rows.length, what);
  return rows;
}

/**
 * Read several known documents in ONE request (`:batchGet`).
 * Returns {[path]: plainObject | null} — null for a document that does not
 * exist — or **null when the read itself failed**. fbGet cannot make that
 * distinction (a 404 and a 429 both come back null), which is exactly the
 * confusion the quota rules forbid, so anything that must tell "no such day"
 * from "could not read" goes through here.
 * Billed as one read per requested document: Firestore charges a lookup of a
 * missing document too.
 */
async function fbBatchGet(paths, what) {
  if (!paths?.length) return {};
  const root = CFG.FB_BASE.replace(/^https:\/\/firestore\.googleapis\.com\/v1\//, '');
  const r = await fetch(`${CFG.FB_BASE}:batchGet?key=${CFG.FB_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documents: paths.map(p => `${root}/${p}`) }),
  }).catch(e => { console.warn(`[WavePlanner] ${what} batchGet network error:`, e.message); return null; });
  if (!r) { S.fbLastError = 'Firestore read failed (network)'; return null; }
  if (!r.ok) {
    const hint = r.status === 429 ? ' — Firestore daily free quota exhausted, resets at midnight US Pacific' : '';
    console.error(`[WavePlanner] ${what} batchGet failed: HTTP ${r.status}${hint}`);
    S.fbLastError = `Firestore read failed (HTTP ${r.status})${hint}`;
    return null;
  }
  const data = await r.json().catch(() => null);
  if (!Array.isArray(data)) return null;
  _fbBillReads(paths.length, what);
  const out = Object.fromEntries(paths.map(p => [p, null]));
  for (const d of data) {
    if (!d.found) continue;
    const path = d.found.name.slice(d.found.name.indexOf('/documents/') + '/documents/'.length);
    out[path] = Object.fromEntries(Object.entries(d.found.fields || {}).map(([k, v]) => [k, _fromFB(v)]));
  }
  return out;
}

/** Delete a document at path */
async function fbDelete(path) {
  const r = await fetch(_fbUrl(path), { method: 'DELETE' }).catch(() => null);
  return r?.ok || false;
}

/**
 * NW history for one location over a time range.
 *
 * Reads TWO collections and merges them:
 *  - `kd_nw_chunks` — current. One document per ISLAND per sample, holding
 *    every kingdom on that island in a `kds` map (see scripts/snapshot.js: the
 *    per-kingdom scheme cost ~18,400 writes/day against a 20,000/day free
 *    tier). Sampled every 3h for kingdoms at war, daily for the rest.
 *  - `kd_nw_history` — LEGACY, no longer written. Still read so history from
 *    before the change is not lost; it drains through the age cleanup, and this
 *    half can be deleted once it is empty.
 *
 * Requires composite indexes on (island ASC, storedAt ASC) and, for the legacy
 * half, (loc ASC, storedAt ASC).
 * Returns rows sorted ascending by storedAt, or null when BOTH reads failed
 * (null is NOT "no history" — see _fbRunQuery).
 */
async function fbQueryNWHistory(loc, fromTs, toTs) {
  // The legacy half retires itself: the snapshot Action sets legacyDrained on
  // meta/nw_cleanup once kd_nw_history is genuinely empty, which happens when
  // the age rolls over and the cleanup deletes the last of it. Until then it
  // still holds this age's history and must be merged in. Skipping it halves
  // the graph's queries, and needs no code change to take effect.
  const [chunks, legacy] = await Promise.all([
    _fbQueryNWChunks(loc, fromTs, toTs),
    S.nwLegacyDrained ? Promise.resolve([]) : _fbQueryNWLegacy(loc, fromTs, toTs),
  ]);
  if (chunks === null && legacy === null) return null;   // both failed
  const rows = [...(chunks || []), ...(legacy || [])];
  // A sample can exist in both halves only around the cutover; keep one per
  // timestamp so the graph does not draw a doubled point.
  const seen = new Set();
  return rows
    .filter(r => { const k = Math.round(r.storedAt / 60e3); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.storedAt - b.storedAt);
}

/** Island number from a "5:2" location — the chunk key */
function _fbIsland(loc) {
  const n = parseInt(String(loc).split(':')[0], 10);
  return Number.isFinite(n) ? n : 0;
}

/** Chunked half: fetch the island's documents and pull this kingdom out of each */
async function _fbQueryNWChunks(loc, fromTs, toTs) {
  const locKey = String(loc).replace(':', '_');
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'kd_nw_chunks' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'island' },   op: 'EQUAL',                 value: { integerValue: String(_fbIsland(loc)) } } },
            { fieldFilter: { field: { fieldPath: 'storedAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(fromTs) } } },
            { fieldFilter: { field: { fieldPath: 'storedAt' }, op: 'LESS_THAN_OR_EQUAL',    value: { integerValue: String(toTs) } } },
          ],
        },
      },
      orderBy: [{ field: { fieldPath: 'storedAt' }, direction: 'ASCENDING' }],
      limit: 600,   // 3h sampling → 600 docs is ~75 days
    },
  };
  const docs = await _fbRunQuery(body, `kd_nw_chunks ${loc}`);
  if (!docs) return null;
  // Expand back into the per-kingdom row shape the graph and Find War expect.
  // A kingdom missing from a sample is not a gap in the data — it just was not
  // at war at that hour, so there is no row for it.
  return docs.reduce((out, d) => {
    const k = d.kds?.[locKey];
    if (k) out.push({
      loc, name: k.n || '', nw: k.w || 0, land: k.l || 0,
      stanceLoc: k.s || '', wars: k.r || '', storedAt: d.storedAt,
    });
    return out;
  }, []);
}

/** Legacy half: one document per kingdom per hour */
async function _fbQueryNWLegacy(loc, fromTs, toTs) {
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'kd_nw_history' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: 'loc' },
                op: 'EQUAL',
                value: { stringValue: loc },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'storedAt' },
                op: 'GREATER_THAN_OR_EQUAL',
                value: { integerValue: String(fromTs) },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'storedAt' },
                op: 'LESS_THAN_OR_EQUAL',
                value: { integerValue: String(toTs) },
              },
            },
          ],
        },
      },
      orderBy: [{ field: { fieldPath: 'storedAt' }, direction: 'ASCENDING' }],
      limit: 500,
    },
  };
  return _fbRunQuery(body, `kd_nw_history ${loc}`);
}

/**
 * Query a collection with simple field filters.
 * filters: [{field, op, value, type}] — op defaults to 'EQUAL', type to 'string'
 *          ('integer' for numeric fields such as storedAt / syncedAt).
 * opts:    {limit, orderBy, dir, what} — a bounded query needs a composite index
 *          on (filtered field ASC, orderBy field); see fbQueryOrdered.
 * Returns array of plain JS objects, or null when the read failed.
 */
async function fbQuery(collection, filters = [], opts = {}) {
  const where = filters.map(f => ({
    fieldFilter: {
      field: { fieldPath: f.field },
      op: f.op || 'EQUAL',
      value: f.type === 'integer' ? { integerValue: String(f.value) } : { stringValue: String(f.value) },
    },
  }));
  const sq = {
    from: [{ collectionId: collection }],
    limit: opts.limit || FB_QUOTA.LIMIT,
  };
  if (filters.length === 1)     sq.where = where[0];
  else if (filters.length > 1)  sq.where = { compositeFilter: { op: 'AND', filters: where } };
  if (opts.orderBy) sq.orderBy = [{ field: { fieldPath: opts.orderBy }, direction: opts.dir || 'DESCENDING' }];
  return _fbRunQuery({ structuredQuery: sq }, opts.what || collection);
}

/**
 * Bounded query that degrades gracefully when the composite index is missing.
 *
 * The bound is the whole point — it keeps a collection that grows every age
 * from costing more reads every age, and it stops the old blanket `limit: 2000`
 * from silently returning an arbitrary slice. But the index has to exist in the
 * Firestore console first, and until someone clicks the link this must not take
 * the board down. So: try bounded, and if the ONLY problem was the missing
 * index, fall back to the unbounded form and remember that for the session.
 */
async function fbQueryOrdered(collection, filters, opts = {}) {
  const key = `${collection}|${opts.orderBy || ''}`;
  if (!S.fbNoIndex[key]) {
    const rows = await fbQuery(collection, filters, opts);
    if (rows) return rows;
    if (!S.fbMissingIndex) return null;   // quota / network — a retry would only burn more
    S.fbNoIndex[key] = true;
    console.warn(`[WavePlanner] ${collection}: reading unbounded for the rest of this session.`);
  }
  // Unbounded fallback: drop the range filters and the ordering, keep equality.
  return fbQuery(collection, (filters || []).filter(f => !f.op || f.op === 'EQUAL'), { limit: opts.limit });
}

/**
 * COUNT(*) for a filtered collection. Billed at roughly one read per 1,000
 * index entries instead of one per document, so it is the cheap way to answer
 * "how much did the limit hide?" without reading the documents themselves.
 * Returns a number, or null when the read failed.
 */
async function fbCount(collection, filters = []) {
  const where = filters.map(f => ({
    fieldFilter: {
      field: { fieldPath: f.field },
      op: f.op || 'EQUAL',
      value: f.type === 'integer' ? { integerValue: String(f.value) } : { stringValue: String(f.value) },
    },
  }));
  const sq = { from: [{ collectionId: collection }] };
  if (where.length === 1)    sq.where = where[0];
  else if (where.length > 1) sq.where = { compositeFilter: { op: 'AND', filters: where } };

  const url = `${CFG.FB_BASE}:runAggregationQuery?key=${CFG.FB_API_KEY}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredAggregationQuery: { structuredQuery: sq, aggregations: [{ alias: 'n', count: {} }] } }),
  }).catch(() => null);
  if (!r || !r.ok) return null;
  _fbBillReads(1, `${collection} count`);
  const data = await r.json().catch(() => null);
  const n = data?.[0]?.result?.aggregateFields?.n?.integerValue;
  return n == null ? null : parseInt(n, 10);
}

// ── Session cache for whole-collection reads ───────────────────────────────
// A collection that is aggregated client-side (ops, dragon_events) is read ONCE
// per session and re-aggregated from memory after that. Every metric switch,
// sort, filter and range change used to pay for a full re-read: on the dragon
// board that was ~765 documents per BUTTON CLICK.
//
// Entries carry both timestamps deliberately:
//   readAt  — when Firestore was last consulted (what the TTL is about)
//   at      — when the rows last changed, including free top-ups from the
//             backend or the IS API (what "data as of" shows the leader)

const _FB_CACHE = {};   // key → {kd, rows, readAt, at, partial, src}

/** Cached rows for kd, or null when absent, stale or belonging to another kd */
function fbCacheGet(key, kd, maxAgeMs) {
  const c = _FB_CACHE[key];
  if (!c || c.kd !== kd) return null;
  if (maxAgeMs != null && Date.now() - c.readAt > maxAgeMs) return null;
  return c;
}

/** Replace the cache for key with a fresh Firestore read */
function fbCachePut(key, kd, rows, extra = {}) {
  const now = Date.now();
  _FB_CACHE[key] = { kd, rows, readAt: now, at: now, partial: false, src: 'firestore', ...extra };
  return _FB_CACHE[key];
}

/**
 * Fold rows into an existing cache entry, keyed by idOf(row).
 * This is how the caches stay current for FREE: the dragon board takes new
 * events from the backend poll that syncBackend already runs, and the ops board
 * takes new ops from the IS API call syncOps already makes. Neither costs a
 * Firestore read.
 * Returns how many rows were NEW — callers re-render only when that is > 0.
 */
function fbCacheMerge(key, kd, rows, idOf) {
  const c = _FB_CACHE[key];
  if (!c || c.kd !== kd || !rows?.length) return 0;
  const byId = new Map(c.rows.map(r => [idOf(r), r]));
  let added = 0;
  rows.forEach(r => {
    const id = idOf(r);
    if (!id) return;
    if (!byId.has(id)) added++;
    byId.set(id, r);
  });
  if (!added) return 0;
  c.rows = [...byId.values()];
  c.at   = Date.now();
  return added;
}

/** Forget a cached collection (kd change, or an explicit refresh) */
function fbCacheDrop(key) { delete _FB_CACHE[key]; }
