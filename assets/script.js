// Shared bootstrap: nav, sticky ticker, identity surface in header.

import { fetchScoreboard, normalizeEvent, pollScoreboard, TONIGHT_EVENT_IDS } from "./espn.js";
import { getIdentity } from "./identity.js";

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

// ---- Score ticker ----

export async function mountTicker(rootEl) {
  if (!rootEl) return () => {};
  const inner = document.createElement("div");
  inner.className = "ticker__inner";
  rootEl.appendChild(inner);

  const stop = pollScoreboard((data) => {
    const events = (data.events || []).map(normalizeEvent);
    // Pin tonight's three games first, then any other NBA games today.
    events.sort((a, b) => {
      const aT = TONIGHT_EVENT_IDS.indexOf(a.id);
      const bT = TONIGHT_EVENT_IDS.indexOf(b.id);
      if (aT !== -1 && bT === -1) return -1;
      if (bT !== -1 && aT === -1) return 1;
      return aT - bT;
    });
    inner.innerHTML = events.map(tickerCardHtml).join("");
  });
  return stop;
}

function tickerCardHtml(ev) {
  const live = ev.isLive;
  const final = ev.state === "post";
  const cls = ["ticker-card"];
  if (live) cls.push("is-live");
  if (final) cls.push("is-final");

  const status = live ? `Q${ev.period} ${ev.clock || ""}`
    : final ? "FINAL"
    : ev.detail.replace(/^\d+\/\d+\s+-\s+/, "");

  const homeWinning = ev.home.score > ev.away.score && (live || final);
  const awayWinning = ev.away.score > ev.home.score && (live || final);

  const showScore = live || final;

  return `
    <a href="game.html?id=${ev.id}" class="${cls.join(" ")}" aria-label="${ev.shortName}">
      <div class="ticker-card__status">
        <span class="ticker-card__status-state">${live ? '<span class="live-dot"></span>' : ""}${status}</span>
        ${ev.broadcast ? `<span>${ev.broadcast}</span>` : ""}
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
