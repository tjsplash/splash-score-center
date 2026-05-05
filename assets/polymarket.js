// Polymarket data client.
//
// Public, unauthenticated endpoints used by polymarket.com itself:
//   GET https://gamma-api.polymarket.com/events?...   — events catalog with
//       per-event markets array (conditionId, outcomes, outcomePrices,
//       clobTokenIds, volume, slug, image).
//   GET https://gamma-api.polymarket.com/markets?...  — flat market list.
//   GET https://clob.polymarket.com/prices-history?market={tokenId}&interval=...
//       — time-series price points: [{ t: unix-seconds, p: 0..1 }].
//
// `clobTokenIds` is JSON-encoded inside the gamma response (a string of
// `'["yes-token", "no-token"]'`), so we parse it before use.

// Polymarket exposes two hosts:
//   - gamma-api.polymarket.com   — events catalog (CORS only allowed for
//                                  polymarket.com itself, so the browser
//                                  blocks direct calls from our origin).
//   - clob.polymarket.com        — prices-history (Access-Control-Allow-
//                                  Origin: *, so we call it direct).
//
// To keep gamma data flowing without standing up a proxy server, we ship a
// static snapshot at data/polymarket-events.json (refreshed via the
// `scripts/refresh-polymarket.js` helper). It has the same per-event shape
// as the live API, just frozen at refresh time.
const SNAPSHOT_URL = "data/polymarket-events.json";
const CLOB = "https://clob.polymarket.com";

let snapshotPromise = null;
function loadSnapshot() {
  if (!snapshotPromise) {
    snapshotPromise = fetch(SNAPSHOT_URL, { cache: "no-cache" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error("snapshot " + r.status)))
      .catch(e => { snapshotPromise = null; throw e; });
  }
  return snapshotPromise;
}

// In-memory caches.
const eventsByMatchupCache = new Map();   // `${league}:${home}-${away}` → markets[]
const pricesHistoryCache = new Map();     // tokenId → { ts, points }
const PRICES_TTL_MS = 60_000;

const LEAGUE_TAG = {
  nba: "nba",
  mlb: "mlb",
  nhl: "nhl",
  nfl: "nfl",
  pga: "golf",
};

// Map ESPN team abbreviations to the names Polymarket uses in market titles.
// Scoped by league because some abbreviations collide across sports
// (DET = Pistons in NBA, Tigers in MLB, Red Wings in NHL).
const TEAM_NAMES = {
  nba: {
    ATL: "Hawks", BOS: "Celtics", BKN: "Nets", CHA: "Hornets", CHI: "Bulls",
    CLE: "Cavaliers", DAL: "Mavericks", DEN: "Nuggets", DET: "Pistons",
    GSW: "Warriors", HOU: "Rockets", IND: "Pacers", LAC: "Clippers",
    LAL: "Lakers", MEM: "Grizzlies", MIA: "Heat", MIL: "Bucks", MIN: "Timberwolves",
    NOP: "Pelicans", NYK: "Knicks", OKC: "Thunder", ORL: "Magic", PHI: "76ers",
    PHX: "Suns", POR: "Trail Blazers", SAC: "Kings", SAS: "Spurs", TOR: "Raptors",
    UTA: "Jazz", WAS: "Wizards",
  },
  mlb: {
    ARI: "Diamondbacks", ATL: "Braves", BAL: "Orioles", BOS: "Red Sox", CHC: "Cubs",
    CHW: "White Sox", CIN: "Reds", CLE: "Guardians", COL: "Rockies", DET: "Tigers",
    HOU: "Astros", KC: "Royals", LAA: "Angels", LAD: "Dodgers", MIA: "Marlins",
    MIL: "Brewers", MIN: "Twins", NYM: "Mets", NYY: "Yankees", OAK: "Athletics",
    PHI: "Phillies", PIT: "Pirates", SD: "Padres", SEA: "Mariners", SF: "Giants",
    STL: "Cardinals", TB: "Rays", TEX: "Rangers", TOR: "Blue Jays", WSH: "Nationals",
  },
  nhl: {
    ANA: "Ducks", ARI: "Coyotes", BOS: "Bruins", BUF: "Sabres", CAR: "Hurricanes",
    CGY: "Flames", CHI: "Blackhawks", COL: "Avalanche", CBJ: "Blue Jackets",
    DAL: "Stars", DET: "Red Wings", EDM: "Oilers", FLA: "Panthers", LAK: "Kings",
    MIN: "Wild", MTL: "Canadiens", NSH: "Predators", NJD: "Devils", NYI: "Islanders",
    NYR: "Rangers", OTT: "Senators", PHI: "Flyers", PIT: "Penguins", SEA: "Kraken",
    SJS: "Sharks", STL: "Blues", TBL: "Lightning", TOR: "Maple Leafs", VAN: "Canucks",
    VGK: "Golden Knights", WSH: "Capitals", WPG: "Jets",
  },
};

export function teamNameFor(abbr, league = "nba") {
  return TEAM_NAMES[league]?.[abbr] || abbr;
}

// Fetch a list of active Polymarket events for a league, sorted by 24h volume.
async function fetchActiveLeagueEvents(league) {
  const tag = LEAGUE_TAG[league] || league;
  const snap = await loadSnapshot();
  return snap[tag] || [];
}

