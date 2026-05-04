// Box Score tab: full per-player stat tables for both teams.

import { escape } from "./script.js?v2026050209";
import { TEAM_LOGO } from "./espn.js?v2026050209";

let rootEl = null;
let league = "nba";

const STATS = [
  { key: "minutes", label: "MIN" },
  { key: "fieldGoalsMade-fieldGoalsAttempted", label: "FG" },
  { key: "threePointFieldGoalsMade-threePointFieldGoalsAttempted", label: "3PT" },
  { key: "freeThrowsMade-freeThrowsAttempted", label: "FT" },
  { key: "offensiveRebounds", label: "OREB" },
  { key: "defensiveRebounds", label: "DREB" },
  { key: "rebounds", label: "REB" },
  { key: "assists", label: "AST" },
  { key: "steals", label: "STL" },
  { key: "blocks", label: "BLK" },
  { key: "turnovers", label: "TO" },
  { key: "fouls", label: "PF" },
  { key: "plusMinus", label: "+/-" },
  { key: "points", label: "PTS" },
];

export function mountBoxscore(el, opts) {
  rootEl = el;
  league = opts?.league || "nba";
  const start = league === "mlb" ? "the first pitch" : league === "nhl" ? "the puck drop" : "tip-off";
  rootEl.innerHTML = `<p class="muted">Box score will populate once ${start}.</p>`;
}

export function updateBoxscore(summary) {
  if (!rootEl) return;
  const teams = summary.boxscore?.players || [];
  if (!teams.length) {
    rootEl.innerHTML = `<p class="muted">Box score will populate once the game tips off.</p>`;
    return;
  }
  rootEl.innerHTML = teams.map(renderTeam).join("");
}

function renderTeam(team) {
  const abbr = team.team?.abbreviation || "";
  const name = team.team?.displayName || abbr;
  // ESPN groups stats by category — find the player rows.
  const group = (team.statistics || []).find(s => s.athletes || s.players);
  const athletes = (group?.athletes || group?.players || []);
  const labels = (group?.labels || group?.names || []).map(s => s.toUpperCase());
  const totals = group?.totals || [];

  return `
    <section class="bs-team">
      <header class="bs-team__header">
        <img src="${TEAM_LOGO(abbr, league)}" alt="${escape(abbr)}" />
        <span>${escape(name)}</span>
      </header>
      <table class="bs-table">
        <thead>
          <tr>
            <th>Player</th>
            ${labels.map(l => `<th>${escape(l)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${athletes.map(a => {
            const p = a.athlete || {};
            const pos = p.position?.abbreviation || "";
            const did = (a.didNotPlay || a.dnp);
            const stats = a.stats || [];
            return `
              <tr>
                <td>${escape(p.shortName || p.displayName || "")} <span class="pos">${escape(pos)}</span></td>
                ${stats.map(s => `<td>${did ? "DNP" : escape(s)}</td>`).join("")}
                ${stats.length === 0 ? labels.map(() => `<td>—</td>`).join("") : ""}
              </tr>
            `;
          }).join("")}
        </tbody>
        ${totals.length ? `
          <tfoot>
            <tr>
              <td>TEAM</td>
              ${totals.map(t => `<td>${escape(t)}</td>`).join("")}
            </tr>
          </tfoot>` : ""}
      </table>
    </section>
  `;
}
