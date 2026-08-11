# Wave Planner â€” Session Context

Paste-ready context for continuing work on the Utopia War Tools. Last updated 2026-08-10 (latest).

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

## Recent work (2026-08-11, latest) -- Dragon ingest LIVE (deployed, working)

The Discord->backend->Firestore->board chain is now running in production.
101 real events from #dragon are in Firestore, slots and land/NW resolved.

**Deployed:** Cloud Run `utopia-intel` rev 00065 (project **utopia-intel-bot**,
NOT utopia-leaderboard -- that is Firestore only). Env vars now:
`ANTHROPIC_API_KEY`, `WP_API_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_DRAGON_CHANNEL`
(= 1397235793206050903, the #dragon channel). Bot is "War planner"
(id 1536403597020110889) in guild 1397235789980631164.

**Four things went wrong; all four are worth remembering:**
1. **`--update-env-vars` placeholders got replaced wholesale**, creating one env
   var whose NAME was the bot token. That token was also pasted into chat, so it
   was rotated. Cleaned up by finding the unexpected name programmatically and
   passing it to `--remove-env-vars` (never printed).
2. **A 403 from Discord that Administrator could not fix** was not permissions at
   all -- it was **Cloudflare rejecting PowerShell's default User-Agent**. Any
   direct Discord API call from a script MUST send a real
   `User-Agent: DiscordBot (<url>, <version>)`. The backend already did, which is
   why it got 200 while local probes got 403.
3. **Message Content Intent was off.** Messages came back with `content`, embeds
   and attachments blanked -- `scanned: 100, added: 0` with no samples. It is a
   privileged intent and gates REST reads too, not just the gateway. Portal ->
   Bot -> Privileged Gateway Intents -> Message Content.
4. **Raw Discord text is not the rendered text.** utopiabot actually sends
   `:dragon_face: __DRAGON__ Spinosaurus [royc#] donated __5,000 gold coins__ to
   fund dragon!` -- the emphasis markers sit exactly where the pattern expected
   spaces. Both parsers now strip Discord markup first (`dragonCleanText()` in
   api.php, inline in `parseDragonDiscord()`); the client keeps newlines because
   its timestamp headers are matched per line. After the fix: **101 events from
   100 messages** (one message carried two, as expected).

**Also added to api.php this session:** `&reset=1` (forget the cursor, re-read
the newest 100 -- safe to repeat, ids are message-derived), `&force=1` (bypass
the 60s throttle), `discord_code` in every poll response, and up to 3 `samples`
whenever messages were scanned but nothing matched. Those samples are what
found bugs 3 and 4 -- keep them.

**Known gap:** the paste box keys events by content hash, the backend by Discord
message id, so an event arriving BOTH ways is stored twice. The paste box is now
only for history the backend cannot reach; warning added to its hint text.

### Backfill (added same session, deployed rev 00068) -- 765 events, whole age
Leader asked whether the war's whole history could be pasted. It should not be:
pasted events double-count against backend-pulled ones, a Discord copy carries
only HH:MM with no date (so identical events on different days collapse into
one), and the client wrote to Firestore one event at a time.

`?dragon_poll=1&backfill=1&since=YYYY-MM-DD[&days=N][&pages=N]` walks BACKWARD
through the channel with Discord's `before` cursor, resuming from `oldest_id` in
state.json. **`since` is REQUIRED** -- the channel spans several ages and an
unbounded walk would mix old dragons into this age's totals. The natural cutoff
is the plan's `ageStartDate` (Firestore `warplan/{kdId}` -> json.ageStartDate,
2026-07-26 this age). Backfill is exempt from the 60s forward-poll throttle.

Three bugs found while running it, all fixed:
- **429 discarded everything.** The error path exited before writing, throwing
  away 664 already-parsed events. Error paths now save progress and report
  `progress_saved`, so a rate limit costs a retry rather than the work.
- **No rate-limit handling.** `discordFetchMessages` now retries on 429 honouring
  `retry_after` (max 5 tries), with 0.3s between pages. HTTP is split out into
  `discordRequest()`.
- **The throttle blocked backfill**, since it is checked before the branch.

Result: 765 events, 2026-07-28 -> 2026-08-11 (nothing before the cutoff), 8.09M
gc, 989k bushels, 615,845 slay damage over 348 slay events, 24 provinces, in one
pass. Client `dragonPull()` now mirrors into Firestore in **parallel batches of
10** with progress in the status line -- 664 sequential writes would have stalled
the sync timer for minutes.

