#!/usr/bin/env node
/**
 * analyze_ops.js — parse Discord op log dump and compute success rates by ratio bucket.
 * Usage: node scripts/analyze_ops.js ops.txt [> results.txt]
 */

const fs    = require('fs');
const path  = require('path');

const file  = process.argv[2];
if (!file) { console.error('Usage: node analyze_ops.js <ops.txt>'); process.exit(1); }

const raw   = fs.readFileSync(path.resolve(file), 'utf8');
const lines = raw.split(/\r?\n/);

// ── Parse ──────────────────────────────────────────────────────────────────────
// Line format (from Discord API fetch):
//   [timestamp] utopiabot: :detective::green_heart: Province <<__op name__ **| Target (X:Y)**>>
//   [result]|N sent (r)|ownRtpa (m.ownMod)[ vs enemyRtpa (m.enemyMod)]|rNW X.XX

// Op name: strip Discord markdown __ and **
const OP_RE  = /<<[_*]*([^_*|<>]+?)[_*\s]*\|/;
const MOD_RE = /\(m\.([\d.]+)\)/g;
const RNW_RE = /rNW\s*([\d.]+)/i;

const records      = [];
let skippedNoVs    = 0;
let skippedNoMatch = 0;

for (const line of lines) {
  if (!line.includes('<<') || !line.includes('(m.')) { skippedNoMatch++; continue; }

  const opM = line.match(OP_RE);
  if (!opM) { skippedNoMatch++; continue; }
  const op = opM[1].trim().toLowerCase().replace(/[_*]/g, '');

  // Collect all (m.X) values
  const mods = [];
  let mm;
  MOD_RE.lastIndex = 0;
  while ((mm = MOD_RE.exec(line)) !== null) mods.push(parseFloat(mm[1]));

  // Need at least 2 mod values with 'vs' between them
  if (mods.length < 2) { skippedNoVs++; continue; }

  const firstMPos  = line.indexOf('(m.');
  const secondMPos = line.indexOf('(m.', firstMPos + 1);
  if (!line.slice(firstMPos, secondMPos).includes('vs')) { skippedNoVs++; continue; }

  const ownMod   = mods[0];
  const enemyMod = mods[1];
  if (!ownMod || !enemyMod) { skippedNoVs++; continue; }
  const ratio = ownMod / enemyMod;

  const rnwM  = line.match(RNW_RE);
  const nw    = rnwM ? parseFloat(rnwM[1]) : null;

  const hasFail   = /\bFAIL\b/.test(line);
  const hasGreen  = /:green_heart:|💚/.test(line);
  const success   = hasGreen && !hasFail;
  const type      = /:comet:|☄/.test(line) ? 'magic' : 'thievery';

  records.push({ type, op, success, ownMod, enemyMod, ratio, nw });
}

console.log(`Parsed ${records.length} ops with own+enemy mod TPA/WPA.`);
console.log(`Skipped: ${skippedNoVs} without enemy intel, ${skippedNoMatch} non-op lines.\n`);

if (!records.length) { console.log('No records — check file format.'); process.exit(1); }

// ── Buckets ────────────────────────────────────────────────────────────────────
const BUCKETS = [
  { label: '<0.5',   min: 0,   max: 0.5 },
  { label: '0.5–1',  min: 0.5, max: 1.0 },
  { label: '1–1.5',  min: 1.0, max: 1.5 },
  { label: '1.5–2',  min: 1.5, max: 2.0 },
  { label: '2–2.5',  min: 2.0, max: 2.5 },
  { label: '2.5–3',  min: 2.5, max: 3.0 },
  { label: '3–4',    min: 3.0, max: 4.0 },
  { label: '4–5',    min: 4.0, max: 5.0 },
  { label: '5+',     min: 5.0, max: Infinity },
];

function bkt(r)         { return BUCKETS.find(b => r >= b.min && r < b.max) || BUCKETS[BUCKETS.length-1]; }
function cell(ok, n)    { return n ? `${Math.round(ok/n*100)}%(${n})` : '—'; }

