// Game Center controller: header + tabs + live polling.
// Pulls a real ESPN summary on a 10s loop and fans data out to sub-modules.

import { renderNav, mountTicker, escape } from "./script.js?v2026050209";
import { fetchSummary, pollSummary, normalizeEvent, TEAM_LOGO, LEAGUES } from "./espn.js?v2026050209";
import { mountPbp, updatePbp } from "./pbp.js?v2026050209";
import { mountBoxscore, updateBoxscore } from "./boxscore.js?v2026050209";
import { mountMarkets, updateMarketsFromPlay, refreshSparklines } from "./markets.js?v2026050209";
import { mountWinprob, updateWinprob } from "./winprob.js?v2026050209";
import { mountChat } from "./chat.js?v2026050209";
import { startFakeActivity } from "./fakeusers.js?v2026050209";

renderNav("game");
mountTicker(document.querySelector(".ticker"));

const params = new URLSearchParams(location.search);
const gameId = params.get("id") || "401869409";
const league = (params.get("league") || "nba").toLowerCase();
const isBasketball = league === "nba" || league === "wnba";

mountPbp(document.getElementById("panel-pbp"), { gameId, league });
mountBoxscore(document.getElementById("panel-boxscore"), { gameId, league });
// Markets + Win Prob are NBA-specific (Polymarket coverage). Hide for other leagues.
const isNbaGame = league === "nba";
if (isNbaGame) {
  mountMarkets(document.getElementById("panel-markets"), { gameId, league });
} else {
  // Hide unsupported tabs and panels for non-NBA games.
  ["markets", "winprob"].forEach(t => {
    const tab = document.querySelector(`.gc__tab[data-tab="${t}"]`);
    const panel = document.querySelector(`.gc__panel[data-panel="${t}"]`);
    if (tab) tab.style.display = "none";
    if (panel) panel.style.display = "none";
  });
}

// Mount the chat in whichever container is appropriate for the viewport.
// Mobile gets a slide-up sheet, desktop gets the inline right rail.
const isMobile = () => window.matchMedia("(max-width: 768px)").matches;
const desktopChatHost = document.getElementById("game-chat");
const sheetChatHost = document.getElementById("chat-sheet-mount");
const sheet = document.getElementById("chat-sheet");

function ensureChatMounted() {
  const target = isMobile() ? sheetChatHost : desktopChatHost;
  if (target.dataset.mounted === "1") return;
  // Build a fresh `.gc-chat` container inside the chosen host.
  const wrapper = isMobile() ? sheetChatHost : desktopChatHost;
  if (wrapper === sheetChatHost) {
    // Reset any previous content.
    wrapper.innerHTML = "";
    const aside = document.createElement("aside");
    aside.className = "gc-chat";
    aside.id = "game-chat-mobile";
    wrapper.appendChild(aside);
    mountChat(aside, { gameId, league });
  } else {
    mountChat(desktopChatHost, { gameId, league });
  }
  target.dataset.mounted = "1";
}

ensureChatMounted();
window.addEventListener("resize", () => {
  // Re-evaluate mount target when crossing the breakpoint.
  if (isMobile() && !sheetChatHost.dataset.mounted) {
    ensureChatMounted();
  } else if (!isMobile() && !desktopChatHost.dataset.mounted) {
    ensureChatMounted();
  }
});

// Bottom-tab Chat button opens the slide-up sheet on mobile.
const chatBtn = document.querySelector('.tabbar__chat-btn[data-tab="chat"]');
const closeBtn = document.getElementById("chat-sheet-close");
chatBtn?.addEventListener("click", () => {
  ensureChatMounted();
  sheet.classList.add("is-open");
  document.body.style.overflow = "hidden";
});
closeBtn?.addEventListener("click", () => {
  sheet.classList.remove("is-open");
  document.body.style.overflow = "";
});
sheet.addEventListener("click", (e) => {
  if (e.target === sheet) {
    sheet.classList.remove("is-open");
    document.body.style.overflow = "";
  }
});

