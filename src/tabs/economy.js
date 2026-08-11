// ── TAB: ECONOMY ───────────────────────────────────────────────────────────
// Net income per province + KD totals for own and enemy kingdoms.
// Net = gross income − army wages (leader decision 2026-07-28).
//
// Formula (utopiawiki.com Economy/Growth + AGE 116 doc, constants in config.js):
//   jobs        = built non-home acres × JOBS_PER_ACRE
//   raw         = 3×employed + 1×unemployed + prisGc×prisoners + bankAcres×25×BE
//   gross       = raw × (1+banks%) × (1+Alchemy sci) × (1+honor) × race × pers
//   wages       = (specs×0.5 + elites×0.75) × wageRate × (1−armoury%)
//                 × (1−Bookkeeping sci) × race × pers
//                 (wageRate source order: Military Advisor (ma.wages) → derived
//                  from the SoM's efficiency → old IS board → WAGE_RATE_ASSUMED)
//   %-building effects use the x·(1−x) curve: rate × pct × (1−pct/100) × BE.
// Provinces without a survey are estimated acres-only (banks/armouries/homes
// treated as 0) and flagged ⚠ est. Plague is flagged 🦠 but its income effect
// is NOT applied (multiplier unknown). Dragons/rituals/riots not modeled.

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

function _provEconomy(prov, loc) {
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
  const prisGc    = INCOME_PER_PRISONER + (race === 'human' ? HUMAN_PRISONER_EXTRA_GC : 0);
  const bankFlat  = land * banksPct / 100 * BANK_FLAT_GC * be * (PERS_BANK_PROD_MULT[pers] || 1);
  const raw = employed * INCOME_PER_EMPLOYED + unemployed * INCOME_PER_UNEMPLOYED
            + prisoners * prisGc + bankFlat;

  // x·(1−x) diminishing curve for %-effect buildings, hard-capped at rate×25
  const curve = (rate, p) => Math.min(rate * p * (1 - p / 100) * be, rate * 25);
  const bankPct = curve(BANK_INCOME_RATE, banksPct);
  const alch    = prov.sos?.books?.find(b => b.type === 'Alchemy')?.effect || 0;
  const book    = prov.sos?.books?.find(b => b.type === 'Bookkeeping')?.effect || 0;
  let honor     = HONOR_INCOME_PCT[(prov.title || '').toLowerCase()] ?? 0;
  if (pers === 'war hero') honor *= 2;  // +100% Honor Effects

  const gross = raw * (1 + bankPct / 100) * (1 + alch / 100) * (1 + honor / 100)
              * (RACE_INCOME_MULT[race] || 1) * (PERS_INCOME_MULT[pers] || 1);

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
  const wageRate = wagePct / 100;
  const wages = wageBase * wageRate * (1 - armCut / 100) * (1 - book / 100)
              * (RACE_WAGE_MULT[race] || 1) * (PERS_WAGE_MULT[pers] || 1);

  return {
    gross: Math.round(gross), wages: Math.round(wages), net: Math.round(gross - wages),
    est, plague: !!sot.plague,
    emplPct: jobs > 0 ? Math.min(100, Math.round(peasants / jobs * 100)) : null,
    banksPct, armPct, bankPct, armCut, alch, book, honor,
    wagePct, wageSrc, wageAge, wageAssumed: wageSrc === 'assumed',
  };
}

