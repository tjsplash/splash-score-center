// Game chat right rail — Real Sports-style with quick emojis,
// per-message reactions, and floating emoji animation.

import { escape, teamHex, spawnFloatingEmoji, teamChipsHtml } from "./script.js?v2026050209";
import { get, set, chatKey } from "./storage.js?v2026050209";
import { requireIdentity, getIdentity } from "./identity.js?v2026050209";

const QUICK_EMOJIS_BY_LEAGUE = {
  nba: ["🔥", "😱", "🤯", "💀", "🏀", "🤡", "🚨", "💯"],
  mlb: ["🔥", "😱", "💀", "⚾", "💣", "🚀", "🤡", "💯"],
  nhl: ["🔥", "😱", "💀", "🏒", "🚨", "🧤", "💪", "💯"],
  default: ["🔥", "😱", "🤯", "💀", "🚀", "🤡", "💪", "💯"],
};

const SEED_MESSAGES = {
  nba: [
    { name: "AnimalAndDan", body: "Tip-off vibes 🍿" },
    { name: "BostonRob", body: "either way, this one's going down to the wire" },
    { name: "QuickPicksQ", body: "running a Quickpicks lineup with both stars in this one — let's eat" },
  ],
  mlb: [
    { name: "EastBleachers", body: "first pitch energy ⚾" },
    { name: "DiamondDan", body: "what's everyone running tonight — overs on hits or unders on Ks?" },
    { name: "QuickPicksQ", body: "took the over on top-of-the-order hits, fingers crossed" },
  ],
  nhl: [
    { name: "ShotBlockerSam", body: "puck drop in 5 🥶" },
    { name: "GoaliePoolGuy", body: "how's everyone looking on shots-on-goal lines tonight?" },
    { name: "QuickPicksQ", body: "PP1 over points + power-play assists is my one to watch" },
  ],
  default: [
    { name: "AnimalAndDan", body: "let's get it 🚀" },
    { name: "QuickPicksQ", body: "running picks tonight — drop your favorites" },
  ],
};

let rootEl = null;
let gameId = null;
let leagueLocal = "nba";

