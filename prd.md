---
title: Splash Score Center — PRD
author: tj
created: 2026-05-01
status: draft
---

# Splash Score Center

A live, social play-by-play experience for sports — built as a v1
prototype that demonstrates how Splash can blend ESPN-grade scoreboard
data with the social reaction layer of Real Sports, then layer in
something neither does: live betting market context from Polymarket,
woven directly into the feed.

This v1 is a standalone web prototype. The longer-term ambition is to
embed these components inside the Splash app, website, and inside
contests themselves — with a per-contest filter that surfaces only
the plays, markets, and players relevant to the contest you are in.

## Why this exists

Splash players today leave the product to follow live games — they
open ESPN for play-by-play, theScore for scores, and Polymarket for
live odds. None of those tools talk to each other, and none of them
are social. **Splash Score Center makes the live game itself a social
surface, and pulls market context into the same feed as the action.**

The vision is bigger than a standalone app. Once the patterns are
right, the same components drop into:

- The contest leaderboard view, filtered to plays that affect the
  current contest (e.g. a play that swings 5%+ of survivor pool win
  probability in a Game 6).
- The home tab of the Splash app, as a daily "what's happening" pulse.
- Game-specific contest pages, where the play-by-play is the
  scoreboard.

This v1 proves the patterns. It is intentionally not embedded.

## Audience

- **Primary:** existing Splash players who want a richer, more social
  live-game companion than what they leave the app to find.
- **Secondary:** prospective players who land on Splash from a search
  for live scores, react to a play, and convert into a contest entry.

## Inspiration and prior art

- **ESPN ScoreCenter** — the gold-standard scoreboard ticker and the
  taxonomy for game pages (Gamecast, Box Score, Play-by-Play). The
  scoreboard page mirrors espn.com/nba/scoreboard.
- **Real Sports app** — every individual play is its own social unit
  with emoji reactions and a comment thread. Speed, density, and
  per-play ownership of the conversation.
- **Polymarket** — live, deep market coverage of every game. We do
  not replicate the betting interface; we surface the signal.

## The three pages

### 1. Home — Bracket and tonight's games

The landing experience. Three layers stacked vertically:

- **Sticky top score ticker** — horizontal scrollable row of every
  NBA game tonight, styled after the existing Splash QuickPicks
  matchup card with team logos, abbreviations, records or live
  scores, and game time or status added. Click a card → game view.
- **Hero — NBA 2026 Playoff Bracket** — full first-round bracket,
  East and West, with live series records (3-2, etc.). Each series
  cell is clickable and routes to the latest game in that series.
- **Tonight's games — preview cards** — a deeper card per game
  showing the matchup, key storylines (Game 6 elimination,
  series-defining), tip-off countdown, broadcast info, and a link
  to "Open Game Center."

Primary action: **click a game and enter the social feed.**

### 2. Scoreboard — All NBA games today

The "give me everything" page. Mirrors espn.com/nba/scoreboard:

- Same sticky top ticker as Home.
- Date selector (defaults to today).
- A vertically-stacked list of every NBA game on the selected date,
  each rendered as a wide card showing both teams' logos, names,
  records, line score by quarter, current score (or final), game
  status, broadcast info, and a couple of statistical highlights
  (top scorer, top rebounder).

Primary action: **scan all the action, pick a game, dive in.**

### 3. Game Center — The main event

The page that does the new work. Sticky game header at the top with
team logos, score, quarter, clock, and a compact win-probability
sparkline. Below, a tab bar:

#### Play-by-Play tab (default)

A reverse-chronological feed of every play in the game. Each play is
its own card with:

- Play description, timestamp (game clock), and team icon.
- Visual differentiation for scoring plays (accent color, icon).
- A quick emoji reaction bar — five preset emojis plus an "add" button
  for any emoji.
- Live floating emoji animation when reactions land.
- Comment count and an inline-expandable thread per play.

Interleaved into the play feed are **Market Move cards** — a new
class of feed item generated whenever any of the game's Polymarket
markets moves 5% or more between plays. They look like:

```
┌─────────────────────────────────────────────┐
│ 📈 MARKET MOVE  •  Q3 8:42                  │
│ Celtics ML  72% → 81%  (+9%)                │
│ Triggered by: Tatum 3PT (above)             │
│ [ Open on Polymarket ↗ ]                    │
│ 💬 12  🔥 8                                 │
└─────────────────────────────────────────────┘
```

Market Move cards are reactable and threadable like any play. The
"Open on Polymarket" CTA links out (no in-app betting in v1).

#### Box Score tab

Full ESPN-grade box score:

- Team totals: shooting splits, rebounds, assists, turnovers, steals,
  blocks, fouls.
- Per-player tables for both teams: MIN, FG, 3PT, FT, OREB, DREB,
  TOTAL REB, AST, STL, BLK, TO, PF, PTS, +/-.

#### Markets tab

A list of every Polymarket market available for this game. For each
market: current implied probability for each side, a sparkline of the
last hour of price action, and a link out to Polymarket. Markets in
v1: Moneyline, Spread, Total Points, First-Half Winner, Player Points
for the three star players per team.

#### Win Probability tab

