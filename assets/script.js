// Shared bootstrap: nav, sticky ticker, identity surface in header.

import { fetchScoreboard, normalizeEvent, pollScoreboard, pollMultiSportScoreboard, TONIGHT_EVENT_IDS, LEAGUES } from "./espn.js?v2026050209";
import { getIdentity } from "./identity.js?v2026050209";

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
  // Patch Game Center / Live links to the most-likely-live event so that
  // the nav doesn't keep linking to a series that has already ended.
  syncGameCenterLink();
}

async function syncGameCenterLink() {
  const candidates = [
    document.querySelector('.nav__link[data-page="game"]'),
    document.querySelector('.tabbar a[data-tab="game"]'),
  ].filter(Boolean);
  if (!candidates.length) return;

  const fallbackId = TONIGHT_EVENT_IDS[0];
  candidates.forEach(el => { if (!el.getAttribute("href")) el.setAttribute("href", `game.html?id=${fallbackId}`); });

  try {
    const data = await fetchScoreboard("nba");
    const events = (data.events || []).map(e => normalizeEvent(e, "nba"));
    // Prefer live; otherwise the first prepared tonight event still on the
    // schedule; otherwise the first scheduled game; otherwise the fallback.
    const live = events.find(e => e.isLive);
    const tonight = events.find(e => TONIGHT_EVENT_IDS.includes(e.id));
    const next = events.find(e => e.state === "pre");
    const pick = live?.id || tonight?.id || next?.id || fallbackId;
    candidates.forEach(el => el.setAttribute("href", `game.html?id=${pick}`));
  } catch {
    /* network errors are fine — fallback already set */
  }
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
      ${teamChipsHtml(id)}
    `;
  }
}

// Render all team chips for an identity or post. Accepts either:
//  • { teams: { nba: "BOS", mlb: "NYY" } }   (multi-sport)
//  • { teams: [{sport, abbr}, ...] }         (legacy array shape)
//  • { team: "BOS" }                          (legacy single-team)
export function teamChipsHtml(holder) {
  if (!holder) return "";
  let chips = [];
  if (holder.teams && Array.isArray(holder.teams)) {
    chips = holder.teams;
  } else if (holder.teams && typeof holder.teams === "object") {
    chips = Object.entries(holder.teams)
      .filter(([_, abbr]) => abbr)
      .map(([sport, abbr]) => ({ sport, abbr }));
  } else if (holder.team) {
    chips = [{ sport: "nba", abbr: holder.team }];
  }
  if (!chips.length) return "";
  return chips.map(c =>
    `<span class="comment__team" style="background:#${teamHex(c.abbr, c.sport)}" title="${escape((c.sport || "").toUpperCase())} fan">${escape(c.abbr)}</span>`
  ).join("");
}

// ---- Multi-sport score ticker ----

const TICKER_LEAGUES = ["nba", "mlb", "nhl", "pga"];
const LEAGUE_ORDER = ["nba", "nhl", "mlb", "pga"]; // ESPN-style ordering: live sports first

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
    // Group events by league so we can render ESPN-style sport dividers.
    const byLeague = {};
    for (const r of lastResults) {
      if (!activeLeagues.has(r.league)) continue;
      const evs = (r.data.events || [])
        .map(ev => normalizeEvent(ev, r.league));
      // Within a sport, sort: live > pre > post; pin NBA-tonight first.
      evs.sort((a, b) => {
        const aT = TONIGHT_EVENT_IDS.indexOf(a.id);
        const bT = TONIGHT_EVENT_IDS.indexOf(b.id);
        if (aT !== -1 && bT === -1) return -1;
        if (bT !== -1 && aT === -1) return 1;
        if (aT !== -1 && bT !== -1) return aT - bT;
        const ord = { in: 0, pre: 1, post: 2 };
        return (ord[a.state] ?? 3) - (ord[b.state] ?? 3);
      });
      byLeague[r.league] = evs;
    }

    const out = [];
    for (const lg of LEAGUE_ORDER) {
      if (!byLeague[lg] || !byLeague[lg].length) continue;
      out.push(`<div class="ticker__divider" style="--sport-accent:${LEAGUES[lg].accent}">${LEAGUES[lg].label}</div>`);
      out.push(byLeague[lg].map(tickerCardHtml).join(""));
    }
    if (!out.length) {
      inner.innerHTML = `<span class="muted" style="padding:8px 12px;">No games right now.</span>`;
    } else {
      inner.innerHTML = out.join("");
    }
  }

  const stop = pollMultiSportScoreboard((results) => {
    lastResults = results;
    rerender();
  }, 20000, TICKER_LEAGUES);

  return stop;
}

function tickerCardHtml(ev) {
  if (ev.isGolf) return tickerGolfCardHtml(ev);

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
        ${ev.broadcast ? `<span class="ticker-card__broadcast">${ev.broadcast}</span>` : ""}
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

function tickerGolfCardHtml(ev) {
  const live = ev.isLive;
  const cls = ["ticker-card", "ticker-card--golf", `is-${ev.league}`];
  if (live) cls.push("is-live");
  if (ev.state === "post") cls.push("is-final");

  const status = ev.detail || (live ? "Live" : "Scheduled");
  const leader = (ev.leaders || [])[0];
  // Use the tournament short name truncated to fit the card width.
  const tname = (ev.shortName || ev.name || "").length > 22
    ? (ev.shortName || ev.name || "").slice(0, 22) + "…"
    : (ev.shortName || ev.name || "");

  return `
    <a href="pga-game.html?id=${ev.id}" class="${cls.join(" ")}" aria-label="${ev.shortName || ""}">
      <div class="ticker-card__status">
        <span class="ticker-card__status-state">${live ? '<span class="live-dot"></span>' : ""}${status}</span>
        <span class="ticker-card__broadcast">PGA</span>
      </div>
      <span class="ticker-card__golf-tname">${tname}</span>
      ${leader ? `
        <span class="ticker-card__golf-leader">
          <span class="ticker-card__golf-rank">1.</span>
          <span class="ticker-card__golf-name">${leader.name}</span>
          <span class="ticker-card__golf-score">${leader.score || "—"}</span>
        </span>
      ` : `<span class="ticker-card__golf-leader muted">No leader yet</span>`}
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

// Per-sport team primary-color lookup. NBA values are the canonical primary
// hex from each team's brand kit; the other leagues are seeded with common
// teams a fan might select. Fallback is a neutral gray.
const TEAM_HEX = {
  nba: {
    DET: "1d42ba", ORL: "0150b5", CLE: "860038", TOR: "ce1141",
    LAL: "552583", HOU: "ce1141", BOS: "007a33", PHI: "006bb6",
    MIL: "00471b", NYK: "006bb6", OKC: "007ac1", MEM: "5d76a9",
    DEN: "0e2240", GSW: "1d428a", MIN: "0c2340", DAL: "00538c",
    MIA: "98002e", CHI: "ce1141", ATL: "e03a3e", PHX: "1d1160",
    SAS: "000000", POR: "e03a3e",
  },
  nfl: {
    KC: "e31837", BUF: "00338d", BAL: "241773", CIN: "fb4f14",
    PIT: "ffb612", MIA: "008e97", NE: "002244",   NYJ: "125740",
    PHI: "004c54", DAL: "003594", NYG: "0b2265",  WAS: "5a1414",
    GB:  "203731", MIN: "4f2683", DET: "0076b6",  CHI: "0b162a",
    SF:  "aa0000", SEA: "002244", LAR: "003594",  ARI: "97233f",
    TB:  "d50a0a", ATL: "a71930", NO:  "d3bc8d",  CAR: "0085ca",
    HOU: "03202f", IND: "002c5f", JAX: "006778",  TEN: "4b92db",
    DEN: "fb4f14", LAC: "0080c6", LV:  "000000",  CLE: "311d00",
  },
  mlb: {
    NYY: "003087", BOS: "bd3039", TOR: "134a8e", TB:  "092c5c",
    BAL: "df4601", CLE: "00385d", DET: "0c2340", CHW: "27251f",
    KC:  "004687", MIN: "002b5c", HOU: "002d62", TEX: "003278",
    SEA: "0c2c56", ATH: "003831", LAA: "ba0021", ATL: "ce1141",
    PHI: "e81828", NYM: "002d72", WSH: "ab0003", MIA: "000000",
    CHC: "0e3386", MIL: "12284b", STL: "c41e3a", CIN: "c6011f",
    PIT: "fdb827", LAD: "005a9c", SF:  "fd5a1e", SD:  "2f241d",
    ARI: "a71930", COL: "33006f",
  },
  nhl: {
    BOS: "ffb81c", TOR: "00205b", FLA: "041e42", TB:  "002868",
    BUF: "002654", MTL: "af1e2d", OTT: "c52032", DET: "ce1126",
    NYR: "0038a8", NYI: "00539b", NJ:  "ce1126", PHI: "f74902",
    PIT: "000000", WSH: "041e42", CAR: "cc0000", CBJ: "002654",
    DAL: "006847", COL: "6f263d", MIN: "154734", STL: "002f87",
    NSH: "ffb81c", WPG: "041e42", CHI: "cf0a2c", VGK: "b4975a",
    EDM: "041e42", VAN: "00205b", CGY: "c8102e", LA:  "111111",
    SJ:  "006d75", ANA: "f47a38", SEA: "001628", UTA: "6cace4",
  },
};

export function teamHex(abbr, sport = "nba") {
  return TEAM_HEX[sport]?.[abbr] || TEAM_HEX.nba[abbr] || "6b7280";
}

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
