#!/usr/bin/env node
// ── Utopia NW Snapshot ─────────────────────────────────────────────────────
// Fetches the world kingdom dump and writes one Firestore document per KD.
// Collection: kd_nw_history / Document ID: {loc_underscored}_{hourId}
//
// Also reads meta/nw_cleanup.ageStartDate and batch-deletes old documents
// (runs until all docs before that date are gone, 500 at a time).
//
// Required env vars:
//   FB_PROJECT  — Firestore project ID (e.g. utopia-leaderboard)
//   FB_API_KEY  — Firestore REST API key (store as GitHub Actions secret)
//
// Optional env vars:
//   DUMP_URL    — defaults to https://utopia-game.com/wol/game/kingdoms_dump/

'use strict';

const FB_PROJECT = process.env.FB_PROJECT || 'utopia-leaderboard';
const FB_API_KEY = process.env.FB_API_KEY;
const FB_BASE    = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;
const DUMP_URL   = process.env.DUMP_URL   || 'https://utopia-game.com/wol/game/kingdoms_dump/';

if (!FB_API_KEY) {
  console.error('[snapshot] FB_API_KEY env var is required');
  process.exit(1);
}

const now      = Date.now();
const hourId   = Math.floor(now / 3_600_000);
const storedAt = now;

// ── Firestore field helpers ───────────────────────────────────────────────────

function _toFB(v) {
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')  return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string')  return { stringValue: v };
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
  const r = await fetch(`${FB_BASE}/${path}?key=${FB_API_KEY}`);
  if (!r.ok) return null;
  return r.json();
}

async function fbBatchWrite(writes) {
  const url = `${FB_BASE}:batchWrite?key=${FB_API_KEY}`;
  const r = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ writes }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`batchWrite failed: ${r.status} — ${text.slice(0, 200)}`);
  }
  return r.json();
}

async function fbQueryOldDocs(cutoffTs) {
  const url = `${FB_BASE}:runQuery?key=${FB_API_KEY}`;
  const body = {
    structuredQuery: {
      from:  [{ collectionId: 'kd_nw_history' }],
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
  const r = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
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

  // ── 2. Build and send Firestore batch writes ───────────────────────────────
  const BATCH_SIZE = 500;
  const writes = kds
    .filter(kd => kd.loc)
    .map(kd => {
      const locKey  = kd.loc.replace(':', '_');
      const docName = `${FB_BASE}/kd_nw_history/${locKey}_${hourId}`;
      return {
        update: {
          name:   docName,
          fields: {
            loc:      _toFB(kd.loc),
            name:     _toFB(kd.name   || ''),
            nw:       _toFB(Math.round(kd.nw   || 0)),
            land:     _toFB(Math.round(kd.land  || 0)),
            storedAt: _toFB(storedAt),
          },
        },
      };
    });

  let written = 0;
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = writes.slice(i, i + BATCH_SIZE);
    await fbBatchWrite(batch);
    written += batch.length;
    console.log(`[snapshot] Wrote ${written}/${writes.length} KD documents`);
  }

  // ── 3. Cleanup old age data ───────────────────────────────────────────────
  // Read the age start date that the leader set in the tool
  const cleanupDoc = await fbGet('meta/nw_cleanup');
  const ageStartDate = cleanupDoc?.fields?.ageStartDate
    ? _fromFB(cleanupDoc.fields.ageStartDate)
    : 0;

  if (ageStartDate > 0) {
    console.log(`[snapshot] Cleanup: deleting docs before ${new Date(ageStartDate).toISOString()}`);
    let totalDeleted = 0;
    let iterations   = 0;
    const MAX_ITERS  = 300; // safety cap — 300 × 500 = 150,000 docs max per run

    let batch;
    do {
      batch = await fbQueryOldDocs(ageStartDate);
      if (batch.length) {
        const deletes = batch.map(name => ({ delete: name }));
        await fbBatchWrite(deletes);
        totalDeleted += batch.length;
        console.log(`[snapshot] Deleted ${batch.length} old docs (total: ${totalDeleted})`);
      }
      iterations++;
    } while (batch.length === 500 && iterations < MAX_ITERS);

    if (totalDeleted > 0) {
      console.log(`[snapshot] Cleanup complete — ${totalDeleted} docs deleted`);
    } else {
      console.log(`[snapshot] Cleanup: no old docs found`);
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
