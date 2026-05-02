# Splash Score Center — Integration brief

How this prototype slots into the production Splash Sports app, what's
already production-ready, and what would need to be built. Intended for an
engineering / product conversation with the CTO.

---

## TL;DR

Three product surfaces, glued together by one live data stream:

1. **Score Center** — daily scoreboard, brackets, recap-aware game previews.
2. **Live Game Center** — play-by-play with reactions, social chat, box score,
   win probability.
3. **Inline Markets layer** — Splash Quick Picks props + Polymarket prices,
   visible *next to the play that moved them*.

The prototype shows that all three can live on a single page surface with a
single live polling loop without feeling crowded. The screen the user spends
time on is the **Game Center** — that's the centerpiece.

---

## What we'd reuse as-is

- **Splash Quick Picks API client** ([`assets/quickpicks.js`](assets/quickpicks.js))
  — wraps `api.splashsports.com/props-service/api`. Already public, CORS-open,
  no auth required. Already returns the data we need (props per game, by
  player, with team alias and primary color).
- **ESPN data layer** ([`assets/espn.js`](assets/espn.js)) — multi-sport
  normalization (NBA, MLB, NHL today; PGA scoreboard separately). Returns a
  consistent `event` shape regardless of league.
- **Markets pairing logic** ([`assets/markets.js`](assets/markets.js)) — yes/no
  pairing, opposite-side synthesis, dual-line history charts. Same data shape
  works whether prices come from a JSON seed (today) or a live WSS feed
  (production).

---

## What we'd swap in for production

| Prototype | Production |
|---|---|
| Seeded `data/markets.json` | Polymarket WSS live prices via `gamma-api.polymarket.com` (event ids already captured) |
| `localStorage` chat / comments / reactions | A backend (Vercel + Supabase or Cloudflare Workers + KV) so state syncs across viewers |
| Hardcoded NBA storylines for 3 events | ESPN `summary.article.description` (already wired as the primary source — hardcoded copy is the fallback) |
| `fakeusers.js` ambient activity | Real users, possibly seeded with public commentator handles for the first month |
| Plain HTML pages | Drop Game Center / Markets components into the existing Splash app's React shell |

---

## Polymarket integration plan

1. Subscribe to Polymarket's WSS feed for the markets we care about
   (Moneyline, Spread, Total per game; player-prop markets where they exist).
2. Map each Polymarket market id → our internal `pair.yes.id` and feed prices
   into the existing `advanceSide()` reducer in `markets.js`.
3. Keep the swing-detection layer as-is — it already emits "Market Move"
   cards into the PBP feed when ≥5% swings happen.

The synthesizing of an opposite side at `1 − p` (Spread, Total, etc.) goes
away once Polymarket gives us both sides directly.

---

## Splash Quick Picks integration plan

The prototype already calls the live Splash API. Two productization steps:

1. **Identity bridge.** When a user is authenticated in the Splash app, the
   "More / Less" pills in our markets section should one-tap-add to their
   in-progress entry rather than open a new tab. That's a deeplink + auth
   token hand-off; the data layer is already correct.
2. **Player image lookup.** Splash's prop response gives us `entity_id`,
   `entity.player_details`, and a team UUID, but no player photo. ESPN has
   per-player headshots keyed by their own ID. We have two options:
   a) ask the Splash API team to add a `player_image_url` to the prop
      response, or
   b) build a name → ESPN-id index from the cached ESPN summary on game pages
      and use it client-side.

   The prototype currently uses player-initials avatars; that's a fine
   starting point.

---

## Backend that we need (eventually)

**Right now:** none.

**For shared state** (chat, comments, reactions across viewers):
- Tiny REST API (or WebSocket) for `chat:{gameId}` messages.
- Object store for per-play comments and reactions, fan-out via WS.
- Recommendation: Cloudflare Durable Objects per game id — natural sharding,
  millisecond fanout, no cold-start.

**For trade execution** (one-tap onto a Splash entry):
- Existing Splash entry-builder API. The markets module already has the
  player + line + over/under primitives needed to construct a pick payload.

---

## Open product questions

1. **Where does Markets live?** Today it's a tab inside Game Center. Should it
   also exist as a standalone surface, or be allowed to *expand inline* in the
   PBP feed (the way Polymarket cards interleave today)?
2. **How prominent is the chat?** Desktop has it as a fixed right rail; mobile
   is a slide-up sheet. Real Sports leans heavy on chat; do we want chat
   *above* the play-by-play on mobile?
3. **Cross-game persistence.** When a user navigates from a live NBA game to
   an MLB game, what (if anything) carries over? Today: nothing — chat scopes
   per game. Maybe their followed-players list, or a "favorite teams" filter
   that prioritises certain games on home.
4. **Quick Picks lineup awareness.** If a user has props in their Splash entry
   for tonight's game, the play-by-play could highlight plays involving those
   players. The data is all client-side.

---

## Risks / non-obvious

- **Splash API is unauthenticated and public** today. That's how we got
  unblocked. If they add auth, the prototype's `quickpicks.js` is a single-
  function change (add an auth header passthrough); the rest is unchanged.
- **ESPN endpoints are technically undocumented public.** They've been stable
  for years (sports apps and aggregators rely on them) but they're not a
  contract. For production we'd want a thin server-side proxy with caching
  to insulate us from rate limits and shape changes.
- **Polymarket's WSS feed has occasional gaps**; a small client-side reconnect
  + last-known-price cache (already present for the seed feed) covers it.

---

## Suggested first ship

A read-only "Score Center" inside the existing Splash app — Home + Game
Center, with the Markets tab already showing Splash QP props pulled from the
existing API. Zero backend, zero new auth, zero new infra. Polymarket pricing
can be a later phase since it's the part that needs a real-time feed.
