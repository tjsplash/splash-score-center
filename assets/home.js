// Home page controller: sport filter (NBA / MLB / NHL), tonight's games for the
// selected league, and a row of action buttons at the bottom that surface
// bracket / standings / season leaders inline (ESPN-style).

import { renderNav, mountTicker, escape } from "./script.js?v2026050104";
import {
  fetchScoreboard, normalizeEvent, pollScoreboard, LEAGUES,
} from "./espn.js?v2026050104";

const HOME_LEAGUES = ["nba", "mlb", "nhl"];

// Sport-specific copy for the page subtitle and the recap CTA. Keeps the
// surface honest — a "Game 6 elimination" line is wrong for an MLB Tuesday.
const SPORT_COPY = {
  nba: { kicker: "NBA · 2025-26 Playoffs", recapVerb: "Recap" },
  mlb: { kicker: "MLB · Regular Season",    recapVerb: "Recap" },
  nhl: { kicker: "NHL · Stanley Cup Playoffs", recapVerb: "Recap" },
};

// Storylines are NBA-playoff specific and keyed by event id. For other sports
// (or NBA games not in the prepared set) we fall back to a sport-aware blurb
// derived from the matchup.
const STORYLINES = {
  "401869417": "Series tied 3-3. Win-or-go-home Game 7 in Detroit — the East's top seed is on the line.",
  "401869381": "Series tied 3-3. Game 7 in Cleveland; Raptors trying to steal one on the road.",
  "401869409": "Lakers up 3-2 in Houston. Door is open for LA to wrap the series and head to round two.",
};

const ACTIONS = {
  nba: [
    { kind: "bracket",   label: "Playoff bracket", sub: "2025-26 NBA postseason",   icon: "🏀", href: "bracket.html" },
    { kind: "standings", label: "Standings",       sub: "Conference rankings",      icon: "📊" },
    { kind: "stats",     label: "Season leaders",  sub: "Top scorers & playmakers", icon: "📈" },
  ],
  mlb: [
    { kind: "standings", label: "Standings",       sub: "AL & NL by division",      icon: "📊" },
    { kind: "stats",     label: "Season leaders",  sub: "Batting & pitching",       icon: "📈" },
  ],
  nhl: [
    { kind: "standings", label: "Standings",       sub: "Conference rankings",      icon: "📊" },
    { kind: "stats",     label: "Season leaders",  sub: "Goals & assists",          icon: "📈" },
  ],
};

// ---- Boot ----

renderNav("home");
mountTicker(document.querySelector(".ticker"));

const filterEl = document.getElementById("sport-filter");
const tonightEl = document.getElementById("tonight");
const actionsEl = document.getElementById("home-actions");
const standingsPanel = document.getElementById("standings-panel");
const standingsBody = document.getElementById("standings-body");
const statsPanel = document.getElementById("stats-panel");
const statsBody = document.getElementById("stats-body");
const subEl = document.getElementById("home-sub");

let activeLeague = "nba";
let stopPoll = null;

filterEl.innerHTML = HOME_LEAGUES.map(lg => {
  const cfg = LEAGUES[lg];
  return `<button class="sport-chip ${lg === activeLeague ? "is-active" : ""}" data-league="${lg}" type="button" role="tab" aria-selected="${lg === activeLeague}">
    <span class="sport-chip__emoji" aria-hidden="true">${cfg.emoji}</span>${cfg.label}
  </button>`;
}).join("");

filterEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".sport-chip");
  if (!btn) return;
  const lg = btn.dataset.league;
  if (lg === activeLeague) return;
  activeLeague = lg;
  filterEl.querySelectorAll(".sport-chip").forEach(b => {
    const on = b === btn;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on);
  });
  closePanels();
  renderActions();
  renderSubtitle();
  startPolling();
});

renderSubtitle();
renderActions();
startPolling();

actionsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".home-action");
  if (!btn) return;
  const kind = btn.dataset.kind;
  if (kind === "bracket") {
    location.href = "bracket.html";
    return;
  }
  if (kind === "standings") {
    togglePanel(standingsPanel, standingsBody, () => loadStandings(activeLeague));
    return;
  }
  if (kind === "stats") {
    togglePanel(statsPanel, statsBody, () => loadStats(activeLeague));
    return;
  }
});

document.querySelectorAll("[data-close-panel]").forEach(el => {
  el.addEventListener("click", () => {
    const panel = el.closest(".home-panel");
    if (panel) panel.hidden = true;
  });
});

// ---- Subtitle ----

function renderSubtitle() {
  const c = SPORT_COPY[activeLeague];
  subEl.innerHTML = `<span class="home-sub__kicker">${c.kicker}</span> · Updates every 15 seconds. Recaps appear automatically when games go final.`;
}