A full-width line chart of win probability over the course of the
game so far, both teams plotted. Markers on the X axis where major
events happened (lead changes, 5%+ market moves, scoring plays).

#### Game Chat (always visible, right rail on desktop)

A global chat for this game alongside the tabs. Latest message at
the bottom, scroll for history. Same comment input pattern as
per-play threads.

## Identity and persistence

- No login. First time you write any comment or chat message, a
  modal asks for a display name and (optional) team affiliation.
- Both are persisted to `localStorage`. Subsequent visits skip the
  modal.
- Team affiliation surfaces as a small team-color badge next to your
  display name on every comment you make.
- All comments and reactions persist locally to `localStorage` —
  refreshing the page does not lose the state, and the existing
  comment volume seeds future visits.

This is intentionally lightweight for v1. A real launch would
authenticate against the existing Splash account.

## "Live" simulation

This is a static prototype, but a frozen demo would undersell it.
The site ships with a **simulator** that plays mock fixture data
through the UI on a configurable timer:

- One game (LAL @ HOU) in **progress** — clock ticking, plays landing
  every few seconds, win probability redrawing, market moves
  arriving.
- One game (DET @ ORL) at **halftime** — score and PBP frozen at
  the half, all data viewable.
- One game (CLE @ TOR) **pre-game** — countdown to tip with bracket
  context.

Every fixture is shaped to match SportRadar's response format so
swapping in a real API is a one-line change.

## Tonight's games (May 1, 2026 — real first-round Game 6 matchups)

| Matchup | Series | Tip | Demo state |
|---|---|---|---|
| DET @ ORL | ORL leads 3–2 | 7:00 PM ET | Halftime, ORL 58 – DET 54 |
| CLE @ TOR | CLE leads 3–2 | 7:30 PM ET | Live, Q3 8:42, CLE 71 – TOR 65 |
| LAL @ HOU | LAL leads 3–2 | 9:30 PM ET | Pre-game countdown |

All three are elimination games. The bracket context (every series at
3–2) makes for naturally high-stakes demo fixtures.

## Must-haves

- Sticky game ticker that runs on every page.
- Real NBA 2026 first-round bracket with current series records, full
  East and West.
- Live-feeling Game Center with PBP, Box Score, Markets, and Win
  Probability tabs.
- Market Move cards inline in the PBP feed, reactable and threadable.
- Per-play emoji reactions and threaded comments, persisted via
  `localStorage` and shared across visits.
- Three game fixtures, each with full PBP, full box score, win-prob
  history, and 7+ market price histories.
- Splash brand styling: dark nav (`#0e0e14`), light page (`#eef1f5`),
  signature teal (`#3ddbd3`), green for scores (`#22c55e`).
- Components built as self-contained modules (single mount point,
  scoped CSS, configurable via data attributes) so they can drop
  into the Splash app later without a refactor.

## Won't-haves (v1)

- No login or real Splash account integration.
- No real Polymarket or SportRadar API calls — fixture data only.
- No contest filter mode — global feed only.
- No per-game-type significance logic — the 5% market-move threshold
  is the only relevance filter in v1.
- No mobile-app embedding — built for web first.
- No real-time push to other users — `localStorage` is per-browser;
  comments do not propagate across machines in v1.

## Success criteria

- [ ] Three pages load and navigate to each other.
- [ ] Score ticker shows tonight's three real first-round Game 6
      matchups with the correct series records.
- [ ] Bracket renders all eight first-round series with accurate seeds
      and series scores.
- [ ] Game Center loads any of the three fixture games and shows
      consistent data across PBP, Box Score, Markets, and Win
      Probability tabs.
- [ ] Live simulator plays plays into the feed at a realistic pace,
      and the win-probability chart updates as plays land.
- [ ] Reactions and comments persist across refresh.
- [ ] Market Move cards appear inline in the PBP feed for every
      simulated 5%+ price swing.
- [ ] Splash branding (colors, type, logo lockup) is consistent.
- [ ] Passes a basic accessibility pass: semantic HTML, alt text,
      focus visible, keyboard-navigable, color contrast ≥ 4.5:1.

## Future state — explicitly out of scope for v1

The full ambition lives in v2+ and is captured here only so the v1
build does not foreclose it.

- **Contest filter mode.** When loaded inside a Splash contest, the
  PBP feed filters to plays involving teams or players in that
  contest, and to events that meet a per-contest-type significance
  threshold. Example: in a survivor pool, surface every play that
  swings the win probability of any team picked by ≥10% of the pool.
- **In-app embedding.** Drop-in components mount inside the Splash
  app and website. The same modules used in v1 ship behind feature
  flags into native containers.
- **Real-time multi-user state.** Comments, reactions, and chat sync
  across users via a real backend (auth, WebSockets, persistence).
- **Real data integrations.** SportRadar for play-by-play and box
  scores, Polymarket's CLOB API for live market data, with a thin
  Splash service caching and proxying both.
- **Per-game-type significance logic.** Per sport and per contest
  type, define what counts as a "show this play" event. NFL survivor
  has different signal than NBA QuickPicks.
- **Fanhood layer.** Claim a team, see your team-colored badge, and
  unlock fan-only chat threads inside game discussions.
