# Wave Planner — Session Context

Paste-ready context for continuing work on the Utopia War Tools. Last updated 2026-07-14 (evening).

## The two tools

- **War Planner** (this repo) — bookmarklet injected into intel.utopia.site (IS). Must run in the
  IS context because the IS API has no CORS headers. `src/` is concatenated by `node build.js`
  into `dist/app.js`, deployed via GitHub Pages (repo bridgeburneruto/utopia-wave-planner).
- **War Companion** — standalone PWA (`war-companion.html`) served by the Cloud Run PHP backend
  (project `utopia-intel-bot`, service `utopia-intel`, europe-west1). Polls the backend every 90s.
  Backend source lives in `C:\Users\Helmer\AppData\Local\Google\Cloud SDK\Claude folder`.

## Build & conventions (read before editing)

- **Always run `npm run build:prod`** (terser minify) after source edits — plain `node build.js`
  produces an unminified bundle; the committed `dist/app.js` is minified (~225 KB).
- Inline `onclick=""` handlers can only reach globals — route everything through
  `window.__wpA.*` (defined in `src/app.js`), never internal module functions.
- All shared in-memory state lives on the `S` object in `src/state.js`.
- Firestore access is plain REST (`src/firebase.js`): `fbWrite`, `fbGet`, `fbQuery`, `fbDelete`.
  Project `utopia-leaderboard`, rules wide open, docs keyed by `kdId` = own location with `:` → `_`.
- Thresholds, webhook, API endpoint/key persist inside the war plan JSON (`warplan/{kdId}`) —
  new threshold keys must be added in three places: `state.js` defaults, the merge in
  `__wpA.init()` (app.js), and the reset object in `__wpA.clearPlan()` (app.js).
- IS SoT field names (verified from the IS bundle): `sot.soldiers`, `sot.food`, `sot.money`,
  `sot.runes`, `sot.peasants`, `sot.totalTroops`, `sot.thieves`, `sot.wizards`, `sot.offPoints`,
  `sot.defPoints`, `sot.opa`, `sot.dpa`, `sot.rTpa`, `sot.ruler`, `sot.personality`, `sot.badSpells`.

## Recent work (2026-07-13/14) — committed & pushed 2026-07-14, NOT yet live-tested

### Kingdom Location Lock
Prevents a previous war's enemy from contaminating the current plan.
- Lock = allowed **enemy** location, stored in Firestore `meta/{kdId}_loc_lock`
  `{enemyLoc, setBy, setAt}`. Loaded in init/refresh after enemy load (`_loadLocLock`, app.js).
- Mismatch (`S.eLoc !== S.locLock`) → one-time confirm dialog (`_maybeWarnLocLock`) + persistent
  banner `#__wplock` (dom.js, rendered by `_renderLocLockBanner`): red while blocked, amber when
  overridden. Override is session-only (`S.locLockOverride`).
- While mismatched and not overridden: `save()` re-confirms before writing; `syncBackend()`
  (2-min timer) pauses silently with a status message.
- UI: leader-only "Kingdom Location Lock" section in Alerts tab — input + 🔒 Lock / ✕ Clear /
  "Lock to current enemy" (`__wpA.setLocLock/lockToCurrentEnemy/clearLocLock/overrideLocLock`).
- Alerts list: red LOCK alert on mismatch; info nudge when no lock is set during war.
- Desktop only by design (companion just displays what the backend has).

### Soldier stack alert ("Solds ↑")
Alongside the other enemy resource threshold alerts.
- Threshold key: **`solds`** in `S.thresholds` (saved with war plan like the others).
- Settings row "Solds ↑" in Alerts tab Enemy Kingdom section.
- Fires per enemy province when `p.sot.soldiers > thr.solds` → SOLDS alert in `enemy_rich`
  group ("nightmares / meteor showers" hint).
- Discord: `enemy_soldiers` state-diff key in discord.js — 🪖 embed, fires only for provinces
  newly above threshold, carried forward when enemy not loaded (same pattern as runes/gc/food).

## Testing notes
- The bookmarklet can only be tested inside intel.utopia.site with a logged-in session — reload
  the planner there after deploying.
- Game is in **age freeze** (between ages) as of 2026-07-14 — good window: lock can be tested by
  setting it to a location ≠ current `S.eLoc` (expect dialog + red banner + paused sync).

## Wave Planner solver — agreed design (2026-07-14, being built in stages)

Flip target selection: the whole wave is planned kingdom-wide as one ordered hit sequence;
each player's My Orders becomes their slice. Decisions (Q&A with war leader):

- **Who plans:** leader generates on the repurposed Summary tab (renamed Wave Plan, old
  content dropped), can reassign hits, then publishes.