// ---- Tonight's games ----

function startPolling() {
  if (stopPoll) stopPoll();
  tonightEl.innerHTML = `<p class="muted">Loading ${LEAGUES[activeLeague].label} games…</p>`;
  refreshTonight();
  stopPoll = pollScoreboard(() => refreshTonight(), 15000, activeLeague);
}

async function refreshTonight() {
  try {
    const data = await fetchScoreboard(activeLeague);
    const events = (data.events || [])
      .map(ev => normalizeEvent(ev, activeLeague))
      .sort((a, b) => {
        // live first, then pre, then post
        const ord = { in: 0, pre: 1, post: 2 };
        return (ord[a.state] ?? 3) - (ord[b.state] ?? 3);
      });
    if (!events.length) {
      tonightEl.innerHTML = `<p class="muted">No ${LEAGUES[activeLeague].label} games scheduled today.</p>`;
      return;
    }
    tonightEl.innerHTML = events.map(tonightCardHtml).join("");
    tonightEl.querySelectorAll("[data-event-id]").forEach(el => {
      el.addEventListener("click", () => {
        location.href = `game.html?id=${el.dataset.eventId}&league=${activeLeague}`;
      });
    });
  } catch (e) {
    tonightEl.innerHTML = `<p class="muted">Couldn't load games (${e.message}). Retrying…</p>`;
  }
}

function tonightCardHtml(ev) {
  const live = ev.isLive;
  const final = ev.state === "post";
  const showScore = live || final;
  const status = live
    ? `<span class="tonight-card__live"><span class="live-dot"></span>${escape(formatLiveStatus(ev))}</span>`
    : final
      ? "Final"
      : escape(ev.detail.replace(/^\d+\/\d+\s+-\s+/, "Tip "));

  const story = STORYLINES[ev.id] || fallbackStory(ev);
  const ctaPrimary = live ? "Live now" : final ? `${SPORT_COPY[activeLeague].recapVerb} available` : "Tip-off soon";
  const winnerAway = (live || final) && ev.away.score > ev.home.score;
  const winnerHome = (live || final) && ev.home.score > ev.away.score;

  return `
    <article class="tonight-card ${live ? "is-live" : final ? "is-final" : ""}" role="button" tabindex="0" data-event-id="${ev.id}">
      <div class="tonight-card__header">
        <span>${status}</span>
        <span>${escape(ev.broadcast || "")}</span>
      </div>
      <div class="tonight-card__matchup">
        <div class="tonight-card__team ${winnerAway ? "is-winner" : ""}">
          <img class="tonight-card__logo" src="${ev.away.logo}" alt="${escape(ev.away.fullName)}" />
          <span class="tonight-card__team-name">${escape(ev.away.fullName)}</span>
          <span class="tonight-card__team-record">${escape(ev.away.record)}</span>
        </div>
        <div class="tonight-card__center">
          ${showScore
            ? `<div class="tonight-card__vs-score"><span class="${winnerAway ? "is-winner" : ""}">${ev.away.score}</span><span class="tonight-card__vs-sep">·</span><span class="${winnerHome ? "is-winner" : ""}">${ev.home.score}</span></div>`
            : `<span class="tonight-card__vs">VS</span>`}
        </div>
        <div class="tonight-card__team ${winnerHome ? "is-winner" : ""}">
          <img class="tonight-card__logo" src="${ev.home.logo}" alt="${escape(ev.home.fullName)}" />
          <span class="tonight-card__team-name">${escape(ev.home.fullName)}</span>
          <span class="tonight-card__team-record">${escape(ev.home.record)}</span>
        </div>
      </div>
      <div class="tonight-card__story">${escape(story)}</div>
      <div class="tonight-card__cta">
        <span>${ctaPrimary}</span>
        <span class="tonight-card__cta-btn">Open Game Center →</span>
      </div>
    </article>
  `;
}

function formatLiveStatus(ev) {
  const lg = activeLeague;
  if (lg === "mlb") return ev.detail || `Inn ${ev.period}`;
  if (lg === "nhl") return `P${ev.period}${ev.clock ? " · " + ev.clock : ""}`;
  return `Q${ev.period}${ev.clock ? " · " + ev.clock : ""}`;
}

function fallbackStory(ev) {
  const aw = ev.away.name || ev.away.abbr;
  const hm = ev.home.name || ev.home.abbr;
  if (ev.note) return ev.note;
  if (ev.state === "post") return `Final from ${hm}. ${ev.away.score > ev.home.score ? aw : hm} take it.`;
  if (ev.state === "in") return `${aw} at ${hm}. Live now on ${ev.broadcast || "the broadcast"}.`;
  return `${aw} at ${hm}. ${ev.detail.replace(/^\d+\/\d+\s+-\s+/, "")}.`;
}

