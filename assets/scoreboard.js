// Scoreboard page: ESPN-style list of every NBA game today.

import { renderNav, mountTicker, escape } from "./script.js";
import { fetchScoreboard, normalizeEvent, pollScoreboard, fetchSummary } from "./espn.js";

renderNav("scoreboard");
mountTicker(document.querySelector(".ticker"));

const list = document.getElementById("sb-list");
const dateLabel = document.getElementById("sb-date");

const summaryCache = new Map();

async function refresh() {
  try {
    const data = await fetchScoreboard();
    // Use the local "today" rather than ESPN's UTC-derived day, which can flip a day in PT.
    dateLabel.textContent = new Date().toLocaleDateString([], {
      weekday: "long", month: "long", day: "numeric", year: "numeric"
    });
    const events = (data.events || []).map(normalizeEvent);
    list.innerHTML = events.map(scoreboardCardHtml).join("") || `<p class="muted">No NBA games scheduled today.</p>`;
    list.querySelectorAll("[data-event-id]").forEach(el => {
      el.addEventListener("click", () => {
        window.location.href = `game.html?id=${el.dataset.eventId}`;
      });
    });
    // Lazy-load leaders + line score per card.
    events.forEach(ev => hydrateCard(ev));
  } catch (e) {
    list.innerHTML = `<p class="muted">Couldn't load scoreboard (${e.message}).</p>`;
  }
}

function scoreboardCardHtml(ev) {
  const live = ev.isLive;
  const final = ev.state === "post";
  const showScore = live || final;

  const homeWin = (final && ev.home.score > ev.away.score) || (live && ev.home.score > ev.away.score);
  const awayWin = (final && ev.away.score > ev.home.score) || (live && ev.away.score > ev.home.score);

  const status = live
    ? `<span class="sb-card__status is-live"><span class="dot"></span>Q${ev.period} · ${ev.clock}</span>`
    : final ? `<span class="sb-card__status">FINAL</span>`
    : `<span class="sb-card__status">${escape(ev.detail)}</span>`;

  return `
    <article class="sb-card" role="button" tabindex="0" data-event-id="${ev.id}">
      ${status}
      <div class="sb-card__teams">
        <img src="${ev.away.logo}" alt="${escape(ev.away.abbr)}" />
        <span class="sb-card__team-name">${escape(ev.away.fullName)}<span class="sb-card__team-record">${escape(ev.away.record)}</span></span>
        <span class="sb-card__team-score ${showScore ? (awayWin ? "is-winner" : "is-loser") : ""}">${showScore ? ev.away.score : "—"}</span>

        <img src="${ev.home.logo}" alt="${escape(ev.home.abbr)}" />
        <span class="sb-card__team-name">${escape(ev.home.fullName)}<span class="sb-card__team-record">${escape(ev.home.record)}</span></span>
        <span class="sb-card__team-score ${showScore ? (homeWin ? "is-winner" : "is-loser") : ""}">${showScore ? ev.home.score : "—"}</span>
      </div>
      <div class="sb-card__linescore" data-line="${ev.id}">
        <span class="muted">${escape(ev.broadcast || "")}</span>
      </div>
      <div class="sb-card__leaders" data-leaders="${ev.id}">
        <span class="muted">Loading leaders…</span>
      </div>
    </article>
  `;
}

async function hydrateCard(ev) {
  // Pre-game: show series series info, no leaders.
  const leadersEl = list.querySelector(`[data-leaders="${ev.id}"]`);
  const lineEl = list.querySelector(`[data-line="${ev.id}"]`);
  if (!leadersEl) return;

  if (ev.state === "pre") {
    leadersEl.innerHTML = `<span class="muted">Tip ${escape(ev.detail.replace(/^\d+\/\d+\s+-\s+/, ""))}</span>`;
    return;
  }
  try {
    let summary = summaryCache.get(ev.id);
    if (!summary) {
      summary = await fetchSummary(ev.id);
      summaryCache.set(ev.id, summary);
    }
    // Leaders.
    const leaders = (summary.leaders || []).slice(0, 2).flatMap(t =>
      (t.leaders || []).slice(0, 2).map(l => ({
        team: t.team?.abbreviation || "",
        name: l.leaders?.[0]?.athlete?.shortName || "",
        stat: l.leaders?.[0]?.displayValue || "",
        cat: l.shortDisplayName || l.displayName || "",
      }))
    );
    leadersEl.innerHTML = leaders.length
      ? `<div class="sb-card__leaders-grid">
          ${leaders.slice(0, 4).map(l => `
            <span class="sb-card__leader-cat">${escape(l.cat)}</span>
            <span class="sb-card__leader-player"><b>${escape(l.name)}</b> <span class="muted">(${escape(l.team)})</span></span>
            <span class="sb-card__leader-stat">${escape(l.stat)}</span>
          `).join("")}
        </div>`
      : `<span class="muted">No leaders yet.</span>`;
    // Line score.
    if (lineEl) {
      const awayComp = summary.header?.competitions?.[0]?.competitors;
      if (awayComp) {
        const home = awayComp.find(c => c.homeAway === "home");
        const away = awayComp.find(c => c.homeAway === "away");
        // ESPN sometimes returns linescore entries with null/undefined values for
        // upcoming or not-yet-reported quarters — coerce to a sentinel.
        const toCells = (arr) => (arr || []).map(s => {
          const v = s?.value;
          return (v === null || v === undefined || isNaN(Number(v))) ? null : Math.floor(Number(v));
        });
        const homeLine = toCells(home?.linescores);
        const awayLine = toCells(away?.linescores);
        if (homeLine.length || awayLine.length) {
          const max = Math.max(homeLine.length, awayLine.length, 4);
          const heads = Array.from({ length: max }, (_, i) => `<span class="qhead">Q${i + 1}</span>`).join("");
          const awayCells = Array.from({ length: max }, (_, i) =>
            `<span>${awayLine[i] != null ? awayLine[i] : "—"}</span>`).join("");
          const homeCells = Array.from({ length: max }, (_, i) =>
            `<span>${homeLine[i] != null ? homeLine[i] : "—"}</span>`).join("");
          lineEl.innerHTML = `
            <span class="label">&nbsp;</span>${heads}
            <span class="label">${ev.away.abbr}</span>${awayCells}
            <span class="label">${ev.home.abbr}</span>${homeCells}`;
          lineEl.style.gridTemplateColumns = `auto repeat(${max}, 1fr)`;
        }
      }
    }
  } catch {
    /* ignore */
  }
}

refresh();
pollScoreboard(refresh, 15000);
