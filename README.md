# Draft Command — Yahoo fantasy football draft assistant

Value-based drafting (VBD) assistant that tracks a live draft and tells you who to pick and why.

## Fastest way to use it (no install)

Open `dist/draft-command.html` in Chrome (double-click it). Everything is embedded: player projections, ADP, and the engine.
State is saved in the browser, so a refresh does not lose the draft.

1. **Settings** → set Teams, My pick, roster slots and scoring. Or paste your Yahoo *League Settings* page text and click *Parse*.
2. Keep the Yahoo draft room and this page side by side. Each time a pick is made, type the player's name and press **Enter**. The pick is assigned to the team on the clock and the board advances. `Ctrl+Z` undoes.
3. When you are on the clock the top bar pulses and the **Advice** panel lists the best picks with reasons.
4. Fell behind? **Sync / Import** → paste the Yahoo *Draft Results* text; every missing pick is applied in order.

## Live auto-sync from the Yahoo draft room (optional)

```
node server.js            # serves the app at http://localhost:3000 and relays picks
```

Install `yahoo-draft-sync.user.js` in Tampermonkey (Chrome). In the Yahoo draft room the script finds the draft-results
list, extracts player names in pick order every 2 seconds, and POSTs them to the local server, which pushes them to the
app over Server-Sent Events. A small badge at the bottom-right of the Yahoo page shows what the script sees.
The Yahoo DOM could not be inspected while building this, so the script uses selector guesses plus a text heuristic.
If the badge says it is waiting, right-click the results list in Yahoo → Inspect, copy a class name from its container
into `SELECTORS` at the top of the userscript, and save. Manual entry and paste-sync always work regardless.

## How the advice is computed

* **Proj**: 2026 season stat-line projections scored with your league's settings (kickers and defenses use point projections).
* **VORP**: projected points over the replacement-level player at the position. Replacement rank = starters × teams +
  the position's share of flex spots + a small bench allowance, and it is recomputed from the players still on the board,
  so positional runs raise the value of what is left.
* **VONA**: projected points over the *expected* best player at that position still available at your next pick, using an
  ADP-based availability model (normal distribution around ADP, width growing with ADP, conditioned on the player still being
  available now, shifted when a positional run is underway).
* **Avail**: probability the player survives to your next pick.
* **Score** = need × (0.55 × VORP + 0.45 × VONA). Need is 1.0 for an open starter slot, 0.9 for an open flex, lower for
  bench depth, and kickers/defenses are suppressed until the last two rounds (or until they must be filled).
  Kicker and defense VBD is discounted because their projections are unreliable.

## Files

| Path | Purpose |
| --- | --- |
| `app/index.html`, `app/app.js` | UI |
| `app/engine.js` | scoring, VBD, availability model, recommendations, parsers (unit-tested) |
| `app/players.js` | generated player pool + strategy notes |
| `data/players.json`, `data/raw/` | dataset and the per-position research it was built from |
| `scripts/build-data.js` | rebuilds `app/players.js` from `data/raw` |
| `build.js` | bundles the app into `dist/draft-command.html` |
| `server.js` | local relay server (static files + `/api/sync` + SSE) |
| `yahoo-draft-sync.user.js` | Tampermonkey userscript for the Yahoo draft room |
| `STRATEGY.md` | pick-7 draft strategy for 10- and 12-team half-PPR leagues |
| `test/` | `node test/engine.test.js`, `node test/smoke.js` (headless Chromium) |

## Updating projections

Sync / Import → *Replace projections (CSV)* accepts a CSV with `Player, Team, Pos, ADP, Tier, Bye` plus stat columns
(`pass_yds, pass_td, pass_int, rush_yds, rush_td, rec, rec_yds, rec_td, fumbles`) or an `FPTS` column.
