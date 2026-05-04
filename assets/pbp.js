// Play-by-Play feed: real ESPN plays + inline market move cards.
// Each play is a card with reactions, comments, and team context.

import { escape, spawnFloatingEmoji, teamHex, teamChipsHtml } from "./script.js?v2026050208";
import { TEAM_LOGO } from "./espn.js?v2026050208";
import { get, set, commentsKey, reactionsKey } from "./storage.js?v2026050208";
import { requireIdentity, getIdentity } from "./identity.js?v2026050208";

const PRESET_EMOJIS = ["🔥", "😱", "🤯", "💀", "🏀"];

let rootEl = null;
let gameId = null;
let league = "nba";
let knownPlayIds = new Set();
let marketEvents = []; // injected market-move cards (id, after-play index, payload)
let lastSummary = null;

export function mountPbp(el, opts) {
  rootEl = el;
  gameId = opts.gameId;
  league = opts.league || "nba";
  const startLabel = league === "mlb" ? "first pitch" : league === "nhl" ? "puck drop" : "tip-off";
  rootEl.innerHTML = `<div class="pbp__empty">Waiting for ${startLabel}… plays will land here as they happen.</div>`;
}

// Called whenever a fresh ESPN summary lands.
let lastRenderedSignature = "";
let lastMarketCount = 0;
export function updatePbp(summary) {
  if (!rootEl) return;
  lastSummary = summary;

  const rawPlaysOldFirst = (summary.plays || []);
  if (rawPlaysOldFirst.length === 0) {
    if (rootEl.dataset.empty !== "1") {
      rootEl.innerHTML = `<div class="pbp__empty">Tip-off pending. Plays land here in real time.</div>`;
      rootEl.dataset.empty = "1";
    }
    return;
  }
  rootEl.dataset.empty = "";

  // For MLB, collapse pitch noise + hydrate pitcher/batter context onto
  // each result play; for other leagues just drop blank-text plays.
  const cleanedOldFirst = league === "mlb"
    ? cleanMlbPlays(rawPlaysOldFirst, summary)
    : rawPlaysOldFirst.filter(p => p.text);
  const plays = cleanedOldFirst.slice().reverse(); // newest first

  for (const p of plays) {
    if (!knownPlayIds.has(p.id)) knownPlayIds.add(p.id);
  }

  // Skip re-render when nothing has changed — preserves open comment threads
  // and any text users are typing.
  const completed = !!summary.header?.competitions?.[0]?.status?.type?.completed;
  const signature = `${plays.length}:${plays[0]?.id || ""}:${marketEvents.length}:${completed}`;
  if (signature === lastRenderedSignature) return;
  lastRenderedSignature = signature;

  const merged = mergeFeed(plays);
  // Final-game marker on top once the game is completed.
  if (completed) merged.unshift({ kind: "final" });

  rootEl.innerHTML = merged.map(item => {
    if (item.kind === "final") return finalDividerHtml();
    if (item.kind === "quarter") return quarterDividerHtml(item.label, item.flavor);
    if (item.kind === "market") return marketCardHtml(item);
    return playCardHtml(item.play, summary);
  }).join("");
  attachInteractions();
}

