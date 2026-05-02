# Splash Score Center — Architecture

A single-page-per-route prototype that proves out the **social play-by-play +
Splash Quick Picks + Polymarket** experience as one cohesive product surface.
Plain HTML + ES module JS, no build step, no backend; everything renders from
public APIs and `localStorage`.

---

## Surface area

| Page | File | Job |
|---|---|---|
| Home | [`index.html`](index.html) | Sport filter, tonight's games preview cards, action shelf for Bracket / Standings / Stats |
| Scoreboard | [`scoreboard.html`](scoreboard.html) | ESPN-style daily scores by league |
| Bracket | [`bracket.html`](bracket.html) | NBA playoff bracket, live red border on tonight's series |
| Game Center | [`game.html`](game.html) | Live PBP, Box Score, Markets (Polymarket + Splash QP), Win Probability, side chat |

All four pages share the top nav (`<header class="nav">`) and the score
ticker (`<div class="ticker">`); both are mounted by a shared bootstrap module.

---

## Module map (`assets/`)

```
script.js          — bootstrap: nav, identity badge, ticker, common helpers
identity.js        — sign-up modal, getIdentity() / requireIdentity()
storage.js         — namespaced localStorage wrapper (chat / comments / reactions)
espn.js            — ESPN public API client (multi-sport scoreboard + summary)
quickpicks.js      — Splash Sports Quick Picks API client + ESPN↔Splash matching
home.js            — home page controller (sport filter, tonight cards, panels)
scoreboard.js      — scoreboard page controller (per-league lists, PGA leaderboard)
bracket-page.js    — full ESPN-style 7-column bracket
game.js            — game page controller (tab routing, live polling fan-out)
pbp.js             — play-by-play feed with reaction bar + threaded comments
boxscore.js        — per-team box score table
markets.js         — paired yes/no Polymarket cards + Splash QP player cards
winprob.js         — win-probability chart driven by ESPN's winprobability array
chat.js            — game chat sidebar (mobile slide-up sheet on small screens)
fakeusers.js       — ambient social activity simulator (toggleable)
```

```
data/
  bracket.json    — NBA 2025-26 playoff bracket fixture
  markets.json    — seeded Polymarket prices/links per ESPN event id
```

---

## Data sources

| Source | Endpoints | Auth | Used for |
|---|---|---|---|
| **ESPN public site API** | `site.api.espn.com/apis/site/v2/sports/{sport}/{league}/{scoreboard\|summary}` | none | Scoreboards, live game summaries, leaders, news article descriptions |
| **ESPN core API** | `sports.core.api.espn.com/.../seasons/{year}/types/2/leaders` | none | Career / season leader pools (not currently used) |
| **ESPN web stats API** | `site.web.api.espn.com/apis/common/v3/sports/{sport}/{league}/statistics/byathlete?sort={group.stat}:desc` | none | Stat-leader cards on home (PPG, RPG, AVG, HR, ERA, etc.) |
| **ESPN standings API** | `site.api.espn.com/apis/v2/sports/{sport}/{league}/standings` | none | Conference / division standings panel on home |
| **Splash Sports** | `api.splashsports.com/props-service/api/{props,filters,v1/popular}` | none | Quick Picks props per game; popularity ordering |
| **Polymarket** | (seeded JSON; live WSS planned) | none | Market prices and event deep-links |

Every endpoint above returns `Access-Control-Allow-Origin: *`, so calls go
direct from the browser. **No proxy. No backend. No keys.**

---

## State

Everything that survives a refresh lives in `localStorage` under the
`splash-sc:` namespace via [`storage.js`](assets/storage.js):

- `splash-sc:chat:{gameId}` — chat messages per game
- `splash-sc:comments:{gameId}:{playId}` — threaded comments on a play
- `splash-sc:reactions:{gameId}:{playId}` — emoji reactions on a play
- `splash-sc:identity` — `{ name, team }`
- `ssc:home:league` — active sport on home (sessionStorage)

---

## Live update model

```
ESPN summary endpoint (10s poll)
        │
        ▼
   game.js :: pollSummary
        │
        ├──► pbp.js          (new plays → cards + reactions)
        ├──► boxscore.js     (per-player stats)
        ├──► winprob.js      (chart update)
        └──► markets.js      (price evolution + swing detection)
                  │
                  └──► pbp.js :: injectMarketMove
                       (cards reading "Pistons moneyline jumped +6%
                        after this play" inline in the feed)
```

Home/scoreboard pages poll the league scoreboard every 15 s. Bracket page
is a static render but the ticker above it pulls live scores.

---

## What's prototype vs. production-ready

**Prototype-only (intentional shortcuts):**
- Polymarket prices are seeded from a manual capture and evolved with a toy
  in-browser model. Real WSS feed is the next step (see `INTEGRATION.md`).
- Comments / reactions / chat are local — no shared state across viewers.
- Storylines for the 3 NBA Game-7s are hardcoded; everything else is hydrated
  from `summary.article.description`.

**Already production-shape:**
- Two-sided Splash-styled market cards with live history lines are the same
  shape the live Polymarket WSS would feed.
- Splash Quick Picks integration uses the public API with no auth and could
  drop into production behind the existing auth gate by swapping the base URL.
- ESPN bindings are written sport-agnostically (NBA / MLB / NHL all share the
  same code path; PGA has its own leaderboard renderer).

---

## Adding a new league

1. Add it to `LEAGUES` in [`espn.js`](assets/espn.js) with sport / league /
   accent color.
2. Add it to `HOME_LEAGUES` in [`home.js`](assets/home.js) for the sport filter.
3. Add a `STAT_CATEGORIES[league]` block in `home.js` for season leaders.
4. (Optional) Add a sport-specific live status formatter to
   `formatLiveStatus()` in `home.js` and `script.js`.

No data fixtures required — ESPN drives everything.