// ---- Actions ----

function renderActions() {
  const items = ACTIONS[activeLeague] || [];
  actionsEl.innerHTML = items.map(a => `
    <button class="home-action" data-kind="${a.kind}" type="button">
      <span class="home-action__icon" aria-hidden="true">${a.icon}</span>
      <span class="home-action__text">
        <span class="home-action__label">${a.label}</span>
        <span class="home-action__sub">${a.sub}</span>
      </span>
      <span class="home-action__arrow" aria-hidden="true">→</span>
    </button>
  `).join("");
}

function togglePanel(panel, body, loader) {
  // Close the other panel if it's open.
  [standingsPanel, statsPanel].forEach(p => { if (p !== panel) p.hidden = true; });
  if (panel.hidden) {
    panel.hidden = false;
    body.innerHTML = `<p class="muted">Loading…</p>`;
    loader().catch(e => {
      body.innerHTML = `<p class="muted">Couldn't load (${escape(e.message)}).</p>`;
    });
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    panel.hidden = true;
  }
}

function closePanels() {
  standingsPanel.hidden = true;
  statsPanel.hidden = true;
}

// ---- Standings ----

async function loadStandings(league) {
  const cfg = LEAGUES[league];
  const url = `https://site.api.espn.com/apis/v2/sports/${cfg.sport}/${cfg.league}/standings`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`standings ${r.status}`);
  const data = await r.json();
  // ESPN's standings response has nested groups (conferences) and children (divisions).
  // Render as a series of mini tables.
  const groups = collectStandingGroups(data);
  if (!groups.length) {
    standingsBody.innerHTML = `<p class="muted">No standings available.</p>`;
    return;
  }
  standingsBody.innerHTML = groups.map(g => standingsGroupHtml(g, league)).join("");
}

function collectStandingGroups(data) {
  // The endpoint returns either { children: [{ name, standings }] } at the top
  // (single conference / division) or { children: [{ name, children: [...] }] }
  // (e.g. NBA/NHL with East/West each having divisions).
  const groups = [];
  function walk(node, parentLabel = "") {
    if (!node) return;
    const label = parentLabel ? `${parentLabel} · ${node.name || ""}`.trim() : (node.name || "");
    if (node.standings && node.standings.entries) {
      groups.push({ label, entries: node.standings.entries });
    }
    if (Array.isArray(node.children)) {
      node.children.forEach(c => walk(c, node.name || parentLabel));
    }
  }
  if (Array.isArray(data.children)) {
    data.children.forEach(c => walk(c));
  } else if (data.standings) {
    groups.push({ label: data.name || "Standings", entries: data.standings.entries || [] });
  }
  return groups;
}

