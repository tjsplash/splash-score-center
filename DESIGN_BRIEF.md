# Splash Score Center — Design brief

For the lead designer. The prototype is engineer-built (so the design is
"reasonable" rather than "considered"). This doc captures every visual /
interaction decision I made along with the open questions I'd love your eye
on.

---

## Component inventory

These are the named UI elements I'd treat as the design surface:

| Component | Where | Notes |
|---|---|---|
| **Top nav** | every page | Logo at 22 px desktop / 18 px mobile; SCORE CENTER tag with teal accent; identity badge with team chip |
| **Score ticker** | every page | League divider chips; horizontal-scroll cards; live cards have teal left-border |
| **Sport filter (home)** | home only | Pill row, NBA selected by default, persists in sessionStorage |
| **Tonight card** | home | Per-game preview: matchup, score (live/final), recap line, market preview row, QP preview row, "Open Game Center →" CTA |
| **Action shelf** | home | Bracket / Standings / Stats — context-aware (NBA gets Bracket, MLB/NHL don't) |
| **Standings panel** | home (inline) | Conference/division mini tables |
| **Stats panel** | home (inline) | Top-5 leaders per stat category, sport-specific |
| **Bracket grid** | bracket page | 7-column ESPN-style with connector lines and live-game red border |
| **Game Center header** | game | Sticky team logos + score + status + win-prob sparkline |
| **Game Center tabs** | game | Play-by-Play / Box Score / Markets / Win Probability |
| **Play card** | game / pbp tab | Time, scoring border, reactions row, threaded comments |
| **Market Move card** | game / pbp tab | Inline interruption when a market swings ≥5% on a play |
| **Polymarket pair card** | game / markets tab | Type label, dual-line chart, two team-coloured pills with %, small ↗ Polymarket link |
| **Splash QP player card** | game / markets tab | Avatar, team logo, name, prop rows with More/Less pills |
| **Game chat** | game | Quick-emoji bar, threaded reactions, floating emoji on send |

---

## Decisions I made you'll probably want to revisit

### Color
- Teal primary (`#4BEBE2`) and teal-deep (`#1BC4CF`) for CTAs and accents
- Off-black (`#101113`) for nav and dark surfaces
- Per-team primary colors lifted from team data — used on Splash QP card
  top-strokes and on Polymarket pill borders
- Polymarket markets are styled in **Splash colors**, not Polymarket's purple,
  per a product call to keep the visual ownership clearly Splash. The "↗
  Polymarket" link is the only Polymarket branding touch on each card.

### Type
- Inter, weights 400 / 500 / 600 / 700 / 800
- `font-feature-settings: "tnum" 1` for tabular numerals (scores, prices, lines)
- All-caps + letter-spacing for eyebrows and meta rows

### Density
- Tonight cards are intentionally dense — they show story + score + 3 markets
  + 3 picks + CTA in a single card. Could feel busy. Open question whether
  to split this into two stacked cards or a hover-expand interaction.
- Markets tab uses a 2-column grid for Polymarket pairs and a 3-column grid
  for Splash player cards on wide screens.

### Mobile
- Hard breakpoint at 768 px:
  - Top nav links → bottom tab bar
  - Right-rail chat → slide-up sheet (with handle + dismiss-on-backdrop)
  - Markets/Stats grids collapse to single column
- Bracket page becomes horizontal-scroll (the 7-column grid doesn't reflow
  cleanly without breaking the visual).

### Motion
- Floating emoji animation on chat send (1.5 s float-up)
- Skeleton shimmer on tonight cards / standings / stats (1.4 s loop)
- Hover lift on tonight cards and Splash QP pills
- That's it — no other motion. The market sparklines are static (one chart
  redraw per ESPN poll, every 10 seconds).

---

## What I'd love your eye on

### Tonight card layout
Currently: status row · matchup · story · QP+Markets preview · CTA — five
content rows in one card. Reads okay on desktop but mobile gets long. Options
I considered:
- **Tabs inside the card** (Story / Picks / Markets) — feels heavy
- **Collapsible preview section** — adds an interaction
- **Split into two cards** — story card + props card — I'd recommend this if
  we add more depth (e.g. recent head-to-head, last-5 form chart)

### Game Center hierarchy
The hierarchy today is: Header → Tabs → Panel content. The chat sidebar
competes with the panel content visually. Real Sports puts chat *above the
play feed* on mobile; we put it behind a sheet. Worth A/B-ing.

### Splash QP card — More/Less buttons
Splash's actual app uses **MORE** / **LESS** verbs (not Over/Under). I
matched that. On hover the pill border picks up a green/red tint. Open:
- Should "More" be visually heavier than "Less" since it's the more common
  selection?
- Should we surface the player headshot? Today it's an initials avatar with
  the team-color gradient (Splash API doesn't return a photo URL — see
  `INTEGRATION.md` for options).
- Today the line is shown twice (More 24.5, Less 24.5). Splash's actual app
  doesn't repeat. We probably shouldn't either, but it does make hit-targets
  larger.

### Polymarket pair card
Two team-coloured pills + dual-line chart + ↗ Polymarket link. Open:
- Does the dual-line chart belong on each card, or only on tap?
- Should the chart show *who's leading* with a label callout (like the
  reference Polymarket UI) or stay minimal?

### Bracket
ESPN-style 7-column grid with connector lines. Live games get a red border.
Open:
- Do the round-header pills carry their weight, or could we drop them?
- The TBD placeholder cards (East R3 etc.) are decorative but might be too
  loud — they could be lighter or omitted.

### Identity
Right now: name + single team chip in the nav, single-team selection at
sign-up. Product wants **multi-sport team affinities** (NBA, NFL, MLB, NHL,
all optional, all displayed on every comment). Not yet built; this is one of
the next-iteration items.

---

## Reference patterns we partially follow

- **ESPN.com** — bracket grid, scoreboard layout, leader categories
- **The Athletic / Real Sports** — chat-as-sidebar, quick-emoji bar
- **Polymarket** — yes/no two-side display with dual-line history; we
  recolored to Splash teal but the card structure is the same
- **PrizePicks / Underdog** — More/Less pills inside per-player cards (Splash
  uses this pattern in their actual app)

---

## Files / handoff

If you want to fork the styles for a Figma mock:
- All shared tokens are in `:root` of [`assets/styles.css`](assets/styles.css)
  — ~30 CSS variables for colors, radii, shadows, fonts.
- Each component's CSS lives near its module section in the same file (search
  for `===== Markets tab =====`, `===== Game Center =====`, etc.).
- The four HTML pages are static — you can open any of them in a browser
  with no build step (just a static file server: `python3 -m http.server 8765`).
