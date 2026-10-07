// EOWCF planner model (src/tabs/eowcf.js) — invariants on synthetic provinces.
// Loads the real source files into a sandbox, so it tests the shipped code.
// Run: node scripts/eowcf-model.test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');

const ctx = { console, window: {}, document: { getElementById: () => null },
              localStorage: { getItem: () => null }, sessionStorage: { getItem: () => null } };
vm.createContext(ctx);
for (const f of ['config.js', 'state.js', 'utils.js', 'ritual.js', 'tabs/economy.js', 'tabs/leaderboard.js', 'tabs/eowcf.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8').replace(/^const (\w+)/gm, 'var $1'), ctx, { filename: f });

const B = (name, pct) => ({ name, pctCurr: pct, pctInc: 0, pctTot: pct });
function prov(o = {}) {
  return {
    slot: 1, name: 'Test', race: o.race || 'Orc', land: 2000, title: 'Lord', location: '1:1',
    sot: { personality: o.pers || 'Cleric', land: 2000, peasants: o.peasants ?? 30000, be: 100, money: o.money ?? 100000,
           soldiers: o.soldiers ?? 0, oSpecs: o.oSpecs ?? 6000, dSpecs: o.dSpecs ?? 8000, elites: 10000,
           thieves: o.thieves ?? 6000, wizards: 4000, prisoners: 0, plague: false, ...(o.sot || {}) },
    survey: { credits: o.buildCredits || 0, buildings: [B('Barren Land', 0), B('Homes', 0), B('Banks', o.banks ?? 15),
              B('Armouries', 0), B('Guilds', 10), B('Training Grounds', 0), B('Towers', 10)] },
    sos: { books: [] },
    som: { training: { oSpecs: 0, dSpecs: 0, elites: 0, thieves: 0 } },
    ma: { wages: 100, draftRate: o.draftRate ?? 'Normal', draftTarget: o.draftTarget ?? 60, credits: o.credits ?? 0 },
  };
}
const ectx = { wdWageCut: 0, dragon: null, plague: true };
const plan = (p, cfg = {}) => ctx.eoPlanProvince(p, { ticks: 96, ritual: 'none', tpa: 4, wpa: 2.5, dpa: 5, opa: 0,
                                                       ppa: 6.5, draftRate: 'emergency', patriotism: true, ...cfg }, ectx, '1:1');

// 1. Timing: training ordered at exit − training time; armour swap a build time before that
let r = plan(prov());
assert.strictEqual(r.trainAt, r.N - r.trainTicks);
assert.strictEqual(r.swapAt, r.trainAt - r.buildTicks);
assert.strictEqual(r.trainTicks, 24);   // no Valor/TG/race/pers speed-up on this province

// 2. Never more units than soldiers, never a bill above the gold at training
for (const money of [0, 50000, 1e6, 2e7]) for (const soldiers of [0, 3000, 20000]) {
  const x = plan(prov({ money, soldiers }));
  const t = x.train;
  assert(t.thv + t.dsp + t.osp + t.eli <= x.soldiersAtTrain, `units > soldiers (money ${money}, sol ${soldiers})`);
  assert(t.bill <= Math.max(0, x.gold.atTrain) + 1, `bill ${t.bill} > gold ${x.gold.atTrain}`);
  assert(t.untrained >= 0 && t.thv >= 0 && t.eli >= 0);
}

// 3. Draft = one LATE burst down to the PPA, ending at the training tick
r = plan(prov({ peasants: 30000 }));                       // 2000 acres → floor 13,000 peasants
assert(r.draft.drafted > 0 && r.draft.startAt > 0, 'burst should start late, not now');
assert.strictEqual(r.draft.startAt + r.draft.ticks, r.trainAt, 'burst must end exactly at the training tick');
assert(Math.abs(r.draft.ppaAtTrain - 6.5) < 0.01, 'drafts down to the PPA target');
// Patriotism makes the burst shorter (so it starts later)
assert(plan(prov(), { patriotism: false }).draft.ticks > r.draft.ticks);
// Rate "none" drafts nothing (leadership setting, or the province's own when blank)
assert.strictEqual(plan(prov(), { draftRate: 'none' }).draft.drafted, 0);
assert.strictEqual(plan(prov({ draftRate: 'None' }), { draftRate: '' }).draft.drafted, 0);
// Already at/below the PPA: nothing to draft
assert.strictEqual(plan(prov({ peasants: 10000 })).draft.drafted, 0);
// Emergency drafts in fewer ticks than Normal (so its burst can start later)
assert(plan(prov(), { draftRate: 'normal' }).draft.ticks > plan(prov(), { draftRate: 'emergency' }).draft.ticks);

