// NBA Playoff bracket — round-switchable view (R1 / R2 / Conference Finals / NBA Finals).
// Visual layout mirrors ESPN's playoff-bracket page: East on the left,
// West on the right, with seed dots, records, and series state per matchup.

import { TEAM_LOGO } from "./espn.js?v2026050203";
import { escape } from "./script.js?v2026050203";

let data = null;
let currentRound = "r1";

export async function mountBracket(rootEl) {
  data = await (await fetch("data/bracket.json", { cache: "no-cache" })).json();
  render(rootEl);
}

function render(rootEl) {
  rootEl.innerHTML = `
    <div class="bracket__header">
      <h2 class="bracket__title">Playoff Bracket and Matchups by Round</h2>
      <label class="bracket__round-select">
        <span class="bracket__round-select-label">Round</span>
        <select id="bracket-round" aria-label="Select playoff round">
          ${Object.entries(data.rounds).map(([k, v]) =>
            `<option value="${k}" ${k === currentRound ? "selected" : ""}>${escape(v.label)}</option>`
          ).join("")}
        </select>
      </label>
    </div>
    <div class="bracket__grid" id="bracket-grid">
      ${roundHtml(currentRound)}
    </div>
  `;
  rootEl.querySelector("#bracket-round").addEventListener("change", (e) => {
    currentRound = e.target.value;
    rootEl.querySelector("#bracket-grid").innerHTML = roundHtml(currentRound);
    attachClicks(rootEl);
  });
  attachClicks(rootEl);
}

function attachClicks(rootEl) {
  rootEl.querySelectorAll("[data-event-id]").forEach(el => {
    el.addEventListener("click", () => {
      window.location.href = `game.html?id=${el.dataset.eventId}`;
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        window.location.href = `game.html?id=${el.dataset.eventId}`;
      }
    });
  });
}

function roundHtml(roundKey) {
  const r = data.rounds[roundKey];
  if (roundKey === "r4") {
    return `
      <div class="bracket__finals">
        <div class="bracket__conf-title bracket__conf-title--center">NBA Finals</div>
        <div class="bracket__series">
          ${r.finals.map(s => seriesCard(s, true)).join("")}
        </div>
      </div>
    `;
  }
  return `
    <div>
      <div class="bracket__conf-title">Eastern Conference</div>
      <div class="bracket__series">${r.east.map(s => seriesCard(s)).join("")}</div>
    </div>
    <div>
      <div class="bracket__conf-title">Western Conference</div>
      <div class="bracket__series">${r.west.map(s => seriesCard(s)).join("")}</div>
    </div>
  `;
}

function seriesCard(s, finals = false) {
  const tonight = !!s.tonightEventId;
  const [aWins, bWins] = s.wins;
  const aWin = aWins > bWins;
  const bWin = bWins > aWins;
  const seriesDone = aWins === 4 || bWins === 4;
  const projected = !s.leader && (aWins === 0 && bWins === 0);
  const status = seriesDone
    ? `${s.leader} wins series ${Math.max(aWins, bWins)}-${Math.min(aWins, bWins)}`
    : (s.series || "");

  const seedLabel = (s.seedHigh && s.seedLow)
    ? `(${s.seedHigh}) ${escape(s.teams[0])} vs (${s.seedLow}) ${escape(s.teams[1])}`
    : `${escape(s.names[0])} vs ${escape(s.names[1])}`;

  const interactive = tonight ? `data-event-id="${s.tonightEventId}" role="button" tabindex="0"` : "";

  return `
    <div class="series-card ${tonight ? "is-tonight" : ""} ${projected ? "is-projected" : ""}" ${interactive}>
      <div class="series-card__team">
        ${teamLogo(s.teams[0])}
        <span>${escape(displayName(s.teams[0], s.names[0]))}</span>
        <span class="series-card__team-record">${escape(s.records[0])}</span>
      </div>
      <span class="series-card__wins ${aWin ? "is-winning" : ""}">${aWins}</span>
      <div class="series-card__team">
        ${teamLogo(s.teams[1])}
        <span>${escape(displayName(s.teams[1], s.names[1]))}</span>
        <span class="series-card__team-record">${escape(s.records[1])}</span>
      </div>
      <span class="series-card__wins ${bWin ? "is-winning" : ""}">${bWins}</span>
      <div class="series-card__status">
        <span>${seedLabel}${status ? ` · ${escape(status)}` : ""}</span>
        ${tonight ? `<span class="series-card__tonight-pill">Tonight</span>` : ""}
      </div>
    </div>
  `;
}

function teamLogo(abbr) {
  const tbd = !abbr || abbr === "TBD" || abbr.endsWith("?") || abbr.includes("/");
  if (tbd) return `<span class="series-card__team-logo series-card__team-logo--tbd" aria-hidden="true">?</span>`;
  return `<img class="series-card__team-logo" src="${TEAM_LOGO(abbr)}" alt="${escape(abbr)}" />`;
}

function displayName(abbr, name) {
  if (!abbr) return name;
  if (abbr.endsWith("?") || abbr === "TBD" || abbr.includes("/")) return name; // projected slot
  return abbr;
}
