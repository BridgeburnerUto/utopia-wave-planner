# Wave Planner â€” Session Context

Paste-ready context for continuing work on the Utopia War Tools. Last updated 2026-07-28.

**Standing rule (2026-07-28): every session must end by summarizing what was done into this file.**

## The two tools

- **War Planner** (this repo) â€” bookmarklet injected into intel.utopia.site (IS). Must run in the
  IS context because the IS API has no CORS headers. `src/` is concatenated by `node build.js`
  into `dist/app.js`, deployed via GitHub Pages (repo bridgeburneruto/utopia-wave-planner).
- **War Companion** â€” standalone PWA (`war-companion.html`) served by the Cloud Run PHP backend
  (project `utopia-intel-bot`, service `utopia-intel`, europe-west1). Polls the backend every 90s.
  Backend source lives in `D:\Claude\utopia-intel-server`.

## Build & conventions (read before editing)

- **Always run `npm run build:prod`** (terser minify) after source edits â€” plain `node build.js`
  produces an unminified bundle; the committed `dist/app.js` is minified (~225 KB).
- Inline `onclick=""` handlers can only reach globals â€” route everything through
  `window.__wpA.*` (defined in `src/app.js`), never internal module functions.
- All shared in-memory state lives on the `S` object in `src/state.js`.
- **Age-varying game constants are centralized in `src/config.js`** under the
  "AGE-VARYING SOLVER CONSTANTS -- UPDATE EVERY AGE" block: `RACE_UNITS`,
  `PERS_ELITE_OFF_BONUS`, `PERS_OSPEC_OFF_BONUS`, `RACE_WAR_OSPEC_OFF_BONUS`,
  `FANATICISM_OFF_MULT`, `NW_OPTIMAL`, `NW_WAR_RANGE`, `GEN_OFF_BONUS`,
  `TM_GAIN` (land-gain curve), `RACE_POP_MULT`, `WAR_DOCTRINES`. Every consumer
  (utils/player/waveplan/kingdom/tmmatchup) references these -- a per-age update
  is a one-file edit here, not a grep hunt. The OME/DME mult tables stay EMPTY
  (SoT points already include efficiency). Per-age steps: edit this block from
  the "AGE nnn FINAL CHANGES" doc, then harness-verify.
- **Unit-strength offense bonuses** (General +2 elite, War Hero +2 ospec, Avian
  Dive Bomb +2 ospec) are applied ONLY in `waveplan.js:_wpUnitsOff`, the one
  place offense is rebuilt from raw unit counts (per-army wave slots). Everywhere
  else uses the API's `offPoints`, which already bakes them in -- never add them
  on top of `offPoints`/`offPointsHome` (double-count). New per-age unit bonuses
  go in the config tables above.
- **War doctrines are display-only.** Shared helpers in `utils.js`
  (`_wdRaceCounts`/`_wdStrength`/`_wdEffects`/`_wdSubtitle`/`_wdSummarySection`)
  render a per-province line + an "Active/Enemy War Doctrines" summary, strength
  scaled by same-race province count. Kingdom tab shows OWN doctrines; War Board
  (board.js) shows the ENEMY's. At war the API's `som.ome/dme` and off/def points
  already include the active doctrine, so `WAR_DOCTRINES` never feeds the offense
  math -- not even Orc's OME.
- Firestore access is plain REST (`src/firebase.js`): `fbWrite`, `fbGet`, `fbQuery`, `fbDelete`.
  Project `utopia-leaderboard`, rules wide open, docs keyed by `kdId` = own location with `:` â†’ `_`.
- Thresholds, webhook, API endpoint/key persist inside the war plan JSON (`warplan/{kdId}`) â€”
  new threshold keys must be added in three places: `state.js` defaults, the merge in
  `__wpA.init()` (app.js), and the reset object in `__wpA.clearPlan()` (app.js).
