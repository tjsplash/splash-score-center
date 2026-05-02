// Home page controller: sport filter (NBA / MLB / NHL), tonight's games for the
// selected league, and a row of action buttons at the bottom that surface
// bracket / standings / season leaders inline (ESPN-style).

import { renderNav, mountTicker, escape, teamHex } from "./script.js?v2026050203";
import {
  fetchScoreboard, fetchSummary, normalizeEvent, pollScoreboard, LEAGUES,
} from "./espn.js?v2026050203";
import {
  matchEspnToSplash, popularPropsForGame, playerInitials,
} from "./quickpicks.js?v2026050203";

const HOME_LEAGUES = ["nba", "mlb", "nhl", "pga"];

// Sport-specific copy for the page subtitle and the recap CTA. Keeps the
// surface honest — a "Game 6 elimination" line is wrong for an MLB Tuesday.
const SPORT_COPY = {
  nba: { kicker: "NBA · 2025-26 Playoffs",     recapVerb: "Recap" },
  mlb: { kicker: "MLB · Regular Season",       recapVerb: "Recap" },
  nhl: { kicker: "NHL · Stanley Cup Playoffs", recapVerb: "Recap" },
  pga: { kicker: "PGA Tour · This Week",       recapVerb: "Round" },
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
  pga: [
    { kind: "stats",     label: "Tour leaders",    sub: "FedEx Cup, money, scoring", icon: "🏆" },
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
const titleEl = document.getElementById("home-title");
const dateEl = document.getElementById("home-date");

const STORAGE_KEY = "ssc:home:league";
const persisted = (() => {
  try { return sessionStorage.getItem(STORAGE_KEY); } catch { return null; }
})();
let activeLeague = HOME_LEAGUES.includes(persisted) ? persisted : "nba";
let activeDate = todayYYYYMMDD();
let stopPoll = null;

function persistLeague(lg) {
  try { sessionStorage.setItem(STORAGE_KEY, lg); } catch {}
}

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
  persistLeague(lg);
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
mountDateScroller();
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
  const dateMod = activeDate === todayYYYYMMDD()
    ? "Updates every 15 seconds. Recaps appear automatically when games go final."
    : `Browsing ${prettyDate(activeDate)} · scores final.`;
  subEl.innerHTML = `<span class="home-sub__kicker">${c.kicker}</span> · ${dateMod}`;
  if (titleEl) {
    const isPga = activeLeague === "pga";
    const isToday = activeDate === todayYYYYMMDD();
    titleEl.firstChild.nodeValue = isPga
      ? "This week's tournament "
      : isToday ? "Tonight's games " : `Games on ${prettyDate(activeDate, "short")} `;
  }
}

// ---- Date scroller ----

function mountDateScroller() {
  if (!dateEl) return;
  dateEl.innerHTML = `
    <div class="home-date__inner">
      <button class="home-date__arrow" data-step="-1" aria-label="Previous day">‹</button>
      <button class="home-date__pill" type="button" id="home-date-pill">
        <span class="home-date__rel" id="home-date-rel"></span>
        <span class="home-date__abs" id="home-date-abs"></span>
      </button>
      <button class="home-date__arrow" data-step="1" aria-label="Next day">›</button>
      <input type="date" class="home-date__input" id="home-date-input" />
    </div>
    <button class="home-date__today" type="button" id="home-date-today" hidden>Jump to today</button>
  `;
  const input = dateEl.querySelector("#home-date-input");
  const pill = dateEl.querySelector("#home-date-pill");
  const todayBtn = dateEl.querySelector("#home-date-today");

  dateEl.addEventListener("click", (e) => {
    const arrow = e.target.closest("[data-step]");
    if (arrow) {
      shiftActiveDate(parseInt(arrow.dataset.step, 10));
      return;
    }
    if (e.target.closest("#home-date-pill")) {
      input.showPicker?.();
    }
    if (e.target.closest("#home-date-today")) {
      activeDate = todayYYYYMMDD();
      onDateChanged();
    }
  });
  input.addEventListener("change", () => {
    const v = input.value;
    if (!v) return;
    activeDate = v.replaceAll("-", "");
    onDateChanged();
  });
  renderDateScroller();
}

function shiftActiveDate(days) {
  const d = ymdToDate(activeDate);
  d.setDate(d.getDate() + days);
  activeDate = dateToYMD(d);
  onDateChanged();
}

function onDateChanged() {
  renderDateScroller();
  renderSubtitle();
  startPolling();
}

function renderDateScroller() {
  if (!dateEl) return;
  const today = todayYYYYMMDD();
  const d = ymdToDate(activeDate);
  const diff = Math.round((d.getTime() - ymdToDate(today).getTime()) / (1000 * 60 * 60 * 24));
  const rel = diff === 0 ? "TODAY" : diff === -1 ? "YESTERDAY" : diff === 1 ? "TOMORROW"
    : d.toLocaleDateString([], { weekday: "short" }).toUpperCase();
  dateEl.querySelector("#home-date-rel").textContent = rel;
  dateEl.querySelector("#home-date-abs").textContent = prettyDate(activeDate);
  const input = dateEl.querySelector("#home-date-input");
  if (input) input.value = `${activeDate.slice(0,4)}-${activeDate.slice(4,6)}-${activeDate.slice(6,8)}`;
  const todayBtn = dateEl.querySelector("#home-date-today");
  if (todayBtn) todayBtn.hidden = activeDate === today;
}

function todayYYYYMMDD() { return dateToYMD(new Date()); }

function dateToYMD(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function ymdToDate(ymd) {
  return new Date(parseInt(ymd.slice(0,4), 10), parseInt(ymd.slice(4,6), 10) - 1, parseInt(ymd.slice(6,8), 10));
}

function prettyDate(ymd, format = "long") {
  const d = ymdToDate(ymd);
  if (format === "short") return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

// ---- Tonight's games ----

function startPolling() {
  if (stopPoll) stopPoll();
  tonightEl.innerHTML = skeletonCards(3);
  refreshTonight();
  // Only poll for live updates when the user is browsing today.
  if (activeDate === todayYYYYMMDD()) {
    stopPoll = pollScoreboard(() => refreshTonight(), 15000, activeLeague);
  }
}

function skeletonCards(n) {
  const card = `
    <article class="skel-card" aria-hidden="true">
      <div class="skel-card__row">
        <span class="skel skel-card__line skel-card__line--short"></span>
        <span class="skel skel-card__line skel-card__line--short" style="margin-left:auto"></span>
      </div>
      <div class="skel-card__row">
        <span class="skel skel-card__circle"></span>
        <span class="skel skel-card__line"></span>
        <span class="skel skel-card__circle"></span>
      </div>
      <div class="skel-card__row">
        <span class="skel skel-card__line skel-card__line--mid"></span>
      </div>
      <div class="skel-card__row">
        <span class="skel skel-card__line skel-card__line--short"></span>
        <span class="skel skel-card__line skel-card__line--short" style="margin-left:auto"></span>
      </div>
    </article>
  `;
  return Array.from({ length: n }, () => card).join("");
}

// Cache for ESPN article descriptions, keyed by `${league}:${eventId}`.
const summaryCache = new Map();

async function refreshTonight() {
  // Golf has its own card layout (tournament leaderboard, not a games list).
  if (activeLeague === "pga") {
    refreshPga();
    return;
  }
  try {
    const data = await fetchScoreboard(activeLeague, activeDate);
    let events = (data.events || []).map(ev => normalizeEvent(ev, activeLeague));
    let usingYesterday = false;
    // Empty-state fallback (only when looking at today): if nothing's
    // scheduled, surface yesterday's recaps instead of a void.
    if (!events.length && activeDate === todayYYYYMMDD()) {
      const ymd = yesterdayYYYYMMDD();
      try {
        const y = await fetchScoreboard(activeLeague, ymd);
        events = (y.events || []).map(ev => normalizeEvent(ev, activeLeague));
        usingYesterday = events.length > 0;
      } catch { /* fall through */ }
    }
    if (!events.length) {
      tonightEl.innerHTML = `<p class="muted">No ${LEAGUES[activeLeague].label} games on ${prettyDate(activeDate)}.</p>`;
      return;
    }
    events.sort((a, b) => {
      // live first, then pre, then post
      const ord = { in: 0, pre: 1, post: 2 };
      return (ord[a.state] ?? 3) - (ord[b.state] ?? 3);
    });
    const banner = usingYesterday
      ? `<div class="tonight-banner"><span class="tonight-banner__pill">Yesterday</span> No ${LEAGUES[activeLeague].label} games today — showing yesterday's results.</div>`
      : "";
    tonightEl.innerHTML = banner + events.map(tonightCardHtml).join("");
    tonightEl.querySelectorAll("[data-event-id]").forEach(el => {
      el.addEventListener("click", (e) => {
        // Anchors inside the card (preview link) take their own href without
        // routing through the card-level navigation.
        if (e.target.closest("a")) return;
        location.href = `game.html?id=${el.dataset.eventId}&league=${activeLeague}`;
      });
    });
    // Hydrate stories from ESPN's article description for richer copy than
    // the hand-written fallback (recap on FINAL, narrative on live games).
    events.forEach(ev => hydrateStory(ev));
    // Hydrate Splash Quick Picks + Polymarket preview blocks.
    events.forEach(ev => hydratePreview(ev));
  } catch (e) {
    tonightEl.innerHTML = `<p class="muted">Couldn't load games (${e.message}). Retrying…</p>`;
  }
}

let marketsCfgPromise = null;
function loadMarketsConfig() {
  if (!marketsCfgPromise) {
    marketsCfgPromise = fetch("data/markets.json", { cache: "no-cache" })
      .then(r => r.ok ? r.json() : {})
      .catch(() => ({}));
  }
  return marketsCfgPromise;
}

async function hydratePreview(ev) {
  const slot = tonightEl.querySelector(`[data-preview-for="${ev.id}"]`);
  if (!slot) return;

  const [match, marketsCfg] = await Promise.all([
    matchEspnToSplash(ev),
    loadMarketsConfig(),
  ]);

  // Quick Picks side: top 3 popular props for the matched Splash game.
  let qpProps = [];
  if (match) {
    qpProps = await popularPropsForGame(match.id, match.league, 3);
  }

  // Markets side: pick winner / spread / total from markets.json by ESPN id.
  const cfg = marketsCfg[ev.id];
  const previewMarkets = cfg ? pickPreviewMarkets(cfg, ev) : [];

  if (!qpProps.length && !previewMarkets.length) {
    slot.innerHTML = `<div class="tonight-card__preview-empty">Quick Picks &amp; markets open closer to tip-off.</div>`;
    return;
  }

  const linkHref = `game.html?id=${ev.id}&league=${activeLeague}#markets`;
  slot.innerHTML = `
    <div class="tonight-card__preview-grid">
      ${qpProps.length ? `
        <div class="tc-preview-col">
          <div class="tc-preview-col__title"><span class="tc-preview-col__icon">🎯</span> Splash Quick Picks <span class="tc-preview-col__hint">popular</span></div>
          <ul class="tc-preview-list">
            ${qpProps.map(p => qpPropRowHtml(p, activeLeague)).join("")}
          </ul>
        </div>` : ""}
      ${previewMarkets.length ? `
        <div class="tc-preview-col">
          <div class="tc-preview-col__title"><span class="tc-preview-col__icon">📊</span> Markets <span class="tc-preview-col__hint">Polymarket</span></div>
          <ul class="tc-preview-list">
            ${previewMarkets.map(pair => `
              <li class="tc-preview-pair">
                <span class="tc-preview-pair__type">${escape(pair.type)}</span>
                <span class="tc-preview-pair__pill" style="--pill-color:${pair.yes.color}">
                  <span class="tc-preview-pair__pill-label">${escape(pair.yes.label)}</span>
                  <span class="tc-preview-pair__pill-price">${Math.round(pair.yes.price * 100)}%</span>
                </span>
                <span class="tc-preview-pair__pill" style="--pill-color:${pair.no.color}">
                  <span class="tc-preview-pair__pill-label">${escape(pair.no.label)}</span>
                  <span class="tc-preview-pair__pill-price">${Math.round(pair.no.price * 100)}%</span>
                </span>
              </li>`).join("")}
          </ul>
        </div>` : ""}
    </div>
    <a class="tonight-card__preview-link" href="${linkHref}">View all markets &amp; picks →</a>
  `;
}

// Pick three preview pairs (Moneyline, Spread, Total) and return them as
// two-sided objects so the preview can show both yes/no percentages.
function pickPreviewMarkets(cfg, ev) {
  const ms = cfg.markets || [];
  const home = cfg.homeTeam;
  const away = cfg.awayTeam;
  const pairFor = (type, fallbackPredicate) => buildPreviewPair(ms, type, home, away, fallbackPredicate);

  const moneyline = pairFor("Moneyline");
  const spread = pairFor("Spread");
  const total = pairFor("Total");
  return [moneyline, spread, total].filter(Boolean);
}

function buildPreviewPair(rawMarkets, type, homeT, awayT) {
  const candidates = rawMarkets.filter(m => m.type === type);
  if (!candidates.length) return null;
  const yes = candidates[0];
  const counterpart = candidates.find(c => c !== yes && c.side !== yes.side);
  const no = counterpart || synthesizeOpp(yes, type, homeT, awayT);
  return {
    type,
    yes: previewSide(yes, homeT, awayT, true),
    no: previewSide(no, homeT, awayT, false),
  };
}

function synthesizeOpp(yes, type, homeT, awayT) {
  const oppPrice = Math.max(0.05, Math.min(0.95, 1 - yes.price));
  if (type === "Total") {
    const m = (yes.side || "").match(/(\d+\.?\d*)/);
    const line = m ? m[1] : "";
    const isOver = (yes.side || "").toLowerCase().startsWith("over");
    return { type, side: isOver ? `Under ${line}` : `Over ${line}`, label: isOver ? `Under ${line}` : `Over ${line}`, price: oppPrice };
  }
  if (type === "Spread") {
    const m = (yes.side || "").match(/(\w+)\s+([+-])(\d+\.?\d*)/);
    if (m) {
      const otherTeam = m[1] === homeT ? awayT : homeT;
      const otherSign = m[2] === "-" ? "+" : "-";
      return { type, side: `${otherTeam} ${otherSign}${m[3]}`, label: `${otherTeam} ${otherSign}${m[3]}`, price: oppPrice };
    }
  }
  // Moneyline default
  const team = (yes.side || "").split(" ")[0];
  const otherTeam = team === homeT ? awayT : homeT;
  return { type, side: otherTeam, label: otherTeam, price: oppPrice };
}

function previewSide(raw, homeT, awayT, isYes) {
  const t = raw.type;
  if (t === "Total") {
    const isOver = (raw.side || "").toLowerCase().startsWith("over");
    return { label: raw.side, price: raw.price, color: isOver ? "#22c55e" : "#ef4444" };
  }
  // Team-based market — color by team
  const team = (raw.side || "").split(" ")[0];
  return { label: raw.side, price: raw.price, color: "#" + teamHex(team) };
}

function formatLine(line) {
  if (line == null) return "";
  return Number.isInteger(line) ? `${line}.5` : String(line);
}

function qpPropRowHtml(p, league) {
  const teamAlias = p.team?.alias;
  const teamColor = p.team?.primary_color || "#6b7280";
  const teamLogo = teamAlias
    ? `<img class="tc-qp__team-logo" src="https://a.espncdn.com/i/teamlogos/${league}/500/${teamAlias.toLowerCase()}.png" alt="${escape(teamAlias)}" />`
    : `<span class="tc-qp__team-logo tc-qp__team-logo--blank"></span>`;
  return `
    <li class="tc-qp" style="--team-color:${escape(teamColor)}">
      <span class="tc-qp__avatar" aria-hidden="true">${escape(playerInitials(p.entity_name))}</span>
      ${teamLogo}
      <span class="tc-qp__main">
        <span class="tc-qp__player">${escape(p.entity_name)}</span>
        <span class="tc-qp__type">${escape(p.type_display)}</span>
      </span>
      <span class="tc-qp__line">${formatLine(p.line)}</span>
    </li>
  `;
}

function yesterdayYYYYMMDD() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateToYMD(d);
}

// ---- Golf (PGA) — tournament leaderboard preview ----

// PGA round selection — defaults to the current/active round on first render.
let pgaSelectedRound = null;
let pgaLastEvent = null;

async function refreshPga() {
  try {
    const data = await fetchScoreboard("pga", activeDate);
    const events = (data.events || []);
    if (!events.length) {
      tonightEl.innerHTML = `<p class="muted">No PGA tournament for ${prettyDate(activeDate)}.</p>`;
      return;
    }
    pgaLastEvent = events[0];
    if (pgaSelectedRound == null) pgaSelectedRound = currentRound(pgaLastEvent);
    tonightEl.innerHTML = events.map(ev => pgaTournamentCardHtml(ev, /* topN */ 5)).join("");
    wirePgaRoundPicker();
    events.forEach(ev => hydratePgaTeeTimes(ev, 5, ".pga-tournament-card"));
  } catch (e) {
    tonightEl.innerHTML = `<p class="muted">Couldn't load PGA (${e.message}).</p>`;
  }
}

function wirePgaRoundPicker() {
  const sel = tonightEl.querySelector("#pga-round-select");
  if (!sel) return;
  sel.addEventListener("change", () => {
    pgaSelectedRound = parseInt(sel.value, 10) || 1;
    if (pgaLastEvent) {
      tonightEl.innerHTML = pgaTournamentCardHtml(pgaLastEvent, 5);
      wirePgaRoundPicker();
      hydratePgaTeeTimes(pgaLastEvent, 5, ".pga-tournament-card");
    }
  });
}

function pgaTournamentCardHtml(ev, topN = 5) {
  const c = ev.competitions?.[0] || {};
  const status = c.status?.type?.shortDetail || ev.status?.type?.shortDetail || "";
  const courseName = c.course?.name || ev.venue?.fullName || "";
  const cur = currentRound(ev);
  const round = pgaSelectedRound || cur;
  const competitors = (c.competitors || []);
  const visible = competitors.slice(0, topN);
  return `
    <article class="pga-tournament-card" data-event-id="${escape(ev.id)}">
      <header class="pga-tournament-card__header">
        <div class="pga-tournament-card__eyebrow">PGA Tour · ${escape(status)}</div>
        <h2 class="pga-tournament-card__title">${escape(ev.name || ev.shortName || "Tournament")}</h2>
        <div class="pga-tournament-card__course">${escape(courseName)}</div>
      </header>
      ${pgaRoundPickerHtml(round, cur)}
      <div class="pga-tournament-card__leaders">
        ${visible.length === 0 ? `<p class="muted" style="margin:8px 0;">Field not yet posted.</p>` : `
          <div class="pga-tournament-card__row pga-tournament-card__row--head">
            <span>Pos</span><span>Player</span><span>Total</span><span>R${round}</span><span>Thru</span>
          </div>
          ${visible.map(p => pgaPlayerRowHtml(p, round, cur)).join("")}
        `}
      </div>
      <a class="pga-tournament-card__cta" href="scoreboard.html?league=pga">Full leaderboard →</a>
    </article>
  `;
}

function pgaRoundPickerHtml(round, cur) {
  return `
    <div class="pga-round-picker">
      <label for="pga-round-select">Round</label>
      <select id="pga-round-select">
        ${[1, 2, 3, 4].map(r => `<option value="${r}" ${r === round ? "selected" : ""}>R${r}${r === cur ? " · live" : ""}</option>`).join("")}
      </select>
    </div>
  `;
}

function pgaPlayerRowHtml(p, round, currentRoundN) {
  const flag = p.athlete?.flag?.href || "";
  const name = p.athlete?.shortName || p.athlete?.displayName || "";
  return `
    <div class="pga-tournament-card__row" data-competitor-id="${escape(p.id)}">
      <span class="pga-tournament-card__pos">${escape(String(p.status?.position?.displayName || p.status?.position?.id || ""))}</span>
      <span class="pga-tournament-card__player">
        ${flag ? `<img src="${escape(flag)}" alt="" class="pga-flag" />` : ""}
        <b>${escape(name)}</b>
      </span>
      <span class="pga-tournament-card__score">${escape(String(p.score || "—"))}</span>
      <span class="pga-tournament-card__round">${escape(roundScoreFor(p, round))}</span>
      <span class="pga-tournament-card__thru">${escape(thruFor(p, round, currentRoundN))}</span>
    </div>
  `;
}

function currentRound(ev) {
  const c = ev.competitions?.[0];
  return c?.status?.period || 1;
}

function roundScoreFor(p, round) {
  const ls = p.linescores?.[round - 1];
  if (!ls) return "—";
  // displayValue can be "-8", "+1", "E", "-" (not yet started). Show as-is
  // unless it's "-" / null.
  if (!ls.displayValue || ls.displayValue === "-") return "—";
  return ls.displayValue;
}

function thruFor(p, round, currentRoundN) {
  const ls = p.linescores?.[round - 1];
  if (!ls) return "—";
  const inner = ls.linescores || [];
  if (round < currentRoundN) {
    // Past round — should be 18 holes complete.
    return inner.length === 18 ? "F" : (inner.length ? String(inner.length) : "—");
  }
  if (round > currentRoundN) {
    // Future round — score and thru are TBD.
    return "—";
  }
  // Current round in progress.
  if (inner.length === 18) return "F";
  if (inner.length) return String(inner.length);
  // Empty current round — hydrator will fill in the tee time.
  return "";
}

async function hydratePgaTeeTimes(ev, topN, scopeSelector) {
  const competitors = ev.competitions?.[0]?.competitors || [];
  const top = competitors.slice(0, topN);
  await Promise.all(top.map(async (p) => {
    const row = tonightEl.querySelector(`${scopeSelector}[data-event-id="${ev.id}"] [data-competitor-id="${p.id}"]`);
    if (!row) return;
    const thruEl = row.querySelector(".pga-tournament-card__thru");
    if (!thruEl || (thruEl.textContent.trim() && thruEl.textContent.trim() !== "")) return;
    try {
      const url = `https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/${ev.id}/competitions/${ev.id}/competitors/${p.id}/status`;
      const r = await fetch(url);
      if (!r.ok) return;
      const data = await r.json();
      if (data.type?.state === "pre" && data.teeTime) {
        thruEl.textContent = formatTeeTime(data.teeTime, data.startHole);
        thruEl.classList.add("pga-tournament-card__thru--tee");
      } else if (data.type?.completed) {
        thruEl.textContent = "F";
      } else if (data.thru) {
        thruEl.textContent = String(data.thru);
      }
    } catch { /* fall through */ }
  }));
}

function formatTeeTime(iso, startHole) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase();
  return startHole && startHole !== 1 ? `${time} · ${startHole}` : time;
}

async function hydrateStory(ev) {
  const cacheKey = `${activeLeague}:${ev.id}`;
  let summary = summaryCache.get(cacheKey);
  if (!summary) {
    try { summary = await fetchSummary(ev.id, activeLeague); }
    catch { return; }
    summaryCache.set(cacheKey, summary);
  }
  const article = summary?.article || {};
  const note = (summary?.header?.competitions?.[0]?.notes?.[0]?.headline) || "";
  // Prefer the article description (long form) on finals; the headline is
  // shorter and works better mid-game; the competition note is a good
  // pre-game framing (e.g. "Game 7" / "Eastern Conference Quarterfinals").
  const text = ev.state === "post"
    ? trimSentence(article.description, 220) || article.headline || ""
    : ev.state === "in"
      ? article.headline || trimSentence(article.description, 180) || note || ""
      : note || article.headline || "";
  if (!text) return;
  const card = tonightEl.querySelector(`[data-event-id="${ev.id}"] .tonight-card__story`);
  if (card) card.textContent = text;
}

function trimSentence(s, max) {
  if (!s) return "";
  // ESPN descriptions often start with " — " from the AP byline; strip it.
  let out = s.replace(/^\s*[—–-]\s*/, "").trim();
  if (out.length <= max) return out;
  // Trim at the last sentence boundary before max chars.
  const slice = out.slice(0, max);
  const lastDot = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  return (lastDot > 60 ? slice.slice(0, lastDot + 1) : slice.replace(/\s+\S*$/, "") + "…");
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
      <div class="tonight-card__preview" data-preview-for="${ev.id}">
        <div class="tonight-card__preview-skel">
          <span class="skel" style="height:14px;width:120px;display:inline-block"></span>
          <span class="skel" style="height:14px;width:60%;display:block;margin-top:6px"></span>
          <span class="skel" style="height:14px;width:40%;display:block;margin-top:6px"></span>
        </div>
      </div>
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
    body.innerHTML = panelSkeleton();
    loader().catch(e => {
      body.innerHTML = `<p class="muted">Couldn't load (${escape(e.message)}).</p>`;
    });
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    panel.hidden = true;
  }
}

