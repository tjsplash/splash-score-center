## Build log — 2026-05-01

### What shipped

A live, social play-by-play web app for tonight's three NBA Game 6
elimination matchups (DET @ ORL, CLE @ TOR, LAL @ HOU), branded as
Splash Score Center. Three pages — Home (bracket + ticker + tonight's
preview cards), Scoreboard (ESPN-style all-games view), Game Center
(Play-by-Play, Box Score, Markets, Win Probability tabs + global game
chat sidebar).

Real ESPN public-API data drives the ticker, scoreboard, game header,
play-by-play feed, box score, and win-probability chart. Polymarket
markets are mocked but react to real plays — any synthetic price
swing of 5%+ surfaces inline in the play-by-play feed as a Market
Move card, reactable and threadable like any play.

Identity, comments, and reactions persist via `localStorage`. No
backend, no API keys.

## Code review — 2026-05-01 18:47 UTC

### Wins

- Real ESPN data flows through every surface that needs it. The
  scoreboard, ticker, and Game Center are wired to the live API and
  poll on a sane cadence (15s scoreboard, 10s game summary).
- Component module pattern is clean: every visual unit (`mountPbp`,
  `mountMarkets`, `mountChat`, `mountWinprob`, `mountBoxscore`) takes
  a single root element + opts, fully owns its DOM, and listens for
  fresh data via explicit `update*` calls. Drop-in for the future
  Splash app embed.
- The Market Move card is the differentiated piece — it cleanly ties
  betting context to live action without leaving the feed. Visually
  distinct (amber left border, soft amber gradient), reactable, and
  links out to Polymarket.
- Empty states are graceful for every tab (PBP, Box Score, Win
  Probability) so the pre-game state still feels finished.
- Sparkline render race (`canvas.clientWidth = 0` while panel hidden)
  was caught and fixed with a `requestAnimationFrame` after layout
  plus a `refreshSparklines` redraw on tab activation.
- PBP feed re-render now skips when the play count + market-event
  count haven't changed — preserves open comment threads and any
  text the user is mid-typing on each 10s poll.
- Identity modal is non-blocking: only opens lazily on first reaction
  or comment, includes optional team affiliation that surfaces as a
  team-color badge across every comment and the nav.

### Suggestions (worth doing post-demo)

- `assets/markets.js:derivePrice` uses string-prefix heuristics to
  decide which side of a Moneyline a price refers to. Move to an
  explicit `home`/`away` flag in the fixture rather than parsing the
  label.
- The ESPN `winprobability` array is pulled but Chart.js destroys and
  recreates the chart on every poll. With a short timer this would
  flicker; cheap fix is to update `chart.data` and call
  `chart.update("none")` instead of `destroy()`.
- `assets/pbp.js:cssEscape` is a hand-rolled escape for class-name
  selectors. CSS.escape is widely available and would be safer.
- The home-page tonight cards re-render on each 15s poll — fine
  for now, but could mirror the PBP "skip if unchanged" guard.

### Must fix before shipping

- None. Built clean, runs clean.

## Future state — already documented in PRD

- Real Polymarket WSS feed (replaces mock markets)
- Cross-user comments behind a thin Node + SQLite proxy
- Contest-filter mode that surfaces only plays/markets relevant to
  the contest the user is currently inside
- In-app embedding via the same module mount points
- Per-game-type significance logic for which plays + market moves
  to surface

<!-- homework-status: complete -->
completed_at: 2026-05-01T22:50:31Z
