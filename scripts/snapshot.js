#!/usr/bin/env node
// ── Utopia NW Snapshot ─────────────────────────────────────────────────────
// Fetches the world kingdom dump and stores NW/land/stance history.
//
// WRITE BUDGET — why this looks the way it does.
// The project is on the Firestore Spark free tier: 20,000 writes per DAY. The
// original design wrote ONE DOCUMENT PER KINGDOM PER HOUR, which at ~765
// kingdoms is ~18,400 writes a day — 92% of the entire daily budget before the
// planner itself wrote a single row. That is why a modest write spike elsewhere
// killed this job with `batchWrite: 429` on 2026-08-11.
//
// Two changes bring it to a few hundred a day:
//   1. CHUNKED DOCUMENTS. One document per ISLAND per sample, holding every
//      kingdom on that island in a `kds` map, instead of one document each.
//      ~30 islands means ~30 writes per sample rather than ~765.
//   2. SAMPLE ONLY AS OFTEN AS THE DATA IS USED. Kingdoms AT WAR are sampled
//      every 3 hours (the NW graph's resolution); everyone else once a day.
//      A peaceful kingdom's networth curve does not need 24 points a day.
//
// Collections:
//   kd_nw_chunks/{island}_{sampleId}  — current, chunked (sampleId = YYYYMMDDHH)
//   kd_nw_history/{loc}_{hourId}      — LEGACY, no longer written. The client
//     still reads it and merges, so existing history is not lost; it drains
//     away through the same age cleanup below and the read path can be dropped
//     once it is empty.
//
// Also reads meta/nw_cleanup.ageStartDate and batch-deletes old documents from
// BOTH collections (runs until all docs before that date are gone, 500 at a time).
//
// Required env vars:
//   FIREBASE_SA_KEY — full JSON content of a Firebase service account key
//   FB_PROJECT      — Firestore project ID (default: utopia-leaderboard)
//
// Optional env vars:
//   DUMP_URL        — defaults to https://utopia-game.com/wol/game/kingdoms_dump/

'use strict';

const crypto = require('crypto');

const FB_PROJECT  = process.env.FB_PROJECT || 'utopia-leaderboard';
const FB_BASE     = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;
const FB_DOC_ROOT = `projects/${FB_PROJECT}/databases/(default)/documents`;
const DUMP_URL    = process.env.DUMP_URL || 'https://utopia-game.com/wol/game/kingdoms_dump/';

if (!process.env.FIREBASE_SA_KEY) {
  console.error('[snapshot] FIREBASE_SA_KEY env var is required');
  process.exit(1);
}

let _sa;
try {
  _sa = JSON.parse(process.env.FIREBASE_SA_KEY);
} catch (e) {
  console.error('[snapshot] FIREBASE_SA_KEY is not valid JSON:', e.message);
  process.exit(1);
}

const now      = Date.now();
const hourId   = Math.floor(now / 3_600_000);
const storedAt = now;

// ── Sampling policy ────────────────────────────────────────────────────────
// The Action is scheduled every 3 hours (.github/workflows/snapshot.yml), so
// every run is a war sample. The run at UTC hour 0 additionally sweeps every
// kingdom, giving peaceful ones one point a day.
const SAMPLE_HOURS   = 3;
const FULL_SWEEP_UTC = 0;

const _d        = new Date(now);
const utcHour   = _d.getUTCHours();
const isFullSweep = utcHour < SAMPLE_HOURS;   // the first run of the UTC day
// YYYYMMDDHH, floored to the sampling grid so a late-firing cron still lands on
// the same sample id as an on-time one.
const sampleId = [
  _d.getUTCFullYear(),
  String(_d.getUTCMonth() + 1).padStart(2, '0'),
  String(_d.getUTCDate()).padStart(2, '0'),
  String(Math.floor(utcHour / SAMPLE_HOURS) * SAMPLE_HOURS).padStart(2, '0'),
].join('');

/** Island number from a "5:2" location — the chunk key */
function islandOf(loc) {
  const n = parseInt(String(loc).split(':')[0], 10);
  return Number.isFinite(n) ? n : 0;
}

// ── Service account JWT auth ──────────────────────────────────────────────────

let _accessToken    = null;
let _accessTokenExp = 0;

