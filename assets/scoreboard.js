// Multi-sport scoreboard. League tabs across the top; each league has its own
// list (NBA, MLB, NHL, WNBA, PGA leaderboard). Live data from ESPN's public
// scoreboard endpoints.

import { renderNav, mountTicker, escape } from "./script.js?v2026050101";
import {
  fetchScoreboard, fetchSummary, normalizeEvent,
  pollScoreboard, LEAGUES, TEAM_LOGO,
} from "./espn.js?v2026050101";

renderNav("scoreboard");
mountTicker(document.querySelector(".ticker"));

const list = document.getElementById("sb-list");
const dateLabel = document.getElementById("sb-date");
const leagueBar = document.getElementById("sb-league-bar");

const ORDER = ["nba", "mlb", "nhl", "wnba", "pga"];

let activeLeague = (new URLSearchParams(location.search).get("league") || "nba").toLowerCase();
if (!ORDER.includes(activeLeague)) activeLeague = "nba";

leagueBar.innerHTML = ORDER.map(lg => `
  <button class="sb-tab ${lg === activeLeague ? "is-active" : ""}" data-league="${lg}" type="button">
    <span class="sb-tab__emoji">${LEAGUES[lg].emoji}</span>
    ${LEAGUES[lg].label}
  </button>
`).join("");
leagueBar.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-league]");
  if (!btn) return;
  const lg = btn.dataset.league;
  if (lg === activeLeague) return;
  activeLeague = lg;
  leagueBar.querySelectorAll(".sb-tab").forEach(b => b.classList.toggle("is-active", b === btn));
  history.replaceState(null, "", `?league=${lg}`);
  list.innerHTML = `<p class="muted">Loading ${LEAGUES[lg].label}…</p>`;
  startPolling();
});

dateLabel.textContent = new Date().toLocaleDateString([], {
  weekday: "long", month: "long", day: "numeric", year: "numeric"
});

let stopPoll = null;
const summaryCache = new Map();

function startPolling() {
  if (stopPoll) stopPoll();
  if (activeLeague === "pga") {
    refreshPga();
    stopPoll = pollScoreboard(refreshPga, 30000, "pga");
  } else {
    refreshTeamSport();
    stopPoll = pollScoreboard(() => refreshTeamSport(), 15000, activeLeague);
  }
}

async function refreshTeamSport() {
  try {
    const data = await fetchScoreboard(activeLeague);
    const events = (data.events || []).map(ev => normalizeEvent(ev, activeLeague));
    if (!events.length) {
      list.innerHTML = `<p class="muted">No ${LEAGUES[activeLeague].label} games scheduled today.</p>`;
      return;
    }
    list.innerHTML = events.map(ev => sbCardHtml(ev)).join("");
    list.querySelectorAll("[data-event-id]").forEach(el => {
      el.addEventListener("click", () => {
        location.href = `game.html?id=${el.dataset.eventId}&league=${activeLeague}`;
      });
    });
    events.forEach(ev => hydrateCard(ev));
  } catch (e) {
    list.innerHTML = `<p class="muted">Couldn't load scoreboard (${e.message}).</p>`;
  }
}

function sbCardHtml(ev) {
  const live = ev.isLive;
  const final = ev.state === "post";
  const showScore = live || final;
  const homeWin = (live || final) && ev.home.score > ev.away.score;
  const awayWin = (live || final) && ev.away.score > ev.home.score;

  const status = live
    ? `<span class="sb-card__status is-live"><span class="dot"></span>${escape(ev.detail)}</span>`
    : final ? `<span class="sb-card__status">FINAL</span>`
    : `<span class="sb-card__status">${escape(ev.detail)}</span>`;

  return `
    <article class="sb-card" role="button" tabindex="0" data-event-id="${ev.id}">
      ${status}
      <div class="sb-card__teams">
        <img src="${ev.away.logo}" alt="${escape(ev.away.abbr)}" />
        <span class="sb-card__team-name">${escape(ev.away.fullName)}<span class="sb-card__team-record">${escape(ev.away.record)}</span></span>
        <span class="sb-card__team-score ${showScore ? (awayWin ? "is-winner" : "is-loser") : ""}">${showScore ? ev.away.score : "—"}</span>

        <img src="${ev.home.logo}" alt="${escape(ev.home.abbr)}" />
        <span class="sb-card__team-name">${escape(ev.home.fullName)}<span class="sb-card__team-record">${escape(ev.home.record)}</span></span>
        <span class="sb-card__team-score ${showScore ? (homeWin ? "is-winner" : "is-loser") : ""}">${showScore ? ev.home.score : "—"}</span>
      </div>
      <div class="sb-card__linescore" data-line="${ev.id}">
        <span class="muted">${escape(ev.broadcast || "")}</span>
      </div>
      <div class="sb-card__leaders" data-leaders="${ev.id}">
        <span class="muted">Loading leaders…</span>
      </div>
    </article>
  `;
}