const COL = 11;
const HDR = 'Op'.padEnd(26) + BUCKETS.map(b => b.label.padStart(COL)).join('');
const DIV = '─'.repeat(HDR.length);

// ── Per-op table ───────────────────────────────────────────────────────────────
const byOp = {};
for (const r of records) {
  if (!byOp[r.op]) byOp[r.op] = {};
  const b = bkt(r.ratio).label;
  if (!byOp[r.op][b]) byOp[r.op][b] = { ok: 0, n: 0 };
  byOp[r.op][b].ok += r.success ? 1 : 0;
  byOp[r.op][b].n++;
}

console.log(HDR);
console.log(DIV);
for (const op of Object.keys(byOp).sort()) {
  const row = op.slice(0,25).padEnd(26) + BUCKETS.map(b => {
    const d = byOp[op][b.label];
    return (d ? cell(d.ok, d.n) : '—').padStart(COL);
  }).join('');
  console.log(row);
}

// ── Totals ─────────────────────────────────────────────────────────────────────
console.log(DIV);
for (const type of ['thievery', 'magic']) {
  const recs = records.filter(r => r.type === type);
  if (!recs.length) continue;
  const row = ('ALL ' + type.toUpperCase()).padEnd(26) + BUCKETS.map(b => {
    const sub = recs.filter(r => bkt(r.ratio).label === b.label);
    return (sub.length ? cell(sub.filter(r=>r.success).length, sub.length) : '—').padStart(COL);
  }).join('');
  console.log(row);
}

// ── NW zone breakdown (thievery) ───────────────────────────────────────────────
const nwRecs = records.filter(r => r.type === 'thievery' && r.nw != null);
if (nwRecs.length) {
  console.log('\n' + DIV);
  console.log('NW ZONE BREAKDOWN (thievery)');
  console.log(HDR);
  console.log(DIV);
  const zones = [
    { label: 'rNW <0.567 (dead)',    fn: r => r.nw < 0.567 },
    { label: 'rNW 0.567–0.9 (low)',  fn: r => r.nw >= 0.567 && r.nw < 0.9 },
    { label: 'rNW 0.9–1.1 (sweet)',  fn: r => r.nw >= 0.9   && r.nw <= 1.1 },
    { label: 'rNW 1.1–1.6 (high)',   fn: r => r.nw > 1.1    && r.nw <= 1.6 },
    { label: 'rNW >1.6 (dead)',      fn: r => r.nw > 1.6 },
  ];
  for (const z of zones) {
    const sub = nwRecs.filter(z.fn);
    if (!sub.length) continue;
    const row = z.label.padEnd(26) + BUCKETS.map(b => {
      const zb = sub.filter(r => bkt(r.ratio).label === b.label);
      return (zb.length ? cell(zb.filter(r=>r.success).length, zb.length) : '—').padStart(COL);
    }).join('');
    console.log(row);
  }
}

console.log('\n(Format: successRate%(count) — only ops where enemy intel was available)\n');

// ── CSV output ─────────────────────────────────────────────────────────────────
const csvFile = path.join(path.dirname(path.resolve(file)), 'results.csv');
const csvRows = [
  ['Op', ...BUCKETS.map(b => b.label), 'Total ops', 'Overall %'].join('\t')
];
for (const op of Object.keys(byOp).sort()) {
  const allRecs = records.filter(r => r.op === op);
  const totalOk = allRecs.filter(r => r.success).length;
  const row = [
    op,
    ...BUCKETS.map(b => {
      const d = byOp[op][b.label];
      return d ? `${Math.round(d.ok/d.n*100)}% (${d.n})` : '';
    }),
    allRecs.length,
    allRecs.length ? `${Math.round(totalOk/allRecs.length*100)}%` : '',
  ].join('\t');
  csvRows.push(row);
}
fs.writeFileSync(csvFile, csvRows.join('\n'), 'utf8');
console.log(`CSV saved to results.csv`);
