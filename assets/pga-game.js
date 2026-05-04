// PGA Game Center controller.
// Tabs: Leaderboard, Shot Feed (hole-by-hole highlights for top-10 or
// starred), Player Stats (per-player season + tournament), Course Stats.

import { renderNav, mountTicker, escape } from "./script.js?v2026050209";
import { fetchScoreboard, pollScoreboard } from "./espn.js?v2026050209";
import { findActiveTournament, fetchLeaderboard, fetchLiveStrokes } from "./pgatour.js?v2026050209";

renderNav("game");
mountTicker(document.querySelector(".ticker"));

const params = new URLSearchParams(location.search);
let eventId = params.get("id");
let activeTab = params.get("tab") || (location.hash || "").replace("#", "") || "leaderboard";

const headerEl = document.getElementById("pga-gc-header");
const panels = {
  leaderboard: document.getElementById("panel-leaderboard"),
  feed: document.getElementById("panel-feed"),
  "player-stats": document.getElementById("panel-player-stats"),
  course: document.getElementById("panel-course"),
};

let lastEvent = null;
let courseDetail = null;
let selectedRound = null;
const STAR_KEY = "ssc:pga:starred";
let starred = readStarred();
const linescoreCache = new Map(); // competitorId → items[] (per round)
let stopPoll = null;

// --- Boot ----

bootstrap();

async function bootstrap() {
  // If no event id, look up the active PGA tournament.
  if (!eventId) {
    try {
      const data = await fetchScoreboard("pga");
      eventId = data.events?.[0]?.id;
      if (!eventId) {
        document.querySelector(".pga-gc").innerHTML = `<p class="muted" style="padding:24px;">No PGA tournament in progress.</p>`;
        return;
      }
    } catch (e) {
      document.querySelector(".pga-gc").innerHTML = `<p class="muted" style="padding:24px;">Couldn't load PGA tour data (${escape(e.message)}).</p>`;
      return;
    }
  }
  wireTabs();
  setActiveTab(activeTab);
  await refresh();
  stopPoll = pollScoreboard(refresh, 30000, "pga");
}

async function refresh() {
  try {
    const data = await fetchScoreboard("pga");
    const ev = (data.events || []).find(e => e.id === eventId) || data.events?.[0];
    if (!ev) return;
    lastEvent = ev;
    if (selectedRound == null) selectedRound = currentRound(ev);
    if (!courseDetail) loadCourseDetail(ev.id);
    renderHeader(ev);
    renderActiveTab();
  } catch (e) {
    // Silent — keep prior state.
  }
}

async function loadCourseDetail(evId) {
  try {
    const r = await fetch(`https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/${evId}?lang=en`);
    if (!r.ok) return;
    const data = await r.json();
    courseDetail = data.courses?.[0] || null;
    if (lastEvent) renderHeader(lastEvent);
  } catch {}
}

function wireTabs() {
  document.querySelectorAll(".pga-gc__tab").forEach(t => {
    t.addEventListener("click", () => setActiveTab(t.dataset.tab));
  });
}