### Per-dragon + custom date filter (same session)
With a whole age in the store, the board was totalling several dragons together.
New range bar: **Whole age | one button per dragon | Custom (from/to dates)**.
- **Campaigns are INFERRED from gaps in activity** (`WP_DRAGON_CAMPAIGN_GAP_H =
  36`), because the bot never names the project -- there is no id to group on.
  A dragon lives at most 48 ticks and funding runs a day or two ahead, so a
  36h+ quiet stretch means the next event is a different dragon. Verified on the
  real 765: exactly 2 campaigns (Aug 7-11 = 489 events / 5.79M gc, Jul 28-30 =
  276 / 2.30M gc), and the counts sum back to 765 with nothing dropped.
  Raise the constant if two campaigns ever get split, lower it if two merge.
- `S.drgRange` = 'all' | 'c<N>' | 'custom', `S.drgFrom`/`S.drgTo` (YYYY-MM-DD,
  blank = open-ended). `_drgTs()` reads `ts` and falls back to `storedAt` so
  pasted events (which have no date, only HH:MM) still sort somewhere sane.
- **Bug this exposed and fixed:** `_drgSlayLaggards()` counted ANY slay event
  ever, so after the backfill everyone who slayed in July counted as done for a
  dragon arriving today -- they would have silently dropped off the chase list
  and out of the auto-reminder. It now scopes to the LATEST campaign only.

**Diagnostics that paid off:** `gcloud storage cat gs://utopia-intel-bot-data/dragon/state.json`
reads the poller's cursor directly; a Firestore `:runQuery` via curl confirms
what the board will actually see.

Uncommitted at session end: `.gitignore` (secret patterns -- this repo publishes
to GitHub Pages), `src/dragon.js` (markdown fix), `dist/app.js` (rebuild).

## Recent work (2026-08-11) -- Economy wage rate: placeholder bug + SoM recovery

Leader report: on a live IS every enemy province showed **Wage% 0%** and
**Wages/t −0**, so enemy net income equalled gross (309k/t).

**Root cause (real bug):** the IS ships a **placeholder `ma` block** --
`{wages: 0, draftTarget: 0, credits: 0}` -- on provinces that were never opped,
rather than omitting `ma`. `_provEconomy` tested `maWages != null`, true for 0,
so the WAGE_RATE_ASSUMED fallback never fired. Fixed by testing `> 0`. Visible
in the fixture too (Deimos/Gunnlod carry the zeroed block).

