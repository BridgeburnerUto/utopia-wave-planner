// Mirror of elitesCalc()/parseAmount() in utopia-intel-server/discord.php (the
// /elites Discord command). No PHP on the dev box, so the maths is checked here.
// Keep the two in step.  Run: node scripts/elites-calc.test.js
const assert = require('assert');

function elitesCalc(s, ps, pe, b) {
  let e, sp;
  if (b >= s * pe) { e = s; sp = 0; }
  else if (b < s * ps) { e = 0; sp = Math.floor(b / ps); }
  else { e = Math.floor((b - s * ps) / (pe - ps)); sp = s - e; }
  const cost = e * pe + sp * ps;
  return { elites: e, specs: sp, untrained: s - e - sp, cost, left: b - cost, allElites: Math.min(s, Math.floor(b / pe)) };
}

function parseAmount(str) {
  const s = String(str).trim().toLowerCase().replace(/[, _ ]/g, '');
  const m = s.match(/^(\d+(?:\.\d+)?)([kmb]?)$/);
  if (!m) return null;
  const v = parseFloat(m[1]) * { '': 1, k: 1e3, m: 1e6, b: 1e9 }[m[2]];
  return v > 1e15 ? null : Math.round(v);
}

// The scope example: 10k soldiers, 350/800, 5M -> 3,333 elites + 6,667 specs.
let r = elitesCalc(10000, 350, 800, 5_000_000);
assert.deepStrictEqual([r.elites, r.specs, r.untrained], [3333, 6667, 0]);
assert(r.cost <= 5_000_000 && r.left < 450, 'leftover must be less than one spec->elite upgrade');

// Rich: everyone becomes an elite.
r = elitesCalc(1000, 350, 800, 10_000_000);
assert.deepStrictEqual([r.elites, r.specs, r.left], [1000, 0, 9_200_000]);

// Exactly enough for all specs: 0 elites, nothing untrained.
r = elitesCalc(1000, 350, 800, 350_000);
assert.deepStrictEqual([r.elites, r.specs, r.untrained, r.left], [0, 1000, 0, 0]);

// Poor: cannot even spec everyone.
r = elitesCalc(1000, 350, 800, 100_000);
assert.deepStrictEqual([r.elites, r.specs, r.untrained], [0, 285, 715]);

// Never over budget, never more units than soldiers, across a sweep.
for (let b = 0; b <= 2_000_000; b += 7_919) {
  const x = elitesCalc(1500, 350, 1150, b);
  assert(x.cost <= b && x.elites + x.specs <= 1500 && x.elites >= 0 && x.specs >= 0, `b=${b}`);
  // maximal: one more elite would not fit
  if (x.elites < 1500 && x.untrained === 0) assert(x.left < 1150 - 350, `b=${b} not maximal`);
}

// Input parsing.
assert.strictEqual(parseAmount('5,000,000'), 5_000_000);
assert.strictEqual(parseAmount('5 000 000'), 5_000_000);
assert.strictEqual(parseAmount('5m'), 5_000_000);
assert.strictEqual(parseAmount('1.2M'), 1_200_000);
assert.strictEqual(parseAmount('350k'), 350_000);
assert.strictEqual(parseAmount('800'), 800);
assert.strictEqual(parseAmount('abc'), null);
assert.strictEqual(parseAmount('-5'), null);
assert.strictEqual(parseAmount(''), null);

console.log('elites-calc: all checks passed');
