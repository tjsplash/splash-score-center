// Play-by-Play feed: real ESPN plays + inline market move cards.
// Each play is a card with reactions, comments, and team context.

import { escape, spawnFloatingEmoji, teamHex } from "./script.js";
import { TEAM_LOGO } from "./espn.js";
import { get, set, commentsKey, reactionsKey } from "./storage.js";
import { requireIdentity, getIdentity } from "./identity.js";

const PRESET_EMOJIS = ["🔥", "😱", "🤯", "💀", "🏀"];

let rootEl = null;
let gameId = null;
let knownPlayIds = new Set();
let marketEvents = []; // injected market-move cards (id, after-play index, payload)
let lastSummary = null;

export function mountPbp(el, opts) {
  rootEl = el;
  gameId = opts.gameId;
  rootEl.innerHTML = `<div class="pbp__empty">Waiting for tip-off… plays will land here as they happen.</div>`;
}

// Called whenever a fresh ESPN summary lands.
let lastRenderedSignature = "";
let lastMarketCount = 0;
export function updatePbp(summary) {
  if (!rootEl) return;
  lastSummary = summary;

  const plays = (summary.plays || []).slice().reverse(); // newest first
  if (plays.length === 0) {
    if (rootEl.dataset.empty !== "1") {
      rootEl.innerHTML = `<div class="pbp__empty">Tip-off pending. Plays land here in real time.</div>`;
      rootEl.dataset.empty = "1";
    }
    return;
  }
  rootEl.dataset.empty = "";

  // Find genuinely new plays.
  for (const p of plays) {
    if (!knownPlayIds.has(p.id)) knownPlayIds.add(p.id);
  }

  // Skip re-render when nothing has changed — preserves open comment threads
  // and any text users are typing.
  const signature = `${plays.length}:${plays[0]?.id || ""}:${marketEvents.length}`;
  if (signature === lastRenderedSignature) return;
  lastRenderedSignature = signature;

  const merged = mergeFeed(plays);
  rootEl.innerHTML = merged.map(item => {
    if (item.kind === "quarter") return quarterDividerHtml(item.label);
    if (item.kind === "market") return marketCardHtml(item);
    return playCardHtml(item.play, summary);
  }).join("");
  attachInteractions();
}

function mergeFeed(playsNewestFirst) {
  // Insert market events in line with plays (after the play that triggered them).
  // Inject quarter dividers when period changes.
  const out = [];
  let lastPeriod = null;
  for (let i = 0; i < playsNewestFirst.length; i++) {
    const p = playsNewestFirst[i];
    const period = p.period?.number || p.period?.value || 1;
    // Market events that happened "after" this play (earlier in time, since we render newest first)
    const mes = marketEvents.filter(m => m.afterPlayId === p.id);
    for (const m of mes) {
      out.push({ kind: "market", ...m });
    }
    if (lastPeriod !== null && period !== lastPeriod) {
      // We're descending top-down to an earlier period — that boundary marks
      // the end of the period we're about to read.
      out.push({ kind: "quarter", label: `End of Q${period}` });
    }
    out.push({ kind: "play", play: p });
    lastPeriod = period;
  }
  return out;
}

function quarterDividerHtml(label) {
  return `<div class="pbp__quarter-divider">${escape(label)}</div>`;
}

function playCardHtml(p, summary) {
  const score = p.scoreValue && p.scoreValue > 0;
  const major = p.scoreValue >= 3;
  const team = (p.team && p.team.id)
    ? findTeamByEspnId(summary, p.team.id)
    : null;
  const time = p.clock?.displayValue || "";
  const period = p.period?.number || "";
  const typeIcon = playIcon(p);

  return `
    <article class="play-card ${score ? "is-scoring" : ""} ${major ? "is-major-scoring" : ""}" data-play-id="${escape(p.id)}">
      <div class="play-card__time">
        <div class="play-card__time-q">Q${period}</div>
        <div>${escape(time)}</div>
      </div>
      <div class="play-card__body">
        <div class="play-card__top">
          ${team ? `<img class="play-card__team-icon" src="${TEAM_LOGO(team.abbr)}" alt="${escape(team.abbr)}" />` : `<span class="play-card__team-icon">${typeIcon}</span>`}
          <span class="play-card__text">${escape(p.text || "")}</span>
          ${(p.awayScore != null && p.homeScore != null) ? `<span class="play-card__score-pill">${p.awayScore} – ${p.homeScore}</span>` : ""}
        </div>
        ${reactionsHtml(p.id)}
        ${commentsBlock(p.id)}
      </div>
    </article>
  `;
}

function marketCardHtml(m) {
  const up = m.delta > 0;
  return `
    <article class="play-card is-market" data-play-id="${escape(m.id)}">
      <div class="play-card__time">
        <div class="play-card__time-q">${escape(m.periodLabel)}</div>
        <div>${escape(m.clock || "")}</div>
      </div>
      <div class="play-card__body play-card__market">
        <div class="play-card__market-headline">
          <span class="play-card__market-icon" aria-hidden="true">📈</span>
          <span>Market move · <strong>${escape(m.label)}</strong></span>
          <span class="play-card__market-delta ${up ? "" : "is-down"}">${(m.from * 100).toFixed(0)}% → ${(m.to * 100).toFixed(0)}% (${up ? "+" : ""}${(m.delta * 100).toFixed(0)}%)</span>
        </div>
        <div class="play-card__market-trigger">Triggered by: ${escape(m.trigger)}</div>
        <a class="play-card__market-link" href="${escape(m.url || "https://polymarket.com/")}" target="_blank" rel="noopener">Open on Polymarket ↗</a>
        ${reactionsHtml(m.id)}
        ${commentsBlock(m.id)}
      </div>
    </article>
  `;
}

