// ── TAB: ECONOMY ───────────────────────────────────────────────────────────
// Net income per province + KD totals for own and enemy kingdoms.
// Net = gross income − army wages (leader decision 2026-07-28).
//
// Formula (utopiawiki.com Economy/Growth + AGE 116 doc, constants in config.js):
//   jobs        = built non-home acres × JOBS_PER_ACRE
//   raw         = 3×employed + 1×unemployed + prisGc×prisoners + bankAcres×25×BE
//   gross       = raw × (1+banks%) × (1+Alchemy sci) × (1+honor) × race × pers
//                     × plague × dragon
//   wages       = (specs×0.5 + elites×0.75) × wageRate × (1−armoury%)
//                 × (1−Bookkeeping sci) × race × pers × (1−war doctrine) × dragon
//                 (wageRate source order: Military Advisor (ma.wages) → derived
//                  from the SoM's efficiency → old IS board → WAGE_RATE_ASSUMED)
//   %-building effects use the x·(1−x) curve: rate × pct × (1−pct/100) × BE.
//
// Race/personality modifiers come from the config tables (RACE_INCOME_MULT,
// RACE_WAGE_MULT, RACE_PRISONER_EXTRA_GC, PERS_INCOME_MULT, PERS_WAGE_MULT,
// PERS_BANK_PROD_MULT, PERS_HONOR_MULT) and are shown per province in the Mods
// column, which `_econMods` derives from those same lookups so the two cannot
// disagree. Race WAR DOCTRINES that touch the economy are kingdom-wide and
// applied per kingdom (`_econKdCtx`), at war only.
//
// Plague costs −15% income (PLAGUE_INCOME_MULT) and is flagged 🦠, except on
// races immune to it — Undead carries plague permanently and takes no hit.
// A dragon on the kingdom applies its DRAGON_ECON term (Age 116: Ruby +20%
// wages, Topaz −25% income) to every province in that kingdom.
// Provinces without a survey are estimated acres-only (banks/armouries/homes
// treated as 0) and flagged ⚠ est. Rituals and Incite Riots not modeled.

/**
 * Recover the wage rate from a SoM's military efficiency.
 * The SoM text states the wage rate outright ("Our wage rate is 100.0% of
 * normal levels"), but the IS API only exposes the efficiency it produces
 * (`som.eff`), so we invert the published curve:
 *   eff% = 33 + 67 × (wage%/100)^0.25   →   wage% = 100 × ((eff% − 33)/67)^4
 * Returns null when there is no usable efficiency reading.
 */
function _wageRateFromEff(eff) {
  if (!(eff > 0)) return null;
  const effPct = eff * 100;
  if (effPct <= MIL_EFF_BASE) return 0;
  const w = 100 * Math.pow((effPct - MIL_EFF_BASE) / MIL_EFF_WAGE_COEF, 1 / MIL_EFF_WAGE_EXP);
  return Math.min(WAGE_RATE_MAX, Math.round(w));
}

/** Wage% column styling per source: color, marker, tooltip. Order = precedence. */
const WAGE_SRC = {
  ma:      { c: '#b8c8c8', m: '',  t: 'Military Advisor intel — exact' },
  som:     { c: '#8fa8a8', m: '~', t: 'Derived from the SoM military efficiency. This is the '
             + 'EFFECTIVE wage rate, which trails the rate actually being paid by up to ~96h.' },
  oldis:   { c: '#7fd0a0', m: '',  t: 'Old IS board — exact paid rate. Used when there is no '
             + 'Military Advisor number and either no SoM or a SoM older than this reading '
             + '(age measured from the last run of scripts/oldis-collector.js)' },
  assumed: { c: '#617070', m: '*', t: 'Assumed — no Military Advisor intel, no SoM, no old IS data' },
};