async function getAccessToken() {
  if (_accessToken && Date.now() < _accessTokenExp) return _accessToken;

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;

  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss:   _sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud:   'https://oauth2.googleapis.com/token',
    iat,
    exp,
  })).toString('base64url');

  const toSign    = `${header}.${payload}`;
  const signer    = crypto.createSign('RSA-SHA256');
  signer.update(toSign);
  const signature = signer.sign(_sa.private_key, 'base64url');
  const jwt       = `${toSign}.${signature}`;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Token exchange failed: ${r.status} — ${text.slice(0, 300)}`);
  }

  const data      = await r.json();
  _accessToken    = data.access_token;
  _accessTokenExp = Date.now() + (data.expires_in - 60) * 1000;
  return _accessToken;
}

async function _authHeaders() {
  const token = await getAccessToken();
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type':  'application/json',
  };
}

// ── Firestore field helpers ───────────────────────────────────────────────────

function _toFB(v) {
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')  return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string')  return { stringValue: v };
  // Maps carry the per-kingdom payload inside a chunk document (see below).
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, val]) => [k, _toFB(val)])) } };
  }
  return { stringValue: String(v) };
}

function _fromFB(v) {
  if (!v) return null;
  if ('stringValue'  in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue);
  if ('doubleValue'  in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  return null;
}

// ── Firestore REST helpers ────────────────────────────────────────────────────

async function fbGet(path) {
  const headers = await _authHeaders();
  const r = await fetch(`${FB_BASE}/${path}`, { headers });
  if (!r.ok) return null;
  return r.json();
}

async function fbBatchWrite(writes) {
  const headers = await _authHeaders();
  const r = await fetch(`${FB_BASE}:batchWrite`, {
    method:  'POST',
    headers,
    body:    JSON.stringify({ writes }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`batchWrite failed: ${r.status} — ${text.slice(0, 200)}`);
  }
  return r.json();
}

/**
 * Is there anything at all left in a collection?
 * Asks for a single document rather than counting — one read, and the only
 * question that matters is "empty or not".
 * Returns 0, 1 (meaning "at least one"), or null when the check itself failed —
 * null must NOT be treated as empty, or the client would stop reading a
 * collection that still holds history.
 */
async function fbCountRemaining(collection) {
  const headers = await _authHeaders();
  const r = await fetch(`${FB_BASE}:runQuery`, {
    method:  'POST',
    headers,
    body:    JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], limit: 1 } }),
  });
  if (!r.ok) return null;
  const data = await r.json();
  return (data || []).filter(d => d.document).length;
}

async function fbQueryOldDocs(cutoffTs, collection) {
  const headers = await _authHeaders();
  const body = {
    structuredQuery: {
      from:  [{ collectionId: collection }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'storedAt' },
          op:    'LESS_THAN',
          value: { integerValue: String(cutoffTs) },
        },
      },
      limit: 500,
    },
  };
  const r = await fetch(`${FB_BASE}:runQuery`, {
    method:  'POST',
    headers,
    body:    JSON.stringify(body),
  });
  if (!r.ok) return [];
  const data = await r.json();
  return (data || [])
    .filter(d => d.document?.name)
    .map(d => d.document.name);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[snapshot] Starting — hourId ${hourId} (${new Date(now).toISOString()})`);

  // ── 1. Fetch world dump ────────────────────────────────────────────────────
  console.log(`[snapshot] Fetching ${DUMP_URL}`);
  const resp = await fetch(DUMP_URL);
  if (!resp.ok) throw new Error(`Dump fetch failed: ${resp.status}`);

  const raw = await resp.json();
  // raw[0] is a timestamp string, raw[1..] are KD objects
  const kds = Array.isArray(raw) ? raw.slice(1) : [];
  if (!kds.length) throw new Error('No KD data in dump response');
  console.log(`[snapshot] Fetched ${kds.length} kingdoms`);

  // ── 2. Select what this sample covers ──────────────────────────────────────
  // Every run samples the kingdoms AT WAR — those are the ones the NW graph and
  // Find War are actually used on, and the ones whose numbers move. The first
  // run of each UTC day additionally sweeps everyone, so a peaceful kingdom
  // still has a continuous (daily) curve.
  const atWar = kd => Array.isArray(kd.stance) && kd.stance[0] === 'war';
  const pool  = kds.filter(kd => kd.loc && (isFullSweep || atWar(kd)));

  console.log(`[snapshot] Sample ${sampleId} — ${isFullSweep ? 'FULL SWEEP' : 'war only'}: ` +
              `${pool.length} of ${kds.length} kingdoms`);

  if (!pool.length) {
    console.log('[snapshot] Nothing to sample this run (no kingdoms at war)');
  }

  // ── 3. Group by island and write one document per island ───────────────────
  // The whole point: ~30 island documents instead of ~765 kingdom documents.
  const byIsland = new Map();
  pool.forEach(kd => {
    const isl = islandOf(kd.loc);
    if (!byIsland.has(isl)) byIsland.set(isl, {});
    // stance is either the string "Normal" or the array ["war", "X:Y"].
    // stanceLoc is the enemy location at war, empty string at peace.
    const stanceLoc = atWar(kd) ? (kd.stance[1] || '') : '';
    // Short keys — this map carries every kingdom on the island, and the
    // document is fetched whole by the client on every graph read.
    byIsland.get(isl)[kd.loc.replace(':', '_')] = {
      n: kd.name || '',
      w: Math.round(kd.nw   || 0),
      l: Math.round(kd.land || 0),
      s: stanceLoc,
      r: Array.isArray(kd.wars) ? kd.wars.join(',') : '',   // game-assigned war IDs
    };
  });

  const BATCH_SIZE = 500;
  const writes = [...byIsland.entries()].map(([isl, kdMap]) => ({
    update: {
      name: `${FB_DOC_ROOT}/kd_nw_chunks/${isl}_${sampleId}`,
      fields: {
        island:   _toFB(isl),
        sampleId: _toFB(sampleId),
        storedAt: _toFB(storedAt),
        full:     _toFB(isFullSweep),
        n:        _toFB(Object.keys(kdMap).length),
        kds:      _toFB(kdMap),
      },
    },
  }));

  let written = 0;
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = writes.slice(i, i + BATCH_SIZE);
    await fbBatchWrite(batch);
    written += batch.length;
  }
  console.log(`[snapshot] Wrote ${written} island documents covering ${pool.length} kingdoms ` +
              `(the per-kingdom scheme would have cost ${pool.length} writes)`);

  // ── 3. Cleanup old age data ───────────────────────────────────────────────
  const cleanupDoc   = await fbGet('meta/nw_cleanup');
  const ageStartDate = cleanupDoc?.fields?.ageStartDate
    ? _fromFB(cleanupDoc.fields.ageStartDate)
    : 0;

  if (ageStartDate > 0) {
    console.log(`[snapshot] Cleanup: deleting docs before ${new Date(ageStartDate).toISOString()}`);
    let totalDeleted = 0;
    const MAX_ITERS  = 300;

    // Both collections: the chunked one in use, and the legacy per-kingdom one
    // that is no longer written but still holds this age's history until the
    // age rolls over. Draining it is what eventually lets the client stop
    // reading it at all.
    for (const coll of ['kd_nw_chunks', 'kd_nw_history']) {
      let iterations = 0;
      let batch;
      do {
        batch = await fbQueryOldDocs(ageStartDate, coll);
        if (batch.length) {
          const deletes = batch.map(name => ({ delete: name }));
          await fbBatchWrite(deletes);
          totalDeleted += batch.length;
          console.log(`[snapshot] Deleted ${batch.length} old ${coll} docs (total: ${totalDeleted})`);
        }
        iterations++;
      } while (batch.length === 500 && iterations < MAX_ITERS);
    }

    if (totalDeleted > 0) {
      console.log(`[snapshot] Cleanup complete — ${totalDeleted} docs deleted`);
    } else {
      console.log(`[snapshot] Cleanup: no old docs found`);
    }

    // ── Retire the legacy collection when it is genuinely empty ─────────────
    // The client reads BOTH kd_nw_chunks and the legacy kd_nw_history and
    // merges them, so history written before the chunked scheme is not lost.
    // That second query should stop happening once there is nothing left to
    // find — but only the writer can safely decide that, and only by looking.
    //
    // kd_nw_history holds the CURRENT age until the age rolls over and this
    // cleanup deletes it, so the flag flips on its own at rollover and needs no
    // code change. It is published on meta/nw_cleanup, a document the client
    // already fetches at init, so acting on it costs no extra read.
    const alreadyDrained = cleanupDoc?.fields?.legacyDrained?.booleanValue === true;
    if (alreadyDrained) {
      console.log('[snapshot] Legacy kd_nw_history already drained — client skips it');
    } else {
      const remaining = await fbCountRemaining('kd_nw_history');
      if (remaining === 0) {
        await fbBatchWrite([{
          update: {
            name:   `${FB_DOC_ROOT}/meta/nw_cleanup`,
            fields: { legacyDrained: _toFB(true), legacyDrainedAt: _toFB(now) },
          },
          updateMask: { fieldPaths: ['legacyDrained', 'legacyDrainedAt'] },
        }]);
        console.log('[snapshot] Legacy kd_nw_history is empty — flagged drained, ' +
                    'the client will stop querying it (halves NW graph reads)');
      } else {
        console.log(`[snapshot] Legacy kd_nw_history still holds data — client keeps merging it`);
      }
    }
  } else {
    console.log(`[snapshot] Cleanup: ageStartDate not set, skipping`);
  }

  console.log('[snapshot] Done');
}

main().catch(e => {
  console.error('[snapshot] Fatal error:', e.message);
  process.exit(1);
});
