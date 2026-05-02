// Home page controller: nav + ticker + bracket + tonight's preview cards.

import { renderNav, mountTicker, escape } from "./script.js?v2026050102";
import { fetchScoreboard, normalizeEvent, pollScoreboard, TONIGHT_EVENT_IDS } from "./espn.js?v2026050102";

const STORYLINES = {
  "401869417": "Magic and Pistons square off in a Game 6 elimination — ORL trying to close out the series at home.",
  "401869381": "Cavs lead 3-2 and head to Toronto for a chance to advance. Raptors fighting for survival.",
  "401869409": "Lakers up 3-2 in Houston. Door is open for LA to wrap up the series and head to round two.",
};

renderNav("home");
mountTicker(document.querySelector(".ticker"));

mountTonight(document.getElementById("tonight"));

async function mountTonight(rootEl) {
  async function refresh() {
    try {
      const data = await fetchScoreboard();
      const events = (data.events || [])
        .filter(e => TONIGHT_EVENT_IDS.includes(e.id))
        .map(normalizeEvent);
      rootEl.innerHTML = events.map(tonightCardHtml).join("") || `<p class="muted">Loading tonight's games…</p>`;
      rootEl.querySelectorAll("[data-event-id]").forEach(el => {
        el.addEventListener("click", () => {
          window.location.href = `game.html?id=${el.dataset.eventId}`;
        });
      });
    } catch (e) {
      rootEl.innerHTML = `<p class="muted">Couldn't load games (${e.message}). Retrying…</p>`;
    }
  }
  refresh();
  pollScoreboard(refresh);
}

function tonightCardHtml(ev) {
  const live = ev.isLive;
  const final = ev.state === "post";
  const showScore = live || final;
  const status = live ? `<span class="tonight-card__live"><span class="live-dot"></span>Q${ev.period} · ${ev.clock}</span>`
    : final ? "Final"
    : ev.detail.replace(/^\d+\/\d+\s+-\s+/, "Tip ");

  return `
    <article class="tonight-card" role="button" tabindex="0" data-event-id="${ev.id}">
      <div class="tonight-card__header">
        <span>${status}</span>
        <span>${ev.broadcast || ""}</span>
      </div>
      <div class="tonight-card__matchup">
        <div class="tonight-card__team">
          <img class="tonight-card__logo" src="${ev.away.logo}" alt="${escape(ev.away.fullName)}" />
          <span class="tonight-card__team-name">${escape(ev.away.fullName)}</span>
          <span class="tonight-card__team-record">${escape(ev.away.record)}</span>
        </div>
        <div>
          ${showScore
            ? `<div class="tonight-card__vs-score"><span>${ev.away.score}</span><span style="color:var(--text-mute);font-weight:400">·</span><span>${ev.home.score}</span></div>`
            : `<span class="tonight-card__vs">VS</span>`}
        </div>
        <div class="tonight-card__team">
          <img class="tonight-card__logo" src="${ev.home.logo}" alt="${escape(ev.home.fullName)}" />
          <span class="tonight-card__team-name">${escape(ev.home.fullName)}</span>
          <span class="tonight-card__team-record">${escape(ev.home.record)}</span>
        </div>
      </div>
      <div class="tonight-card__story">${escape(STORYLINES[ev.id] || "Game 6 elimination matchup.")}</div>
      <div class="tonight-card__cta">
        <span>${live ? "Live now" : final ? "Recap available" : "Tip-off soon"}</span>
        <span class="tonight-card__cta-btn">Open Game Center →</span>
      </div>
    </article>
  `;
}
