// Markets module: realistic Polymarket-style markets per game.
// Prices update on every new ESPN play, and any swing >=5% emits an event
// that the PBP module renders inline as a Market Move card.

import { escape } from "./script.js?v2026050103";
import { injectMarketMove } from "./pbp.js?v2026050103";

const SWING_THRESHOLD = 0.05;
const HISTORY_LEN = 60;

let gameId = null;
let rootEl = null;
let markets = [];
let snapshots = {}; // marketId -> last "anchor" price for swing detection
let homeAbbr = null;
let awayAbbr = null;
let eventUrl = null;

export async function mountMarkets(el, opts) {
  rootEl = el;
  gameId = opts.gameId;
  const all = await (await fetch("data/markets.json", { cache: "no-cache" })).json();
  const cfg = all[gameId];
  if (!cfg) {
    rootEl.innerHTML = `<p class="muted">No markets configured for this game.</p>`;
    return;
  }
  homeAbbr = cfg.homeTeam;
  awayAbbr = cfg.awayTeam;
  eventUrl = cfg.eventUrl;
  markets = cfg.markets.map(m => ({
    ...m,
    history: seedHistory(m.price),
    delta24: 0,
  }));
  markets.forEach(m => snapshots[m.id] = m.price);
  renderMarkets();
}

export function updateMarketsFromPlay(play, summary) {
  if (!markets.length) return;
  const home = summary.header?.competitions?.[0]?.competitors?.find(c => c.homeAway === "home");
  const away = summary.header?.competitions?.[0]?.competitors?.find(c => c.homeAway === "away");
  if (!home || !away) return;

  const homeScore = parseInt(home.score, 10) || 0;
  const awayScore = parseInt(away.score, 10) || 0;
  const period = summary.header?.competitions?.[0]?.status?.period || 1;
  const clock = summary.header?.competitions?.[0]?.status?.displayClock || "";

  // Build a rough state snapshot.
  const totalPts = homeScore + awayScore;
  const margin = homeScore - awayScore;
  const elapsed = (period - 1) + (1 - parseClock(clock) / 12);
  const remaining = Math.max(0, 4 - elapsed);

  for (const m of markets) {
    const newPrice = derivePrice(m, { margin, totalPts, remaining, period, clock });
    // tiny random jitter for realism
    const jittered = clamp(newPrice + (Math.random() - 0.5) * 0.01, 0.02, 0.98);
    m.history.push(jittered);
    if (m.history.length > HISTORY_LEN) m.history.shift();
    m.price = jittered;
    m.delta24 = jittered - m.history[0];

    // Swing detection from anchor.
    const anchor = snapshots[m.id];
    if (Math.abs(jittered - anchor) >= SWING_THRESHOLD) {
      injectMarketMove({
        id: `mm:${m.id}:${play.id}`,
        marketId: m.id,
        label: m.label,
        from: anchor,
        to: jittered,
        delta: jittered - anchor,
        trigger: shorten(play.text || "(play)"),
        afterPlayId: play.id,
        periodLabel: `Q${period}`,
        clock,
        url: m.url,
      });
      snapshots[m.id] = jittered;
    }
  }

  renderMarkets();
}

function derivePrice(m, st) {
  // Toy "model": move price toward an implied outcome based on game state.
  // Good enough for demo, not for trading.
  const remainingPenalty = clamp(1 - st.remaining / 4, 0, 1); // closer to end = less uncertainty
  const sideIsHome = m.side === homeAbbr || m.side?.startsWith(homeAbbr || "__");
  if (m.type === "Moneyline") {
    const lead = sideIsHome ? st.margin : -st.margin;
    const x = (lead / 6) * (1 + remainingPenalty * 1.5);
    return clamp(sigmoid(x), 0.05, 0.95);
  }
  if (m.type === "Spread") {
    return clamp(0.5 + (st.margin / 14) * (1 + remainingPenalty), 0.1, 0.9);
  }
  if (m.type === "Total") {
    // Need enough elapsed time to project a total. Early-game projection is
    // noisy; smooth toward the seeded price proportional to elapsed fraction.
    const elapsedFrac = clamp((st.period - 1 + (1 - parseClock(st.clock || "12") / 12)) / 4, 0, 1);
    if (elapsedFrac < 0.1) return m.price; // first ~5 minutes — keep seeded price
    const projected = st.totalPts / elapsedFrac;
    const line = parseLine(m.label, 210);
    const x = (projected - line) / 12;
    const target = sigmoid(x);
    // Blend toward target proportional to elapsed time — late-game lines move more.
    return clamp(m.price * (1 - elapsedFrac) + target * elapsedFrac, 0.1, 0.9);
  }
  if (m.type === "1H Moneyline") {
    if (st.period >= 3) return m.price; // settled at half
    const lead = sideIsHome ? st.margin : -st.margin;
    return clamp(0.5 + (lead / 12), 0.05, 0.95);
  }
  if (m.type === "Series") {
    // Series price moves slowly with game outcome influence — hard to model
    // tonight without knowing prior series state, so just drift.
    return clamp(m.price + (Math.random() - 0.5) * 0.005, 0.1, 0.95);
  }
  // Player props: slow drift
  return clamp(m.price + (Math.random() - 0.5) * 0.02, 0.1, 0.9);
}

