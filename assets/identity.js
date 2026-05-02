// Identity: display name + optional team affiliation, persisted to localStorage.
// Modal opens lazily the first time anyone tries to comment or react.

import { get, set } from "./storage.js?v2026050103";

const KEY = "identity";

const TEAM_OPTIONS = [
  { abbr: "", name: "(none)" },
  { abbr: "DET", name: "Pistons" },
  { abbr: "ORL", name: "Magic" },
  { abbr: "CLE", name: "Cavaliers" },
  { abbr: "TOR", name: "Raptors" },
  { abbr: "LAL", name: "Lakers" },
  { abbr: "HOU", name: "Rockets" },
  { abbr: "BOS", name: "Celtics" },
  { abbr: "PHI", name: "76ers" },
  { abbr: "MIL", name: "Bucks" },
  { abbr: "NYK", name: "Knicks" },
  { abbr: "OKC", name: "Thunder" },
  { abbr: "MEM", name: "Grizzlies" },
  { abbr: "DEN", name: "Nuggets" },
  { abbr: "GSW", name: "Warriors" },
  { abbr: "MIN", name: "Timberwolves" },
  { abbr: "DAL", name: "Mavericks" },
  { abbr: "MIA", name: "Heat" },
  { abbr: "CHI", name: "Bulls" },
  { abbr: "ATL", name: "Hawks" },
];

export function getIdentity() {
  return get(KEY, null);
}

export function setIdentity(identity) {
  set(KEY, identity);
}

export function requireIdentity() {
  const existing = getIdentity();
  if (existing && existing.name) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-labelledby="id-modal-title">
        <h2 id="id-modal-title">Pick a handle</h2>
        <p>So your reactions and comments show up the same way every time you visit Splash Score Center.</p>
        <label for="id-modal-name">Display name</label>
        <input id="id-modal-name" type="text" maxlength="20" autocomplete="off" placeholder="e.g. CourtsideTJ" />
        <label for="id-modal-team">Team affiliation (optional)</label>
        <select id="id-modal-team">
          ${TEAM_OPTIONS.map(t => `<option value="${t.abbr}">${t.name}${t.abbr ? ` (${t.abbr})` : ""}</option>`).join("")}
        </select>
        <button class="modal__cta" id="id-modal-save">Save and continue</button>
      </div>
    `;
    document.body.appendChild(backdrop);
    const nameInput = backdrop.querySelector("#id-modal-name");
    const teamSelect = backdrop.querySelector("#id-modal-team");
    const saveBtn = backdrop.querySelector("#id-modal-save");
    nameInput.focus();

    function save() {
      const name = (nameInput.value || "").trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      const identity = { name, team: teamSelect.value || null };
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