/**
 * Exact paid wage rate collected from the OLD IS board (intel.utopia-game.com),
 * which parses it out of the SoM text — the number neither the new IS API nor
 * the efficiency inversion can give us. Pushed to Firestore by
 * scripts/oldis-collector.js, loaded into S.oldisEcon by _loadOldisEcon().
 * Last of the real sources by leader's choice: it is exact but manually
 * collected, so a live SoM of our own is preferred even though that one has to
 * be estimated.
 * `loc` is the kingdom the province belongs to; without it we cannot tell own
 * slot 7 from enemy slot 7, so no loc means no lookup.
 */
function _oldisWage(prov, loc) {
  if (!loc || prov?.slot == null) return null;
  const kd = S.oldisEcon?.[loc];
  const w  = kd?.provs?.[prov.slot]?.wagePct;
  if (!(w > 0)) return null;
  // Age is measured from when the collector RAN, which understates the true age
  // of the figure — the old IS was already showing intel of some age when it
  // was scraped. Its own per-province intel-age column is stored raw
  // (`intelRaw`) but its four fields are not identified yet, so it is not used.
  // The bias is acceptable here: this value is the EXACT paid rate, so letting
  // it win close calls against an inverted estimate is the right way to be
  // wrong.
  const ageSec = kd.updatedAt > 0 ? Math.max(0, (Date.now() - kd.updatedAt) / 1000) : null;
  return { pct: w, ageSec };
}

// ── Race / personality modifiers ─────────────────────────────────────────────

/** A multiplier as a signed percentage: 1.30 → "+30%", 0.75 → "−25%". */
function _econPct(v) {
  return (v > 1 ? '+' : '−') + Math.round(Math.abs(v - 1) * 100) + '%';
}

/**
 * Kingdom-wide military-wage cut from race war doctrines, as a percentage.
 * Active only while at war, and scaled by how many provinces of that race the
 * kingdom holds (Age 116: Avian, up to −12.5%).
 *
 * Doctrines are display-only everywhere else in the tool because the API's
 * som.ome/dme and off/def points already include them — but nothing reports
 * wages, this file computes them, so here the cut has to be applied by hand.
 * Summed across races in case a future age gives two of them a wage effect;
 * today only Avian has one.
 */
function _wdEconWageCut(provinces) {
  if (!_atWar()) return 0;
  const counts = _wdRaceCounts(provinces);
  let cut = 0;
  for (const r of Object.keys(counts)) {
    for (const e of (WAR_DOCTRINES[r]?.effects || [])) {
      if (e.label === WD_ECON_WAGE_LABEL && e.sign === '-') {
        cut += Math.min(e.cap, _wdStrength(r, counts[r]));
      }
    }
  }
  return cut;
}

/**
 * Economy effect of the dragon sitting on this kingdom, or null when there is
 * none. `kdEffects.dragon` is the type name and is '' when no dragon is on the
 * lands (the same test dragon.js uses). A dragon with no income/wage term
 * (Amethyst / Emerald / Sapphire) still returns an object so the tab can say
 * "no economy effect" out loud — silence would be indistinguishable from a
 * type name we failed to recognise.
 */
function _dragonEcon(kd) {
  const name = (kd?.kdEffects?.dragon || '').trim();
  if (!name) return null;
  const key = Object.keys(DRAGON_ECON).find(k => name.toLowerCase().includes(k));
  return { name, key: key || null, ticks: kd?.kdEffects?.dragonDuration ?? null,
           ...(key ? DRAGON_ECON[key] : {}) };
}

/** Kingdom-level context every province row in that kingdom shares.
 *  `kd` is the kingdom object (S.own / S.enemy) — needed for kdEffects. */
function _econKdCtx(provinces, kd) {
  return { wdWageCut: _wdEconWageCut(provinces), dragon: _dragonEcon(kd) };
}

/**
 * Every modifier actually in play for one province, as display chips. Read out
 * of the SAME config tables `_provEconomy` multiplies by, so the Mods column
 * can never drift from the Net column.
 * `good` = raises net income (a wage cut is good, a wage surcharge is not).
 * `kind` = 'racepers' (per-province race/personality — the only kind the KD
 * tally card counts), 'kd' (kingdom-wide, shown on the Wages card instead) or
 * 'status' (a condition the province happens to be in, e.g. plague).
 */
