// ESPN public API client — multi-sport.
// CORS-enabled, no auth. Polls scoreboard + per-game summary endpoints.

// League configuration — sport path + league slug for ESPN URLs.
// `accent` is the league brand color used for ticker section dividers.
export const LEAGUES = {
  nba:  { sport: "basketball", league: "nba",  label: "NBA",  emoji: "🏀", logoLeague: "nba",  accent: "#4BEBE2" },
  mlb:  { sport: "baseball",   league: "mlb",  label: "MLB",  emoji: "⚾", logoLeague: "mlb",  accent: "#4BEBE2" },
  nhl:  { sport: "hockey",     league: "nhl",  label: "NHL",  emoji: "🏒", logoLeague: "nhl",  accent: "#4BEBE2" },
  pga:  { sport: "golf",       league: "pga",  label: "PGA",  emoji: "⛳", logoLeague: null,   accent: "#4BEBE2" },
};

const SCOREBOARD_URL = (lg) => `https://site.api.espn.com/apis/site/v2/sports/${LEAGUES[lg].sport}/${LEAGUES[lg].league}/scoreboard`;
const SUMMARY_URL = (lg) => `https://site.api.espn.com/apis/site/v2/sports/${LEAGUES[lg].sport}/${LEAGUES[lg].league}/summary`;

// Backwards-compatible NBA endpoints.
const SCOREBOARD = SCOREBOARD_URL("nba");
const SUMMARY = SUMMARY_URL("nba");

const TEAM_LOGO = (abbr, league = "nba") => {
  const lg = LEAGUES[league]?.logoLeague || "nba";
  return `https://a.espncdn.com/i/teamlogos/${lg}/500/${abbr.toLowerCase()}.png`;
};

export const TONIGHT_EVENT_IDS = ["401869417", "401869381", "401869409"];

export async function fetchScoreboard(league = "nba", dateYYYYMMDD = null) {
  const url = dateYYYYMMDD ? `${SCOREBOARD_URL(league)}?dates=${dateYYYYMMDD}` : SCOREBOARD_URL(league);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`scoreboard ${league} ${r.status}`);
  return await r.json();
}

export async function fetchSummary(eventId, league = "nba") {
  const r = await fetch(`${SUMMARY_URL(league)}?event=${eventId}`);
  if (!r.ok) throw new Error(`summary ${league} ${r.status}`);
  return await r.json();
}

// Fetch scoreboards across multiple leagues in parallel.
export async function fetchMultiSportScoreboard(leagues = ["nba", "mlb", "nhl"], dateYYYYMMDD = null) {
  const results = await Promise.allSettled(leagues.map(lg => fetchScoreboard(lg, dateYYYYMMDD).then(d => ({ league: lg, data: d }))));
  return results.filter(r => r.status === "fulfilled").map(r => r.value);
}

export function pollScoreboard(callback, intervalMs = 15000, league = "nba") {
  let stopped = false;
  let timer = null;
  let firstDone = false;
  async function tick() {
    if (stopped) return;
    if (!firstDone || !document.hidden) {
      try { callback(await fetchScoreboard(league)); firstDone = true; }
      catch (e) { console.warn("scoreboard poll", e); }
    }
    timer = setTimeout(tick, intervalMs);
  }
  tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

export function pollMultiSportScoreboard(callback, intervalMs = 20000, leagues = ["nba", "mlb", "nhl", "wnba"]) {
  let stopped = false;
  let timer = null;
  let firstDone = false;
  async function tick() {
    if (stopped) return;
    if (!firstDone || !document.hidden) {
      try { callback(await fetchMultiSportScoreboard(leagues)); firstDone = true; }
      catch (e) { console.warn("multi-sport poll", e); }
    }
    timer = setTimeout(tick, intervalMs);
  }
  tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

export function pollSummary(eventId, callback, intervalMs = 10000, league = "nba") {
  let stopped = false;
  let timer = null;
  let firstDone = false;
  async function tick() {
    if (stopped) return;
    if (!firstDone || !document.hidden) {
      try { callback(await fetchSummary(eventId, league)); firstDone = true; }
      catch (e) { console.warn("summary poll", e); }
    }
    timer = setTimeout(tick, intervalMs);
  }
  tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

// Compact normalizer for an ESPN scoreboard event into ticker shape.
export function normalizeEvent(ev, league = "nba") {
  const c = ev.competitions[0];
  const status = c.status.type;
  const competitors = c.competitors || [];
  // Team sports: home / away. Golf: a list of athletes (no homeAway).
  if (LEAGUES[league]?.sport === "golf") {
    return normalizeGolfEvent(ev, league);
  }
  const home = competitors.find(x => x.homeAway === "home") || competitors[0];
  const away = competitors.find(x => x.homeAway === "away") || competitors[1];
  return {
    league,
    id: ev.id,
    shortName: ev.shortName,
    state: status.state,
    detail: status.shortDetail,
    completed: status.completed,
    isLive: status.state === "in",
    home: normalizeTeam(home, league),
    away: normalizeTeam(away, league),
    period: c.status.period,
    clock: c.status.displayClock,
    broadcast: (c.broadcasts?.[0]?.names || []).join(", "),
    note: (c.notes?.[0]?.headline) || "",
    // Sport-specific situation strings (e.g. baseball: "1st & 2nd, 1 out").
    situation: c.situation || null,
  };
}

function normalizeTeam(t, league) {
  if (!t) return { abbr: "", name: "", fullName: "", record: "", score: 0, logo: "", color: "", winner: false };
  const abbr = t.team?.abbreviation || "";
  return {
    abbr,
    name: t.team?.shortDisplayName || t.team?.name || abbr,
    fullName: t.team?.displayName || abbr,
    record: (t.records?.[0]?.summary) || "",
    score: parseInt(t.score, 10) || 0,
    logo: t.team?.logo || (abbr ? TEAM_LOGO(abbr, league) : ""),
    color: t.team?.color || "",
    winner: t.winner === true,
    linescores: t.linescores || [],
    leader: t.leaders || [],
  };
}

function normalizeGolfEvent(ev, league = "pga") {
  const c = ev.competitions?.[0] || {};
  const status = c.status?.type || ev.status?.type || {};
  return {
    league,
    id: ev.id,
    shortName: ev.shortName || ev.name,
    name: ev.name,
    state: status.state || "pre",
    detail: status.shortDetail || ev.date || "",
    completed: status.completed,
    isLive: status.state === "in",
    isGolf: true,
    course: c.course?.name || ev.venue?.fullName || "",
    leaders: c.competitors ? c.competitors.slice(0, 8).map(p => ({
      name: p.athlete?.shortName || p.athlete?.displayName || "",
      score: p.score || p.linescores?.[p.linescores.length - 1]?.value || "",
      country: p.athlete?.flag?.alt || "",
    })) : [],
  };
}

export { TEAM_LOGO };
