// Shared bootstrap: nav, sticky ticker, identity surface in header.

import { fetchScoreboard, normalizeEvent, pollScoreboard, pollMultiSportScoreboard, TONIGHT_EVENT_IDS, LEAGUES } from "./espn.js?v2026050101";
import { getIdentity } from "./identity.js?v2026050101";

// Single shared event bus.
export const bus = new EventTarget();

// ---- Nav ----

export function renderNav(activePage) {
  const nav = document.querySelector(".nav");
  if (!nav) return;
  const links = nav.querySelectorAll(".nav__link");
  links.forEach(l => {
    if (l.dataset.page === activePage) l.classList.add("is-active");
  });
  renderIdentityBadge();
  window.addEventListener("identity:change", renderIdentityBadge);
}

function renderIdentityBadge() {
  const slot = document.querySelector(".nav__identity");
  if (!slot) return;
  const id = getIdentity();
  if (!id) {
    slot.innerHTML = `<span class="muted">guest</span>`;
  } else {
    slot.innerHTML = `
      <span class="nav__identity-name">${escape(id.name)}</span>
      ${id.team ? `<span class="comment__team" style="background:#${teamHex(id.team)}">${id.team}</span>` : ""}
    `;
  }
}

// ---- Multi-sport score ticker ----

const TICKER_LEAGUES = ["nba", "mlb", "nhl", "wnba"];

export async function mountTicker(rootEl, opts = {}) {
  if (!rootEl) return () => {};
  const inner = document.createElement("div");
  inner.className = "ticker__inner";
  rootEl.appendChild(inner);

  // League filter chips on top of ticker
  const filter = document.createElement("div");
  filter.className = "ticker__filter";
  filter.innerHTML = TICKER_LEAGUES.map(lg => {
    const cfg = LEAGUES[lg];
    return `<button class="ticker__chip is-active" data-league="${lg}" type="button">
      <span class="ticker__chip-emoji" aria-hidden="true">${cfg.emoji}</span>${cfg.label}
    </button>`;
  }).join("");
  rootEl.insertBefore(filter, inner);

  let activeLeagues = new Set(TICKER_LEAGUES);
  filter.addEventListener("click", (e) => {
    const btn = e.target.closest(".ticker__chip");
    if (!btn) return;
    const lg = btn.dataset.league;
    if (activeLeagues.has(lg)) {
      activeLeagues.delete(lg);
      btn.classList.remove("is-active");
    } else {
      activeLeagues.add(lg);
      btn.classList.add("is-active");
    }
    if (activeLeagues.size === 0) {
      activeLeagues.add(lg);
      btn.classList.add("is-active");
    }
    rerender();
  });

  let lastResults = [];

  function rerender() {
    const events = lastResults
      .filter(r => activeLeagues.has(r.league))
      .flatMap(r => (r.data.events || []).map(ev => normalizeEvent(ev, r.league)))
      .filter(e => !e.isGolf);

    // Sort: live first, then upcoming today, then final at the end. Pin NBA tonight first.
    events.sort((a, b) => {
      const aT = TONIGHT_EVENT_IDS.indexOf(a.id);
      const bT = TONIGHT_EVENT_IDS.indexOf(b.id);
      if (aT !== -1 && bT === -1) return -1;
      if (bT !== -1 && aT === -1) return 1;
      if (aT !== -1 && bT !== -1) return aT - bT;
      // live > pre > post
      const ord = { in: 0, pre: 1, post: 2 };
      return (ord[a.state] ?? 3) - (ord[b.state] ?? 3);
    });

    inner.innerHTML = events.map(tickerCardHtml).join("") || `<span class="muted" style="padding:8px 12px;">No games today.</span>`;
  }

  const stop = pollMultiSportScoreboard((results) => {
    lastResults = results;
    rerender();
  }, 20000, TICKER_LEAGUES);

  return stop;
}

function tickerCardHtml(ev) {
  const live = ev.isLive;
  const final = ev.state === "post";
  const cls = ["ticker-card", `is-${ev.league}`];
  if (live) cls.push("is-live");
  if (final) cls.push("is-final");

  const status = live
    ? formatLiveStatus(ev)
    : final ? "FINAL"
    : ev.detail.replace(/^\d+\/\d+\s+-\s+/, "");

  const homeWinning = ev.home.score > ev.away.score && (live || final);
  const awayWinning = ev.away.score > ev.home.score && (live || final);
  const showScore = live || final;

  return `
    <a href="game.html?id=${ev.id}&league=${ev.league}" class="${cls.join(" ")}" aria-label="${ev.shortName}">
      <div class="ticker-card__status">
        <span class="ticker-card__status-state">${live ? '<span class="live-dot"></span>' : ""}${status}</span>
        <span class="ticker-card__league-tag">${LEAGUES[ev.league]?.label || ev.league.toUpperCase()}</span>
      </div>
      <img class="ticker-card__logo" src="${ev.away.logo}" alt="${ev.away.abbr}" />
      <span><span class="ticker-card__abbr">${ev.away.abbr}</span><span class="ticker-card__sub">${ev.away.record}</span></span>
      <span class="ticker-card__score ${awayWinning ? "is-leading" : ""}">${showScore ? ev.away.score : ""}</span>
      <img class="ticker-card__logo" src="${ev.home.logo}" alt="${ev.home.abbr}" />
      <span><span class="ticker-card__abbr">${ev.home.abbr}</span><span class="ticker-card__sub">${ev.home.record}</span></span>
      <span class="ticker-card__score ${homeWinning ? "is-leading" : ""}">${showScore ? ev.home.score : ""}</span>
    </a>
  `;
}

function formatLiveStatus(ev) {
  // Sport-specific live status formatting.
  const lg = ev.league;
  if (lg === "mlb") {
    // ESPN sends like "Top 5th" in detail; period is half-inning.
    return ev.detail || `Inn ${ev.period}`;
  }
  if (lg === "nhl") {
    return `P${ev.period} ${ev.clock || ""}`;
  }
  // basketball default
  return `Q${ev.period} ${ev.clock || ""}`;
}

// ---- Floating emoji animation ----

export function spawnFloatingEmoji(emoji, x, y) {
  const el = document.createElement("span");
  el.className = "emoji-float";
  el.textContent = emoji;
  el.style.left = `${x - 10}px`;
  el.style.top = `${y - 20}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

// ---- Helpers ----

const TEAM_HEX = {
  DET: "1d42ba", ORL: "0150b5", CLE: "860038", TOR: "ce1141",
  LAL: "552583", HOU: "ce1141", BOS: "007a33", PHI: "006bb6",
  MIL: "00471b", NYK: "006bb6", OKC: "007ac1", MEM: "5d76a9",
  DEN: "0e2240", GSW: "1d428a", MIN: "0c2340", DAL: "00538c",
  MIA: "98002e", CHI: "ce1141", ATL: "e03a3e",
};

export function teamHex(abbr) { return TEAM_HEX[abbr] || "6b7280"; }

export function escape(s) {
  return String(s).replace(/[&<>"]/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;",
  }[c]));
}

export function fmtTime(date) {
  const d = new Date(date);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