function _econMods(race, pers, o) {
  const m   = [];
  const pc  = _econPct;
  const add = (txt, good, title, kind) => m.push({ txt, good, title, kind: kind || 'racepers' });
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

  const ri = RACE_INCOME_MULT[race],    pi = PERS_INCOME_MULT[pers];
  const rw = RACE_WAGE_MULT[race],      pw = PERS_WAGE_MULT[pers];
  const bp = PERS_BANK_PROD_MULT[pers], hm = PERS_HONOR_MULT[pers];
  const pg = RACE_PRISONER_EXTRA_GC[race];

  if (ri) add(pc(ri) + ' inc',  ri > 1, `${cap(race)}: ${pc(ri)} income`);
  if (pi) add(pc(pi) + ' inc',  pi > 1, `${cap(pers)}: ${pc(pi)} income`);
  if (rw) add(pc(rw) + ' wage', rw < 1, `${cap(race)}: ${pc(rw)} military wages`);
  if (pw) add(pc(pw) + ' wage', pw < 1, `${cap(pers)}: ${pc(pw)} military wages`);
  if (bp) add('banks ×' + bp,   true,   `${cap(pers)}: ${pc(bp)} building production — banks' flat gc`);
  // Honor and prisoners only matter when the province actually has them.
  if (hm && o.honor)     add('honor ×' + hm, true,
    `${cap(pers)}: +100% honor effects — honor income doubled to ${o.honor.toFixed(0)}%`);
  if (pg && o.prisoners) add('pris +' + pg + 'gc', true,
    `${cap(race)}: Civil Administration — prisoners earn +${pg}gc/tick (${fK(o.prisoners)} held)`);
  if (o.wdWageCut) add('⚔ −' + o.wdWageCut.toFixed(1) + '% wage', true,
    'Race war doctrine, kingdom-wide while at war — military wage cost reduced', 'kd');
  // Plague: a status, but Undead's immunity to it is squarely a race modifier,
  // and an Undead province reads as plagued on EVERY SoT — so say plainly why
  // the 🦠 flag did not cost it anything.
  if (o.dragon?.incomeMult) add('🐉 ' + pc(o.dragon.incomeMult) + ' inc', false,
    `${o.dragon.name} dragon on this kingdom: ${pc(o.dragon.incomeMult)} income`, 'kd');
  if (o.dragon?.wageMult) add('🐉 ' + pc(o.dragon.wageMult) + ' wage', false,
    `${o.dragon.name} dragon on this kingdom: ${pc(o.dragon.wageMult)} military wages`, 'kd');
  if (o.plague && o.plagueImmune) add('🦠 immune', true,
    `${cap(race)}: Plague Immunity — carries plague permanently, takes no income hit`, 'status');
  else if (o.plague) add('🦠 ' + pc(PLAGUE_INCOME_MULT) + ' inc', false,
    `The Plague: ${pc(PLAGUE_INCOME_MULT)} income (tax collection)`, 'status');
  return m;
}