**Wage rate is now RECOVERED from the SoM** (leader: "the information is on the
SoM"). The SoM text states it outright ("Our wage rate is 100.0% of normal
levels") but **the IS API does not expose it** -- `som` keys are exactly
`ageSeconds, ome, dme, eff, nonPeon, offPointsHome, defPointsHome, training,
standingArmy, armiesAway, armiesReturned, reliability, allDefenseHome, tickId`
(union across all 45 provinces in the dump; "wages" appears nowhere but `ma`).
What it DOES expose is `som.eff`, the efficiency the wage rate produces, so
`_wageRateFromEff()` inverts the published curve
(reference/strategy-context.md:278):
`eff% = 33 + 67 × (wage%/100)^0.25` → `wage% = 100 × ((eff%−33)/67)^4`,
clamped to `WAGE_RATE_MAX = 200`. Constants `MIL_EFF_BASE/COEF/EXP` +
`WAGE_RATE_MAX` in config.js (age-varying, with the others).

Source precedence per province (leader's order): `ma.wages > 0` → SoM-derived →
old IS board → assumed 200%, with the SoM/old-IS pair resolved by FRESHNESS
(see the collector section).
Wage% column now has three states via the `WAGE_SRC` table: exact (bright,
no marker) / `~` derived (mid grey) / `*` assumed (dim), each with its own
tooltip; the Wages card counts them ("2 rate~ from SoM · 20 assumed*").

**Two caveats, stated in the tooltip and the tab footnote, not hidden:**
- The inversion yields the **EFFECTIVE** wage rate, which trails the rate
  actually being paid by up to ~96h. A province that just slashed wages still
  reads high.
- Ruby dragon (×0.875) and multi-attack protection (>1) scale `eff` without
  touching wages -- that is what the 200% clamp absorbs.

Accuracy check against the 23 own provinces (the only ones with BOTH `ma.wages`
and `som.eff`): 22/23 within 10%, 8 exact; `eff 0.78 → 20%` vs paid 20% ✓,
`eff 1.13 → 200%` ✓. The single outlier is Ghetto Siesta (derived 157 vs paid
20) -- a province that had just cut wages 200→20, i.e. the documented lag, not
a formula error. Derived values never apply to own provinces anyway (`ma` is
always populated there).

Harness: own side unchanged (0 derived, 0 assumed; 20%/178%/200% all exact);
enemy side 2 derived + 20 assumed, KD wages −730k where it was 0, Gunnlod
correctly negative net. All 11 tabs render, no console errors. Minified build
done. NOT COMMITTED, NOT live-tested.

**Old IS (intel.utopia-game.com) -- investigated, NOT built.** Leader asked
about hooking it up alongside the new IS since it captures the wage rate.
Blocker: it answers `You can only login from in-game`, so the session can only
be established by clicking through from the game -- no server-side fetch from
Cloud Run is possible, and a cross-origin fetch from intel.utopia.site would
need CORS headers it does not send. Only viable shapes: (a) a second collector
bookmarklet run in the old-IS origin that pushes to Firestore/backend, or
(b) a paste box in the planner (backend parse.php:814 already has the
`/wage rate is ([\d.]+)%/i` regex). **Leader chose (a), the collector
bookmarklet -- BUILT, see below.** `scripts/oldis-probe.js` (the recon step) is
kept for re-probing other old-IS pages.

### Old IS wage collector -- BUILT (harness-verified, NOT run live)

**What the old IS actually is** (from the probe, run by the leader 2026-08-11):
classic PHP + jQuery + tablesorter, `?p=` routes, **no JSON API** -- the data
only exists as rendered HTML. Its board (`?p=intel`, `div#board >
table.tablesorter`) already computes the whole economy per province:
`Slot | Prov | Race | Pers | Acres | NW | Income | Wages | Wages # | Netto gc |
Food eaten | ... | popspace | Intel`, where **`Wages` is the paid rate %** and
`Wages #` is the gold. Confirmed against the leader's SoM screenshot: `[7]
Jabba the Pizza Hutt` reads `Wages 100`, and its SoM text says "Our wage rate
is 100.0% of normal levels". Province cells are `[13]Name (4:6)`, so every row
carries its own kingdom -- own and enemy boards can be collected in any order.
Its `Income` also cross-checks our model: 17.9k for Jabba vs the 18k gross our
Economy tab computes for the same province.

- **`scripts/oldis-collector.js`** -- pasted into the console on the old IS
  board. Parses the table, groups rows by the location in each Prov cell, shows
  a preview and **asks before sending**, then writes one Firestore doc per
  kingdom: `meta/oldis_econ_{loc}` (`:` -> `_`) with
  `{loc, n, updatedAt, source, provs: {[slot]: {name, wagePct, wagesGc,
  incomeGc, nettoGc}}}`. Columns are matched by header TEXT, not index -- the
  board is drag-reorderable (jquery.dragtables) and `Wages #`'s id contains a
  space so it is not a usable CSS selector. Abbreviated values ("17.9k") are
  decoded; the totals row is skipped.
- **Staleness rule -- BUILT.** `ma` still wins outright, but the SoM/old-IS
  pair is resolved by age rather than a fixed winner: old IS wins when it is
  newer than the SoM being inverted (`som.ageSeconds` vs now − doc
  `updatedAt`). An unknown age on either side counts as older -- a reading we
  cannot date cannot be shown to be fresher. The chosen source's age is
  appended to the Wage% tooltip ("… — 22d old") so the leader can see WHY a
  source won.
- **Known bias**: the old-IS age is measured from when the collector RAN, which
  understates the true age -- the old IS was already showing intel of some age
  when it was scraped. Accepted deliberately: that value is the exact paid
  rate, so letting it win close calls against an inverted estimate is the right
  way to be wrong. The board's own per-province intel-age column
  ("2.5h|7.2h|5.9h|95.5h") is now stored raw as `intelRaw`, but its four fields
  are not identified yet -- identify them and the rule can use the real age of
  the wage figure.
- Verified both directions: with the doc collected 2h ago, Deimos (SoM 22.5d
  old) switches to the exact 100% and the card reads "4 from old IS · 18
  assumed*"; with it collected 40d ago, Deimos falls back to "200%~ · 22d old"
  and the card reads "2 rate~ from SoM · 2 from old IS · 18 assumed*". Iapetus,
  which has no SoM at all, keeps the old-IS value in both.
- **Planner side**: `S.oldisEcon` (state.js), `_loadOldisEcon()` (app.js, next
  to `_loadLocLock()` in both init and refresh, own + enemy loc), and
  `_oldisWage(prov, loc)` in economy.js. Source precedence is
  **ma -> som -> oldis -> assumed** (leader's call 2026-08-11: the live IS
  sources outrank the old IS because ours are current, while the old-IS numbers
  are only as fresh as the last manual collection -- so a province we have a
  SoM on uses the estimate even though the old IS has the exact figure).
  `loc` had to be threaded through `_provEconomy`/`_kdEconomy`/`_econSection`
  because a bare slot number cannot tell own [7] from enemy [7]. Green,
  unmarked Wage% for old-IS values; the Wages card counts each source
  ("2 rate~ from SoM · 2 from old IS · 18 assumed*"). A missing doc is normal
  and silent -- the assumed rate stands in.
- Verified in the harness: the real board markup (probe headers + rows) parses
  to the right 5 provinces across 2 kingdoms with Jabba at 100%, negatives and
  k-suffixes decoded, totals row dropped; **re-verified with the columns
  dragged into a different order** -- still correct. End-to-end with a mocked
  Firestore doc: 4 enemy provinces flip to exact green rates, the two that had
  been SoM-derived are correctly overridden (Deimos 200%~ -> 100%), KD wages
  -730k -> -647k, net 259k -> 342k, Gunnlod's net goes from -5.6k to +26k on
  its real 50% rate. Without the doc everything falls back unchanged. All 11
  tabs render, no console errors.
- **Not done**: the collector is manual (paste per board). `incomeGc`/`nettoGc`
  are stored but not yet surfaced as a cross-check against our own income
  model, which is the obvious next use for them.

Also added a `mockup-alt` config (port 7789) to .claude/launch.json -- another
session held 7788.

## Recent work (2026-08-10, latest) -- Dragon contributions top list (NEW)

Leader ask: track how much each player sends to slay a dragon and how much they
fund, as a top list, also normalised per acre and per NW.

**Where the data is NOT (checked, so nobody re-checks):**
- **IS API has nothing per-province.** Endpoint list pulled from the live IS
  bundle (`intel.utopia.site/static/js/main.*.js`): `Kingdom/v1/{OwnKingdom,
  EnemyKingdom,KingdomOps,EnemyKingdomOps,Recent,Ticks,Search}`,
  `News/v1/{kdnews,provinceNews}`, `Province/v1/SotArchive`, `WarPlan/v1/*`,
  `Data/v1/*`. Province objects carry sot/survey/sos/som/ma/calcs only.
  `kdEffects` has just `dragon` (type name) + `dragonDuration` (ticks left).
  The News endpoints are PASTE-PARSERS (POST `parseString`); their dragon output
  is kingdom-level counts (dragonsStarted/Completed/Killed/Received/
  enemyDragonsStarted) with no province breakdown.
- **Game page** `/wol/game/fund_dragon` (nav item "Dragons") has the donate form
  and "N gold coins and M bushels are still needed", never a contributor list.
- **Backend** parse.php had no dragon regexes at all.
- The in-game bot's `dragon` command DOES print cumulative per-RULER totals
  (`bassma# 386.0k |bridg# 173.5k |...  Total: 1.3m`) but rounds to 3 digits.

**The source we use: the utopiabot DRAGON feed in Discord**, one message per
event, exact amounts, gold and food separated, and slay events included:
```
DRAGON Ankylosaurus Rex [bridg#] donated 62,093 gold coins to fund dragon!
DRAGON Indominus rex [indominus re#] donated 28,000 bushels to fund dragon!
DRAGON Dilophosaurus [borwhack] sent 350 troops and weakened dragon by 3723 points!
```
Leading name is the FULL PROVINCE name (exact roster match); the bracketed one
is the ruler, usually truncated by a character, stored for reference only.
Leader's caveat: utopiabot does not see players acting from the mobile app, so
every total is a floor — stated in the UI, not hidden.

**Built (`src/dragon.js`, new; harness-verified, minified build done, NOT
committed, NOT live-tested):**
- `parseDragonDiscord()` — matches events across the whole paste, not line by
  line (one Discord line can carry two events, and copy/paste wraps freely).
  Each event gets a djb2 content hash id including an occurrence index, so
  re-pasting an overlapping range is idempotent while two genuinely identical
  donations in the same minute stay distinct.
- `parseDragonBotList()` — the in-game bot's cumulative list, kept as a
  CROSS-CHECK only: "Feed Gap" card = bot listSum − feed gc sum, i.e. what the
  Discord feed missed. `parseDragonFundPage()` — dragon type, target KD, still
  needed.
- Storage: one doc per event in `dragon_events` keyed by hash (dedupe is the
  doc id), aggregated client-side — same pattern as the ops leaderboard.
  Cross-check docs go to `dragon_check`.
- UI: LEADERBOARD tab now has a section switch (`S.lbSection` = 'ops'|'dragon').
  Dragon board = metric switch (💰 gc / 🌾 food / 🗡 slay) × sort (Total / /Acre
  / /kNW), medals, share%, troops + dmg/troop on the slay view, and a paste box.
- **Per 1,000 NW, not per NW** — provinces run ~1M networth, so a raw ratio
  collapses everyone into 0.0x and the column stops discriminating.
- Land/NW: CURRENT roster values when the province is still there, else the
  snapshot taken when the event was recorded (greyed) — a departed or chained
  province keeps a sensible per-acre figure instead of dropping to "—".
- **"Hasn't funded/slayed yet" chase list** (leader request) — roster minus
  contributors, ranked by ACRES (a 3k-acre province sitting out costs more than
  a 300-acre one), showing each province's Discord handle (`prov.discord`, a
  username string — cannot @mention, no id) and what they DID do ("funded but
  never slayed" is a different conversation from "nothing at all"). Renders even
  with zero events, which is exactly the "nobody has slayed" case.
  `dragonRemind()` posts it via the existing `sendDiscordEmbed` webhook,
  4096-char embed limit respected.
- Wired: state.js (lbSection/drgMetric/drgSort), build.js (dragon.js before
  tabs/), leaderboard.js (branch + section switch on the ops view), app.js
  (`__wpA.lbSection/drgMetric/drgSort/dragonSave/dragonRemind`).
- Verified: node parse test on the real 28-line paste → 29 events (line 9
  carries two), 20 gc / 4 food / 5 slay, re-parse ids identical, duplicate lines
  stay distinct; bot list 18 rulers, listSum 1,312,197 vs its own rounded
  "Total: 1.3m". Harness: empty state shows 23/23 chase list; injected events
  render both metrics with correct /acre and /kNW, unmatched province greyed
  with "—", chase list drops to 18/23; no console errors.

**Backend ingest -- BUILT (api.php, NOT deployed, NOT live-tested).** Two new
endpoints in `D:\Claude\utopia-intel-server\api.php`:
- `?dragon_poll` -- pulls new messages from the DRAGON Discord channel
  (`GET /channels/{id}/messages?after={lastId}`, `Authorization: Bot <token>`),
  parses them with the same regex as the client, stores to
  `/mnt/data/dragon/events.json` keyed `{messageId}_{n}` (exact dedupe, better
  than the client's content hash), tracks `last_id` in `state.json`, paginates
  up to 10 pages, prunes above 20k events. Reads embeds as well as content.
- `?dragon` -- serves stored events newest-first (`&since=ISO`).
- **Needs two Cloud Run env vars**: `DISCORD_BOT_TOKEN` (a BOT token -- a user
  token is self-botting and gets accounts banned, which is what
  `scripts/fetch_discord.js` does and why it must not be the model here) and
  `DISCORD_DRAGON_CHANNEL`. Bot needs View Channel + Read Message History.
- NOT lint-checked: no PHP or Docker on this machine. Verify with `php -l` or
  the first deploy.

**Client side of the ingest:** `dragonPull()` in dragon.js calls `?dragon_poll`
then `?dragon` and mirrors new events into Firestore (one `dragon_events` query
first, so only genuinely new ids are written). Firestore stays the single read
model, so the board still works when the backend is down. Wired into
`syncBackend()` (the existing 2-min timer, quiet mode, re-renders only when the
dragon board is open) plus a manual "⟳ Pull from Discord" button.

**Auto-reminders -- BUILT.** `discord.js` alert cycle gained a slay chase-up:
while `kdEffects.dragon` is set, posts the "not slayed yet" list at most every
`WP_DRAGON_REMIND_HOURS` (6, in dragon.js), throttle stored as
`dragon_slay_remind_at` in `meta/{kdId}_alert_state`. The clock RESETS when the
dragon changes, so a new dragon gets an immediate first call, and clears to 0
when no dragon is present. `_drgSlayLaggards()` is shared by the button and the
auto-post; it returns **null** on a failed Firestore query and the caller then
stays silent -- never accuse the whole kingdom off a broken read. Fund-only and
zero-value slay rows do not count as having slayed. Added
`DISCORD.COLORS.orange`.

Verified (node): laggard logic across 6 cases incl. query failure and
case-insensitive names; `dragonPull` skips already-mirrored ids, resolves slots,
derives tsLabel, and no-ops cleanly without an endpoint. Harness: all 11 tabs
render, ops section unaffected, Pull button correctly disabled with no endpoint,
no console errors.

**Still open:** api.php not deployed and never run; the Discord bot does not
exist yet. Probe scripts kept for reference: `scripts/dragon-probe.js`,
`scripts/bot-net-probe.js`. Nothing in this session is committed.

## Recent work (2026-08-10) -- Popspace "current pop" fix

Leader report: the NW Graph tab's Popspace view never showed current pop live,
even though the SoT data is on the IS and refreshes every tick.

**Root cause (real bug):** `snapshotNW()` gated on the RAW `S.own?.war` boolean
-- the one `utils.js` documents as unreliable and that `_atWar()` exists to
work around. It was the only place in the codebase still using it. On a live IS
where `own.war` is not populated, **no nw_snapshots were ever written**, so the
Popspace graph had no current-pop data (and no precise capacity) to draw --
while the harness, which serves synthetic snapshots, looked perfect.

**Fixes (harness-verified, minified build done):**
- `nwgraph.js:snapshotNW()` now uses `_atWar()`. Both call sites (`init`,
  `refresh` in app.js) already run `_refreshWarStatus()` first, so the cache is
  fresh.
- **Live point**: new `_livePopSnap()` builds an nw_snapshots-shaped object from
  the in-memory `S.own`/`S.enemy` SoTs (`live:true`, `storedAt: Date.now()`) and
  `_loadAndRenderNwGraph` pushes it onto `snaps` whenever the window reaches the
  present. Current pop now shows on the FIRST open -- no waiting for a stored
  snapshot, and it works out of war too (when nothing is ever written). It also
  supplies precise capacity for the current hour.
- Snapshot-loading gate widened: own snapshots are fetched when own loc OR the
  current enemy loc is graphed (snapVals already filters by side).
- **Pop coverage tracked**: `_calcKdPopspace` also returns `popN` (provs that
  actually had SoT population); written as `ownPopN`/`enePopN` and shown in the
  Current Pop card ("live - own 23/23 - eny 22/22 provs with SoT"). Without it
  an enemy KD with 8/22 SoTs read as a tiny current pop, not an incomplete one.
  Precision card now says "(live)" vs "(latest snap)".
- Harness: Popspace shows 4 series + "live - own 23/23 - eny 22/22 provs with
  SoT" / "provs surveyed (live)"; with nw_snapshots forced to `[]` the two
  capacity lines still draw and each pop series renders as a single live dot
  (this is the production case). Total/War NW views byte-identical (2 polylines,
  same cards). No console errors.

**Not done:** snapshots are still war-only, so pop HISTORY only accumulates
during war -- out of war you get the single live point. Writing them always
(one doc per tick, 30-day cleanup already exists) would give continuous popspace
history; not done because it widens what `nw_snapshots` means. NOT COMMITTED.

## Recent work (2026-08-10, later) -- post-live-test fixes

First live wave (shrink-AI, early Age 116, ~200-600 acre provinces) exposed
several things. What the leader saw: 54 hits, est gains only ~727 acres, the
chain target got 3 hits while two provinces soaked 25, and 17 hits flagged
"fat".

**Root causes (diagnosed, not all of them bugs):**
- **Chain target under-hit: the Chain ⌖ column was EMPTY.** The chain-quota tier
  only fires on `targetAcres > 0`. With no acre goal set, the "chain target"
  was just another flagged target and lost to the AI shrink quotas. Diagnostic:
  no ⛓ lines in the warnings box and no ⛓ badges in the table = no chain goal
  anywhere in the plan. WORKS AS DESIGNED -- leader must set Chain ⌖.
- **25 of 54 hits on two provinces**: [11] had 6k def, so it was the only thing
  most small slots could break; the least-bad fallback kept picking it. [24] was
  leader-flagged AND AI-shrink-picked, and the "stop once quota met" guard only
  covered shrink-ONLY targets.
- **11 hits estimated ZERO gain** -- out of range → RPNW factor 0 → no acres.

**Fixes shipped:**
- `WP_MAX_OVERFLOW_HITS_PER_TARGET = 5` -- caps hits from the mid-priority tiers
  (uncovered/any/wall/marginal). EXEMPT: chain victims (pounding one province is
  the point of a chain), raze/mass, shrink quota, and **the DUMP pass** (leader
  rule: a super-low-def province should always soak leftover offense, cap or no
  cap -- offense left at home is worth zero). Harness: mid-tier max stays 5/target
  while the dump target took 13 (5 mid + 8 dump), same 74 total hits -- the cap
  redirects the spread, it does not idle the offense.
- AI shrink now also skips any province the leader FLAGGED as a wave target
  (`plan.wave`), not just chain victims and bloat provs.
- AI shrink ranking corrected AGAIN: density is the GATE (≥90% pop), then rank
  the survivors by SIZE (estimated population, acres as tiebreak). Ranking by
  pop% inside the band was wasting quota on tiny full provinces.
- **Gains: `TM_GAIN.MIN_PCT = 0.005`** -- leader reports a successful land attack
  NEVER nets 0, even out of range, though the published formula gives exactly 0
  outside rpnw 0.567-1.6. Modelled as a floor of 0.5% of target land (still
  subject to the 20% cap). VALUE IS UNVERIFIED -- tune from real OOR results.
- **Gains: Race/Personality modifiers added** (they are in the wiki formula and
  we had neither): `RACE_GAIN_MULT = {orc: 1.15}`, `PERS_GAIN_MULT = {'war hero':
  1.10}` (Age 116 war values). `_estimateTMGain` takes an optional `atk`
  province; slots now carry `pers` so the solver can pass race+pers.
- **`REL_F` renamed `WAR_F`** (1.10, unchanged) and documented as what it is: the
  +10% war stance/relations gains bonus. The planner ALWAYS assumes war. Added
  `OOW_F = 0.85` for reference (Age 116 raised the OOW penalty to 15%).
- Config now lists what the gains model does NOT cover: Stance, Siege Science,
  Emerald Dragon, Attack Time Adjustment, Anonymity, Mist, and the enemy Undead
  war doctrine (-12.5% enemy battle gains).
- **Pop%/"fat" badge moved to the Attacker column** -- it is OUR province's pop%,
  never the target's, and sitting in the Target column it read backwards.

Harness: max hits per target 5 (was up to 14 live), out-of-range hits now show
~13-15 acres instead of "—", the only remaining "—" is a Raze (correct, raze
takes no land for us). AI picker re-verified with the floor temporarily at 60:
flagged [2] Deimos correctly skipped, and Gunnlod (4k acres, 64% pop) loses to
Kerberos (3.4k acres, 78% pop) -- more actual people despite fewer acres.

**Still open / not done:** out-of-range hits are still TMs (Raze ignores RPNW and
would do real damage there); fat attackers (<70% pop) still only get a warning
rather than being switched to raze/mass. Both were offered and not selected.

## Recent work (2026-08-10) -- Shrink wave types + Age 116 strategy doc

### Shrink waves (harness-verified 2026-08-10, NOT live-tested)
Two new entries in the Wave Plan tab's wave-type dropdown, on top of 'standard':
- **`shrink`** -- leader picks the shrink targets on the WAR BOARD's new
  **"Shrink ⇩"** column (select --/1/2/3 = how many hits that province should
  take). Stored as `S.provinces[slot].shrink` (persists in the plan JSON like
  targetAcres; `_pp()` migrates old entries to 0). `setProvShrink()` in board.js,
  exported via `__wpA`.
- **`shrinkai`** -- solver picks them itself (`_wpAiShrinkPicks`): **FULLEST by
  pop% (`_enemyPopPct`), tiebreak land** -- must be breakable by an in-range
  slot, must have real def intel, never a chain victim (targetAcres > 0) or a
  bloat prov. Caps: `WP_SHRINK_AI_MAX_TARGETS = 6` (user rule -- more = spread
  too thin), `WP_SHRINK_AI_HITS = 2` each, `WP_SHRINK_AI_SLOT_SHARE = 0.35` of
  attack slots, and a HARD FLOOR `WP_SHRINK_AI_MIN_POP_PCT = 90` (leader rule:
  never auto-shrink below 90% pop, even if that leaves the roster short --
  `shrinkNote` then explains the empty pass in the warnings). Leader flags are
  honoured first, AI only fills the remaining room.
- **Rank by DENSITY, never by acres or total pop** (leader-corrected 2026-08-10
  after a live test; v1 ranked by absolute population and so kept picking the
  biggest half-empty provinces). A captured acre carries its population pro
  rata: an acre off a 100%-pop prov removes ~25 peons, off a 40%-pop prov ~10
  and the rest still fit. Shrinking an empty prov only deletes unused living
  space (acre trading); shrinking a full one deletes occupied housing, stops
  births and drives pop% toward the overpop thresholds. `_wpByBandPopGain`
  already had this right -- only the AI picker was wrong.

Solver mechanics (waveplan.js):
- `_wpShrinkGoals(waveType, slots)` -> `{[slot]: {hits, ai}}`; passed into
  `buildWaveTargets(shrinkGoals)` (pulls shrink-only provs into the target pool)
  and `_wpWallPool(shrinkGoals)` (drops them, so no province has two sim states).
  Standard wave passes `{}` -> byte-identical behaviour (verified: 77 hits both
  before and after).
- **`_wpAssignShrink()` runs BEFORE the chain is solved** (user requirement):
  every (slot, shrink target) pair that is in range and breakable is scored
  optimal-band -> fattest target -> gain, then greedily matched (max
  `WP_SHRINK_MAX_PER_SLOT = 2` per slot). A slot that is the ONLY in-range
  breaker of a chain victim is protected from shrink work.
- Per-slot pick order is now: raze/mass -> **shrink assigned to this slot** ->
  chain quota -> **unmet shrink quota (any slot)** -> uncovered -> any.
  A shrink-ONLY target whose quota is filled drops out of the uncovered/any
  tiers, and sorts last in the least-bad marginal fallback (stops leftover
  offense piling 5 extra hits on one already-shrunk prov).
- Hits carry `shrink: true` -> ⇩ badge in the Wave Plan table, My Orders, and
  the Discord hitlist; `shrinkStatus` warnings ("Shrink done/short", exact acres
  like the chain warnings -- fK hides 3050 vs 2600); new "Shrink Hits" card.
- `resimulateWaveSeq(seq, waveType)` re-derives the same goals (AI pick is
  deterministic for unchanged intel) and now also increments `t.hits` and
  refreshes `projLand`, so chain/shrink status stays right after edits.
- Harness-verified on the real dump: standard 77 hits unchanged; leader shrink
  (Europa 3 + Kerberos 2) -> shrink hits land at seq #1/#13/#20/#36/#37 (before
  the chain, all "good" band); remove-hit resimulate correctly flips a target to
  "Shrink short"; publish -> My Orders shows "⇩ shrink" per hit; no console
  errors; minified build re-verified.
- AI picker re-verified after the pop%-density fix: the end-of-age fixture tops
  out at 89% pop, so with the 90% floor the AI correctly picks NOTHING and shows
  the shrinkNote (wave falls back to a plain chain, 77 hits = standard). With
  the floor temporarily dropped to 60 it picks the top 5 by pop% (Deimos 89,
  Kerberos 78, Europa 73, Triton 71, Callisto 68) and Hyperion -- the KD's
  biggest prov at 4785 acres but only 56% pop, the exact prov the old ranking
  put first -- is correctly excluded.

### Age 116 strategy doc
- `reference/strategy-context.md` replaced with the Age 116 version (was 115):
  Age 116 key-changes summary, war doctrines, reworked race/personality tables
  (Dryad, Cleric, Sage), Age 116 dragon table, updated op/spell numbers.
- **NOT propagated to the backend**: `D:\Claude\utopia-intel-server\strategy-context.md`
  is the copy `ai_strategy.php` actually sends to Claude and is still Age 115 --
  needs copying + a Cloud Run redeploy.

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

### Economy tab -- DONE (committed & pushed 2026-07-28/29, NOT live-tested)
- **2026-07-29: Own/Enemy KD switch** at the top of the tab (`S.econView`,
  `__wpA.econView`), **defaults to ENEMY** -- enemy econ matters most in war
  (user request; the old stacked own+enemy layout buried the enemy table).
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
  - wages = (specs x 0.5 + elites x 0.75) x wageRate x (1-armoury%) x
    (1-Bookkeeping sci) x race (soldiers/mercs/horses unpaid)
  - **wageRate = `prov.ma.wages`%** (Military Advisor intel -- own always, enemy
    when opped; fixture 2/22) else WAGE_RATE_ASSUMED = 200% (config.js), shown in
    a Wage% column with "*" + dim color when assumed
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
  *(2026-08-10: 'shrink' and 'shrinkai' added -- see the Shrink waves section above.)*
- **Bug fixed**: board.js `setProvWave` still called the renamed `renderSummary` â†’
  ReferenceError on every wave-assignment change since the stage-2 rename. Now
  `renderWavePlan`. (Found while adding the chain column; the harness path had never
  exercised a wave re-assignment.)

### Possible next steps (all optional)
- Economy v2: plague/dragon/riot/war-doctrine income-wage modifiers; honor pop bonus
  in _provLivingSpace; upgrade _enemyPopPct to surveys (changes solver sort!); net
  income graphed over time (user declined for v1).
- Define further wave types beyond standard / shrink / shrink-AI (leader will specify).
- Companion (war-companion.html): render waveSeq slice on mobile (data already synced).
- Live re-check at send time: compare planned def vs latest intel before "SEND NOW".
- Flag more targets in harness plan to demo a realistic war-start wave.

## Next up (roadmap remainder)
1. Wave Planner stages 2â€“3 (above).
2. Verify NW graph / âš” Find War with accumulated snapshots.
3. Pre-war planning mode (lift `_atWar()` gates, grey out ops in peace).
4. SN reminder in companion; armies-return countdown in Orders; push notifications;
   verify makeop.php with real game traffic.