function panelSkeleton() {
  const row = `<div class="skel-card__row"><span class="skel skel-card__line skel-card__line--short"></span><span class="skel skel-card__line"></span><span class="skel skel-card__line skel-card__line--short" style="margin-left:auto"></span></div>`;
  return `<div class="skel-card" aria-hidden="true">${Array.from({length: 6}, () => row).join("")}</div>`;
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
  pga: [
    { sortKey: "general.cupPoints",       group: "general", statName: "cupPoints",       label: "FedEx Cup",       short: "FEC" },
    { sortKey: "general.amount",          group: "general", statName: "amount",          label: "Money list",      short: "$" },
    { sortKey: "general.wins",            group: "general", statName: "wins",            label: "Wins",            short: "W" },
    { sortKey: "general.topTenFinishes",  group: "general", statName: "topTenFinishes",  label: "Top 10s",         short: "T10" },
    { sortKey: "general.scoringAverage",  group: "general", statName: "scoringAverage",  label: "Scoring average", short: "AVG", asc: true },
  ],
};

const PREVIEW_LEADERS = 5;
const FULL_LEADERS = 25;

async function loadStats(league) {
  const cfg = LEAGUES[league];
  const cats = STAT_CATEGORIES[league] || [];
  if (!cats.length) {
    statsBody.innerHTML = `<p class="muted">No stat leaders configured for ${cfg.label}.</p>`;
    return;
  }

  const urls = cats.map(c => {
    const dir = c.asc ? "asc" : "desc";
    return `https://site.web.api.espn.com/apis/common/v3/sports/${cfg.sport}/${cfg.league}/statistics/byathlete?limit=${FULL_LEADERS}&sort=${c.sortKey}:${dir}`;
  });

  const results = await Promise.all(
    urls.map(u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null))
  );

  const cards = cats.map((c, i) => statCategoryHtml(c, results[i]));
  statsBody.innerHTML = `<div class="stats-grid">${cards.join("")}</div>`;

  // Wire "View all N" toggles.
  statsBody.querySelectorAll("[data-stat-expand]").forEach(btn => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".stat-card");
      const expanded = card.classList.toggle("is-expanded");
      btn.textContent = expanded ? "Show top 5 ↑" : `View all ${card.dataset.fullCount} →`;
    });
  });
}