- IS SoT field names (verified from the IS bundle): `sot.soldiers`, `sot.food`, `sot.money`,
  `sot.runes`, `sot.peasants`, `sot.totalTroops`, `sot.thieves`, `sot.wizards`, `sot.offPoints`,
  `sot.defPoints`, `sot.opa`, `sot.dpa`, `sot.rTpa`, `sot.ruler`, `sot.personality`, `sot.badSpells`.

## Recent work (2026-07-28) -- Popspace graph DONE (harness-verified, NOT committed); Economy tab designed

### Popspace graph (built + harness-verified this session)
- **New "Popspace" view button** on the NW Graph tab (S.nwView = 'pop'), alongside Total/War NW.
- Per KD up to two lines: **capacity** (solid) and **current pop** (dashed, same color, 0.65 opacity).
- **Hybrid data source** (user-chosen): capacity baseline = land x 25 from the hourly
  `kd_nw_history` dump docs (works for ANY two KDs, full back-history already exists);
  where own war snapshots exist, the survey/race/science-precise value REPLACES the
  baseline in that hour (mixing both in one hour would zigzag by the race multiplier).
  Current-pop lines come only from war snapshots (world dump has no population).
- **utils.js refactor**: `_ownPopPct` split into shared `_provLivingSpace(prov)` ->
  {cap, precise} (raw LS x RACE_POP_MULT x housing science; precise = survey used;
  works for enemy provinces too -- they carry survey/sos when opped) and
  `_provCurrentPop(prov)` (peasants+troops+thieves+wizards). Behavior verified
  unchanged (Kingdom roster still shows 100-103% "needs acres" on the fixture).
  `_enemyPopPct` deliberately NOT upgraded to surveys (solver sort behavior untouched)
  -- possible future improvement.
- **snapshotNW() now also writes**: `eneLoc` (so a previous war's enemy values are never
  overlaid onto a different KD B -- overlay requires snap.eneLoc === graphed loc),
  `ownCap/ownPop/ownSurveyed/ownN`, `eneCap/enePop/eneSurveyed/eneN` (via new
  `_calcKdPopspace()`). Old snapshot docs lack these -> their enemy values are skipped.
