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
    sos: { books: [{ type: 'Housing', effect: 40 }] },   // max pop 2000 × 25 × 1.4 = 70,000 → default fixture at 91%
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
assert(Math.abs(r.draft.ppaAtTrain - 6.5) < 0.1, 'drafts down to the PPA target (births in the last tick add a few back)');
// Patriotism makes the burst shorter (so it starts later)
assert(plan(prov(), { patriotism: false }).draft.ticks > r.draft.ticks);
// Rate "none" drafts nothing (leadership setting, or the province's own when blank)
assert.strictEqual(plan(prov(), { draftRate: 'none' }).draft.drafted, 0);
assert.strictEqual(plan(prov({ draftRate: 'None' }), { draftRate: '' }).draft.drafted, 0);
// Already at/below the PPA with a FULL population (no room for births): nothing to draft.
// Fixture max pop = 70,000; 10,000 peasants + 60,000 military = full.
assert.strictEqual(plan(prov({ peasants: 10000, soldiers: 26000 }), { ticks: 30 }).draft.drafted, 0);
// ...but with room, births refill peasants above the PPA and the draft takes them
assert(plan(prov({ peasants: 10000 })).draft.drafted > 0, 'births refill a shrunk province');
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
// shorter training → ordered later → more ticks of income before the bill
assert(plan(prov({ money: 0 }), { inspire: true }).gold.atTrain > plan(prov({ money: 0 })).gold.atTrain);

// 4. Specialist credits pay for specs first: no gold at all, credits cover the def specs
r = plan(prov({ money: 0, credits: 3000, dSpecs: 8000, soldiers: 5000, draftRate: 'None',
                sot: { peasants: 0 } }));
assert(r.train.freeSpecs > 0 && r.train.dsp === r.train.freeSpecs, 'credit specs should be free when broke');

// 4b. Dark Elf trains thieves on credits — and a credit goes to a thief (saves 500) before a spec (350)
{
  const de = plan(prov({ race: 'Dark Elf', money: 0, credits: 1000, thieves: 0, dSpecs: 0, soldiers: 20000, draftRate: 'None' }),
                  { tpa: 1, dpa: 1 });                   // needs 2000 thieves + 2000 dspecs
  assert.strictEqual(de.train.freeThv, 1000, 'credits should buy thieves first');
  assert.strictEqual(de.train.freeSpecs, 0);
  const orc = plan(prov({ race: 'Orc', money: 0, credits: 1000, thieves: 0, dSpecs: 0, soldiers: 20000, draftRate: 'None' }),
                   { tpa: 1, dpa: 1 });
  assert.strictEqual(orc.train.freeThv, 0, 'only races allowed to may use credits on thieves');
  assert.strictEqual(orc.train.freeSpecs, 1000);
}

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
{
  const view = ctx._eoPlanText(r, false), pub = ctx._eoPlanText(r, true);
  assert(/\*\*Train\*\*/.test(view) && /in \d+ ticks/.test(view), 'planner view: tick counts');
  assert(/<t:\d+:R>/.test(pub) && !/in \d+ ticks/.test(pub), 'published: live Discord timestamps');
  assert(/Your build/.test(pub) && !/Raze/i.test(pub.split('Timeline')[0].replace('razing', '')), 'build = what to have, no raze list');
  assert(pub.length < 1900, 'fits one Discord message with the footer');
}
assert(!/~\d/.test(ctx._eoPlanText(r, true)), 'use ≈, not ~ (strikethrough risk in Discord)');

