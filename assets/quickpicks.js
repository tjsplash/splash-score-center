// Splash Sports Quick Picks API client.
// Public, unauthenticated. Reverse-engineered from app.splashsports.com:
//   GET /props-service/api/props        — full prop catalog (all leagues)
//   GET /props-service/api/v1/popular   — popularity-ordered prop pool
//
// The /filters endpoint advertises fewer games than /props (Splash hides
// already-locked games from the filter chip catalog), so we treat /props as
// the source of truth for both game and prop discovery.

const BASE = "https://api.splashsports.com/props-service/api";

let popularPromise = null;
const allPropsByLeague = new Map(); // league → Promise<props[]>
const propsByGameCache = new Map();  // `${league}:${gameId}` → props[]

export async function fetchAllPropsForLeague(league = "nba") {
  if (!allPropsByLeague.has(league)) {
    const p = fetch(`${BASE}/props?league=${league}&limit=300`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`splash props ${league} ${r.status}`)))
      .then(d => d.data || [])
      .catch(e => { allPropsByLeague.delete(league); throw e; });
    allPropsByLeague.set(league, p);
  }
  return allPropsByLeague.get(league);
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

// All props for a Splash game, hitting the per-game endpoint for completeness
// (the league-wide cache is capped at 300 props which can truncate big nights).
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

// Match an ESPN event to a Splash game by team alias. Reads the props catalog
// (rather than /filters) since that includes all games with active props.
// Returns { id, league, splashGame, props } or null.
const matchCache = new Map();
export async function matchEspnToSplash(ev) {
  if (!ev?.home?.abbr || !ev?.away?.abbr) return null;
  const cacheKey = `${ev.league}:${ev.home.abbr}-${ev.away.abbr}`;
  if (matchCache.has(cacheKey)) return matchCache.get(cacheKey);

  let result = null;
  try {
    const props = await fetchAllPropsForLeague(ev.league);
    // Build a map: splashGameId → { home_alias, away_alias, props[] }
    const games = new Map();
    for (const p of props) {
      const id = p.game_id;
      if (!id) continue;
      let g = games.get(id);
      if (!g) {
        g = {
          id,
          home: p.game?.home?.alias || null,
          away: p.game?.away?.alias || null,
          start: p.game_start || null,
          props: [],
        };
        games.set(id, g);
      }
      g.props.push(p);
    }
    const home = ev.home.abbr;
    const away = ev.away.abbr;
    for (const g of games.values()) {
      if ((g.home === home && g.away === away) || (g.home === away && g.away === home)) {
        result = { id: g.id, league: ev.league, props: g.props, home: g.home, away: g.away };
        break;
      }
    }
  } catch { /* fall through */ }

  matchCache.set(cacheKey, result);
  return result;
}

// Top N popular props for a Splash game, with at least one prop per team if
// both teams have props available. Falls back to ranked-by-popularity if the
// per-team balance can't be met.
export async function popularPropsForGame(splashGameId, league, n = 3) {
  let popular = [];
  try { popular = await fetchPopularProps(); } catch {}
  const inGame = popular.filter(p => p.game_id === splashGameId);

  // Bring in fallback ordering from per-game props for top-up.
  let allInGame = inGame;
  try {
    const fromGame = await fetchPropsForGame(splashGameId, league);
    const seen = new Set(inGame.map(p => p.id));
    for (const p of fromGame) if (!seen.has(p.id)) allInGame.push(p);
  } catch {}

  if (!allInGame.length) return [];

  // Try to pick one prop per team (first), then fill remaining slots from the
  // ranked pool. We dedupe by player so we don't show the same player twice.
  const out = [];
  const usedPlayers = new Set();
  const teamsSeen = new Set();
  for (const p of allInGame) {
    if (usedPlayers.has(p.entity_id)) continue;
    if (out.length >= n) break;
    if (teamsSeen.has(p.team_id) && teamsSeen.size === 1 && hasPropForOtherTeam(allInGame, p.team_id, usedPlayers)) {
      // Save this slot for the other team if possible.
      continue;
    }
    out.push(p);
    usedPlayers.add(p.entity_id);
    if (p.team_id) teamsSeen.add(p.team_id);
  }
  // Final top-up if still under quota.
  for (const p of allInGame) {
    if (out.length >= n) break;
    if (usedPlayers.has(p.entity_id)) continue;
    out.push(p);
    usedPlayers.add(p.entity_id);
  }
  return out.slice(0, n);
}

function hasPropForOtherTeam(props, teamId, usedPlayers) {
  return props.some(p => p.team_id !== teamId && !usedPlayers.has(p.entity_id));
}

// Group all props for a game by player. Each group = { entity_id, entity_name,
// team_alias, team_name, position, props: [...] }.
export function groupPropsByPlayer(props) {
  const order = [];
  const byId = new Map();
  for (const p of props) {
    if (!byId.has(p.entity_id)) {
      byId.set(p.entity_id, {
        entity_id: p.entity_id,
        entity_name: p.entity_name,
        team_alias: p.team?.alias || null,
        team_name: p.team?.name || null,
        team_color: p.team?.primary_color || null,
        position: p.entity?.player_details?.position || null,
        jersey: p.entity?.player_details?.jersey_number || null,
        props: [],
      });
      order.push(p.entity_id);
    }
    byId.get(p.entity_id).props.push(p);
  }
  return order.map(id => byId.get(id));
}

export function playerInitials(name) {
  if (!name) return "?";
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
