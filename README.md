# Splash Score Center

A live, social play-by-play prototype for Splash Sports — three pages
of live NBA action with the social reaction layer of Real Sports and
Polymarket-context surfaced inline in the feed.

**Live:** https://tjsplash.github.io/splash-score-center/

## What it does

- **Home** — Tonight's games at a glance, plus the full NBA 2026
  Playoff bracket with a round-switcher (First Round / Second Round /
  Conference Championships / NBA Finals).
- **Scoreboard** — ESPN-style list of every NBA game today with live
  scores, line scores, leaders, broadcast info.
- **Game Center** — Sticky game header with live score + win-prob
  sparkline, then four tabs:
  - **Play-by-Play** — every play as its own card with quick-emoji
    reactions and a threaded comment input. Market Move cards
    (5%+ swings on any tracked Polymarket line) interleave inline.
  - **Box Score** — full ESPN-grade per-player stats once the game
    tips off.
  - **Markets** — eight per-game markets (Moneyline x2, Spread, Total,
    1H Moneyline, two Player Points, Series Winner) seeded with real
    opening prices from `gamma-api.polymarket.com` and linking to the
    actual Polymarket events.
  - **Win Probability** — full chart driven by ESPN's
    `winprobability` array.
- **Game Chat** sidebar — Real Sports-style: quick-emoji buttons,
  per-message reactions, floating emoji animation, optional team-color
  badges.

## Stack

- Plain HTML + CSS + vanilla JS (ES modules), no build step.
- Chart.js via CDN for win-prob and market sparklines.
- Live data from ESPN's public API
  (`site.api.espn.com/apis/site/v2/sports/basketball/nba/...`).
- No backend: comments and reactions persist via `localStorage`.

## Local dev

```bash
python3 -m http.server 8765
```

Then open <http://localhost:8765/>.

## Comments are local

Comments, reactions, and chat messages are stored in `localStorage` —
they live on the device that posted them and don't sync across
viewers. The next iteration would add a tiny backend (proposed:
Vercel + Supabase or Cloudflare Workers + KV) for shared state.

## Future state

- Real Polymarket WSS feed (replaces synthetic price evolution)
- Cross-user comments + chat behind a thin backend
- Contest-filter mode that surfaces only plays/markets relevant to
  the contest the viewer is currently inside
- Per-game-type significance logic
- In-app embedding of these modules into the Splash app