function setActiveTab(name) {
  if (!panels[name]) name = "leaderboard";
  activeTab = name;
  document.querySelectorAll(".pga-gc__tab").forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle("is-active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
  Object.entries(panels).forEach(([k, el]) => {
    el.classList.toggle("is-active", k === name);
  });
  renderActiveTab();
}

function renderActiveTab() {
  if (!lastEvent) return;
  switch (activeTab) {
    case "leaderboard": return renderLeaderboard();
    case "feed":        return renderShotFeed();
    case "player-stats":return renderPlayerStats();
    case "course":      return renderCourseStats();
  }
}

// --- Header ----

function renderHeader(ev) {
  const c = ev.competitions?.[0] || {};
  const status = c.status?.type?.shortDetail || "";
  // Course name comes from the event endpoint (cached via courseDetail fetch).
  const courseName = courseDetail?.name || c.course?.name || ev.venue?.fullName || "";
  const cur = currentRound(ev);
  headerEl.innerHTML = `
    <div class="pga-gc__header-main">
      <div class="pga-gc__eyebrow">PGA Tour · ${escape(status)}</div>
      <h1 class="pga-gc__title">${escape(ev.name || ev.shortName || "Tournament")}</h1>
      <div class="pga-gc__course">${escape(courseName)}</div>
    </div>
    <div class="pga-gc__header-right">
      <label for="pga-gc-round">Round</label>
      <select id="pga-gc-round">
        ${[1, 2, 3, 4].map(r => `<option value="${r}" ${r === (selectedRound || cur) ? "selected" : ""}>R${r}${r === cur ? " · live" : ""}</option>`).join("")}
      </select>
    </div>
  `;
  document.getElementById("pga-gc-round").addEventListener("change", (e) => {
    selectedRound = parseInt(e.target.value, 10) || 1;
    renderActiveTab();
  });
}

function currentRound(ev) {
  return ev.competitions?.[0]?.status?.period || 1;
}

// --- Leaderboard ----

function renderLeaderboard() {
  const ev = lastEvent;
  const c = ev.competitions?.[0] || {};
  const cur = currentRound(ev);
  const round = selectedRound || cur;
  const players = c.competitors || [];

  panels.leaderboard.innerHTML = `
    <table class="pga-leaderboard pga-leaderboard--gc">
      <thead>
        <tr>
          <th class="pga-lb__star"></th>
          <th>Pos</th><th>Player</th><th>Total</th><th>R${round}</th><th>Thru</th>
          <th>R1</th><th>R2</th><th>R3</th><th>R4</th><th>Tot</th>
        </tr>
      </thead>
      <tbody>
        ${players.map(p => leaderboardRowHtml(p, round, cur)).join("")}
      </tbody>
    </table>
  `;

  // Star toggles
  panels.leaderboard.querySelectorAll("[data-star-id]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.starId;
      if (starred.has(id)) starred.delete(id);
      else starred.add(id);
      writeStarred();
      btn.classList.toggle("is-on", starred.has(id));
    });
  });

  // Hydrate tee times for current-round empty Thru cells
  hydratePgaTeeTimes(ev, players);
}

function leaderboardRowHtml(p, round, cur) {
  const flag = p.athlete?.flag?.href || "";
  const name = p.athlete?.shortName || p.athlete?.displayName || "";
  const pos = p.status?.position?.displayName || p.status?.position?.id || "";
  const isStarred = starred.has(p.id);
  const r = (n) => roundScoreFor(p, n);
  const totalStrokes = totalStrokesOf(p);
  return `
    <tr data-competitor-id="${escape(p.id)}">
      <td class="pga-lb__star">
        <button class="pga-lb__star-btn ${isStarred ? "is-on" : ""}" data-star-id="${escape(p.id)}" aria-label="Star ${escape(name)}">★</button>
      </td>
      <td class="pga-leaderboard__pos">${escape(String(pos))}</td>
      <td class="pga-leaderboard__player">${flag ? `<img src="${escape(flag)}" alt="" class="pga-flag" />` : ""}<b>${escape(name)}</b></td>
      <td class="pga-leaderboard__score">${escape(String(p.score || "—"))}</td>
      <td class="pga-leaderboard__round">${escape(roundScoreFor(p, round))}</td>
      <td class="pga-leaderboard__thru">${escape(thruFor(p, round, cur))}</td>
      <td>${escape(r(1))}</td>
      <td>${escape(r(2))}</td>
      <td>${escape(r(3))}</td>
      <td>${escape(r(4))}</td>
      <td>${escape(String(totalStrokes || "—"))}</td>
    </tr>
  `;
}

function totalStrokesOf(p) {
  const ls = p.linescores || [];
  let sum = 0;
  for (const r of ls) {
    if (typeof r.value === "number" && r.value > 0) sum += r.value;
  }
  return sum || null;
}

function roundScoreFor(p, round) {
  const ls = p.linescores?.[round - 1];
  if (!ls || !ls.displayValue || ls.displayValue === "-") return "—";
  return ls.displayValue;
}

function thruFor(p, round, cur) {
  const ls = p.linescores?.[round - 1];
  if (!ls) return "—";
  const inner = ls.linescores || [];
  if (round < cur) return inner.length === 18 ? "F" : (inner.length ? String(inner.length) : "—");
  if (round > cur) return "—";
  if (inner.length === 18) return "F";
  if (inner.length) return String(inner.length);
  return "";
}

