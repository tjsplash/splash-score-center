---
title: Splash Score Center — Tech Spec
author: tj
status: draft
---

# Splash Score Center — Tech Spec

## Stack

- HTML5 + CSS3 + vanilla JS (ES modules).
- **Chart.js** via CDN — win probability + market sparklines.
- **No build step, no framework, no backend.**
- Live data via the public ESPN endpoints (CORS-enabled, no key).
- Polymarket-style markets are mocked but driven off real ESPN play
  events.

## File layout

```text
websites/splash-score-center/
  index.html              # Home — bracket + ticker + tonight's games
  scoreboard.html         # Page 2 — ESPN-style all NBA games today
  game.html               # Page 3 — Game Center (?id=<eventId>)
  assets/
    styles.css            # All shared styles
    script.js             # Shared bootstrap + nav + ticker
    espn.js               # ESPN public-API client + polling
    bracket.js            # Bracket renderer
    scoreboard.js         # Scoreboard list page
    game.js               # Game Center controller (tabs, header, polling)
    pbp.js                # Play-by-play feed + reactions + comments
    boxscore.js           # Box score renderer
    markets.js            # Markets tab + market-move card generator
    winprob.js            # Win probability chart + sparkline
    chat.js               # Right-rail game chat
    identity.js           # Display name + team affiliation modal
    storage.js            # localStorage helpers (comments, reactions)
  data/
    bracket.json          # NBA 2026 first-round bracket fixture
    markets.json          # Per-game market fixtures (mock Polymarket)
```

## ESPN public API

CORS-enabled, no auth. Endpoints used:

- `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard`
  — list of today's games, status, scores.
- `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=<id>`
  — full game data: plays, box score, win probability, leaders.

Polling cadence:

- Scoreboard endpoint: every 15s on Home and Scoreboard pages.
- Summary endpoint: every 10s on the active Game Center page.
- All polling pauses when the tab loses focus
  (`document.hidden`).

## Component module pattern

Every visual component exports a single `mount(rootEl, opts)` function
that fully owns its DOM subtree and listens for any data-source events.
Components do not reach outside their root. This keeps them
embeddable later inside the Splash app.

## Event bus

A tiny `EventTarget` singleton in `script.js` is the spine for live
updates. Modules dispatch and subscribe:

- `play:new` — fired by `espn.js` for each new play.
- `score:update` — fired on score deltas.
- `winprob:tick` — fired on every win-prob refresh.
- `market:move` — fired by `markets.js` when a synthetic price moves
  ≥5% based on a `play:new`.
- `comment:add`, `reaction:add` — fired by user interactions.

## Live simulation of Polymarket

In v1, no real Polymarket calls. `markets.js` boots with realistic
seeded markets per game (moneyline, spread, total points,
first-half winner, three player-points props). A play handler updates
prices on each `play:new` based on the play's effect on score and time
remaining. When a price tick crosses 5% from the last "snapshot,"
emit `market:move` and snapshot.

## Win probability

Use ESPN's `winprobability` array from the summary response. Render
as a Chart.js line chart. Emit `winprob:tick` every poll for the
sticky sparkline in the game header.

## Identity

`identity.js` exposes `getIdentity()` and `setIdentity({name, team})`.
First call to `requireIdentity()` opens a modal if absent. Stored at
`splash-sc:identity` in localStorage.

## Comments and reactions

Stored at `splash-sc:comments:<gameId>:<playId>` and
`splash-sc:reactions:<gameId>:<playId>` in localStorage. JSON-encoded
arrays. Re-rendered from disk on each play-card mount.

## Palette

```css
:root {
  --bg-dark:    #0e0e14;
  --bg-page:    #eef1f5;
  --bg-card:    #ffffff;
  --teal:       #3ddbd3;
  --teal-deep:  #00a89f;
  --green:      #22c55e;
  --text-light: #ffffff;
  --text-dark:  #111827;
  --text-mute:  #6b7280;
  --border:     #e5e7eb;
  --shadow:     0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
}
```

## Typography

- System UI stack (`-apple-system, BlinkMacSystemFont, Inter, sans`).
- Headings: weight 700, tighter line-height.
- Body: weight 400, 1.5 line-height.
- Numerals: tabular for scores and tables.

## A11y / quality bar

- Semantic landmarks (`<header>`, `<main>`, `<nav>`, `<aside>`).
- Every `<img>` has meaningful `alt`.
- Color contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text.
- Focus visible everywhere; no click-only interactions.
- Keyboard navigation through tabs, plays, comments.
- Responsive at 360px, 768px, 1024px+.