async function hydrateCard(ev) {
  const leadersEl = list.querySelector(`[data-leaders="${ev.id}"]`);
  const lineEl = list.querySelector(`[data-line="${ev.id}"]`);
  if (!leadersEl) return;

  if (ev.state === "pre") {
    leadersEl.innerHTML = `<span class="muted">Tip ${escape(ev.detail.replace(/^\d+\/\d+\s+-\s+/, ""))}</span>`;
    return;
  }
  try {
    const cacheKey = `${activeLeague}:${ev.id}`;
    let summary = summaryCache.get(cacheKey);
    if (!summary) {
      summary = await fetchSummary(ev.id, activeLeague);
      summaryCache.set(cacheKey, summary);
    }

    // Sport-specific leader categories
    const leaders = (summary.leaders || []).slice(0, 2).flatMap(t =>
      (t.leaders || []).slice(0, 2).map(l => ({
        team: t.team?.abbreviation || "",
        name: l.leaders?.[0]?.athlete?.shortName || "",
        stat: l.leaders?.[0]?.displayValue || "",
        cat: l.shortDisplayName || l.displayName || "",
      }))
    );
    leadersEl.innerHTML = leaders.length
      ? `<div class="sb-card__leaders-grid">
          ${leaders.slice(0, 4).map(l => `
            <span class="sb-card__leader-cat">${escape(l.cat)}</span>
            <span class="sb-card__leader-player"><b>${escape(l.name)}</b> <span class="muted">(${escape(l.team)})</span></span>
            <span class="sb-card__leader-stat">${escape(l.stat)}</span>
          `).join("")}
        </div>`
      : `<span class="muted">No leaders yet.</span>`;

    // Line score (innings/quarters/periods)
    if (lineEl) {
      const competitors = summary.header?.competitions?.[0]?.competitors;
      if (competitors) {
        const home = competitors.find(c => c.homeAway === "home");
        const away = competitors.find(c => c.homeAway === "away");
        const toCells = (arr) => (arr || []).map(s => {
          const v = s?.value;
          return (v === null || v === undefined || isNaN(Number(v))) ? null : Math.floor(Number(v));
        });
        const homeLine = toCells(home?.linescores);
        const awayLine = toCells(away?.linescores);
        if (homeLine.length || awayLine.length) {
          const max = Math.max(homeLine.length, awayLine.length, periodCount(activeLeague));
          const head = periodHead(activeLeague);
          const heads = Array.from({ length: max }, (_, i) => `<span class="qhead">${head}${i + 1}</span>`).join("");
          const awayCells = Array.from({ length: max }, (_, i) =>
            `<span>${awayLine[i] != null ? awayLine[i] : "—"}</span>`).join("");
          const homeCells = Array.from({ length: max }, (_, i) =>
            `<span>${homeLine[i] != null ? homeLine[i] : "—"}</span>`).join("");
          lineEl.innerHTML = `
            <span class="label">&nbsp;</span>${heads}
            <span class="label">${ev.away.abbr}</span>${awayCells}
            <span class="label">${ev.home.abbr}</span>${homeCells}`;
          lineEl.style.gridTemplateColumns = `auto repeat(${max}, 1fr)`;
        }
      }
    }
  } catch {}
}

function periodCount(league) {
  if (league === "mlb") return 9;
  if (league === "nhl") return 3;
  if (league === "wnba") return 4;
  return 4; // nba
}

function periodHead(league) {
  if (league === "mlb") return "";
  if (league === "nhl") return "P";
  return "Q";
}

// PGA leaderboard rendering — different shape from team sports.
async function refreshPga() {
  try {
    const data = await fetchScoreboard("pga");
    const events = data.events || [];
    if (!events.length) {
      list.innerHTML = `<p class="muted">No PGA tournament today.</p>`;
      return;
    }
    list.innerHTML = events.map(pgaTournamentHtml).join("");
  } catch (e) {
    list.innerHTML = `<p class="muted">Couldn't load PGA (${e.message}).</p>`;
  }
}

function pgaTournamentHtml(ev) {
  const c = ev.competitions?.[0] || {};
  const status = c.status?.type?.shortDetail || ev.status?.type?.shortDetail || "";
  const courseName = c.course?.name || ev.venue?.fullName || "";
  const players = (c.competitors || []).slice(0, 20).map(p => ({
    pos: p.status?.position?.id || p.status?.position || "",
    name: p.athlete?.shortName || p.athlete?.displayName || "",
    score: p.score || "",
    today: (p.linescores && p.linescores.length) ? (p.linescores[p.linescores.length - 1]?.value ?? "") : "",
    thru: p.status?.thru || "",
    flag: p.athlete?.flag?.href || "",
  }));

  return `
    <article class="pga-card">
      <header class="pga-card__header">
        <div>
          <div class="pga-card__eyebrow">PGA · ${escape(status)}</div>
          <h2 class="pga-card__title">${escape(ev.name || ev.shortName || "Tournament")}</h2>
          <div class="pga-card__course">${escape(courseName)}</div>
        </div>
      </header>
      <table class="pga-leaderboard">
        <thead>
          <tr><th>Pos</th><th>Player</th><th>Total</th><th>Today</th><th>Thru</th></tr>
        </thead>
        <tbody>
          ${players.map(p => `
            <tr>
              <td class="pga-leaderboard__pos">${escape(String(p.pos || ""))}</td>
              <td class="pga-leaderboard__player">${p.flag ? `<img src="${escape(p.flag)}" alt="" class="pga-flag" />` : ""}<b>${escape(p.name)}</b></td>
              <td class="pga-leaderboard__score">${escape(String(p.score || ""))}</td>
              <td>${escape(String(p.today || ""))}</td>
              <td>${escape(String(p.thru || ""))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </article>
  `;
}

startPolling();