/** KD totals — provinces without computable economy are skipped (nSkipped). */
function _kdEconomy(provinces, loc) {
  const t = { gross: 0, wages: 0, net: 0, nEst: 0, n: 0, nSkipped: 0 };
  for (const p of provinces || []) {
    const e = _provEconomy(p, loc);
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
  el.innerHTML = mk('Own Net', _kdEconomy(S.own?.provinces, S.own?.location), '#60C040')
               + mk('Eny Net', _kdEconomy(S.enemy?.provinces, S.eLoc), '#ffd400');
}

// ── Tab render ───────────────────────────────────────────────────────────────

function _econSection(title, provinces, accent, loc) {
  if (!provinces?.length) {
    return `${sectionHead(title)}<div style="color:#7a9090;font-size:17px;font-style:italic;padding:6px 0 18px">No data loaded.</div>`;
  }
  const tot  = _kdEconomy(provinces, loc);
  const rows = provinces
    .map(p => ({ p, e: _provEconomy(p, loc) }))
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

  const cards = `
    <div class="wsum" style="margin-bottom:10px">
      <div class="wscard"><div class="l">Gross / tick</div><div class="v">${fK(tot.gross)}</div><div class="s">${tot.n} provinces</div></div>
      <div class="wscard"><div class="l">Wages / tick</div><div class="v" style="color:#E05050">−${fK(tot.wages)}</div>
        <div class="s">${wageNote}</div></div>
      <div class="wscard"><div class="l">Net / tick</div><div class="v" style="color:${accent}">${fK(tot.net)}</div><div class="s">${fK(tot.net * 24)} / real day (24t)</div></div>
      <div class="wscard"><div class="l">Precision</div><div class="v" style="font-size:21px">${tot.n - tot.nEst}/${tot.n} sv</div>
        <div class="s">${tot.nEst ? tot.nEst + ' est (no survey)' : 'all surveyed'}${tot.nSkipped ? ' · ' + tot.nSkipped + ' no SoT' : ''}</div></div>
    </div>`;

  const tr = rows.map(({ p, e }) => {
    const flags = (e.est ? '<span title="No survey — banks/armouries/homes assumed 0">⚠</span>' : '')
                + (e.plague ? ' <span title="Plague (income effect not modeled)">🦠</span>' : '');
    const nCol = e.net >= 0 ? '#60C040' : '#E05050';
    return `<tr>
      <td style="padding:6px 10px">[${p.slot}] ${esc(p.name || '')}</td>
      <td style="padding:6px 10px;color:#b8c8c8">${esc(p.race || '')}</td>
      <td style="padding:6px 10px;text-align:right">${fK(p.sot?.peasants || 0)}</td>
      <td style="padding:6px 10px;text-align:right;color:#7a9090">${e.emplPct != null ? e.emplPct + '%' : '—'}</td>
      <td style="padding:6px 10px;text-align:right;color:#7a9090">${e.est ? '—' : e.banksPct.toFixed(1) + '%'}</td>
      <td style="padding:6px 10px;text-align:right;color:#7a9090">${e.est ? '—' : e.armPct.toFixed(1) + '%'}</td>
      <td style="padding:6px 10px;text-align:right;color:${WAGE_SRC[e.wageSrc].c}" title="${WAGE_SRC[e.wageSrc].t}${e.wageAge != null ? ' — ' + fA(e.wageAge) + ' old' : ''}">${e.wagePct}%${WAGE_SRC[e.wageSrc].m}</td>
      <td style="padding:6px 10px;text-align:right;color:#7a9090">${e.alch ? '+' + e.alch.toFixed(1) + '%' : '—'}</td>
      <td style="padding:6px 10px;text-align:right">${fK(e.gross)}</td>
      <td style="padding:6px 10px;text-align:right;color:#E05050">−${fK(e.wages)}</td>
      <td style="padding:6px 10px;text-align:right;color:${nCol};font-weight:700">${fK(e.net)}</td>
      <td style="padding:6px 10px;font-size:15px">${flags}</td>
    </tr>`;
  }).join('');

  const th = t => `<th style="padding:7px 10px;text-align:right;color:#7a9090;font-size:15px;letter-spacing:1px;text-transform:uppercase">${t}</th>`;
  return `${sectionHead(title)}${cards}
    <div style="overflow-x:auto;margin-bottom:22px">
    <table style="width:100%;border-collapse:collapse;font-size:17px">
      <thead><tr style="border-bottom:1px solid #617070">
        <th style="padding:7px 10px;text-align:left;color:#7a9090;font-size:15px;letter-spacing:1px;text-transform:uppercase">Province</th>
        <th style="padding:7px 10px;text-align:left;color:#7a9090;font-size:15px;letter-spacing:1px;text-transform:uppercase">Race</th>
        ${th('Peas')}${th('Empl')}${th('Banks')}${th('Arm')}${th('Wage%')}${th('Inc Sci')}${th('Gross/t')}${th('Wages/t')}${th('Net/t')}
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
      collected, else ${WAGE_RATE_ASSUMED}%* assumed. Dragons, rituals, riots and plague income
      effects not modeled. ⚠ = no survey (banks/armouries as 0, est).
    </div>`
    + (isEnemy
      ? _econSection('ENEMY KINGDOM' + (S.eLoc ? ` (${S.eLoc})` : ''), S.enemy?.provinces, '#ffd400', S.eLoc)
      : _econSection('OWN KINGDOM' + (S.own?.location ? ` (${S.own.location})` : ''), S.own?.provinces, '#60C040', S.own?.location)));
  renderEconBadges();
}