function reactionsHtml(playId) {
  const counts = get(reactionsKey(gameId, playId), {});
  const me = (getIdentity() || {}).name;
  return `
    <div class="reactions" data-rxn="${escape(playId)}">
      ${PRESET_EMOJIS.map(e => {
        const c = (counts[e] || []).length;
        const mine = (counts[e] || []).includes(me);
        return `<button class="reaction ${mine ? "is-mine" : ""}" data-emoji="${e}" type="button" aria-label="React with ${e}">${e}${c ? `<span>${c}</span>` : ""}</button>`;
      }).join("")}
    </div>
  `;
}

function commentsBlock(playId) {
  const list = get(commentsKey(gameId, playId), []);
  const count = list.length;
  return `
    <button class="comments-toggle" data-toggle-comments="${escape(playId)}" type="button">
      💬 ${count} ${count === 1 ? "comment" : "comments"}${count ? "" : " · be first"}
    </button>
    <div class="comments comments--${escape(playId)}" hidden></div>
  `;
}

function commentsListHtml(playId) {
  const list = get(commentsKey(gameId, playId), []);
  return `
    <div class="comments-list">
      ${list.map(c => `
        <div class="comment">
          <span><span class="comment__author">${escape(c.name)}</span>${c.team ? `<span class="comment__team" style="background:#${teamHex(c.team)}">${escape(c.team)}</span>` : ""}</span>
          <span class="comment__time">${formatRelTime(c.ts)}</span>
          <span class="comment__body">${escape(c.body)}</span>
        </div>
      `).join("") || `<div class="comment muted"><span class="comment__body">No comments yet — drop the first reaction.</span></div>`}
    </div>
    <form class="comment-input" data-comment-form="${escape(playId)}">
      <input type="text" maxlength="200" placeholder="Say something…" autocomplete="off" />
      <button type="submit">Post</button>
    </form>
  `;
}

function attachInteractions() {
  // Reactions
  rootEl.querySelectorAll("[data-rxn]").forEach(group => {
    const playId = group.dataset.rxn;
    group.querySelectorAll(".reaction").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        const emoji = btn.dataset.emoji;
        const id = await requireIdentity();
        const key = reactionsKey(gameId, playId);
        const counts = get(key, {});
        const arr = counts[emoji] || [];
        const ix = arr.indexOf(id.name);
        if (ix >= 0) arr.splice(ix, 1);
        else arr.push(id.name);
        counts[emoji] = arr;
        set(key, counts);
        // Visual: spawn float at the button.
        const r = btn.getBoundingClientRect();
        spawnFloatingEmoji(emoji, r.left + r.width / 2, r.top);
        // Re-render reactions in place.
        const newHtml = reactionsHtml(playId);
        const wrapper = document.createElement("div");
        wrapper.innerHTML = newHtml;
        const fresh = wrapper.firstElementChild;
        group.replaceWith(fresh);
        attachInteractions();
      });
    });
  });

  // Comments toggle
  rootEl.querySelectorAll("[data-toggle-comments]").forEach(btn => {
    btn.addEventListener("click", () => {
      const playId = btn.dataset.toggleComments;
      const panel = rootEl.querySelector(`.comments--${cssEscape(playId)}`);
      if (!panel) return;
      const open = panel.hasAttribute("hidden") ? false : true;
      if (open) {
        panel.setAttribute("hidden", "");
        panel.innerHTML = "";
      } else {
        panel.removeAttribute("hidden");
        panel.innerHTML = commentsListHtml(playId);
        wireCommentForm(playId, panel.querySelector("form"));
      }
    });
  });
}

function wireCommentForm(playId, form) {
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = await requireIdentity();
    const input = form.querySelector("input");
    const body = (input.value || "").trim();
    if (!body) return;
    const key = commentsKey(gameId, playId);
    const list = get(key, []);
    list.push({ name: id.name, team: id.team, body, ts: Date.now() });
    set(key, list);
    input.value = "";
    // Re-render comments + count.
    const panel = form.parentElement;
    panel.innerHTML = commentsListHtml(playId);
    wireCommentForm(playId, panel.querySelector("form"));
    // Update toggle count.
    const toggle = rootEl.querySelector(`[data-toggle-comments="${cssEscape(playId)}"]`);
    if (toggle) {
      const count = list.length;
      toggle.textContent = `💬 ${count} ${count === 1 ? "comment" : "comments"}`;
    }
  });
}

// ---- Helpers ----

function findTeamByEspnId(summary, teamId) {
  const competitors = summary.header?.competitions?.[0]?.competitors || [];
  const t = competitors.find(c => String(c.team?.id) === String(teamId));
  return t ? { abbr: t.team.abbreviation, color: t.team.color } : null;
}

function playIcon(p) {
  const t = (p.type?.text || "").toLowerCase();
  if (t.includes("dunk")) return "💥";
  if (t.includes("three")) return "🎯";
  if (t.includes("steal")) return "🥷";
  if (t.includes("block")) return "🛡️";
  if (t.includes("turnover")) return "💀";
  if (t.includes("foul")) return "⚖️";
  if (t.includes("rebound")) return "🪣";
  return "🏀";
}

function formatRelTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function cssEscape(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, c => `\\${c}`);
}

// Public API for market move card injection.
export function injectMarketMove(event) {
  marketEvents.unshift(event); // newest first
  if (lastSummary) updatePbp(lastSummary);
}

export function getKnownPlayCount() {
  return knownPlayIds.size;
}