function _provEconomy(prov, loc, ctx) {
  const sot  = prov.sot || {};
  const land = prov.land || sot.land || 0;
  if (!(land > 0) || sot.peasants == null) return null;

  const be   = (sot.be || 100) / 100;
  const race = (prov.race || '').toLowerCase();
  const pers = (sot.personality || prov.personality || '').toLowerCase();

  const bArr = prov.survey?.buildings;
  const est  = !(bArr && bArr.length > 0);
  const pct  = name => {
    if (est) return 0;
    const e = bArr.find(b => b.name.toLowerCase() === name);
    return e ? (e.pctTot || 0) : 0;
  };
  const barrenPct = est ? 0 : (bArr.find(b => /barren/i.test(b.name))?.pctTot || 0);
  const homesPct  = pct('homes');
  const banksPct  = pct('banks');
  const armPct    = pct('armouries');

  // Employment — jobs come from built non-home acres only
  const builtAcres = land * Math.max(0, 100 - barrenPct - homesPct) / 100;
  const jobs       = builtAcres * JOBS_PER_ACRE;
  const peasants   = sot.peasants || 0;
  const employed   = Math.min(peasants, jobs);
  const unemployed = peasants - employed;

  const prisoners = sot.prisoners || 0;
  const prisGc    = INCOME_PER_PRISONER + (RACE_PRISONER_EXTRA_GC[race] || 0);
  const bankFlat  = land * banksPct / 100 * BANK_FLAT_GC * be * (PERS_BANK_PROD_MULT[pers] || 1);
  const raw = employed * INCOME_PER_EMPLOYED + unemployed * INCOME_PER_UNEMPLOYED
            + prisoners * prisGc + bankFlat;

  // x·(1−x) diminishing curve for %-effect buildings, hard-capped at rate×25
  const curve = (rate, p) => Math.min(rate * p * (1 - p / 100) * be, rate * 25);
  const bankPct = curve(BANK_INCOME_RATE, banksPct);
  const alch    = prov.sos?.books?.find(b => b.type === 'Alchemy')?.effect || 0;
  const book    = prov.sos?.books?.find(b => b.type === 'Bookkeeping')?.effect || 0;
  let honor     = HONOR_INCOME_PCT[(prov.title || '').toLowerCase()] ?? 0;
  honor *= (PERS_HONOR_MULT[pers] || 1);  // War Hero: +100% Honor Effects

  // Plague costs income unless the race is immune (Undead carries it always).
  const plague       = !!sot.plague;
  const plagueImmune = !!RACE_PLAGUE_IMMUNE[race];
  const plagueMult   = (plague && !plagueImmune) ? PLAGUE_INCOME_MULT : 1;

  const dragon = ctx?.dragon || null;   // kingdom-wide, null when none

  const gross = raw * (1 + bankPct / 100) * (1 + alch / 100) * (1 + honor / 100)
              * (RACE_INCOME_MULT[race] || 1) * (PERS_INCOME_MULT[pers] || 1)
              * plagueMult * (dragon?.incomeMult || 1);

  const specs    = (sot.oSpecs || 0) + (sot.dSpecs || 0);
  const elites   = sot.elites || 0;
  const wageBase = specs * WAGE_PER_SPEC + elites * WAGE_PER_ELITE;
  const armCut   = curve(ARMOURY_WAGE_RATE, armPct);
  // Wage rate, best source first (leader's order 2026-08-11 — the live IS
  // sources outrank the old IS because ours are current, while the old-IS
  // numbers are only as fresh as the last manual collection):
  //   'ma'  — Military Advisor number (own always, enemy when opped). NOTE: the
  //           IS ships a PLACEHOLDER ma block ({wages:0, draftTarget:0,
  //           credits:0}) on provinces never opped, so "no intel" must be
  //           tested as "not > 0", never as null — with a null test every
  //           un-opped enemy province read as 0% wages and paid zero wages.
  //   'som' — recovered from the SoM's military efficiency (_wageRateFromEff).
  //   'oldis' — exact paid rate scraped off the old IS board (_oldisWage).
  //   else  — WAGE_RATE_ASSUMED.
  const maWages  = prov.ma?.wages > 0 ? prov.ma.wages : null;
  const somWages = maWages == null ? _wageRateFromEff(prov.som?.eff) : null;
  const somAge   = prov.som?.ageSeconds;
  const oldIs    = maWages == null ? _oldisWage(prov, loc) : null;

  // When BOTH estimates exist, take the fresher reading rather than a fixed
  // winner: an exact old-IS figure from an hour ago beats an inverted estimate
  // off a three-day-old SoM, and vice versa. An unknown age on either side
  // counts as "older" — a reading we cannot date cannot be shown to be fresher.
  const oldIsFresher = !!oldIs
    && (somAge == null || (oldIs.ageSec != null && oldIs.ageSec < somAge));

  let wagePct, wageSrc;
  if (maWages != null)                    { wagePct = maWages;   wageSrc = 'ma'; }
  else if (somWages != null && !oldIsFresher) { wagePct = somWages; wageSrc = 'som'; }
  else if (oldIs)                         { wagePct = oldIs.pct; wageSrc = 'oldis'; }
  else if (somWages != null)              { wagePct = somWages;  wageSrc = 'som'; }
  else                                    { wagePct = WAGE_RATE_ASSUMED; wageSrc = 'assumed'; }

  const wageAge = wageSrc === 'som'   ? somAge
                : wageSrc === 'oldis' ? oldIs.ageSec : null;
  const wageRate  = wagePct / 100;
  const wdWageCut = ctx?.wdWageCut || 0;   // kingdom-wide race doctrine, at war
  const wages = wageBase * wageRate * (1 - armCut / 100) * (1 - book / 100)
              * (RACE_WAGE_MULT[race] || 1) * (PERS_WAGE_MULT[pers] || 1)
              * (1 - wdWageCut / 100) * (dragon?.wageMult || 1);

  return {
    gross: Math.round(gross), wages: Math.round(wages), net: Math.round(gross - wages),
    est, plague, plagueImmune, plagueApplied: plagueMult !== 1, race, pers,
    mods: _econMods(race, pers, { honor, prisoners, wdWageCut, plague, plagueImmune, dragon }),
    emplPct: jobs > 0 ? Math.min(100, Math.round(peasants / jobs * 100)) : null,
    banksPct, armPct, bankPct, armCut, alch, book, honor, wdWageCut,
    wagePct, wageSrc, wageAge, wageAssumed: wageSrc === 'assumed',
  };
}