function renderMarkets() {
  if (!rootEl) return;
  rootEl.innerHTML = `
    <p class="muted" style="margin-bottom:12px;">Real Polymarket markets for tonight, seeded from <a href="${escape(eventUrl || "https://polymarket.com")}" target="_blank" rel="noopener" style="color:var(--teal-deep);font-weight:600;">polymarket.com</a> and evolving against live ESPN plays. Click any card to open the market.</p>
    <div class="markets-grid">
      ${markets.map(marketCardHtml).join("")}
    </div>
  `;
  // Render sparklines after layout. If panel is hidden (display:none), skip.
  requestAnimationFrame(() => markets.forEach(m => drawSparkline(m)));
}

export function refreshSparklines() {
  // Called when the Markets tab becomes visible to redraw with valid layout.
  requestAnimationFrame(() => markets.forEach(m => drawSparkline(m)));
}

function marketCardHtml(m) {
  const delta = m.delta24;
  const deltaCls = Math.abs(delta) < 0.005 ? "is-flat" : (delta > 0 ? "" : "is-down");
  return `
    <div class="market-card" data-market-id="${escape(m.id)}">
      <div class="market-card__type">${escape(m.type)}</div>
      <div class="market-card__label">${escape(m.label)}</div>
      <div class="market-card__row">
        <div class="market-card__price">${(m.price * 100).toFixed(0)}%</div>
        <div class="market-card__delta ${deltaCls}">${delta > 0 ? "+" : ""}${(delta * 100).toFixed(1)}%</div>
      </div>
      <canvas class="market-card__spark" id="spark-${escape(m.id)}"></canvas>
      <a class="market-card__cta" href="${escape(m.url)}" target="_blank" rel="noopener">Open on Polymarket ↗</a>
    </div>
  `;
}

function drawSparkline(m) {
  const canvas = document.getElementById(`spark-${m.id}`);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * devicePixelRatio;
  canvas.height = h * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.clearRect(0, 0, w, h);
  const pts = m.history;
  if (!pts.length) return;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = Math.max(0.02, max - min);
  ctx.strokeStyle = pts[pts.length - 1] >= pts[0] ? "#22c55e" : "#ef4444";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  pts.forEach((v, i) => {
    const x = (i / (pts.length - 1 || 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ---- Helpers ----

function seedHistory(price) {
  // Build a believable last-hour history ending at `price`.
  const out = [];
  let v = price - (Math.random() - 0.5) * 0.06;
  for (let i = 0; i < HISTORY_LEN; i++) {
    v += (Math.random() - 0.5) * 0.01;
    v = Math.max(0.05, Math.min(0.95, v));
    out.push(v);
  }
  out[out.length - 1] = price;
  return out;
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

function parseClock(c) {
  if (!c || typeof c !== "string") return 12;
  const [m, s] = c.split(":").map(Number);
  return (m || 0) + (s || 0) / 60;
}

function parseLine(label, fallback) {
  const m = label.match(/(\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : fallback;
}

function homeFromLabel(label) {
  // Approximate: first letter of the label is the team if possible.
  return label.split(" ")[0];
}

function shorten(s) {
  return s.length > 60 ? s.slice(0, 60) + "…" : s;
}