- **Timing:** rolling by army return time. One slot per returning army, BUT armies returning
  within 1 hour merge into one slot. Flag "stray armies" (returns >1h apart) — leader may
  tell that player to hold the stray home. First wave degenerates to "everyone home now".
- **Solver priority:** coverage of leader-flagged targets (raze/mass honored) → every hit
  in acceptable NW range (0.75–1.33, aim 0.90–1.10) → maximize gains.
- **Simulation:** target land/NW drop per planned hit (reuse `_estimateTMGain`); attacker NW
  held static. Reserve big targets for late-returning high-NW attackers.
- **Fallbacks (out of range of all set targets):** high-off attacker → in-range breakable
  non-target (fat pure-def province, never bloat); low-NW attacker → least-bad set target,
  flagged marginal.
- **Max offense per attacker** (one big hit, all sendable generals — shows who can break walls):
  `(sot.offPoints − withheldEliteOff) × OME × (1 + 0.05×(sendableGens−1)) × 1.05 fanaticism`.
  Fanaticism (+5% OME / −5% DME) assumed always cast. Elites problem: sot.offPoints counts
  elites even when a province keeps them home → shared per-province "% of elites sent"
  setting (0–100, updatable mid-age).
- **Storage:** new ordered `waveSeq` in the war plan JSON; `assignedTo` derived from it for
  board/My Orders compat. **Publish also posts the full hitlist to Discord.**
- **My Orders:** when waveSeq exists, show the player's numbered hits ("you are #3, #7 of 24")
  with send timing; otherwise current behavior.

### VERIFIED API facts (2026-07-14, from real IS dump — IS itself was down)
Workaround while IS is down between ages: the Cloud Run backend keeps the last IS dump at
`gs://utopia-intel-bot-data/is_dumps/latest.json` (gcloud storage cp; svc.yaml maps it to
/mnt/data). A July-7 end-of-age dump verified everything:
- **sot.offPoints ALREADY includes full OME** (race, personality, science, honor, spells).
  Proven by per-race least-squares: offPoints ≈ (units × raw unit values) × som.ome/100
  (elf fit residuals ±2%). Same for defense (defPointsHome ≈ ×dme). ⇒ NEVER multiply API
  points by OME/DME tables — RACE/PERSONALITY_*_MULT in config.js are now empty on purpose.
- `som.ome` / `som.dme` = efficiency percentages (e.g. 169 = 169%).
- `sot.elites/oSpecs/soldiers/dSpecs/horses/prisoners` = TOTAL unit counts (all locations).
- `som.standingArmy` = {generals, solds, oSpecs, elites, horses} — HOME only.
- `som.armiesAway[]` = {generals, solds, oSpecs, elites, horses, land, secondsRemaining,
  ambush} — full per-army breakdown, so stage-2 slots can compute per-army offense as
  units × RACE_UNITS × ome/100. `sot.generals` DOES NOT EXIST; total gens = standingArmy
  .generals + Σ armiesAway[].generals.

### Offline test harness — mockup/harness.html (gitignored)
Replays the real dump against dist/app.js with fetch fully mocked (IS API wraps kingdom
responses as {kingdom, currentTick}; Firestore mocked; discord/run.app stubbed). Serve repo
root (launch.json "mockup", python http.server port 7788) → open /mockup/harness.html.
Fixture: mockup/is_dump.json (real KD 5:2 vs 4:8 incl. saved war plan — good stage-2 data).
Browser-pane screenshots time out (pane quirk) — verify via javascript_tool/read_page instead.

### Stage 1 — DONE (built, harness-verified 2026-07-14, NOT committed, NOT live-tested)
calcMaxOff formula (corrected after dump verification):
`maxOff = (sot.offPoints − eliteCount × eliteRawOff × (1−elitePct/100) × ome/100)
          × (1 + 0.05×(sendableGens−1)) × 1.05 fanaticism` — no OME multiplier on top.
Harness-verified: gens home+away, stray flag, elite % edit → withheld off matches hand-calc.
- `config.js`: Age 116 tables from "Finals 116" doc — `RACE_UNITS` (unit off/def per race),
  `PERS_ELITE_OFF_BONUS` (General +2 elite off), `FANATICISM_OFF_MULT = 1.05`. Replaced the
  old FICTIONAL race/personality multipliers with real Age 116 ones: `RACE_OFF_MULT` now empty
  (no blanket race OME this age — was giving e.g. Avian a fake +20% in calcAttacks!),
  `PERSONALITY_OFF_MULT` = warrior 1.15 / necromancer 1.075, `RACE_DEF_MULT` = dryad 1.125,
  `PERSONALITY_DEF_MULT` = necromancer 1.075. UPDATE THESE EVERY AGE.
