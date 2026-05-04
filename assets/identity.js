// Identity: display name + optional per-sport team affiliations.
// Persisted to localStorage. Modal opens lazily the first time anyone tries
// to comment, react, or chat. All chosen team chips render together on every
// post the user makes, so a fan with NBA + MLB allegiances shows both.

import { get, set } from "./storage.js?v2026050208";

const KEY = "identity";

// Multi-sport team picker. Curated short list per sport — adequate for a
// prototype; the live app would pull this from the league rosters API.
const TEAMS_BY_SPORT = {
  nba: [
    { abbr: "BOS", name: "Celtics" }, { abbr: "PHI", name: "76ers" },
    { abbr: "NYK", name: "Knicks" }, { abbr: "MIL", name: "Bucks" },
    { abbr: "ATL", name: "Hawks" }, { abbr: "DET", name: "Pistons" },
    { abbr: "ORL", name: "Magic" }, { abbr: "CLE", name: "Cavaliers" },
    { abbr: "TOR", name: "Raptors" }, { abbr: "MIA", name: "Heat" },
    { abbr: "CHI", name: "Bulls" }, { abbr: "OKC", name: "Thunder" },
    { abbr: "DEN", name: "Nuggets" }, { abbr: "MIN", name: "Timberwolves" },
    { abbr: "DAL", name: "Mavericks" }, { abbr: "LAL", name: "Lakers" },
    { abbr: "GSW", name: "Warriors" }, { abbr: "PHX", name: "Suns" },
    { abbr: "SAS", name: "Spurs" }, { abbr: "HOU", name: "Rockets" },
    { abbr: "MEM", name: "Grizzlies" }, { abbr: "POR", name: "Trail Blazers" },
  ],
  nfl: [
    { abbr: "KC", name: "Chiefs" }, { abbr: "BUF", name: "Bills" },
    { abbr: "BAL", name: "Ravens" }, { abbr: "CIN", name: "Bengals" },
    { abbr: "PIT", name: "Steelers" }, { abbr: "MIA", name: "Dolphins" },
    { abbr: "NE", name: "Patriots" }, { abbr: "NYJ", name: "Jets" },
    { abbr: "PHI", name: "Eagles" }, { abbr: "DAL", name: "Cowboys" },
    { abbr: "NYG", name: "Giants" }, { abbr: "WAS", name: "Commanders" },
    { abbr: "GB", name: "Packers" }, { abbr: "MIN", name: "Vikings" },
    { abbr: "DET", name: "Lions" }, { abbr: "CHI", name: "Bears" },
    { abbr: "SF", name: "49ers" }, { abbr: "SEA", name: "Seahawks" },
    { abbr: "LAR", name: "Rams" }, { abbr: "ARI", name: "Cardinals" },
    { abbr: "TB", name: "Buccaneers" }, { abbr: "ATL", name: "Falcons" },
    { abbr: "NO", name: "Saints" }, { abbr: "CAR", name: "Panthers" },
    { abbr: "HOU", name: "Texans" }, { abbr: "IND", name: "Colts" },
    { abbr: "JAX", name: "Jaguars" }, { abbr: "TEN", name: "Titans" },
    { abbr: "DEN", name: "Broncos" }, { abbr: "LAC", name: "Chargers" },
    { abbr: "LV", name: "Raiders" }, { abbr: "CLE", name: "Browns" },
  ],
  mlb: [
    { abbr: "NYY", name: "Yankees" }, { abbr: "BOS", name: "Red Sox" },
    { abbr: "TOR", name: "Blue Jays" }, { abbr: "TB", name: "Rays" },
    { abbr: "BAL", name: "Orioles" }, { abbr: "CLE", name: "Guardians" },
    { abbr: "DET", name: "Tigers" }, { abbr: "CHW", name: "White Sox" },
    { abbr: "KC", name: "Royals" }, { abbr: "MIN", name: "Twins" },
    { abbr: "HOU", name: "Astros" }, { abbr: "TEX", name: "Rangers" },
    { abbr: "SEA", name: "Mariners" }, { abbr: "ATH", name: "Athletics" },
    { abbr: "LAA", name: "Angels" }, { abbr: "ATL", name: "Braves" },
    { abbr: "PHI", name: "Phillies" }, { abbr: "NYM", name: "Mets" },
    { abbr: "WSH", name: "Nationals" }, { abbr: "MIA", name: "Marlins" },
    { abbr: "CHC", name: "Cubs" }, { abbr: "MIL", name: "Brewers" },
    { abbr: "STL", name: "Cardinals" }, { abbr: "CIN", name: "Reds" },
    { abbr: "PIT", name: "Pirates" }, { abbr: "LAD", name: "Dodgers" },
    { abbr: "SF", name: "Giants" }, { abbr: "SD", name: "Padres" },
    { abbr: "ARI", name: "Diamondbacks" }, { abbr: "COL", name: "Rockies" },
  ],
  nhl: [
    { abbr: "BOS", name: "Bruins" }, { abbr: "TOR", name: "Maple Leafs" },
    { abbr: "FLA", name: "Panthers" }, { abbr: "TB", name: "Lightning" },
    { abbr: "BUF", name: "Sabres" }, { abbr: "MTL", name: "Canadiens" },
    { abbr: "OTT", name: "Senators" }, { abbr: "DET", name: "Red Wings" },
    { abbr: "NYR", name: "Rangers" }, { abbr: "NYI", name: "Islanders" },
    { abbr: "NJ", name: "Devils" }, { abbr: "PHI", name: "Flyers" },
    { abbr: "PIT", name: "Penguins" }, { abbr: "WSH", name: "Capitals" },
    { abbr: "CAR", name: "Hurricanes" }, { abbr: "CBJ", name: "Blue Jackets" },
    { abbr: "DAL", name: "Stars" }, { abbr: "COL", name: "Avalanche" },
    { abbr: "MIN", name: "Wild" }, { abbr: "STL", name: "Blues" },
    { abbr: "NSH", name: "Predators" }, { abbr: "WPG", name: "Jets" },
    { abbr: "CHI", name: "Blackhawks" }, { abbr: "VGK", name: "Golden Knights" },
    { abbr: "EDM", name: "Oilers" }, { abbr: "VAN", name: "Canucks" },
    { abbr: "CGY", name: "Flames" }, { abbr: "LA", name: "Kings" },
    { abbr: "SJ", name: "Sharks" }, { abbr: "ANA", name: "Ducks" },
    { abbr: "SEA", name: "Kraken" }, { abbr: "UTA", name: "Mammoth" },
  ],
};