// New-message dot on the bottom-tab Chat icon.
window.addEventListener("fake:chat", () => {
  if (!sheet.classList.contains("is-open")) chatBtn?.classList.add("has-new");
});
chatBtn?.addEventListener("click", () => chatBtn.classList.remove("has-new"));

// Tabs.
const tabs = document.querySelectorAll(".gc__tab");
const panels = document.querySelectorAll(".gc__panel");
function activateTab(name) {
  let found = false;
  tabs.forEach(x => {
    const on = x.dataset.tab === name;
    x.classList.toggle("is-active", on);
    x.setAttribute("aria-selected", on ? "true" : "false");
    if (on) found = true;
  });
  panels.forEach(p => p.classList.toggle("is-active", p.dataset.panel === name));
  if (name === "markets") refreshSparklines();
  return found;
}

tabs.forEach(t => t.addEventListener("click", () => activateTab(t.dataset.tab)));

// Deep-link support: ?tab=markets or #markets activates that tab on load.
const hashTab = (location.hash || "").replace("#", "");
const queryTab = params.get("tab");
const initialTab = queryTab || hashTab;
if (initialTab) activateTab(initialTab);

// Polling loop.
let processedPlayIds = new Set();
let firstSummary = true;
let homeAbbr = "HOME";
let awayAbbr = "AWAY";
let lastPlays = [];

pollSummary(gameId, async (summary) => {
  if (firstSummary) {
    bootstrapHeader(summary);
    firstSummary = false;
    // Kick off ambient fake-user activity once we know the game exists.
    startFakeActivity({ gameId, getPlays: () => lastPlays.slice().reverse() });
  } else {
    refreshHeader(summary);
  }

  // Fan out to modules.
  updatePbp(summary);
  updateBoxscore(summary);
  updateWinprob(summary);

  // Detect new plays since last tick to drive market updates.
  const plays = (summary.plays || []);
  lastPlays = plays;
  for (const p of plays) {
    if (!processedPlayIds.has(p.id)) {
      processedPlayIds.add(p.id);
      // Skip the very first batch on initial render — nothing has "moved" yet.
      if (!firstSummary && processedPlayIds.size > plays.length - 5) {
        try { updateMarketsFromPlay(p, summary); } catch {}
      }
    }
  }
}, 10000, league);

function bootstrapHeader(summary) {
  const c = summary.header?.competitions?.[0];
  if (!c) return;
  const home = c.competitors.find(x => x.homeAway === "home");
  const away = c.competitors.find(x => x.homeAway === "away");
  homeAbbr = home.team.abbreviation;
  awayAbbr = away.team.abbreviation;

  const colors = pickDistinctChartColors(home.team, away.team);

  mountWinprob({
    homeAbbr,
    awayAbbr,
    homeColor: colors.home,
    awayColor: colors.away,
  });
  refreshHeader(summary);
}

// Per-team alternate-color palette — used when two teams' primaries collide.
// All values pulled from each team's secondary brand color so logos still feel right.
const TEAM_ALT = {
  DET: "c8102e",  // red (alternate to default blue)
  ORL: "0150b5",  // keep blue — Pistons get the swap
  CLE: "fdbb30",  // gold
  TOR: "061922",  // black
  BOS: "ba9653",  // gold
  PHI: "ed174c",  // red
  MIL: "eee1c6",  // cream
  NYK: "f58426",  // orange
  OKC: "ef3b24",  // red
  MEM: "12173f",  // navy
  LAL: "fdb927",  // gold
  HOU: "060606",  // black
  DEN: "fec524",  // gold
  GSW: "ffc72c",  // gold
  MIN: "78be20",  // lime
  DAL: "002b5e",  // navy
  MIA: "f9a01b",  // amber
  CHI: "000000",  // black
  ATL: "c1d32f",  // volt green
};