- New **KINGDOM tab** (`src/tabs/kingdom.js`): attacker roster sorted by NW — race/pers, gens
  (sendable), SoT off, elites, editable **Elite % Sent**, computed **Max Off (1 hit)** with
  full breakdown tooltip, armies away with return times + stray flag. Summary cards: KD total
  max off, tuned provinces, stray count.
- Shared settings: `meta/{kdId}_atk_settings` in Firestore, `{json, updatedAt, updatedBy}`,
  json = `{[slot]: {elitePct, eliteCount?, setAt}}`. Loaded in init/refresh (`loadAtkSettings`).
  `calcMaxOff(prov)` is the canonical max-off function — the stage-2 solver must use it.
- **UNVERIFIED against live SoM:** the elite-count field name (`_apiEliteCount` tries
  `elites`/`eliteUnits`/`elite` on standingArmy and armiesAway entries; falls back to manual
  input with amber warning). Also unverified: per-army offense/generals fields on armiesAway
  (needed for stage-2 slot model).

### Stage 2 — DONE (harness-verified 2026-07-14, committed, NOT live-tested)
- **`src/waveplan.js`** — solver. `buildWaveSlots()`: home slot + one per returning army
  (units × RACE_UNITS × ome × fanaticism; elite % applied), merged when ≤1h apart
  (WP_SLOT_MERGE_SEC), stray flag otherwise; sorted by availableAt then NW DESC (big
  attackers pick first at the same time). `generateWaveSeq()`: greedy in slot order —
  raze/mass still needed → uncovered flagged → any in-range flagged by gain; reservation
  heuristic protects targets that are a later slot's only in-range option; fallbacks:
  in-range breakable wall (non-target, non-bloat) → least-bad flagged marked `marginal`.
  Target simNW/simLand drop per hit (attacker NW static). `resimulateWaveSeq()` re-runs
  projections after manual edits. `postWaveSeqToDiscord()` chunks the hitlist into ≤10
  embeds (≤3800 chars each) on one webhook message.
- **Wave Plan tab** (tabs/summary.js REWRITTEN, tab label WAVE PLAN, internal key still
  'summary', renderSummary → renderWavePlan everywhere). Generate → draft table (send
  time, attacker, target, range badge, type, gens, off sent, proj target NW, est gain)
  with per-hit reassign dropdown + remove (both resimulate); Publish (confirm dialog) →
  S.waveSeq into plan JSON (save/load/clearPlan wired in app.js), assignedTo derived per
  target from the seq, Discord hitlist posted when webhook set.
- Harness-verified end-to-end on the real dump: 35 slots/23 provinces, 81 hits, 3/3
  targets covered, ~21k acres est, reassign/remove/publish/Discord all exercised.
- Known simplifications: attacker NW static; defender losses not modeled; send times
  are offsets measured at generation (shown in UI); late big slots can end up with
  0-gain marginal hits once walls chain out of their range — leader should prune those.

**Generals refinement (same day, after leader Q&A):**
- Spare generals are SPREAD across a slot's hits after target selection — each extra gen
  on a hit means fewer raw troops sent (game applies +5%/extra gen to troops), so
  `sentOff = ceil((def+1) / (1 + 0.05×(gens−1)))` (`_wpTroopsFor`). Extras go where they
  save the most troops. Send margin stays exact def+1 (leader's choice).
- **Ambush hold:** if after all sends the province keeps > `WP_AMBUSH_OFF_PCT` (20%) of
  the slot's offense home, one spare gen is held back for ambush (listed in warnings).
- **Pop% is a WARNING only** (never overrides leader flags): attacker pop <70% on a TM
  hit or >100% on raze/mass → 🏠 badge per hit + banner count. `_ownPopPct(prov)` moved
  from calcAttacks to utils.js (shared).
- calcAttacks/My Orders stays as the engine when no waveSeq is published + Max Gain mode.
- Harness-verified: 3-gen hit sends 276k vs 304k def (×1.10 ✓); ambush hold triggered on
  the low-off Faery; selection pass unchanged (conservative def+1 depletion — spare-gen
  savings don't unlock extra hits; documented).

### Stage 3 — TODO: My Orders integration (player's numbered slice of waveSeq, send
timing per hit; fall back to current calcAttacks when no waveSeq published)

## Next up (roadmap remainder)
1. Wave Planner stages 2–3 (above).
2. Verify NW graph / ⚔ Find War with accumulated snapshots.
3. Pre-war planning mode (lift `_atWar()` gates, grey out ops in peace).
4. SN reminder in companion; armies-return countdown in Orders; push notifications;
   verify makeop.php with real game traffic.
