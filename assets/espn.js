// ESPN public API client.
// CORS-enabled, no auth. Polls scoreboard + per-game summary endpoints.

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary";

const TEAM_LOGO = (abbr) => `https://a.espncdn.com/i/teamlogos/nba/500/${abbr.toLowerCase()}.png`;

export const TONIGHT_EVENT_IDS = ["401869417", "401869381", "401869409"];

export async function fetchScoreboard() {
  const r = await fetch(SCOREBOARD);
  if (!r.ok) throw new Error(`scoreboard ${r.status}`);
  return await r.json();
}

export async function fetchSummary(eventId) {
  const r = await fetch(`${SUMMARY}?event=${eventId}`);
  if (!r.ok) throw new Error(`summary ${r.status}`);
  return await r.json();
}

export function pollScoreboard(callback, intervalMs = 15000) {
  let stopped = false;
  let timer = null;
  let firstDone = false;
  async function tick() {
    if (stopped) return;
    // Always do the first fetch; subsequent fetches honor visibility for cost.
    if (!firstDone || !document.hidden) {
      try { callback(await fetchScoreboard()); firstDone = true; }
      catch (e) { console.warn("scoreboard poll", e); }
    }
    timer = setTimeout(tick, intervalMs);
  }
  tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

export function pollSummary(eventId, callback, intervalMs = 10000) {
  let stopped = false;
  let timer = null;
  let firstDone = false;
  async function tick() {
    if (stopped) return;
    if (!firstDone || !document.hidden) {
      try { callback(await fetchSummary(eventId)); firstDone = true; }
      catch (e) { console.warn("summary poll", e); }
    }
    timer = setTimeout(tick, intervalMs);
  }
  tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

// Compact normalizer for an ESPN scoreboard event into ticker shape.
export function normalizeEvent(ev) {
  const c = ev.competitions[0];
  const status = c.status.type;
  const home = c.competitors.find(x => x.homeAway === "home");
  const away = c.competitors.find(x => x.homeAway === "away");
  return {
    id: ev.id,
    shortName: ev.shortName,
    state: status.state, // pre / in / post
    detail: status.shortDetail,
    completed: status.completed,
    isLive: status.state === "in",
    home: {
      abbr: home.team.abbreviation,
      name: home.team.shortDisplayName || home.team.name,
      fullName: home.team.displayName,
      record: (home.records?.[0]?.summary) || "",
      score: parseInt(home.score, 10) || 0,
      logo: home.team.logo || TEAM_LOGO(home.team.abbreviation),
      color: home.team.color,
      winner: home.winner === true,
    },
    away: {
      abbr: away.team.abbreviation,
      name: away.team.shortDisplayName || away.team.name,
      fullName: away.team.displayName,
      record: (away.records?.[0]?.summary) || "",
      score: parseInt(away.score, 10) || 0,
      logo: away.team.logo || TEAM_LOGO(away.team.abbreviation),
      color: away.team.color,
      winner: away.winner === true,
    },
    period: c.status.period,
    clock: c.status.displayClock,
    broadcast: (c.broadcasts?.[0]?.names || []).join(", "),
  };
}

export { TEAM_LOGO };