export function mountChat(el, opts) {
  rootEl = el;
  gameId = opts.gameId;
  leagueLocal = opts.league || "nba";

  const QUICK_EMOJIS = QUICK_EMOJIS_BY_LEAGUE[leagueLocal] || QUICK_EMOJIS_BY_LEAGUE.default;

  rootEl.innerHTML = `
    <div class="gc-chat__header">
      <span class="gc-chat__title">Game Chat</span>
      <span class="gc-chat__count" id="chat-count"></span>
    </div>
    <div class="gc-chat__body" id="chat-body"></div>
    <div class="gc-chat__footer">
      <div class="gc-chat__quick" id="chat-quick">
        ${QUICK_EMOJIS.map(e => `<button class="gc-chat__quick-btn" data-quick="${e}" type="button" aria-label="Send ${e}">${e}</button>`).join("")}
      </div>
      <form class="comment-input" id="chat-form">
        <input type="text" maxlength="200" placeholder="Talk about the game…" autocomplete="off" />
        <button type="button" id="chat-emoji-toggle" class="gc-chat__emoji-toggle" aria-label="Add emoji">😀</button>
        <button type="submit">Post</button>
      </form>
      <div class="gc-chat__picker" id="chat-picker" hidden></div>
    </div>
  `;

  const form = rootEl.querySelector("#chat-form");
  const input = form.querySelector("input");
  const picker = rootEl.querySelector("#chat-picker");
  const toggle = rootEl.querySelector("#chat-emoji-toggle");

  // Submit a text message.
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = (input.value || "").trim();
    if (!body) return;
    const id = await requireIdentity();
    pushMessage({ name: id.name, team: id.team, teams: id.teams, body, ts: Date.now() });
    input.value = "";
    picker.hidden = true;
  });

  // Quick emoji bar — single tap sends the emoji as its own message.
  rootEl.querySelector("#chat-quick").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-quick]");
    if (!btn) return;
    const emoji = btn.dataset.quick;
    const id = await requireIdentity();
    const r = btn.getBoundingClientRect();
    spawnFloatingEmoji(emoji, r.left + r.width / 2, r.top);
    pushMessage({ name: id.name, team: id.team, teams: id.teams, body: emoji, ts: Date.now(), emojiOnly: true });
  });

  // Emoji picker for inline-into-text.
  toggle.addEventListener("click", () => {
    if (picker.hidden) {
      picker.innerHTML = QUICK_EMOJIS.concat(["🙌", "👀", "🥶", "🧊", "😤", "🤝", "🎯", "🛡️", "🥷", "⚖️", "🪣"])
        .map(e => `<button class="gc-chat__pick" data-pick="${e}" type="button">${e}</button>`).join("");
      picker.hidden = false;
    } else {
      picker.hidden = true;
    }
  });
  picker.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-pick]");
    if (!btn) return;
    input.value = (input.value || "") + btn.dataset.pick;
    input.focus();
  });

  // React to existing messages.
  rootEl.addEventListener("click", async (e) => {
    const r = e.target.closest("[data-msg-react]");
    if (!r) return;
    const messageTs = parseInt(r.dataset.msgTs, 10);
    const emoji = r.dataset.msgReact;
    const id = await requireIdentity();
    const list = get(chatKey(gameId), []);
    const msg = list.find(m => m.ts === messageTs);
    if (!msg) return;
    msg.reactions = msg.reactions || {};
    const arr = msg.reactions[emoji] || [];
    const ix = arr.indexOf(id.name);
    if (ix >= 0) arr.splice(ix, 1);
    else arr.push(id.name);
    msg.reactions[emoji] = arr;
    set(chatKey(gameId), list);
    const rect = r.getBoundingClientRect();
    spawnFloatingEmoji(emoji, rect.left + rect.width / 2, rect.top);
    render();
  });

  // Open the per-message reaction-add menu.
  rootEl.addEventListener("click", (e) => {
    const add = e.target.closest("[data-msg-add]");
    if (!add) return;
    const ts = add.dataset.msgAdd;
    closeAllAddPickers(rootEl);
    const wrap = document.createElement("div");
    wrap.className = "gc-chat__msg-pickers";
    wrap.dataset.pickerFor = ts;
    wrap.innerHTML = QUICK_EMOJIS.map(em =>
      `<button class="gc-chat__pick" data-msg-react="${em}" data-msg-ts="${ts}" type="button">${em}</button>`
    ).join("");
    add.parentElement.appendChild(wrap);
    setTimeout(() => {
      const close = (ev) => {
        if (!wrap.contains(ev.target)) {
          wrap.remove();
          document.removeEventListener("click", close, true);
        }
      };
      document.addEventListener("click", close, true);
    }, 0);
  });

  // Seed welcome messages once — sport-aware so an MLB chat doesn't open with
  // NBA Game 6 talk. Stamp ascending timestamps so order is stable.
  const existing = get(chatKey(gameId), []);
  if (!existing.length) {
    const seeds = SEED_MESSAGES[leagueLocal] || SEED_MESSAGES.default;
    const baseTs = Date.now() - 1000 * 60 * (seeds.length * 3);
    set(chatKey(gameId), seeds.map((m, i) => ({
      ...m,
      team: null,
      teams: {},
      ts: baseTs + i * 1000 * 60 * 3,
    })));
  } else {
    const cleaned = existing.filter(m => !/o&?d parlay riding/i.test(m.body || ""));
    if (cleaned.length !== existing.length) set(chatKey(gameId), cleaned);
  }

  // Listen for fake activity so the chat re-renders without waiting for poll.
  window.addEventListener("fake:chat", (e) => {
    if (e.detail?.gameId === gameId) render();
  });

  render();
}

function pushMessage(msg) {
  const list = get(chatKey(gameId), []);
  list.push(msg);
  set(chatKey(gameId), list);
  render();
}

function closeAllAddPickers(scope) {
  scope.querySelectorAll(".gc-chat__msg-pickers").forEach(el => el.remove());
}

function render() {
  if (!rootEl) return;
  const list = get(chatKey(gameId), []);
  const body = rootEl.querySelector("#chat-body");
  const count = rootEl.querySelector("#chat-count");
  count.textContent = `${list.length} ${list.length === 1 ? "message" : "messages"}`;
  body.innerHTML = list.map(messageHtml).join("");
  body.scrollTop = body.scrollHeight;
}

function messageHtml(m) {
  const reactions = m.reactions || {};
  const reactionPills = Object.entries(reactions)
    .filter(([_, arr]) => arr && arr.length)
    .map(([em, arr]) => `
      <button class="gc-chat__rxn" data-msg-react="${em}" data-msg-ts="${m.ts}" type="button">${em} ${arr.length}</button>
    `).join("");

  return `
    <div class="gc-chat__msg ${m.emojiOnly ? "is-emoji-only" : ""}">
      <div class="gc-chat__msg-meta">
        <span class="gc-chat__msg-author">${escape(m.name)}</span>
        ${teamChipsHtml(m)}
        <span>${formatRel(m.ts)}</span>
      </div>
      <div class="gc-chat__msg-body ${m.emojiOnly ? "gc-chat__msg-body--emoji" : ""}">${escape(m.body)}</div>
      <div class="gc-chat__msg-reactions">
        ${reactionPills}
        <button class="gc-chat__rxn-add" data-msg-add="${m.ts}" type="button" aria-label="Add reaction">+</button>
      </div>
    </div>
  `;
}

function formatRel(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