/** KD totals — provinces without computable economy are skipped (nSkipped).
 *  `ctx` is derived from the same province list when not supplied. */
function _kdEconomy(provinces, loc, ctx, kd) {
  const c = ctx || _econKdCtx(provinces, kd);
  const t = { gross: 0, wages: 0, net: 0, nEst: 0, n: 0, nSkipped: 0, wdWageCut: c.wdWageCut };
  for (const p of provinces || []) {
    const e = _provEconomy(p, loc, c);
    if (!e) { t.nSkipped++; continue; }
    t.gross += e.gross; t.wages += e.wages; t.net += e.net;
    if (e.est) t.nEst++;
    t.n++;
  }
  return t;
}

// ── Header cards (like the ritual badges) ────────────────────────────────────

function renderEconBadges() {
  const el = $id('__wpecon');
  if (!el) return;
  const mk = (label, tot, color) => {
    if (!tot || !tot.n) return '';
    const estMark = tot.nEst ? ' <span style="color:#e09040" title="' + tot.nEst + ' provinces estimated (no survey)">~</span>' : '';
    return `<div class="wkb" onclick="__wpA.tab('economy')" style="cursor:pointer" title="Net income per tick (gross − wages). Click for the Economy tab.">
      <div class="l">${label}</div>
      <div class="v" style="color:${color};font-family:monospace">${fK(tot.net)}/t${estMark}</div>
    </div>`;
  };
  el.innerHTML = mk('Own Net', _kdEconomy(S.own?.provinces, S.own?.location, null, S.own), '#60C040')
               + mk('Eny Net', _kdEconomy(S.enemy?.provinces, S.eLoc, null, S.enemy), '#ffd400');
}

// ── Tab render ───────────────────────────────────────────────────────────────