// Pre-process MLB plays: skip raw pitch text + transition stubs, turn the
// "Start Inning" / "End Inning" markers into divider plays, and stamp each
// surviving play with the most-recent pitcher/batter from `Start
// Batter/Pitcher`.
function cleanMlbPlays(playsOldFirst, summary) {
  const out = [];
  let pitcher = null;
  let batter = null;
  // Find the pitching team for the current at-bat: ESPN sets `team.id` on
  // `Start Batter/Pitcher` to the pitching team, so we just remember it.
  let pitchTeamId = null;
  let batTeamId = null;

  for (const p of playsOldFirst) {
    const st = p.summaryType;
    const typeText = p.type?.text || "";

    if (st === "I" || typeText === "Start Inning") {
      // Inning divider
      out.push({
        ...p,
        _kind: "inning",
        _flavor: "start",
        _label: p.text || `${p.period?.displayValue || ""}`,
      });
      continue;
    }
    if (typeText === "End Inning") {
      out.push({
        ...p,
        _kind: "inning",
        _flavor: "end",
        _label: p.text || `End of ${p.period?.displayValue || "inning"}`,
      });
      continue;
    }
    if (st === "A" || typeText === "Start Batter/Pitcher") {
      // Parse "X pitches to Y" — set state, don't emit a card here. The
      // upcoming Play Result will carry both names.
      const m = (p.text || "").match(/^(.+?)\s+pitches to\s+(.+)$/i);
      if (m) {
        pitcher = m[1].trim();
        batter = m[2].trim();
      }
      // ESPN convention: this play's team.id = pitching team.
      if (p.team?.id) {
        pitchTeamId = String(p.team.id);
        batTeamId = otherTeamId(summary, pitchTeamId);
      }
      continue;
    }
    // Survive: scoring/non-scoring play results, pitching changes, wild
    // pitches, manually-flagged narrative plays.
    const survives =
      st === "S" || st === "N" || st === "C" ||
      typeText === "Wild Pitch" || typeText === "Pitching Change" ||
      p.scoringPlay === true;
    if (!survives) continue;
    if (!p.text) continue;

    out.push({
      ...p,
      _pitcher: pitcher,
      _batter: batter,
      _pitchTeamId: pitchTeamId,
      _batTeamId: batTeamId,
      _isPitchingChange: st === "C" || typeText === "Pitching Change",
    });
  }
  return out;
}

function otherTeamId(summary, teamId) {
  const competitors = summary.header?.competitions?.[0]?.competitors || [];
  const other = competitors.find(c => String(c.team?.id) !== String(teamId));
  return other ? String(other.team?.id) : null;
}

function mergeFeed(playsNewestFirst) {
  // Insert market events in line with plays (after the play that triggered them).
  // For MLB, plays already include explicit `_kind: "inning"` divider entries.
  // For other leagues, we synthesise quarter/period dividers by watching the
  // `period` value drop as we scan newest-first.
  const out = [];
  let lastPeriod = null;
  for (let i = 0; i < playsNewestFirst.length; i++) {
    const p = playsNewestFirst[i];
    const period = p.period?.number || p.period?.value || 1;
    const mes = marketEvents.filter(m => m.afterPlayId === p.id);
    for (const m of mes) out.push({ kind: "market", ...m });

    if (p._kind === "inning") {
      out.push({ kind: "quarter", label: p._label, flavor: p._flavor });
      lastPeriod = period;
      continue;
    }
    if (league !== "mlb" && lastPeriod !== null && period !== lastPeriod) {
      out.push({ kind: "quarter", label: periodLabel(lastPeriod) });
    }
    out.push({ kind: "play", play: p });
    lastPeriod = period;
  }
  return out;
}

function periodLabel(period) {
  if (league === "nhl") return `End of P${period}`;
  return `End of Q${period}`;
}

function quarterDividerHtml(label, flavor = "") {
  const cls = flavor === "end" ? "pbp__quarter-divider pbp__quarter-divider--end"
    : flavor === "start" ? "pbp__quarter-divider pbp__quarter-divider--start"
    : "pbp__quarter-divider";
  return `<div class="${cls}">${escape(label)}</div>`;
}

function finalDividerHtml() {
  return `<div class="pbp__final-divider"><span>Final</span></div>`;
}

function playCardHtml(p, summary) {
  const score = p.scoreValue && p.scoreValue > 0;
  const major = p.scoreValue >= 3;
  const time = p.clock?.displayValue || "";
  const period = p.period?.number || "";
  const typeIcon = playIcon(p);

  const periodPrefix = league === "mlb" ? "" : league === "nhl" ? "P" : "Q";
  const periodSuffix = league === "mlb" ? ordinal(period) : "";

  if (league === "mlb") {
    return mlbPlayCardHtml(p, summary, score, major, period, periodSuffix);
  }

  const team = (p.team && p.team.id) ? findTeamByEspnId(summary, p.team.id) : null;
  return `
    <article class="play-card ${score ? "is-scoring" : ""} ${major ? "is-major-scoring" : ""}" data-play-id="${escape(p.id)}">
      <div class="play-card__time">
        <div class="play-card__time-q">${periodPrefix}${period}${periodSuffix}</div>
        <div>${escape(time)}</div>
      </div>
      <div class="play-card__body">
        <div class="play-card__top">
          ${team ? `<img class="play-card__team-icon" src="${TEAM_LOGO(team.abbr, league)}" alt="${escape(team.abbr)}" />` : `<span class="play-card__team-icon">${typeIcon}</span>`}
          <span class="play-card__text">${escape(p.text || "")}</span>
          ${(p.awayScore != null && p.homeScore != null) ? `<span class="play-card__score-pill">${p.awayScore} – ${p.homeScore}</span>` : ""}
        </div>
        ${reactionsHtml(p.id)}
        ${commentsBlock(p.id)}
      </div>
    </article>
  `;
}