- **SVG renderer generalized**: `_nwSvgGraph(times, series, opts)` in nwgraph.js renders
  N series ({vals, color, label, dash, opacity, width}); `opts.connectGaps` draws one
  continuous line through nulls (used by pop view; NW views keep gap-breaking segments).
  `_buildWorldGraph` now delegates to it; `_buildPopGraph` builds the pop view with
  summary cards: cap A/B + delta, Current Pop A vs B, Precision ("own 23/23 - eny 8/22
  provs surveyed" from the latest snapshot, or "acres x25 / no war snapshots in range").
- **Harness upgraded** (mockup/harness.html, gitignored): the Firestore `:runQuery` mock
  now parses the structuredQuery body and serves synthetic `kd_nw_history` (25 hourly
  docs per KD, hour-ALIGNED storedAt -- real batches share one storedAt; misaligned
  timestamps produce dots instead of lines) and `nw_snapshots` (13 war-tick docs with
  precise caps != land x 25 so the overlay is visible). Other collections still [].
- Verified in harness: Total NW view unchanged (2 polylines), Popspace view 4 polylines
  (2 dashed), correct legend/cards/precision, no console errors.

### Economy tab -- DONE (built + harness-verified 2026-07-28, NOT committed/live-tested)
- **New ECONOMY tab** (src/tabs/economy.js, between NW Graph and Alerts): own + enemy
  per-province tables (Peas, Empl% = jobs filled, Banks%, Arm%, Inc Sci, Gross/t,
  Wages/t, Net/t, flags), sorted by net DESC, with KD summary cards (gross/wages/net/
  precision) per section. **Header cards** `#__wpecon` next to the ritual badges:
  "Own Net X/t" / "Eny Net X/t" (~ marker when estimates involved), click -> tab.
  Rendered via renderEconBadges() after both renderRitualBadges() call sites in app.js.
- **Net = gross - army wages** (user decision). Formulas (utopiawiki.com Economy +
  Growth -- NOTE: NEW wiki, https://utopiawiki.com; old wiki.utopia-game.com has an
  EXPIRED CERT; fandom wiki paywalled):
  - jobs = built non-home acres x 25; employed = min(peasants, jobs)
  - raw = 3 x employed + 1 x unemployed + 0.75 x prisoners (+2.0 human Civil Admin)
          + bankAcres x 25 x BE (x1.25 Artisan Building Production)
  - %-buildings use x(1-x) curve: rate x pct x (1-pct/100) x BE, cap rate x 25
    (Banks rate 1.5 -> max 37.5% income; Armouries rate 2.0 -> max 50% wage cut)
  - gross = raw x (1+banks%) x (1+Alchemy sci) x (1+honor) x race x pers
  - wages = (specs x 0.5 + elites x 0.75) x (1-armoury%) x (1-Bookkeeping sci) x race
    (soldiers/mercs/horses unpaid; wage rate 20-200% NOT in intel -> assumed 100%)
  - honor income % from `p.title` (HONOR_INCOME_PCT table, approximate; War Hero x2)
- **Age 116 constants centralized in config.js** economy block: INCOME_PER_*,
  JOBS_PER_ACRE, BANK_FLAT_GC, BANK_INCOME_RATE, ARMOURY_WAGE_RATE, WAGE_PER_SPEC/
  ELITE, RACE_INCOME_MULT {human 1.30}, RACE_WAGE_MULT {human 1.25, avian 0.75},
  PERS_BANK_PROD_MULT {artisan 1.25}, HUMAN_PRISONER_EXTRA_GC, HONOR_INCOME_PCT.
  UPDATE EVERY AGE (source: AGE 116 FINAL CHANGES doc + utopiawiki).
- `sot.be` (a %) is used directly as BE. `sot.gcpa` is stockpiled gold per acre
  (gcpa x land ~= money), NOT income. Enemy has NO som -> wages from sot totals.
- **Missing intel handling** (user decision): no survey -> banks/armouries/homes = 0,
  row flagged with warning emoji, precision card counts "N est"; no SoT -> skipped.
  Plague flagged (emoji) but income effect NOT applied (multiplier unknown);
  dragons/rituals/Incite Riots/war-doctrine wage effects not modeled (v1).
- Harness-verified: 23 own + 22 enemy rows, humans top earners (sanity: 34k peas
  x3 x1.3 x~1.5 alch x1.06 baron ~= 213k/t matches), est flags on 14 unsurveyed
  enemy provs, badges "Own Net 1.9M/t / Eny Net 624k/t ~", no console errors,
  Board/NW Graph unaffected. Wired in build.js (tabs/economy.js), dom.js (tab
  button + content div + #__wpecon), app.js (tab list/render/badges).

## Recent work (2026-07-13/14) â€” committed & pushed 2026-07-14, NOT yet live-tested

### Kingdom Location Lock
Prevents a previous war's enemy from contaminating the current plan.
- Lock = allowed **enemy** location, stored in Firestore `meta/{kdId}_loc_lock`
  `{enemyLoc, setBy, setAt}`. Loaded in init/refresh after enemy load (`_loadLocLock`, app.js).
- Mismatch (`S.eLoc !== S.locLock`) â†’ one-time confirm dialog (`_maybeWarnLocLock`) + persistent
  banner `#__wplock` (dom.js, rendered by `_renderLocLockBanner`): red while blocked, amber when
  overridden. Override is session-only (`S.locLockOverride`).
- While mismatched and not overridden: `save()` re-confirms before writing; `syncBackend()`
  (2-min timer) pauses silently with a status message.
- UI: leader-only "Kingdom Location Lock" section in Alerts tab â€” input + ðŸ”’ Lock / âœ• Clear /
  "Lock to current enemy" (`__wpA.setLocLock/lockToCurrentEnemy/clearLocLock/overrideLocLock`).
- Alerts list: red LOCK alert on mismatch; info nudge when no lock is set during war.
- Desktop only by design (companion just displays what the backend has).

### Soldier stack alert ("Solds â†‘")
Alongside the other enemy resource threshold alerts.
- Threshold key: **`solds`** in `S.thresholds` (saved with war plan like the others).
- Settings row "Solds â†‘" in Alerts tab Enemy Kingdom section.
- Fires per enemy province when `p.sot.soldiers > thr.solds` â†’ SOLDS alert in `enemy_rich`
  group ("nightmares / meteor showers" hint).
- Discord: `enemy_soldiers` state-diff key in discord.js â€” ðŸª– embed, fires only for provinces
  newly above threshold, carried forward when enemy not loaded (same pattern as runes/gc/food).

## Testing notes
- The bookmarklet can only be tested inside intel.utopia.site with a logged-in session â€” reload
  the planner there after deploying.
- Game is in **age freeze** (between ages) as of 2026-07-14 â€” good window: lock can be tested by
  setting it to a location â‰  current `S.eLoc` (expect dialog + red banner + paused sync).

## Wave Planner solver â€” agreed design (2026-07-14, being built in stages)

Flip target selection: the whole wave is planned kingdom-wide as one ordered hit sequence;
each player's My Orders becomes their slice. Decisions (Q&A with war leader):

- **Who plans:** leader generates on the repurposed Summary tab (renamed Wave Plan, old
  content dropped), can reassign hits, then publishes.
- **Timing:** rolling by army return time. One slot per returning army, BUT armies returning
  within 1 hour merge into one slot. Flag "stray armies" (returns >1h apart) â€” leader may
  tell that player to hold the stray home. First wave degenerates to "everyone home now".
- **Solver priority:** coverage of leader-flagged targets (raze/mass honored) â†’ every hit
  in acceptable NW range (0.75â€“1.33, aim 0.90â€“1.10) â†’ maximize gains.
- **Simulation:** target land/NW drop per planned hit (reuse `_estimateTMGain`); attacker NW
  held static. Reserve big targets for late-returning high-NW attackers.
- **Fallbacks (out of range of all set targets):** high-off attacker â†’ in-range breakable
  non-target (fat pure-def province, never bloat); low-NW attacker â†’ least-bad set target,
  flagged marginal.
- **Max offense per attacker** (one big hit, all sendable generals â€” shows who can break walls):
  `(sot.offPoints âˆ’ withheldEliteOff) Ã— OME Ã— (1 + 0.05Ã—(sendableGensâˆ’1)) Ã— 1.05 fanaticism`.
  Fanaticism (+5% OME / âˆ’5% DME) assumed always cast. Elites problem: sot.offPoints counts
  elites even when a province keeps them home â†’ shared per-province "% of elites sent"
  setting (0â€“100, updatable mid-age).
- **Storage:** new ordered `waveSeq` in the war plan JSON; `assignedTo` derived from it for
  board/My Orders compat. **Publish also posts the full hitlist to Discord.**
- **My Orders:** when waveSeq exists, show the player's numbered hits ("you are #3, #7 of 24")
  with send timing; otherwise current behavior.

### VERIFIED API facts (2026-07-14, from real IS dump â€” IS itself was down)
Workaround while IS is down between ages: the Cloud Run backend keeps the last IS dump at
`gs://utopia-intel-bot-data/is_dumps/latest.json` (gcloud storage cp; svc.yaml maps it to
/mnt/data). A July-7 end-of-age dump verified everything:
- **sot.offPoints ALREADY includes full OME** (race, personality, science, honor, spells).
  Proven by per-race least-squares: offPoints â‰ˆ (units Ã— raw unit values) Ã— som.ome/100
  (elf fit residuals Â±2%). Same for defense (defPointsHome â‰ˆ Ã—dme). â‡’ NEVER multiply API
  points by OME/DME tables â€” RACE/PERSONALITY_*_MULT in config.js are now empty on purpose.
- `som.ome` / `som.dme` = efficiency percentages (e.g. 169 = 169%).
- `sot.elites/oSpecs/soldiers/dSpecs/horses/prisoners` = TOTAL unit counts (all locations).
- `som.standingArmy` = {generals, solds, oSpecs, elites, horses} â€” HOME only.
- `som.armiesAway[]` = {generals, solds, oSpecs, elites, horses, land, secondsRemaining,
  ambush} â€” full per-army breakdown, so stage-2 slots can compute per-army offense as
  units Ã— RACE_UNITS Ã— ome/100. `sot.generals` DOES NOT EXIST; total gens = standingArmy
  .generals + Î£ armiesAway[].generals.

### Offline test harness â€” mockup/harness.html (gitignored)
Replays the real dump against dist/app.js with fetch fully mocked (IS API wraps kingdom
responses as {kingdom, currentTick}; Firestore mocked; discord/run.app stubbed). Serve repo
root (launch.json "mockup", python http.server port 7788) â†’ open /mockup/harness.html.
Fixture: mockup/is_dump.json (real KD 5:2 vs 4:8 incl. saved war plan â€” good stage-2 data).
Browser-pane screenshots time out (pane quirk) â€” verify via javascript_tool/read_page instead.

### Stage 1 â€” DONE (built, harness-verified 2026-07-14, NOT committed, NOT live-tested)
calcMaxOff formula (corrected after dump verification):
`maxOff = (sot.offPoints âˆ’ eliteCount Ã— eliteRawOff Ã— (1âˆ’elitePct/100) Ã— ome/100)
          Ã— (1 + 0.05Ã—(sendableGensâˆ’1)) Ã— 1.05 fanaticism` â€” no OME multiplier on top.
Harness-verified: gens home+away, stray flag, elite % edit â†’ withheld off matches hand-calc.
- `config.js`: Age 116 tables from "Finals 116" doc â€” `RACE_UNITS` (unit off/def per race),
  `PERS_ELITE_OFF_BONUS` (General +2 elite off), `FANATICISM_OFF_MULT = 1.05`. Replaced the
  old FICTIONAL race/personality multipliers with real Age 116 ones: `RACE_OFF_MULT` now empty
  (no blanket race OME this age â€” was giving e.g. Avian a fake +20% in calcAttacks!),
  `PERSONALITY_OFF_MULT` = warrior 1.15 / necromancer 1.075, `RACE_DEF_MULT` = dryad 1.125,
  `PERSONALITY_DEF_MULT` = necromancer 1.075. UPDATE THESE EVERY AGE.
- New **KINGDOM tab** (`src/tabs/kingdom.js`): attacker roster sorted by NW â€” race/pers, gens
  (sendable), SoT off, elites, editable **Elite % Sent**, computed **Max Off (1 hit)** with
  full breakdown tooltip, armies away with return times + stray flag. Summary cards: KD total
  max off, tuned provinces, stray count.
- Shared settings: `meta/{kdId}_atk_settings` in Firestore, `{json, updatedAt, updatedBy}`,
  json = `{[slot]: {elitePct, eliteCount?, setAt}}`. Loaded in init/refresh (`loadAtkSettings`).
  `calcMaxOff(prov)` is the canonical max-off function â€” the stage-2 solver must use it.
- **UNVERIFIED against live SoM:** the elite-count field name (`_apiEliteCount` tries
  `elites`/`eliteUnits`/`elite` on standingArmy and armiesAway entries; falls back to manual
  input with amber warning). Also unverified: per-army offense/generals fields on armiesAway
  (needed for stage-2 slot model).

### Stage 2 â€” DONE (harness-verified 2026-07-14, committed, NOT live-tested)
- **`src/waveplan.js`** â€” solver. `buildWaveSlots()`: home slot + one per returning army
  (units Ã— RACE_UNITS Ã— ome Ã— fanaticism; elite % applied), merged when â‰¤1h apart
  (WP_SLOT_MERGE_SEC), stray flag otherwise; sorted by availableAt then NW DESC (big
  attackers pick first at the same time). `generateWaveSeq()`: greedy in slot order â€”
  raze/mass still needed â†’ uncovered flagged â†’ any in-range flagged by gain; reservation
  heuristic protects targets that are a later slot's only in-range option; fallbacks:
  in-range breakable wall (non-target, non-bloat) â†’ least-bad flagged marked `marginal`.
  Target simNW/simLand drop per hit (attacker NW static). `resimulateWaveSeq()` re-runs
  projections after manual edits. `postWaveSeqToDiscord()` chunks the hitlist into â‰¤10
  embeds (â‰¤3800 chars each) on one webhook message.
- **Wave Plan tab** (tabs/summary.js REWRITTEN, tab label WAVE PLAN, internal key still
  'summary', renderSummary â†’ renderWavePlan everywhere). Generate â†’ draft table (send
  time, attacker, target, range badge, type, gens, off sent, proj target NW, est gain)
  with per-hit reassign dropdown + remove (both resimulate); Publish (confirm dialog) â†’
  S.waveSeq into plan JSON (save/load/clearPlan wired in app.js), assignedTo derived per
  target from the seq, Discord hitlist posted when webhook set.
- Harness-verified end-to-end on the real dump: 35 slots/23 provinces, 81 hits, 3/3
  targets covered, ~21k acres est, reassign/remove/publish/Discord all exercised.
- Known simplifications: attacker NW static; defender losses not modeled; send times
  are offsets measured at generation (shown in UI); late big slots can end up with
  0-gain marginal hits once walls chain out of their range â€” leader should prune those.

**Generals refinement (same day, after leader Q&A):**
- Spare generals are SPREAD across a slot's hits after target selection â€” each extra gen
  on a hit means fewer raw troops sent (game applies +5%/extra gen to troops), so
  `sentOff = ceil((def+1) / (1 + 0.05Ã—(gensâˆ’1)))` (`_wpTroopsFor`). Extras go where they
  save the most troops. Send margin stays exact def+1 (leader's choice).
- **Ambush hold:** if after all sends the province keeps > `WP_AMBUSH_OFF_PCT` (20%) of
  the slot's offense home, one spare gen is held back for ambush (listed in warnings).
- **Pop% is a WARNING only** (never overrides leader flags): attacker pop <70% on a TM
  hit or >100% on raze/mass â†’ ðŸ  badge per hit + banner count. `_ownPopPct(prov)` moved
  from calcAttacks to utils.js (shared).
- calcAttacks/My Orders stays as the engine when no waveSeq is published + Max Gain mode.
- Harness-verified: 3-gen hit sends 276k vs 304k def (Ã—1.10 âœ“); ambush hold triggered on
  the low-off Faery.

**Dump pass + pop% refinement (same day, second leader Q&A):**
- Selection now depletes offense by `_wpTroopsFor(def, minGens)` (gen bonus counted), and a
  **dump pass** follows: leftover offense is spent on the best still-breakable enemy
  (targets+walls, range band â†’ enemy pop% â†’ gain), hits marked `dump: true` (â™» in UI +
  Discord " Â· dump"). "An attacker should not leave much, if any, offence at home during
  war." Ambush hold now only triggers when leftover can't break anything at all.
- **Enemy pop% priority**: all candidate sorts use `_wpByBandPopGain` â€” range band first,
  then enemy pop% DESC (fat enemies before thin), then gain. Never trades range for pop.
- **Own pop% flags (display only, never steer)**: <70% = "fat â€” raze/mass", â‰¥100% =
  "needs acres". Shown as Pop% column on Kingdom roster; wave-table ðŸ  warning fires
  only on mismatched hits (fat prov on TM, needs-acres prov on raze/mass).
- Harness-verified: 2 dump hits on small out-of-range walls; ambush warning correctly
  disappeared (offense spent instead); Pop% column shows 100â€“103% "needs acres" on the
  end-of-age dump.

**Defensive-elite fix (leader-spotted in mock):** pure-def provinces (Faery Mystics) were
counted as attackers because sot.offPoints includes their elites' small off value. Fix:
`_defaultElitePct(race)` â€” races whose elite is DEFENSIVE (off < def: Faery 4/16,
Halfling 10/13) default to 0% elites sent; offensive elites default 100%. Shared setting
still overrides per province (`_elitePctFor`). Plus `WP_MIN_SLOT_OFF = 1000` â€” slots under
that offense aren't attackers. Verified: Faeries drop to ~0 max off and out of the wave.

### Stage 3 â€” DONE (harness-verified 2026-07-14, committed & pushed)
- My Orders: when a published `S.waveSeq` exists (and Max Gain is off), `_buildWaveSlice()`
  (tabs/player.js) replaces the classic plan: numbered hits ("#12 of 77"), live countdowns
  computed from `waveGenAt + availableAt` so they age correctly, def / send-off / proj NW /
  est gain per hit, marginal/risky/wall/dump flags, raze-mass claim checkboxes, fresh-SoD
  reminder on repeat hits, required ops + leader notes, and a compact full-wave context
  table with the player's rows highlighted.
- No hits assigned â†’ "defense / ambush duty" message. calcAttacks stays the engine for
  no-plan/peacetime; âš¡ Max Gain toggle still overrides.
- syncBackend payload now includes `waveSeq`/`waveGenAt` (companion PWA can render the
  hitlist later â€” companion UI itself not yet built).

### Chain targets + wave types (2026-07-14, late â€” committed & pushed)
- **Chain goal**: War Board gets a "Chain âŒ–" column â€” leader sets target acres per enemy
  province (`S.provinces[slot].targetAcres`, persists in plan JSON; `setProvTargetAcres`).
  Solver priority is now rm â†’ **chain quota** (unmet chains pounded first â€” the wave is
  built around the chain) â†’ uncovered â†’ any flagged. Met chains drop to overflow (dump
  pool / last-resort only). `_wpChainStatus` reports progress; Wave Plan warnings show
  "â›“ Chain goal reached / incomplete: X only planned down to ~N acres (goal G, from F)"
  with EXACT acres (fK rounding hid 2050 vs 2000). Hits on chain targets get a â›“ badge
  with projected acres. `projLand` stored on every seq entry.
- **Wave types scaffold**: `S.waveType` ('standard' only so far â€” more types to be
  specified by the leader later). Dropdown on Wave Plan action bar (`setWaveType`),
  plumbed through `generateWaveSeq(waveType)` (no behavioral difference yet), persisted
  in plan JSON. New types = extend the dropdown + branch in the solver.
- **Bug fixed**: board.js `setProvWave` still called the renamed `renderSummary` â†’
  ReferenceError on every wave-assignment change since the stage-2 rename. Now
  `renderWavePlan`. (Found while adding the chain column; the harness path had never
  exercised a wave re-assignment.)

### Possible next steps (all optional)
- Economy v2: plague/dragon/riot/war-doctrine income-wage modifiers; honor pop bonus
  in _provLivingSpace; upgrade _enemyPopPct to surveys (changes solver sort!); net
  income graphed over time (user declined for v1).
- Define the additional wave types (leader will specify).
- Companion (war-companion.html): render waveSeq slice on mobile (data already synced).
- Live re-check at send time: compare planned def vs latest intel before "SEND NOW".
- Flag more targets in harness plan to demo a realistic war-start wave.

## Next up (roadmap remainder)
1. Wave Planner stages 2â€“3 (above).
2. Verify NW graph / âš” Find War with accumulated snapshots.
3. Pre-war planning mode (lift `_atWar()` gates, grey out ops in peace).
4. SN reminder in companion; armies-return countdown in Orders; push notifications;
   verify makeop.php with real game traffic.