function standingsGroupHtml(g, league) {
  const cols = standingsCols(league);
  const rows = g.entries.map((e, i) => {
    const team = e.team || {};
    const stats = Object.fromEntries((e.stats || []).map(s => [s.name || s.type, s]));
    return `
      <tr>
        <td class="st-table__rank">${i + 1}</td>
        <td class="st-table__team">
          ${team.logos?.[0]?.href ? `<img src="${team.logos[0].href}" alt="" />` : ""}
          <span><b>${escape(team.shortDisplayName || team.displayName || team.abbreviation || "")}</b></span>
        </td>
        ${cols.map(c => `<td class="st-table__num">${escape(statValue(stats, c.key))}</td>`).join("")}
      </tr>
    `;
  }).join("");

  return `
    <div class="st-group">
      <h3 class="st-group__title">${escape(g.label)}</h3>
      <table class="st-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            ${cols.map(c => `<th class="st-table__num">${c.label}</th>`).join("")}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function standingsCols(league) {
  if (league === "mlb") return [
    { key: "wins", label: "W" },
    { key: "losses", label: "L" },
    { key: "winPercent", label: "PCT" },
    { key: "gamesBehind", label: "GB" },
  ];
  // NBA / NHL
  return [
    { key: "wins", label: "W" },
    { key: "losses", label: "L" },
    { key: "winPercent", label: "PCT" },
    { key: "gamesBehind", label: "GB" },
  ];
}

function statValue(stats, key) {
  const s = stats[key];
  if (!s) return "—";
  return s.displayValue ?? s.value ?? "—";
}

// ---- Season leaders (stats) ----
// ESPN's `byathlete` endpoint accepts ?sort=<group>.<stat>:<asc|desc>. We fetch
// the top 5 leaders per category in parallel and pivot the values from the
// per-athlete categories[group].values array using the schema names.

const STAT_CATEGORIES = {
  nba: [
    { sortKey: "offensive.avgPoints",   group: "offensive", statName: "avgPoints",   label: "Points / game",   short: "PPG" },
    { sortKey: "general.avgRebounds",   group: "general",   statName: "avgRebounds", label: "Rebounds / game", short: "RPG" },
    { sortKey: "offensive.avgAssists",  group: "offensive", statName: "avgAssists",  label: "Assists / game",  short: "APG" },
    { sortKey: "defensive.avgSteals",   group: "defensive", statName: "avgSteals",   label: "Steals / game",   short: "SPG" },
    { sortKey: "defensive.avgBlocks",   group: "defensive", statName: "avgBlocks",   label: "Blocks / game",   short: "BPG" },
  ],
  mlb: [
    { sortKey: "batting.avg",        group: "batting",  statName: "avg",        label: "Batting average", short: "AVG" },
    { sortKey: "batting.homeRuns",   group: "batting",  statName: "homeRuns",   label: "Home runs",       short: "HR" },
    { sortKey: "batting.runs",       group: "batting",  statName: "runs",       label: "Runs",            short: "R" },
    { sortKey: "batting.hits",       group: "batting",  statName: "hits",       label: "Hits",            short: "H" },
    { sortKey: "pitching.ERA",       group: "pitching", statName: "ERA",        label: "ERA (lower is better)", short: "ERA", asc: true },
  ],
  nhl: [
    { sortKey: "offensive.points",     group: "offensive", statName: "points",     label: "Points",            short: "PTS" },
    { sortKey: "offensive.goals",      group: "offensive", statName: "goals",      label: "Goals",             short: "G" },
    { sortKey: "offensive.assists",    group: "offensive", statName: "assists",    label: "Assists",           short: "A" },
    { sortKey: "offensive.shotsTotal", group: "offensive", statName: "shotsTotal", label: "Shots on goal",     short: "SOG" },
    { sortKey: "defensive.savePct",    group: "defensive", statName: "savePct",    label: "Save % (goalies)",  short: "SV%" },
  ],
};

async function loadStats(league) {
  const cfg = LEAGUES[league];
  const cats = STAT_CATEGORIES[league] || [];
  if (!cats.length) {
    statsBody.innerHTML = `<p class="muted">No stat leaders configured for ${cfg.label}.</p>`;
    return;
  }

  const urls = cats.map(c => {
    const dir = c.asc ? "asc" : "desc";
    return `https://site.web.api.espn.com/apis/common/v3/sports/${cfg.sport}/${cfg.league}/statistics/byathlete?limit=5&sort=${c.sortKey}:${dir}`;
  });

  const results = await Promise.all(
    urls.map(u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null))
  );

  const cards = cats.map((c, i) => statCategoryHtml(c, results[i]));
  statsBody.innerHTML = `<div class="stats-grid">${cards.join("")}</div>`;
}

function statCategoryHtml(cat, data) {
  if (!data) {
    return `<div class="stat-card"><div class="stat-card__title">${escape(cat.label)}</div><p class="muted">Couldn't load.</p></div>`;
  }
  const groupSchema = (data.categories || []).find(c => c && c.name === cat.group);
  const idx = groupSchema?.names ? groupSchema.names.indexOf(cat.statName) : -1;
  const items = (data.athletes || []).slice(0, 5).map(a => {
    const ath = a.athlete || {};
    const groupVals = (a.categories || []).find(c => c.name === cat.group)?.values || [];
    const raw = idx >= 0 ? groupVals[idx] : null;
    return {
      name: ath.shortName || ath.displayName || "",
      team: ath.teamShortName || ath.team?.abbreviation || "",
      value: formatStat(raw, cat.statName),
    };
  });

  return `
    <div class="stat-card">
      <div class="stat-card__title">${escape(cat.label)} <span class="stat-card__short">${escape(cat.short)}</span></div>
      <ol class="stat-card__list">
        ${items.map((it, i) => `
          <li class="stat-card__row">
            <span class="stat-card__rank">${i + 1}</span>
            <span class="stat-card__player">${escape(it.name)}</span>
            <span class="stat-card__team">${escape(it.team)}</span>
            <span class="stat-card__value">${escape(it.value)}</span>
          </li>
        `).join("")}
      </ol>
    </div>
  `;
}

function formatStat(raw, name) {
  if (raw == null || isNaN(raw)) return "—";
  // Batting average: 0.327 → .327
  if (name === "avg") return Number(raw).toFixed(3).replace(/^0/, "");
  if (name === "ERA") return Number(raw).toFixed(2);
  if (/Pct/i.test(name)) return raw < 1 ? Number(raw).toFixed(3).replace(/^0/, "") : Number(raw).toFixed(1);
  if (/^avg/i.test(name)) return Number(raw).toFixed(1);
  // Whole-number counting stats
  if (typeof raw === "number") return String(Math.round(raw));
  return String(raw);
}