function _econSection(title, provinces, accent, loc, kd) {
  if (!provinces?.length) {
    return `${sectionHead(title)}<div style="color:#7a9090;font-size:17px;font-style:italic;padding:6px 0 18px">No data loaded.</div>`;
  }
  const ctx  = _econKdCtx(provinces, kd);
  const tot  = _kdEconomy(provinces, loc, ctx);
  const rows = provinces
    .map(p => ({ p, e: _provEconomy(p, loc, ctx) }))
    .filter(r => r.e)
    .sort((a, b) => b.e.net - a.e.net);

  const nOld = rows.filter(r => r.e.wageSrc === 'oldis').length;
  const nSom = rows.filter(r => r.e.wageSrc === 'som').length;
  const nAsm = rows.filter(r => r.e.wageSrc === 'assumed').length;
  const wageNote = [
    nSom ? nSom + ' rate~ from SoM' : '',
    nOld ? nOld + ' from old IS' : '',
    nAsm ? nAsm + ' assumed*' : '',
  ].filter(Boolean).join(' · ') || 'rates from Mil Advisor';
  // Plague is a status rather than a race/pers modifier, so it gets counted on
  // the Gross card instead of the Mods tally. Immune carriers (Undead) are
  // called out separately — they show 🦠 but cost nothing.
  const nPlague = rows.filter(r => r.e.plagueApplied).length;
  const nImmune = rows.filter(r => r.e.plague && r.e.plagueImmune).length;
  const plagueNote = (nPlague || nImmune) ? `<div class="s">`
    + (nPlague ? `<span style="color:#E05050" title="The Plague — −15% income, applied">🦠 ${nPlague} plagued</span>` : '')
    + (nPlague && nImmune ? ' · ' : '')
    + (nImmune ? `<span style="color:#7a9090" title="Carries plague but is immune to it (Undead) — no income effect">${nImmune} immune</span>` : '')
    + `</div>` : '';

  // Dragon: kingdom-wide, so it goes on whichever card it actually moves. A
  // dragon with no economy term is still announced — otherwise "no line" would
  // mean both "harmless dragon" and "type name we did not recognise".
  const drg = ctx.dragon;
  const drgLine = (txt, tip) => `<div class="s" style="color:#E05050" title="${esc(tip)}">🐉 ${esc(drg.name)} ${txt}</div>`;
  const drgTicks  = drg?.ticks != null ? ` — ${drg.ticks} ticks left` : '';
  const drgIncNote = drg?.incomeMult
    ? drgLine(_econPct(drg.incomeMult) + ' income', `${drg.name} dragon on this kingdom${drgTicks}`) : '';
  const drgWageNote = drg?.wageMult
    ? drgLine(_econPct(drg.wageMult) + ' wages', `${drg.name} dragon on this kingdom${drgTicks}`) : '';
  const drgNoneNote = (drg && !drg.incomeMult && !drg.wageMult)
    ? `<div class="s" style="color:#7a9090" title="${esc(drg.name + ' has no income or wage effect' + drgTicks
        + '. If you expected one, its name may not match the DRAGON_ECON table in config.js.')}">🐉 ${esc(drg.name)} — no economy effect</div>`
    : '';

  const wdNote = ctx.wdWageCut
    ? `<div class="s" style="color:#60C040" title="Race war doctrine, kingdom-wide while at war — already applied to every province's wages">⚔ −${ctx.wdWageCut.toFixed(1)}% war doctrine</div>`
    : '';

  // Which race/personality modifiers this kingdom actually fields, and how many
  // provinces carry each — the KD-level answer to the per-province Mods column.
  const modTally = new Map();
  for (const { e } of rows) {
    for (const m of e.mods) {
      if (m.kind !== 'racepers') continue;   // 'kd' → Wages card, 'status' → Gross card
      const k = m.txt;
      modTally.set(k, { n: (modTally.get(k)?.n || 0) + 1, good: m.good, title: m.title });
    }
  }
  const modCard = modTally.size
    ? [...modTally.entries()].sort((a, b) => b[1].n - a[1].n).map(([txt, v]) =>
        `<div title="${esc(v.title)}"><span style="color:${v.good ? '#60C040' : '#E05050'}">${esc(txt)}</span>`
        + `<span style="color:#7a9090"> ×${v.n}</span></div>`).join('')
    : '<div style="color:#617070">none this kingdom</div>';

  const cards = `
    <div class="wsum" style="margin-bottom:10px">
      <div class="wscard"><div class="l">Gross / tick</div><div class="v">${fK(tot.gross)}</div><div class="s">${tot.n} provinces</div>${plagueNote}${drgIncNote}${drgNoneNote}</div>
      <div class="wscard"><div class="l">Wages / tick</div><div class="v" style="color:#E05050">−${fK(tot.wages)}</div>
        <div class="s">${wageNote}</div>${wdNote}${drgWageNote}</div>
      <div class="wscard"><div class="l">Net / tick</div><div class="v" style="color:${accent}">${fK(tot.net)}</div><div class="s">${fK(tot.net * 24)} / real day (24t)</div></div>
      <div class="wscard"><div class="l">Precision</div><div class="v" style="font-size:21px">${tot.n - tot.nEst}/${tot.n} sv</div>
        <div class="s">${tot.nEst ? tot.nEst + ' est (no survey)' : 'all surveyed'}${tot.nSkipped ? ' · ' + tot.nSkipped + ' no SoT' : ''}</div></div>
      <div class="wscard"><div class="l">Race / Pers Mods</div>
        <div style="font-size:17px;line-height:1.5;margin-top:2px">${modCard}</div></div>
    </div>`;

  const tr = rows.map(({ p, e }) => {
    const flags = (e.est ? '<span title="No survey — banks/armouries/homes assumed 0">⚠</span>' : '')
                + (e.plague ? ` <span title="${e.plagueImmune
                    ? 'Carries plague but is immune to it (Undead) — no income effect'
                    : 'The Plague — −15% income, applied'}">🦠</span>` : '');
    const nCol = e.net >= 0 ? '#60C040' : '#E05050';
    const mods = e.mods.length
      ? e.mods.map(m => `<span title="${esc(m.title)}" style="display:inline-block;font-size:13px;`
          + `padding:1px 5px;margin:1px;border-radius:2px;white-space:nowrap;`
          + `border:1px solid ${m.good ? 'rgba(96,192,64,.35)' : 'rgba(224,80,80,.35)'};`
          + `color:${m.good ? '#60C040' : '#E05050'}">${esc(m.txt)}</span>`).join('')
      : '<span style="color:#617070">—</span>';
    return `<tr>
      <td style="padding:6px 10px">[${p.slot}] ${esc(p.name || '')}</td>
      <td style="padding:6px 10px;color:#b8c8c8">${esc(p.race || '')}</td>
      <td style="padding:6px 10px;color:#8fa8a8">${esc(e.pers || '—')}</td>
      <td style="padding:6px 10px;text-align:right">${fK(p.sot?.peasants || 0)}</td>
      <td style="padding:6px 10px;text-align:right;color:#7a9090">${e.emplPct != null ? e.emplPct + '%' : '—'}</td>
      <td style="padding:6px 10px;text-align:right;color:#7a9090">${e.est ? '—' : e.banksPct.toFixed(1) + '%'}</td>
      <td style="padding:6px 10px;text-align:right;color:#7a9090">${e.est ? '—' : e.armPct.toFixed(1) + '%'}</td>
      <td style="padding:6px 10px;text-align:right;color:${WAGE_SRC[e.wageSrc].c}" title="${WAGE_SRC[e.wageSrc].t}${e.wageAge != null ? ' — ' + fA(e.wageAge) + ' old' : ''}">${e.wagePct}%${WAGE_SRC[e.wageSrc].m}</td>
      <td style="padding:6px 10px;text-align:right;color:#7a9090">${e.alch ? '+' + e.alch.toFixed(1) + '%' : '—'}</td>
      <td style="padding:6px 10px;line-height:1.7">${mods}</td>
      <td style="padding:6px 10px;text-align:right">${fK(e.gross)}</td>
      <td style="padding:6px 10px;text-align:right;color:#E05050">−${fK(e.wages)}</td>
      <td style="padding:6px 10px;text-align:right;color:${nCol};font-weight:700">${fK(e.net)}</td>
      <td style="padding:6px 10px;font-size:15px">${flags}</td>
    </tr>`;
  }).join('');

  const th = t => `<th style="padding:7px 10px;text-align:right;color:#7a9090;font-size:15px;letter-spacing:1px;text-transform:uppercase">${t}</th>`;
  const thL = (t, tip) => `<th style="padding:7px 10px;text-align:left;color:#7a9090;font-size:15px;letter-spacing:1px;text-transform:uppercase"${tip ? ` title="${esc(tip)}"` : ''}>${t}</th>`;
  return `${sectionHead(title)}${cards}
    <div style="overflow-x:auto;margin-bottom:22px">
    <table style="width:100%;border-collapse:collapse;font-size:17px">
      <thead><tr style="border-bottom:1px solid #617070">
        ${thL('Province')}${thL('Race')}${thL('Pers')}
        ${th('Peas')}${th('Empl')}${th('Banks')}${th('Arm')}${th('Wage%')}${th('Inc Sci')}
        ${thL('Mods', 'Race and personality economy modifiers applied to this province (hover a chip for the source). Green raises net income, red lowers it.')}
        ${th('Gross/t')}${th('Wages/t')}${th('Net/t')}
        <th></th>
      </tr></thead>
      <tbody>${tr}</tbody>
    </table></div>`;
}