async function hydratePgaTeeTimes(ev, players) {
  await Promise.all(players.slice(0, 30).map(async (p) => {
    const row = panels.leaderboard.querySelector(`tr[data-competitor-id="${p.id}"]`);
    if (!row) return;
    const thruEl = row.querySelector(".pga-leaderboard__thru");
    if (!thruEl || thruEl.textContent.trim()) return;
    try {
      const url = `https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/${ev.id}/competitions/${ev.id}/competitors/${p.id}/status`;
      const r = await fetch(url);
      if (!r.ok) return;
      const data = await r.json();
      if (data.type?.state === "pre" && data.teeTime) {
        thruEl.textContent = formatTeeTime(data.teeTime, data.startHole);
        thruEl.classList.add("pga-leaderboard__thru--tee");
      } else if (data.type?.completed) {
        thruEl.textContent = "F";
      } else if (data.thru) {
        thruEl.textContent = String(data.thru);
      }
    } catch {}
  }));
}

function formatTeeTime(iso, startHole) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase();
  return startHole && startHole !== 1 ? `${time} · ${startHole}` : time;
}

// --- Shot Feed ----
// We don't have ESPN shot-by-shot for PGA (no public shot tracker), so this
// feed is hole-by-hole "recent action" for the configured player set.
// Each entry: "{Player} — Hole {N} — {Birdie/Eagle/etc} ({strokes}, par {par})"

const SCORE_LABELS = {
  ALBATROSS: "Albatross",
  EAGLE: "Eagle",
  BIRDIE: "Birdie",
  PAR: "Par",
  BOGEY: "Bogey",
  DOUBLE_BOGEY: "Double Bogey",
  TRIPLE_BOGEY: "Triple Bogey",
  HOLE_IN_ONE: "Hole-in-One!",
};

function renderShotFeed() {
  const ev = lastEvent;
  const c = ev.competitions?.[0] || {};
  const players = c.competitors || [];
  const cur = currentRound(ev);
  const round = selectedRound || cur;

  const filterMode = starred.size > 0 ? "starred" : "top10";
  const includedPlayers = filterMode === "starred"
    ? players.filter(p => starred.has(p.id))
    : players.slice(0, 10);

  panels.feed.innerHTML = `
    <div class="pga-feed__bar">
      <div class="pga-feed__filters">
        <button class="pga-feed__chip ${filterMode === "top10" ? "is-active" : ""}" data-feed-mode="top10">Top 10</button>
        <button class="pga-feed__chip ${filterMode === "starred" ? "is-active" : ""}" data-feed-mode="starred">Starred (${starred.size})</button>
      </div>
      <div class="pga-feed__hint" id="pga-feed-source">Loading shot data…</div>
    </div>
    <div class="pga-feed__list" id="pga-feed-list"></div>
    <p class="pga-feed__legend muted">Tip: open the Leaderboard tab and tap the ★ to follow a golfer here.</p>
  `;

  panels.feed.querySelectorAll("[data-feed-mode]").forEach(btn => {
    btn.addEventListener("click", () => renderShotFeed());
  });

  hydrateShotFeed(ev, includedPlayers, round);
}

