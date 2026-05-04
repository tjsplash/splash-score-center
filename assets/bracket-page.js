// Full ESPN-style NBA playoff bracket — 7-column grid, West-Center-East,
// connector lines between rounds, live game highlighting.

import { renderNav, mountTicker, escape } from "./script.js?v2026050209";
import { TEAM_LOGO } from "./espn.js?v2026050209";

renderNav("bracket");
mountTicker(document.querySelector(".ticker"));

const data = await (await fetch("data/bracket.json", { cache: "no-cache" })).json();

const yearLabel = document.getElementById("bp-year-label");
const titleEl = document.getElementById("bp-title");
titleEl.textContent = `NBA Playoffs Bracket ${data.year}`;
yearLabel.textContent = `Live series state, scores from ESPN. Click any matchup to open Game Center.`;

// Round headers row
const rh = document.getElementById("bp-rounds-header");
rh.innerHTML = `
  <div class="bp-round-cell">${escape(data.rounds.r1.label)}<br><span class="bp-round-sub">${escape(data.rounds.r1.subtitle)}</span></div>
  <div class="bp-round-cell">${escape(data.rounds.r2.label)}<br><span class="bp-round-sub">${escape(data.rounds.r2.subtitle)}</span></div>
  <div class="bp-round-cell">${escape(data.rounds.r3.label)}</div>
  <div class="bp-round-cell">${escape(data.rounds.r4.label)}<br><span class="bp-round-sub">${escape(data.rounds.r4.subtitle)}</span></div>
  <div class="bp-round-cell">${escape(data.rounds.r3.label)}</div>
  <div class="bp-round-cell">${escape(data.rounds.r2.label)}<br><span class="bp-round-sub">${escape(data.rounds.r2.subtitle)}</span></div>
  <div class="bp-round-cell">${escape(data.rounds.r1.label)}<br><span class="bp-round-sub">${escape(data.rounds.r1.subtitle)}</span></div>
`;

// Build the bracket grid
const grid = document.getElementById("bracket-grid");
grid.innerHTML = renderBracket(data);

// Wire clicks to event-id-bearing cards
grid.querySelectorAll("[data-event-id]").forEach(el => {
  el.addEventListener("click", () => {
    location.href = `game.html?id=${el.dataset.eventId}`;
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      location.href = `game.html?id=${el.dataset.eventId}`;
    }
  });
});

function renderBracket(d) {
  // West side (cols 1-3): R1[4 series] → R2[2 series] → R3[1 series]
  // Middle (col 4): NBA Finals
  // East side (cols 5-7): R3[1 series] → R2[2 series] → R1[4 series]
  // Connector lines drawn via ::after pseudo-elements + extra gap divs.

  const w = d.rounds.r1.west;
  const e = d.rounds.r1.east;
  const wR2 = d.rounds.r2.west;
  const eR2 = d.rounds.r2.east;
  const wR3 = d.rounds.r3.west[0];
  const eR3 = d.rounds.r3.east[0];
  const finals = d.rounds.r4.finals[0];

  return `
    <!-- West R1 column -->
    ${w.map((s, i) => bracketCard(s, { round: 1, side: "w", i, gridRow: r1Row(i) })).join("")}

    <!-- West R2 column -->
    ${wR2.map((s, i) => bracketCard(s, { round: 2, side: "w", i, gridRow: r2Row(i) })).join("")}

    <!-- West R3 -->
    ${bracketCard(wR3, { round: 3, side: "w", i: 0, gridRow: r3Row() })}

    <!-- NBA Finals -->
    ${bracketCard(finals, { round: 4, side: "c", i: 0, gridRow: r3Row(), isFinals: true })}

    <!-- East R3 -->
    ${bracketCard(eR3, { round: 3, side: "e", i: 0, gridRow: r3Row() })}

    <!-- East R2 -->
    ${eR2.map((s, i) => bracketCard(s, { round: 2, side: "e", i, gridRow: r2Row(i) })).join("")}

    <!-- East R1 -->
    ${e.map((s, i) => bracketCard(s, { round: 1, side: "e", i, gridRow: r1Row(i) })).join("")}
  `;
}

// Grid row positions for bracket cards. 16-row grid, each card spans 4 rows.
function r1Row(i) {
  // Four R1 series: rows 1, 5, 9, 13 (each spans 4 rows)
  return `${1 + i * 4} / span 4`;
}

function r2Row(i) {
  // Two R2 series, sit between paired R1 cards: midpoint between R1-1 and R1-2 is row 5; between R1-3 and R1-4 is row 13.
  // R2-1 at rows 3-7; R2-2 at rows 11-15.
  return i === 0 ? "3 / span 4" : "11 / span 4";
}

