# Wave Planner — Session Context

Paste-ready context for continuing work on the Utopia War Tools. Last updated 2026-07-14.

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

## Next up (roadmap remainder)
1. Verify NW graph / ⚔ Find War with accumulated snapshots.
2. Pre-war planning mode (lift `_atWar()` gates, grey out ops in peace).
3. SN reminder in companion; armies-return countdown in Orders; race/personality modifiers in
   `calcAttacks()`; push notifications; verify makeop.php with real game traffic.