async function hydrateShotFeed(ev, players, round) {
  const listEl = document.getElementById("pga-feed-list");
  const sourceEl = document.getElementById("pga-feed-source");
  if (!listEl) return;
  listEl.innerHTML = `<p class="muted" style="padding:14px;">Loading shots…</p>`;

  // 1) Try PGA Tour live shot-by-shot data, but with a short timeout — if
  //    the API is slow or no tournament is in progress, we drop straight
  //    into the ESPN hole-by-hole fallback rather than block the user.
  const withTimeout = (promise, ms) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);

  let pgaCards = null;
  try {
    const tournament = await withTimeout(findActiveTournament(ev.name, ev.season?.year), 4000);
    if (tournament && tournament.status === "IN_PROGRESS") {
      const [lb, strokes] = await withTimeout(Promise.all([
        fetchLeaderboard(tournament.id),
        fetchLiveStrokes(tournament.id),
      ]), 6000);
      pgaCards = buildLiveShotCards(lb, strokes, players, round);
      if (sourceEl) sourceEl.textContent = `Shot-by-shot · PGA Tour · ${tournament.name} R${round}`;
    }
  } catch {}

  if (pgaCards && pgaCards.length) {
    listEl.innerHTML = pgaCards.join("");
    return;
  }

  // 2) Fallback: hole-by-hole "recent action" derived from ESPN linescores,
  //    enriched with leaderboard context (Pos / Today / Total / Hole).
  const espnLeaderIndex = new Map(); // ESPN id → { pos, today, total }
  for (const p of (ev.competitions?.[0]?.competitors || [])) {
    espnLeaderIndex.set(p.id, {
      pos: p.status?.position?.displayName || p.status?.position?.id || "",
      total: p.score || "",
      today: roundScoreFor(p, round),
      thru: thruFor(p, round, currentRound(ev)),
    });
  }

  const results = await Promise.all(players.map(async (p) => {
    if (!linescoreCache.has(p.id)) {
      try {
        const url = `https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/${ev.id}/competitions/${ev.id}/competitors/${p.id}/linescores?lang=en`;
        const r = await fetch(url);
        if (!r.ok) return [];
        const data = await r.json();
        linescoreCache.set(p.id, data.items || []);
      } catch { return []; }
    }
    const items = linescoreCache.get(p.id) || [];
    const rd = items[round - 1];
    if (!rd) return [];
    const ctx = espnLeaderIndex.get(p.id) || {};
    return (rd.linescores || []).map((hole, idx) => ({
      player: p.athlete?.shortName || p.athlete?.displayName || "",
      playerId: p.id,
      flag: p.athlete?.flag?.href || "",
      hole: idx + 1,
      par: hole.par,
      strokes: hole.value,
      scoreType: hole.scoreType?.name || "PAR",
      label: SCORE_LABELS[hole.scoreType?.name] || hole.scoreType?.displayName || "Par",
      relative: hole.scoreType?.displayValue || "E",
      pos: ctx.pos,
      total: ctx.total,
      today: ctx.today,
      currentThru: ctx.thru,
    }));
  }));

  const flat = results.flat().filter(s => s.strokes && s.scoreType !== "PAR");
  flat.sort((a, b) => b.hole - a.hole);

  if (!flat.length) {
    if (sourceEl) sourceEl.textContent = "No notable scores yet for this round.";
    listEl.innerHTML = `<p class="muted" style="padding:14px;">No notable scoring events for this round yet.</p>`;
    return;
  }

  if (sourceEl) sourceEl.textContent = `Hole-by-hole · ESPN · R${round} · live shot-by-shot will replace this when a tournament goes IN_PROGRESS on PGA Tour.`;
  listEl.innerHTML = flat.map(holeRecapCardHtml).join("");
}

function buildLiveShotCards(lb, strokes, espnPlayers, round) {
  if (!lb || !strokes?.strokes?.length) return [];
  // Index ESPN players by lowercase short-name so we can map PGA Tour player
  // → ESPN flag / id (and respect the star/top-10 filter).
  const espnByName = new Map();
  const espnIdsToInclude = new Set(espnPlayers.map(p => p.id));
  for (const p of espnPlayers) {
    const name = (p.athlete?.shortName || p.athlete?.displayName || "").toLowerCase();
    if (name) espnByName.set(name, p);
  }

  // PGA Tour leaderboard data for context (position / total / today / thru).
  const lbByPlayerId = new Map();
  for (const row of lb.players || []) {
    lbByPlayerId.set(row.id, row);
  }

  const cards = [];
  for (const stroke of strokes.strokes) {
    if (stroke.currentRound !== round) continue;
    if (!stroke.playByPlay || stroke.playByPlay === "Round Complete") continue;
    const pgaPlayer = lbByPlayerId.get(stroke.playerId)?.player;
    const pgaScoring = lbByPlayerId.get(stroke.playerId)?.scoringData || {};
    if (!pgaPlayer) continue;
    const espn = espnByName.get((pgaPlayer.shortName || pgaPlayer.displayName || "").toLowerCase());
    // Only include if the player is in the active filter set (top-10 or starred)
    if (espnPlayers.length > 0 && !espn && !espnIdsToInclude.has(stroke.playerId)) continue;

    cards.push(liveShotCardHtml({
      name: pgaPlayer.shortName || pgaPlayer.displayName,
      flag: espn?.athlete?.flag?.href || "",
      pos: pgaScoring.position || "",
      total: pgaScoring.total || "",
      today: pgaScoring.score || "",
      thru: pgaScoring.thru || "",
      currentHole: stroke.currentHoleDisplay || `Hole ${stroke.currentHole}`,
      currentShot: stroke.currentShot,
      currentShotDisplay: stroke.currentShotDisplay,
      par: stroke.par,
      yardage: stroke.yardage,
      playByPlay: stroke.playByPlay,
      scoreStatus: stroke.scoreStatus || "NONE",
      finalStroke: stroke.finalStroke,
    }));
  }
  return cards;
}