// 3b. Thieves cost a flat price: armouries and Human/General training discounts don't touch them
for (const race of ['Orc', 'Human']) {
  const x = plan(prov({ race, pers: 'General', money: 1e8, soldiers: 9000, thieves: 0, dSpecs: 10000, oSpecs: 0 }), { tpa: 1, dpa: 5 });
  assert.strictEqual(x.train.thv, 2000);
  const specCost = x.train.dsp * 350 * x.train.unitMult;   // 0 dspecs needed here, so the bill is thieves + elites
  assert.strictEqual(Math.round(x.train.bill - x.train.eli * x.train.eliteUnit - specCost), 2000 * 500, race + ': thieves must cost 500 each');
}

// 3c. Inspire Army / Hero's Inspiration: Cleric gets Hero's (−30% time), Rogue gets Inspire Army (−20%)
assert.strictEqual(plan(prov({ pers: 'Cleric' }), { inspire: true }).trainTicks, Math.ceil(24 * 0.70));
assert.strictEqual(plan(prov({ pers: 'Rogue' }), { inspire: true }).trainTicks, Math.ceil(24 * 0.80));
assert.strictEqual(plan(prov({ pers: 'Rogue' }), { inspire: true }).inspire.name, 'Inspire Army');
// lower wages → more gold by training time (same province, same horizon... training starts later too)
assert(plan(prov({ money: 0 }), { inspire: true }).gold.atTrain > plan(prov({ money: 0 })).gold.atTrain);

// 4. Specialist credits pay for specs first: no gold at all, credits cover the def specs
r = plan(prov({ money: 0, credits: 3000, dSpecs: 8000, soldiers: 5000, draftRate: 'None',
                sot: { peasants: 0 } }));
assert(r.train.freeSpecs > 0 && r.train.dsp === r.train.freeSpecs, 'credit specs should be free when broke');

// 5. A race without an elite price is flagged, never guessed
r = plan(prov({ race: 'Gnome' }));
assert(r.warn.some(w => /RACE_ELITE_COST/.test(w)), 'missing race price must warn');

// 6. Surplus off specs are always released (to soldiers or peasants), nothing kept above target
r = plan(prov({ oSpecs: 6000 }), { opa: 1 });
assert.strictEqual(r.surplusO, 4000);
assert.strictEqual(r.release.toSoldiers + r.release.toPeasants, 4000);

// 7. The chosen plan never trains fewer elites than doing nothing special
for (const money of [0, 3e5, 3e6]) {
  const x = plan(prov({ money, soldiers: 8000 }));
  assert(x.train.eli >= x.baseline.eli);
}

// 8. Plan text renders, and the published (Discord) version uses live timestamps
ctx.S.currentTickName = 'May 14, YR9';
r = plan(prov({ soldiers: 8000, money: 3e6 }));
assert(/order training/.test(ctx._eoPlanText(r, false)));
assert(/<t:\d+:R>/.test(ctx._eoPlanText(r, true)));
assert(!/~\d/.test(ctx._eoPlanText(r, true)), 'use ≈, not ~ (strikethrough risk in Discord)');

// 9. Setups: most specific match wins, manual assignment overrides
ctx.S.own = { location: '1:1', provinces: [] };
const setups = [
  { id: 'all', name: 'Everyone', race: '', pers: '', tpa: 4, wpa: 2.5, dpa: 5, opa: 0, ppa: 6.5 },
  { id: 'orc', name: 'Orcs', race: 'orc', pers: '', tpa: 3, wpa: 2, dpa: 5, opa: 0, ppa: 6.5 },
  { id: 'gen', name: 'Generals', race: '', pers: 'general', tpa: 2, wpa: 2, dpa: 5, opa: 0, ppa: 6.5 },
  { id: 'og',  name: 'Orc General', race: 'orc', pers: 'general', tpa: 1, wpa: 1, dpa: 5, opa: 0, ppa: 6 },
  { id: 'fr',  name: 'Faery Rogue', race: 'faery', pers: 'rogue', tpa: 5, wpa: 3, dpa: 4, opa: 0, ppa: 7 },
];
const pick = (race, pers, assign = {}) => ctx._eoSetupFor(prov({ race, pers }), { setups, assign }).setup.id;
assert.strictEqual(pick('Orc', 'General'), 'og');
assert.strictEqual(pick('Orc', 'Cleric'), 'orc');
assert.strictEqual(pick('Elf', 'General'), 'gen');
assert.strictEqual(pick('Faery', 'Rogue'), 'fr');
assert.strictEqual(pick('Faery', 'Sage'), 'all');
assert.strictEqual(pick('Orc', 'General', { 1: 'fr' }), 'fr');           // hand-assigned
assert.strictEqual(pick('Orc', 'General', { 1: 'gone' }), 'og');         // stale assignment ignored
// eoPlanAll applies the setup's numbers
ctx.S.own.provinces = [prov({ race: 'Faery', pers: 'Rogue' })];
const all = ctx.eoPlanAll({ ticks: 96, ritual: 'none', draftRate: 'emergency', patriotism: true, setups, assign: {} });
assert.strictEqual(all[0].setup.id, 'fr');
assert.strictEqual(all[0].target.thv, 5 * 2000);
assert.strictEqual(all[0].draft.ppa, 7);

console.log('eowcf-model: all checks passed');