function statCategoryHtml(cat, data) {
  if (!data) {
    return `<div class="stat-card"><div class="stat-card__title">${escape(cat.label)}</div><p class="muted">Couldn't load.</p></div>`;
  }
  const groupSchema = (data.categories || []).find(c => c && c.name === cat.group);
  const idx = groupSchema?.names ? groupSchema.names.indexOf(cat.statName) : -1;
  const items = (data.athletes || []).slice(0, FULL_LEADERS).map(a => {
    const ath = a.athlete || {};
    const groupVals = (a.categories || []).find(c => c.name === cat.group)?.values || [];
    const raw = idx >= 0 ? groupVals[idx] : null;
    return {
      name: ath.shortName || ath.displayName || "",
      team: ath.teamShortName || ath.team?.abbreviation || "",
      value: formatStat(raw, cat.statName),
    };
  });

  if (!items.length) {
    return `<div class="stat-card"><div class="stat-card__title">${escape(cat.label)}</div><p class="muted">No data.</p></div>`;
  }

  const rowsHtml = items.map((it, i) => `
    <li class="stat-card__row" data-stat-row="${i}">
      <span class="stat-card__rank">${i + 1}</span>
      <span class="stat-card__player">${escape(it.name)}</span>
      <span class="stat-card__team">${escape(it.team)}</span>
      <span class="stat-card__value">${escape(it.value)}</span>
    </li>
  `).join("");

  const showExpand = items.length > PREVIEW_LEADERS;
  return `
    <div class="stat-card" data-full-count="${items.length}">
      <div class="stat-card__title">${escape(cat.label)} <span class="stat-card__short">${escape(cat.short)}</span></div>
      <ol class="stat-card__list">${rowsHtml}</ol>
      ${showExpand ? `<button class="stat-card__expand" type="button" data-stat-expand>View all ${items.length} →</button>` : ""}
    </div>
  `;
}

function formatStat(raw, name) {
  if (raw == null || isNaN(raw)) return "—";
  // PGA money list: format as $X.XM / $XXXk.
  if (name === "amount") {
    const n = Number(raw);
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
    return `$${n}`;
  }
  if (name === "scoringAverage") return Number(raw).toFixed(2);
  if (name === "cupPoints" || name === "topTenFinishes") return String(Math.round(Number(raw)));
  // Batting average: 0.327 → .327
  if (name === "avg") return Number(raw).toFixed(3).replace(/^0/, "");
  if (name === "ERA") return Number(raw).toFixed(2);
  if (/Pct/i.test(name)) return raw < 1 ? Number(raw).toFixed(3).replace(/^0/, "") : Number(raw).toFixed(1);
  if (/^avg/i.test(name)) return Number(raw).toFixed(1);
  // Whole-number counting stats
  if (typeof raw === "number") return String(Math.round(raw));
  return String(raw);
}