function pickDistinctChartColors(homeTeam, awayTeam) {
  const homeC = (homeTeam.color || "1d42ba").toLowerCase();
  const awayC = (awayTeam.color || "ef4444").toLowerCase();
  const homeAlt = TEAM_ALT[homeTeam.abbreviation];
  const awayAlt = TEAM_ALT[awayTeam.abbreviation];

  // Try every combination of (home/homeAlt) × (away/awayAlt) and pick the
  // first pair that meets a stronger contrast threshold. This guarantees
  // distinct lines even when both teams share a hue family.
  const homeOptions = [homeC, homeAlt].filter(Boolean);
  const awayOptions = [awayC, awayAlt].filter(Boolean);

  let best = null;
  let bestDist = -1;
  for (const h of homeOptions) {
    for (const a of awayOptions) {
      const d = colorDistance(h, a);
      if (d > bestDist) {
        bestDist = d;
        best = { home: h, away: a };
      }
    }
  }
  if (best && bestDist >= 120) return best;

  // No team-color pair was distinct enough — force a guaranteed-contrast pair.
  // Keep one side roughly in the team's color family if possible.
  return {
    home: homeOptions.find(c => isCool(c)) || "1d42ba", // blue-ish
    away: awayOptions.find(c => isWarm(c)) || "ef4444", // red-ish
  };
}

function colorDistance(a, b) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function colorsTooClose(a, b) {
  return colorDistance(a, b) < 120;
}

function isCool(hex) {
  const [r, g, b] = hexToRgb(hex);
  return b > r;
}
function isWarm(hex) {
  const [r, g, b] = hexToRgb(hex);
  return r > b;
}

function hexToRgb(h) {
  const s = h.replace("#", "").padStart(6, "0").slice(-6);
  return [
    parseInt(s.substring(0, 2), 16),
    parseInt(s.substring(2, 4), 16),
    parseInt(s.substring(4, 6), 16),
  ];
}

function refreshHeader(summary) {
  const c = summary.header?.competitions?.[0];
  if (!c) return;
  const home = c.competitors.find(x => x.homeAway === "home");
  const away = c.competitors.find(x => x.homeAway === "away");
  const status = c.status;
  const live = status.type.state === "in";
  const final = status.type.state === "post";

  const showScore = live || final;
  const homeScore = parseInt(home.score, 10) || 0;
  const awayScore = parseInt(away.score, 10) || 0;
  const homeRecord = home.records?.[0]?.summary || "";
  const awayRecord = away.records?.[0]?.summary || "";

  const broadcast = (c.broadcasts?.[0]?.names || []).join(", ");
  const periodPrefix = league === "mlb" ? "" : league === "nhl" ? "P" : "Q";
  const liveDetail = league === "mlb"
    ? (status.shortDetail || `Inn ${status.period}`)
    : `${periodPrefix}${status.period} · ${status.displayClock || ""}`;
  const detail = live ? liveDetail
    : final ? "Final"
    : status.type.shortDetail;

  document.title = `${away.team.abbreviation} @ ${home.team.abbreviation} · Splash Score Center`;
  document.getElementById("gc-header").innerHTML = `
    <div class="gc__team is-away">
      <div>
        <div class="gc__team-name">${escape(away.team.displayName)}</div>
        <div class="gc__team-sub">${escape(awayRecord)}${broadcast ? ` · ${escape(broadcast)}` : ""}</div>
      </div>
      <img class="gc__team-logo" src="${away.team.logo || TEAM_LOGO(away.team.abbreviation, league)}" alt="${escape(away.team.abbreviation)}" />
    </div>
    <div class="gc__center">
      <div class="gc__score">
        <span>${showScore ? awayScore : "—"}</span>
        <span class="gc__score-sep">·</span>
        <span>${showScore ? homeScore : "—"}</span>
      </div>
      <div class="gc__status">${live ? '<span class="live-dot"></span>' : ""}${escape(detail)}</div>
      <div class="gc__sparkline"><canvas id="winprob-spark"></canvas></div>
    </div>
    <div class="gc__team">
      <img class="gc__team-logo" src="${home.team.logo || TEAM_LOGO(home.team.abbreviation, league)}" alt="${escape(home.team.abbreviation)}" />
      <div>
        <div class="gc__team-name">${escape(home.team.displayName)}</div>
        <div class="gc__team-sub">${escape(homeRecord)}</div>
      </div>
    </div>
  `;
}