function liveShotCardHtml(s) {
  const cls = ["pga-feed-card", `pga-feed-card--${(s.scoreStatus || "none").toLowerCase().replace("_", "-")}`, "pga-feed-card--live"];
  return `
    <article class="${cls.join(" ")}">
      <div class="pga-feed-card__top">
        <div class="pga-feed-card__player">
          ${s.flag ? `<img src="${escape(s.flag)}" alt="" class="pga-flag" />` : ""}
          <b>${escape(s.name)}</b>
        </div>
        <div class="pga-feed-card__meta">
          <span class="pga-feed-card__pos">${escape(s.pos || "—")}</span>
          <span class="pga-feed-card__today">Today ${escape(s.today || "—")}</span>
          <span class="pga-feed-card__total">Total ${escape(s.total || "—")}</span>
          <span class="pga-feed-card__hole">${escape(s.currentHole)} · Shot ${escape(String(s.currentShotDisplay || s.currentShot || ""))}</span>
        </div>
      </div>
      <div class="pga-feed-card__pbp">${escape(s.playByPlay)}</div>
      <div class="pga-feed-card__sub muted">Par ${s.par} · ${s.yardage} yds${s.finalStroke ? " · final stroke" : ""}</div>
    </article>
  `;
}

function holeRecapCardHtml(s) {
  const cls = ["pga-feed-card", `pga-feed-card--${(s.scoreType || "par").toLowerCase().replace("_", "-")}`];
  return `
    <article class="${cls.join(" ")}">
      <div class="pga-feed-card__top">
        <div class="pga-feed-card__player">
          ${s.flag ? `<img src="${escape(s.flag)}" alt="" class="pga-flag" />` : ""}
          <b>${escape(s.player)}</b>
        </div>
        <div class="pga-feed-card__meta">
          ${s.pos ? `<span class="pga-feed-card__pos">${escape(s.pos)}</span>` : ""}
          ${s.today ? `<span class="pga-feed-card__today">Today ${escape(s.today)}</span>` : ""}
          ${s.total ? `<span class="pga-feed-card__total">Total ${escape(s.total)}</span>` : ""}
          ${s.currentThru ? `<span class="pga-feed-card__hole">Thru ${escape(s.currentThru)}</span>` : ""}
        </div>
      </div>
      <div class="pga-feed-card__detail">
        <span class="pga-feed-card__hole">Hole ${s.hole}</span>
        <span class="pga-feed-card__label">${escape(s.label)}</span>
        <span class="pga-feed-card__strokes">${s.strokes} (par ${s.par})</span>
        <span class="pga-feed-card__rel ${s.relative.startsWith("-") ? "is-down" : s.relative === "E" ? "is-flat" : "is-up"}">${escape(s.relative)}</span>
      </div>
    </article>
  `;
}

// --- Player Stats ----

function renderPlayerStats() {
  const ev = lastEvent;
  const c = ev.competitions?.[0] || {};
  const players = (c.competitors || []).slice(0, 20);
  panels["player-stats"].innerHTML = `
    <p class="muted" style="margin:0 0 12px;">Top 20 from the field. Strokes-per-round + tournament running totals.</p>
    <div class="pga-pstats-grid">
      ${players.map(playerStatsCardHtml).join("")}
    </div>
  `;
}

function playerStatsCardHtml(p) {
  const name = p.athlete?.shortName || p.athlete?.displayName || "";
  const flag = p.athlete?.flag?.href || "";
  const r1 = p.linescores?.[0];
  const r2 = p.linescores?.[1];
  const r3 = p.linescores?.[2];
  const r4 = p.linescores?.[3];
  const cell = (r) => r ? (r.displayValue === "-" ? "—" : `${r.value || "—"} <span class='muted' style='font-size:10px;'>(${r.displayValue || "—"})</span>`) : "—";
  return `
    <div class="pga-pstats-card">
      <div class="pga-pstats-card__head">
        ${flag ? `<img src="${escape(flag)}" alt="" class="pga-flag" />` : ""}
        <b>${escape(name)}</b>
        <span class="pga-pstats-card__total">${escape(String(p.score || "—"))}</span>
      </div>
      <div class="pga-pstats-card__rounds">
        <div><span>R1</span> ${cell(r1)}</div>
        <div><span>R2</span> ${cell(r2)}</div>
        <div><span>R3</span> ${cell(r3)}</div>
        <div><span>R4</span> ${cell(r4)}</div>
      </div>
    </div>
  `;
}

// --- Course Stats ----