const SPORT_LABEL = { nba: "NBA", nfl: "NFL", mlb: "MLB", nhl: "NHL" };

export function getIdentity() {
  const id = get(KEY, null);
  if (!id) return null;
  // Backwards-compat: legacy identities had `team` (string). Normalize to
  // a `teams` object keyed by sport.
  if (id.teams) return id;
  return { ...id, teams: id.team ? { nba: id.team } : {} };
}

export function setIdentity(identity) {
  set(KEY, identity);
}

// Helper: list of `{ sport, abbr }` chips a user has selected. Empty when
// they're a guest or chose no teams.
export function teamChips(id) {
  if (!id?.teams) return [];
  return Object.entries(id.teams)
    .filter(([_, abbr]) => abbr)
    .map(([sport, abbr]) => ({ sport, abbr }));
}

export function requireIdentity() {
  const existing = getIdentity();
  if (existing && existing.name) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal modal--identity" role="dialog" aria-labelledby="id-modal-title">
        <h2 id="id-modal-title">Pick a handle</h2>
        <p>So your reactions and comments show up the same way every time you visit Splash Score Center. Pick the teams you root for in each sport — all optional. Your fanhood badges show on every post.</p>
        <label for="id-modal-name">Display name</label>
        <input id="id-modal-name" type="text" maxlength="20" autocomplete="off" placeholder="e.g. CourtsideTJ" />
        <div class="id-teams" id="id-teams">
          ${["nba", "nfl", "mlb", "nhl"].map(sport => `
            <div class="id-teams__row">
              <label for="id-team-${sport}">${SPORT_LABEL[sport]} team</label>
              <select id="id-team-${sport}" data-sport="${sport}">
                <option value="">(none)</option>
                ${TEAMS_BY_SPORT[sport].map(t => `<option value="${t.abbr}">${t.name} (${t.abbr})</option>`).join("")}
              </select>
            </div>
          `).join("")}
        </div>
        <button class="modal__cta" id="id-modal-save">Save and continue</button>
      </div>
    `;
    document.body.appendChild(backdrop);
    const nameInput = backdrop.querySelector("#id-modal-name");
    const saveBtn = backdrop.querySelector("#id-modal-save");
    nameInput.focus();

    function save() {
      const name = (nameInput.value || "").trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      const teams = {};
      backdrop.querySelectorAll("[data-sport]").forEach(sel => {
        if (sel.value) teams[sel.dataset.sport] = sel.value;
      });
      // For backwards-compat, still surface the legacy `team` field with the
      // user's NBA pick if they picked one (existing chat code reads .team).
      const identity = { name, teams, team: teams.nba || null };
      setIdentity(identity);
      backdrop.remove();
      window.dispatchEvent(new CustomEvent("identity:change", { detail: identity }));
      resolve(identity);
    }

    saveBtn.addEventListener("click", save);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save();
    });
  });
}