function r3Row() {
  // R3 sits centered between R2-1 (row 5) and R2-2 (row 13). Midpoint row 9.
  // Span 4 rows so it goes 7-11.
  return "7 / span 4";
}

function bracketCard(s, ctx) {
  const sideClass = ctx.side === "w" ? "is-west" : ctx.side === "e" ? "is-east" : "is-center";
  const colClass = `col-r${ctx.round}-${ctx.side}${ctx.round === 4 ? "" : `-${ctx.i}`}`;
  const live = s.tonightEventId;
  const tied = s.wins?.[0] === s.wins?.[1] && (s.wins?.[0] || 0) > 0;
  const seriesDone = (s.wins?.[0] || 0) === 4 || (s.wins?.[1] || 0) === 4;

  const statusClass = live ? "is-live" : (tied ? "is-tied" : seriesDone ? "is-done" : (s.leader ? "is-progress" : "is-projected"));

  const statusText = live
    ? (s.scheduleNote || s.series || "Live")
    : (s.series || "");

  const interactive = live ? `data-event-id="${s.tonightEventId}" role="button" tabindex="0"` : "";

  return `
    <div class="bp-card-cell ${sideClass} ${colClass}" style="grid-column: ${roundCol(ctx.round, ctx.side)}; grid-row: ${ctx.gridRow};">
      <div class="bp-card ${statusClass}" ${interactive}>
        ${statusText ? `<div class="bp-card__status">${escape(statusText)}</div>` : ""}
        ${teamRow(s, 0, ctx.isFinals)}
        ${teamRow(s, 1, ctx.isFinals)}
        ${s.scheduleNote && !live ? `<div class="bp-card__schedule">${escape(s.scheduleNote)}</div>` : ""}
      </div>
    </div>
  `;
}

function teamRow(s, idx, isFinals) {
  const abbr = s.teams?.[idx] || "TBD";
  const name = s.names?.[idx] || abbr;
  const seedHigh = s.seedHigh;
  const seedLow = s.seedLow;
  const seed = idx === 0 ? seedHigh : seedLow;
  const score = s.scores?.[idx];
  const wins = s.wins?.[idx] || 0;
  const otherWins = s.wins?.[1 - idx] || 0;
  const isWinner = wins > otherWins && (wins === 4);
  const isLoser = otherWins === 4;
  const tbd = !abbr || abbr === "TBD" || abbr.includes("/") || abbr.endsWith("?");
  // Show wins on both teams once the series has started (one side has at least
  // one game), so a 4-0 sweep reads as "4 / 0" rather than "4 / blank".
  const seriesStarted = (s.wins?.[0] || 0) > 0 || (s.wins?.[1] || 0) > 0;
  const rightVal = score != null
    ? `<span class="bp-card__score ${isWinner ? "is-winner" : ""}">${score}</span>`
    : (seriesStarted ? `<span class="bp-card__wins ${isWinner ? "is-winner" : ""}">${wins}</span>` : "");

  return `
    <div class="bp-card__team ${isLoser ? "is-loser" : ""}">
      ${seed ? `<span class="bp-card__seed">${seed}</span>` : `<span class="bp-card__seed bp-card__seed--blank"></span>`}
      ${tbd
        ? `<span class="bp-card__logo bp-card__logo--tbd" aria-hidden="true">${isFinals ? "🏆" : "?"}</span>`
        : `<img class="bp-card__logo" src="${TEAM_LOGO(abbr)}" alt="${escape(abbr)}" />`}
      <span class="bp-card__name ${isWinner ? "is-winner" : ""}">${escape(displayName(abbr, name))}</span>
      ${rightVal}
    </div>
  `;
}

function displayName(abbr, name) {
  if (!abbr || abbr === "TBD" || abbr.includes("/") || abbr.endsWith("?")) return name;
  // Strip "City " prefix to keep names short, e.g. "Oklahoma City Thunder" → "Thunder"
  const parts = name.split(" ");
  return parts.length > 1 ? parts[parts.length - 1] : name;
}

function roundCol(round, side) {
  // 7 columns: W R1=1, W R2=2, W R3=3, Finals=4, E R3=5, E R2=6, E R1=7
  if (side === "c") return 4;
  if (side === "w") {
    if (round === 1) return 1;
    if (round === 2) return 2;
    if (round === 3) return 3;
  } else {
    // east
    if (round === 1) return 7;
    if (round === 2) return 6;
    if (round === 3) return 5;
  }
  return 1;
}