async function renderCourseStats() {
  if (courseDetail) {
    renderCoursePanel(courseDetail);
    return;
  }
  panels.course.innerHTML = `<p class="muted" style="padding:14px;">Loading course stats…</p>`;
  await loadCourseDetail(lastEvent.id);
  if (courseDetail) renderCoursePanel(courseDetail);
  else panels.course.innerHTML = `<p class="muted" style="padding:14px;">No course detail available.</p>`;
}

function renderCoursePanel(course) {
  const holes = course.holes || [];
  const totalPar = (course.parIn || 0) + (course.parOut || 0)
    || holes.reduce((sum, h) => sum + (h.shotsToPar || h.par || 0), 0);
  const totalYards = course.totalYards || holes.reduce((sum, h) => sum + (h.totalYards || h.yardage || 0), 0);
  const front9 = holes.slice(0, 9);
  const back9 = holes.slice(9);
  const front9Par = front9.reduce((s, h) => s + (h.shotsToPar || h.par || 0), 0);
  const back9Par = back9.reduce((s, h) => s + (h.shotsToPar || h.par || 0), 0);
  const front9Yds = front9.reduce((s, h) => s + (h.totalYards || h.yardage || 0), 0);
  const back9Yds = back9.reduce((s, h) => s + (h.totalYards || h.yardage || 0), 0);

  // Per-hole averages from the round stats if available.
  const roundStats = course.tournamentRoundStats || course.tournamentOverallStats;
  const holeAvg = {};
  if (roundStats?.holes) {
    roundStats.holes.forEach(h => {
      if (h.number) holeAvg[h.number] = h.averageScore ?? h.avg;
    });
  }

  panels.course.innerHTML = `
    <div class="pga-course__summary">
      <div>
        <div class="pga-course__name">${escape(course.name || "Course")}</div>
        <div class="muted">${escape(course.address?.city || "")}${course.address?.state ? `, ${escape(course.address.state)}` : ""}</div>
      </div>
      <div class="pga-course__totals">
        <div><span class="muted">Par</span> <b>${totalPar || "—"}</b></div>
        <div><span class="muted">Yards</span> <b>${totalYards ? totalYards.toLocaleString() : "—"}</b></div>
        <div><span class="muted">Holes</span> <b>${holes.length}</b></div>
      </div>
    </div>
    ${holes.length ? `
      <div class="pga-course-table-wrap">
      <table class="pga-course-table">
        <thead>
          <tr>
            <th>Hole</th>
            ${front9.map(h => `<th>${h.number || ""}</th>`).join("")}
            <th>Out</th>
            ${back9.map(h => `<th>${h.number || ""}</th>`).join("")}
            <th>In</th>
            <th>Tot</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><b>Par</b></td>
            ${front9.map(h => `<td>${h.shotsToPar || h.par || ""}</td>`).join("")}
            <td><b>${front9Par}</b></td>
            ${back9.map(h => `<td>${h.shotsToPar || h.par || ""}</td>`).join("")}
            <td><b>${back9Par}</b></td>
            <td><b>${totalPar}</b></td>
          </tr>
          <tr>
            <td><b>Yards</b></td>
            ${front9.map(h => `<td>${h.totalYards || h.yardage || ""}</td>`).join("")}
            <td><b>${front9Yds.toLocaleString()}</b></td>
            ${back9.map(h => `<td>${h.totalYards || h.yardage || ""}</td>`).join("")}
            <td><b>${back9Yds.toLocaleString()}</b></td>
            <td><b>${totalYards.toLocaleString()}</b></td>
          </tr>
          ${Object.keys(holeAvg).length ? `
            <tr>
              <td><b>Avg</b></td>
              ${front9.map(h => `<td>${holeAvg[h.number] ? Number(holeAvg[h.number]).toFixed(2) : "—"}</td>`).join("")}
              <td>—</td>
              ${back9.map(h => `<td>${holeAvg[h.number] ? Number(holeAvg[h.number]).toFixed(2) : "—"}</td>`).join("")}
              <td>—</td>
              <td>—</td>
            </tr>
          ` : ""}
        </tbody>
      </table>
      </div>
    ` : `<p class="muted">No hole-by-hole detail available for this course.</p>`}
  `;
}

// --- Star storage ----

function readStarred() {
  try {
    const raw = localStorage.getItem(STAR_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function writeStarred() {
  try {
    localStorage.setItem(STAR_KEY, JSON.stringify([...starred]));
  } catch {}
}