function renderEconomy() {
  const el = $id('__wpc_economy');
  if (!el) return;
  const isEnemy = S.econView !== 'own';
  renderTab('__wpc_economy', () =>
    `<div style="display:flex;align-items:center;gap:6px;margin-bottom:12px">
      <span style="font-size:17px;color:#7a9090;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-right:4px">Kingdom</span>
      <button class="wb${isEnemy ? ' g' : ''}" style="font-size:17px;padding:3px 12px" onclick="__wpA.econView('enemy')">Enemy${S.eLoc ? ' (' + esc(S.eLoc) + ')' : ''}</button>
      <button class="wb${!isEnemy ? ' g' : ''}" style="font-size:17px;padding:3px 12px" onclick="__wpA.econView('own')">Own${S.own?.location ? ' (' + esc(S.own.location) + ')' : ''}</button>
    </div>
    <div style="font-size:15px;color:#7a9090;margin-bottom:12px">
      Net = gross income − army wages, per tick. Wage rate: Military Advisor intel where
      available, else ~ = recovered from the SoM's military efficiency (effective rate, trails
      the paid rate by up to ~96h), else the old IS board's exact figure where it has been
      collected, else ${WAGE_RATE_ASSUMED}%* assumed. <b style="color:#8fa8a8">Mods</b> = the
      race/personality modifiers applied to that province, plus the kingdom-wide race war
      doctrine (⚔, at war only — Avian's military-wage cut this age). Dwarf's building
      efficiency and the science bonuses are already inside the reported BE and book effects,
      so they are not applied again. 🦠 = plague, −15% income — except on Undead, which
      carries plague permanently and is immune to it. 🐉 = a dragon on that kingdom
      (Ruby +20% wages, Topaz −25% income; the other three have no economy effect).
      Rituals and Incite Riots not modeled. ⚠ = no survey (banks/armouries as 0, est).
    </div>`
    + (isEnemy
      ? _econSection('ENEMY KINGDOM' + (S.eLoc ? ` (${S.eLoc})` : ''), S.enemy?.provinces, '#ffd400', S.eLoc, S.enemy)
      : _econSection('OWN KINGDOM' + (S.own?.location ? ` (${S.own.location})` : ''), S.own?.provinces, '#60C040', S.own?.location, S.own)));
  renderEconBadges();
}