function mlbPlayCardHtml(p, summary, score, major, period, periodSuffix) {
  const pitchTeam = p._pitchTeamId ? findTeamByEspnId(summary, p._pitchTeamId) : null;
  const batTeam = p._batTeamId ? findTeamByEspnId(summary, p._batTeamId) : null;
  const isPitchingChange = p._isPitchingChange === true;
  const cls = [
    "play-card",
    score ? "is-scoring" : "",
    major ? "is-major-scoring" : "",
    "play-card--mlb",
    isPitchingChange ? "is-pitching-change" : "",
  ].filter(Boolean).join(" ");

  const matchup = (p._pitcher && p._batter)
    ? `<div class="play-card__mlb-matchup">
         ${pitchTeam ? `<img class="play-card__mlb-logo" src="${TEAM_LOGO(pitchTeam.abbr, league)}" alt="${escape(pitchTeam.abbr)}" title="${escape(p._pitcher)} (${escape(pitchTeam.abbr)})" />` : ""}
         <span class="play-card__mlb-name">${escape(p._pitcher)}</span>
         <span class="play-card__mlb-vs">vs</span>
         <span class="play-card__mlb-name">${escape(p._batter)}</span>
         ${batTeam ? `<img class="play-card__mlb-logo" src="${TEAM_LOGO(batTeam.abbr, league)}" alt="${escape(batTeam.abbr)}" title="${escape(p._batter)} (${escape(batTeam.abbr)})" />` : ""}
       </div>`
    : "";

  return `
    <article class="${cls}" data-play-id="${escape(p.id)}">
      <div class="play-card__time">
        <div class="play-card__time-q">${period}${periodSuffix}</div>
        <div>${escape(p.outs != null ? `${p.outs} out${p.outs === 1 ? "" : "s"}` : "")}</div>
      </div>
      <div class="play-card__body">
        ${matchup}
        <div class="play-card__top">
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
          <span><span class="comment__author">${escape(c.name)}</span>${teamChipsHtml(c)}</span>
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
    list.push({ name: id.name, team: id.team, teams: id.teams, body, ts: Date.now() });
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
  const t = (p.type?.text || p.text || "").toLowerCase();
  if (league === "mlb") {
    if (t.includes("home run")) return "💥";
    if (t.includes("strikeout")) return "🥶";
    if (t.includes("walk")) return "🚶";
    if (t.includes("triple")) return "3️⃣";
    if (t.includes("double")) return "2️⃣";
    if (t.includes("single")) return "1️⃣";
    if (t.includes("out")) return "⚾";
    return "⚾";
  }
  if (league === "nhl") {
    if (t.includes("goal")) return "🚨";
    if (t.includes("save")) return "🧤";
    if (t.includes("shot")) return "🎯";
    if (t.includes("penalty")) return "⚖️";
    if (t.includes("hit")) return "💥";
    if (t.includes("faceoff")) return "🏒";
    return "🏒";
  }
  // Basketball default
  if (t.includes("dunk")) return "💥";
  if (t.includes("three")) return "🎯";
  if (t.includes("steal")) return "🥷";
  if (t.includes("block")) return "🛡️";
  if (t.includes("turnover")) return "💀";
  if (t.includes("foul")) return "⚖️";
  if (t.includes("rebound")) return "🪣";
  return "🏀";
}

function ordinal(n) {
  const v = parseInt(n, 10);
  const s = ["th", "st", "nd", "rd"];
  const tens = v % 100;
  return s[(tens - 20) % 10] || s[tens] || s[0];
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
