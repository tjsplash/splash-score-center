// Splash Sports Quick Picks API client.
// Public, unauthenticated. Reverse-engineered from app.splashsports.com:
//   GET /props-service/api/filters       — leagues + games (used for ESPN matching)
//   GET /props-service/api/props         — props for a game (?league=&game_id=&limit=)
//   GET /props-service/api/v1/popular    — props ordered by popularity
//
// CORS allows '*' so we call it directly from the browser.

const BASE = "https://api.splashsports.com/props-service/api";

let filtersPromise = null;
let popularPromise = null;
const propsByGameCache = new Map();
const espnMatchCache = new Map(); // `${league}:${homeAbbr}-${awayAbbr}` → splash gameId | null

export async function fetchSplashFilters() {
  if (!filtersPromise) {
    filtersPromise = fetch(`${BASE}/filters`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`splash filters ${r.status}`)))
      .then(d => d.filters || d)
      .catch(e => { filtersPromise = null; throw e; });
  }
  return filtersPromise;
}

export async function fetchPopularProps() {
  if (!popularPromise) {
    popularPromise = fetch(`${BASE}/v1/popular?limit=100`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`splash popular ${r.status}`)))
      .then(d => d.data || [])
      .catch(e => { popularPromise = null; throw e; });
  }
  return popularPromise;
}

export async function fetchPropsForGame(splashGameId, league) {
  const key = `${league}:${splashGameId}`;
  if (propsByGameCache.has(key)) return propsByGameCache.get(key);
  const url = `${BASE}/props?league=${league}&game_id=${splashGameId}&limit=200`;
  const p = fetch(url)
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`splash props ${r.status}`)))
    .then(d => d.data || [])
    .catch(e => { propsByGameCache.delete(key); throw e; });
  propsByGameCache.set(key, p);
  return p;
}

// Match an ESPN event to a Splash game by team aliases. ESPN abbr → Splash alias
// is mostly identical (DET, BOS, NYK, …); we ignore home/away orientation since
// some sports flip it. Returns Splash gameId or null.
export async function matchEspnToSplash(ev) {
  if (!ev?.home?.abbr || !ev?.away?.abbr) return null;
  const cacheKey = `${ev.league}:${ev.home.abbr}-${ev.away.abbr}`;
  if (espnMatchCache.has(cacheKey)) return espnMatchCache.get(cacheKey);

  let result = null;
  try {
    const filters = await fetchSplashFilters();
    const lg = (filters.leagues || []).find(l => l.id === ev.league);
    if (lg) {
      const home = ev.home.abbr;
      const away = ev.away.abbr;
      const match = (lg.games || []).find(g => {
        const a = g.home?.alias;
        const b = g.away?.alias;
        return (a === home && b === away) || (a === away && b === home);
      });
      if (match) result = { id: match.id, league: lg.id, splashGame: match };
    }
  } catch { /* fall through */ }

  espnMatchCache.set(cacheKey, result);
  return result;
}

// Top N popular props for a specific Splash game. Falls back to the plain
// /props ordering when /v1/popular has no entries from this game in its top
// pool (popular pool is global across all sports, ~100 entries).
export async function popularPropsForGame(splashGameId, league, n = 3) {
  try {
    const popular = await fetchPopularProps();
    const matches = popular.filter(p => p.game_id === splashGameId);
    if (matches.length >= n) return matches.slice(0, n);
    if (matches.length > 0) {
      // Top up with non-popular game props if needed.
      const extras = await fetchPropsForGame(splashGameId, league);
      const seen = new Set(matches.map(m => m.id));
      for (const p of extras) {
        if (matches.length >= n) break;
        if (!seen.has(p.id)) matches.push(p);
      }
      return matches.slice(0, n);
    }
    // Nothing in popular for this game — fall back to game's own ordering.
    const all = await fetchPropsForGame(splashGameId, league);
    return all.slice(0, n);
  } catch {
    return [];
  }
}

// Group all props for a game by player (entity_name + entity_id), preserving
// the API's player ordering. Each group is { entity_id, entity_name, team_id,
// player_image, props: [...] }.
export function groupPropsByPlayer(props) {
  const order = [];
  const byId = new Map();
  for (const p of props) {
    if (!byId.has(p.entity_id)) {
      byId.set(p.entity_id, {
        entity_id: p.entity_id,
        entity_name: p.entity_name,
        team_id: p.team_id,
        team_alias: p.team_alias || null,
        player_image: p.entity?.player_image || null,
        props: [],
      });
      order.push(p.entity_id);
    }
    byId.get(p.entity_id).props.push(p);
  }
  return order.map(id => byId.get(id));
}