// 10. Build advice
{
  const sum = m => Object.values(m).reduce((a, b) => a + b, 0);
  // Mix always adds up to 100% and keeps the basics
  r = plan(prov({ money: 2e5 }), { guildPct: 12, towerPct: 16 });
  assert(r.build, 'a survey + enough time → build advice');
  assert(Math.abs(sum(r.build.mix) - 100) < 0.6, 'mix sums to 100, got ' + sum(r.build.mix));
  assert(r.build.mix.towers === 16 && r.build.mix.guilds >= 12);
  // Farms: production covers consumption at exit; Undead need none
  assert.strictEqual(plan(prov({ race: 'Undead' })).build.mix.farms, 0);
  const orc = plan(prov({ race: 'Orc' }));
  const people = 30000 + 0 + 6000 + 8000 + 10000 + 6000 + 4000;   // fixture population (no homes change assumed below)
  assert(orc.build.mix.farms > 0 && orc.build.mix.farms / 100 * 2000 * 60 >= people * 0.25 * 0.99, 'farms feed everyone');
  assert(plan(prov({ race: 'Dwarf' })).build.mix.farms > orc.build.mix.farms, 'dwarves eat more');
  // Dungeons: only what the prisoners fill (3000 prisoners / 30 = 100 acres = 5%)
  const pd = prov({}); pd.sot.prisoners = 3000; pd.survey.buildings.push(B('Dungeons', 12));
  assert.strictEqual(plan(pd).build.mix.dungeons, 5);
  // Spare gold: goal met → at least that much left; a bigger buffer needs more money acres
  const money = x => x.build.mix.banks;
  // Homes are leadership's number, the tool never adds its own; blank keeps the current homes
  assert.strictEqual(plan(prov({ money: 0, soldiers: 8000 })).build.mix.homes, 0);
  { const ph = prov(); ph.survey.buildings[1] = B('Homes', 7); assert.strictEqual(plan(ph).build.mix.homes, 7); }
  assert.strictEqual(plan(prov(), { homesPct: 10 }).build.mix.homes, 10);
  assert(plan(prov(), { homesPct: 10 }).draft.drafted > plan(prov()).draft.drafted, 'homes add people to draft');
  const a1 = plan(prov({ money: 0, soldiers: 8000 }), { spareGold: 0 });
  const a2 = plan(prov({ money: 0, soldiers: 8000 }), { spareGold: 3e6 });
  if (a2.build.goal === 'met') assert(a2.train.left >= 3e6 - 1, 'spare gold kept');
  assert(money(a2) >= money(a1), 'more spare gold → at least as many bank/home acres');
  // A rich province needs no banks or homes — the land goes to guilds/unis
  const rich = plan(prov({ money: 5e7 }));
  assert.strictEqual(money(rich), 0);
  assert(rich.build.mix.universities > 0);
  // WPA: a high target pushes guilds above the base %
  assert(plan(prov(), { wpa: 6 }).build.mix.guilds > plan(prov(), { wpa: 0 }).build.mix.guilds);
  // Wages: raising them earlier costs gold
  assert(plan(prov({ money: 0 }), { wageRaiseTicks: 80 }).gold.atTrain < plan(prov({ money: 0 }), { wageRaiseTicks: 0 }).gold.atTrain);
  // Rebuild on credits (default) costs no gold; off → razing and building cost gold
  // Leadership's credits cover building; acres beyond them, and razing, cost gold
  const many = plan(prov(), { buildCredits: 99999 }).build, none = plan(prov(), { buildCredits: 0 }).build;
  assert.strictEqual(many.overAcres, 0); assert.strictEqual(many.gcBuild, 0);
  assert.strictEqual(none.onCredits, 0); assert(none.overAcres === none.built && none.gcBuild > 0);
  const some = plan(prov(), { buildCredits: 100 }).build;
  assert.strictEqual(some.onCredits, 100); assert.strictEqual(some.overAcres, some.built - 100);
  assert(many.gcRaze > 0 && many.gcRaze === none.gcRaze, 'razing is gold either way');
  // Unis: blank → only leftovers; a reserved % is kept even when gold is short
  {
    const poor = prov({ money: 0, soldiers: 20000, peasants: 60000 });   // gold-limited: wants every bank acre
    const free = plan(poor), kept = plan(poor, { uniPct: 15 });
    assert(kept.build.mix.universities >= 15, 'reserved unis kept');
    assert(kept.build.mix.banks <= free.build.mix.banks, 'reserving unis can only leave fewer banks');
  }
  // Too little time left for a rebuild → no build advice, current build kept
  assert.strictEqual(plan(prov(), { ticks: 30 }).build, null);
}

// 11. Population regrowth
{
  // A war-shrunk province (well under 50% of max) gets +20% of max at once and refills
  const shrunk = prov({ peasants: 2000, soldiers: 0, oSpecs: 0, dSpecs: 4000, thieves: 2000, sot: { elites: 4000, wizards: 1000 } });
  r = plan(shrunk);
  assert(r.pop.pct < 50 && r.pop.instant === Math.round(0.20 * r.pop.max), 'instant +20% of max');
  assert(r.draft.drafted > 10000, 'refilled peasants get drafted');
  // Already late in the ceasefire: no instant boost, no ×11 births
  const late = plan(shrunk, { elapsedTicks: 40, ticks: 56 });
  assert.strictEqual(late.pop.instant, 0);
  assert(late.draft.drafted < r.draft.drafted);
  // Overpopulated: flagged
  assert(plan(prov({ peasants: 60000 })).warn.some(w => /overpopulated/.test(w)));   // 94k of 70k
}

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