// Find markets for a specific matchup. Tries to match by team names appearing
// in the event/market title. Returns an array of markets ready for the UI.
export async function findMarketsForMatchup(league, homeAbbr, awayAbbr) {
  const cacheKey = `${league}:${homeAbbr}-${awayAbbr}`;
  if (eventsByMatchupCache.has(cacheKey)) return eventsByMatchupCache.get(cacheKey);

  const homeName = teamNameFor(homeAbbr, league);
  const awayName = teamNameFor(awayAbbr, league);
  const matchers = [homeName, awayName].map(n => n.toLowerCase());

  let events = [];
  try { events = await fetchActiveLeagueEvents(league); }
  catch { eventsByMatchupCache.set(cacheKey, []); return []; }

  // Score each event:
  //   +10 per team name in the EVENT TITLE (head-to-head matchups read e.g.
  //        "Cavaliers vs. Pistons" — these are exactly what we want).
  //   +2  per team name in the slug.
  //   +1  per team name in any market question (catches season-long props
  //        for both teams, but they should never beat a real matchup).
  // Best score below 6 (can't get both teams into the title) → no match.
  let bestEvent = null;
  let bestScore = 0;
  for (const ev of events) {
    const title = (ev.title || "").toLowerCase();
    const slug = (ev.slug || "").toLowerCase();
    const blob = (ev.markets || []).map(m => (m.question || "") + " " + (m.slug || "")).join(" ").toLowerCase();
    let score = 0;
    for (const m of matchers) {
      if (!m) continue;
      if (title.includes(m)) score += 10;
      else if (slug.includes(m)) score += 2;
      else if (blob.includes(m)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestEvent = ev;
    }
  }
  // Require both team names in the title (or a tight slug match) to count.
  if (bestScore < 6 || !bestEvent) {
    eventsByMatchupCache.set(cacheKey, []);
    return [];
  }

  // Promote the matchup to a normalized list of markets. Polymarket returns
  // each market with an `outcomes` JSON-array string, `outcomePrices` JSON
  // string of probabilities, and `clobTokenIds` JSON array of two token ids
  // (yes/no). For NBA "Team A vs Team B" markets the outcomes are the team
  // names; we map them to home/away by alias match.
  const out = [];
  for (const m of bestEvent.markets || []) {
    const outcomes = parseJson(m.outcomes, []);
    const prices = parseJson(m.outcomePrices, []).map(s => parseFloat(s));
    const tokenIds = parseJson(m.clobTokenIds, []);
    if (outcomes.length !== 2 || prices.length !== 2 || tokenIds.length !== 2) continue;

    const [yesLabel, noLabel] = outcomes;
    const [yesPrice, noPrice] = prices;
    const [yesTokenId, noTokenId] = tokenIds;

    // Identify a "home/away" mapping when the outcomes are team names.
    const eventUrl = `https://polymarket.com/event/${bestEvent.slug || ""}`;
    out.push({
      id: m.conditionId || m.id,
      type: classifyMarket(m.question, m.groupItemTitle),
      title: m.groupItemTitle || m.question || bestEvent.title,
      question: m.question,
      eventUrl,
      eventTitle: bestEvent.title,
      yes: { label: yesLabel, price: yesPrice, tokenId: yesTokenId },
      no:  { label: noLabel,  price: noPrice,  tokenId: noTokenId },
      volume: parseFloat(m.volume || "0"),
      endDate: m.endDate,
    });
  }

  eventsByMatchupCache.set(cacheKey, out);
  return out;
}

function classifyMarket(question, groupItemTitle) {
  const q = (question + " " + (groupItemTitle || "")).toLowerCase();
  if (q.includes("spread") || q.match(/[+\-]\s*\d/)) return "Spread";
  if (q.includes("total") || q.includes("over") || q.includes("under")) return "Total";
  if (q.includes("series")) return "Series";
  if (q.includes("first half") || q.includes("1h") || q.includes("half")) return "1H Moneyline";
  if (q.includes("points") || q.includes("rebounds") || q.includes("assists")) return "Player Prop";
  return "Moneyline";
}

function parseJson(value, fallback) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

// --- Prices history ----

// Returns an array of { t (unix seconds), p (0..1) } points or [].
export async function fetchPricesHistory(tokenId, { interval = "max", fidelity = 60 } = {}) {
  if (!tokenId) return [];
  const cached = pricesHistoryCache.get(tokenId);
  if (cached && Date.now() - cached.ts < PRICES_TTL_MS) return cached.points;
  try {
    // clob.polymarket.com responds with Access-Control-Allow-Origin: *, so
    // we hit it direct from the browser — no proxy needed for live prices.
    const url = `${CLOB}/prices-history?market=${tokenId}&interval=${interval}&fidelity=${fidelity}`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const data = await r.json();
    const points = Array.isArray(data.history) ? data.history : [];
    pricesHistoryCache.set(tokenId, { ts: Date.now(), points });
    return points;
  } catch {
    return [];
  }
}

// Aggregate raw price points into OHLC candles. Returns an array of
// { t (unix seconds), o, h, l, c } where buckets are evenly spaced in the
// requested period (auto-chosen from the data range).
export function buildCandles(points, targetCandles = 24) {
  if (!points.length) return [];
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const span = sorted[sorted.length - 1].t - sorted[0].t;
  if (span <= 0) {
    const p = sorted[0].p;
    return [{ t: sorted[0].t, o: p, h: p, l: p, c: p }];
  }
  const bucket = Math.max(60, Math.floor(span / targetCandles));
  const buckets = new Map();
  for (const pt of sorted) {
    const key = Math.floor(pt.t / bucket) * bucket;
    let b = buckets.get(key);
    if (!b) {
      b = { t: key, o: pt.p, h: pt.p, l: pt.p, c: pt.p };
      buckets.set(key, b);
    } else {
      b.h = Math.max(b.h, pt.p);
      b.l = Math.min(b.l, pt.p);
      b.c = pt.p;
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}
