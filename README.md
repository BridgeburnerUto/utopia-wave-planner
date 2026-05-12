# Wave Planner — Module Structure

## Workflow

```
Edit src/ files  →  node build.js  →  dist/app.js  →  push to GitHub  →  done
```

You need [Node.js](https://nodejs.org) installed (free, no npm packages required).

### Step by step
1. Clone the repo to your computer
2. Edit files in `src/`
3. In the repo folder, run: `node build.js`
4. That writes `dist/app.js`
5. Commit and push — GitHub Pages serves the new version automatically
6. All players get the update next time they use the bookmarklet

To tag a version: `VERSION=v6 node build.js`

---

## How to add a feature

**New tab** → create `src/tabs/yourtab.js`, add a `renderYourTab()` function  
Then in `src/app.js`: call it in `tab()` and expose it on `window.__wpA`  
Then in `src/dom.js`: add the tab button and content div  
Then in `build.js`: add `'tabs/yourtab.js'` to the `ORDER` array

**New API endpoint** → add one function to `src/api.js` only

**New utility helper** → add a pure function to `src/utils.js` only

**New state field** → add to `S` in `src/state.js` with a comment

**New op type or category** → edit `src/config.js` only

---

## File map

```
src/
  config.js          Constants, CSS string, op code tables (DOPS/IOPS/OP_SETS)
  state.js           Shared mutable state object S — all in-memory app state
  utils.js           Pure helpers: fK, fA, aC, canHit, esc, pd, $id, setSav
                     renderTab (error boundary), loadingHTML, sectionHead
  api.js             IS API calls: fetchOwnKingdom, fetchEnemyKingdom,
                     fetchKingdomOps, postWarPlan, getWarPlan
  firebase.js        Firestore REST: fbWrite, fbGet, fbQuery
  dom.js             buildOverlay(), injectStyles() — HTML skeleton only
  tabs/
    board.js         Kanban board, drag/drop, ops panel, column management
    player.js        Attack calculator (calcAttacks) + My Orders render
    summary.js       Summary tab render
    alerts.js        Alerts tab render + threshold handler
    leaderboard.js   Leaderboard render + silent syncOps()
  app.js             init(), refresh(), save(), tab(), setRole(), meta()
                     + thin wrappers that expose tab functions on window.__wpA

dist/
  app.js             Built output — DO NOT edit directly, always run build.js
```

---

## Key design rules

- `window.__wpA` is the only global. All `onclick=""` handlers in HTML strings go through it.
- Modules share state via the `S` object in `state.js`. Never create hidden module-local state.
- `renderTab(elId, fn)` wraps every tab render in try/catch — one broken tab can't crash others.
- API calls only in `api.js`. Firebase calls only in `firebase.js`. CSS only in `config.js`.
- The build output is still a single IIFE — the bookmarklet model is completely unchanged.
