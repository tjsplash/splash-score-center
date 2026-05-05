// Markets module: Polymarket-style two-sided markets, rendered in Splash
// styling. Each raw "side" entry from data/markets.json is paired with its
// opposite (synthesized when only one side exists in the seed data) so every
// card shows yes/no percentages plus a dual-line history chart.

import { escape, teamHex } from "./script.js?v2026050214";
import { injectMarketMove } from "./pbp.js?v2026050214";
import {
  matchEspnToSplash, groupPropsByPlayer, playerInitials,
} from "./quickpicks.js?v2026050214";
import {
  findMarketsForMatchup, fetchPricesHistory, buildCandles, teamNameFor,
} from "./polymarket.js?v2026050214";

const SWING_THRESHOLD = 0.05;
const HISTORY_LEN = 60;

// Generic palette for non-team markets.
const COLOR = {
  over: "#22c55e",
  under: "#ef4444",
  yesNeutral: "#1BC4CF",  // teal
  noNeutral: "#9aa1ab",
};

let gameId = null;
let league = "nba";
let rootEl = null;
let pairs = [];          // [{ id, type, title, yes:{}, no:{}, urlEvent }]
let homeAbbr = null;
let awayAbbr = null;
let eventUrl = null;
let splashPropsHtml = "";

export async function mountMarkets(el, opts) {
  rootEl = el;
  gameId = opts.gameId;
  league = opts.league || "nba";
  homeAbbr = opts.homeAbbr || null;
  awayAbbr = opts.awayAbbr || null;

  // 1) Try the static seed file first (curated tonight-event markets with
  //    full type coverage: ML, spread, total, 1H, player props, series).
  let cfg = null;
  try {
    const all = await (await fetch("data/markets.json", { cache: "no-cache" })).json();
    cfg = all[gameId] || null;
  } catch {}
  if (cfg) {
    homeAbbr = cfg.homeTeam || homeAbbr;
    awayAbbr = cfg.awayTeam || awayAbbr;
    eventUrl = cfg.eventUrl;
    pairs = buildPairs(cfg.markets, homeAbbr, awayAbbr, eventUrl);
  } else {
    pairs = [];
  }
  renderMarkets();

  // 2) Always try Polymarket live discovery — even when a seed exists we
  //    fold any additional Polymarket-listed markets into the grid so users
  //    see every available market for the game.
  hydratePolymarketLive();

  // 3) Splash Quick Picks (props from the public splashsports API).
  hydrateSplashPicks(cfg, opts.homeAbbr, opts.awayAbbr);
}

async function hydratePolymarketLive() {
  if (!homeAbbr || !awayAbbr) return;
  let live;
  try { live = await findMarketsForMatchup(league, homeAbbr, awayAbbr); }
  catch { return; }
  if (!live || !live.length) return;

  const existingIds = new Set(pairs.map(p => p.id));
  const livePairs = live
    .filter(m => !existingIds.has(m.id))
    .map(m => livePairFromPolymarket(m, homeAbbr, awayAbbr));

  if (!livePairs.length && pairs.length) return; // seed already covers it
  pairs = pairs.concat(livePairs);
  if (!eventUrl && live[0]?.eventUrl) eventUrl = live[0].eventUrl;
  renderMarkets();
  // Hydrate prices-history → candle charts asynchronously.
  livePairs.forEach(p => hydrateCandlesticks(p));
}

function livePairFromPolymarket(m, homeT, awayT) {
  const [yesColor, noColor] = pairColorsFor(m, homeT, awayT);
  const yesHistory = seedHistory(m.yes.price);
  const noHistory = seedHistory(m.no.price);
  return {
    id: m.id,
    type: m.type,
    title: m.title || m.type,
    urlEvent: m.eventUrl,
    isLive: true,
    yes: {
      id: m.id + ":yes",
      label: m.yes.label,
      longLabel: m.yes.label,
      side: m.yes.label,
      price: m.yes.price,
      delta24: 0,
      history: yesHistory,
      candles: [],
      tokenId: m.yes.tokenId,
      color: yesColor,
      url: m.eventUrl,
    },
    no: {
      id: m.id + ":no",
      label: m.no.label,
      longLabel: m.no.label,
      side: m.no.label,
      price: m.no.price,
      delta24: 0,
      history: noHistory,
      candles: [],
      tokenId: m.no.tokenId,
      color: noColor,
      url: m.eventUrl,
    },
    snapshot: { yes: m.yes.price, no: m.no.price },
  };
}

function pairColorsFor(m, homeT, awayT) {
  const yes = (m.yes.label || "").toLowerCase();
  const no = (m.no.label || "").toLowerCase();
  const homeName = teamNameFor(homeT, league)?.toLowerCase();
  const awayName = teamNameFor(awayT, league)?.toLowerCase();
  if (yes === "yes" && no === "no") return [COLOR.yesNeutral, COLOR.noNeutral];
  if (yes.includes("over")) return [COLOR.over, COLOR.under];
  if (yes.includes("under")) return [COLOR.under, COLOR.over];
  if (homeName && yes.includes(homeName)) return ["#" + teamHex(homeT), "#" + teamHex(awayT)];
  if (homeName && no.includes(homeName)) return ["#" + teamHex(awayT), "#" + teamHex(homeT)];
  if (awayName && yes.includes(awayName)) return ["#" + teamHex(awayT), "#" + teamHex(homeT)];
  return [COLOR.yesNeutral, COLOR.noNeutral];
}

async function hydrateCandlesticks(pair) {
  const [yesPts, noPts] = await Promise.all([
    fetchPricesHistory(pair.yes.tokenId),
    fetchPricesHistory(pair.no.tokenId),
  ]);
  pair.yes.candles = buildCandles(yesPts, 28);
  pair.no.candles = buildCandles(noPts, 28);
  // Replace synthetic history with real prices for the dual-line variant too.
  if (yesPts.length) pair.yes.history = yesPts.map(p => p.p);
  if (noPts.length) pair.no.history = noPts.map(p => p.p);
  // Re-render just this card's chart.
  drawDualSparkline(pair);
}

// ---- Pairing ----

function buildPairs(rawMarkets, homeAbbrIn, awayAbbrIn, eventUrlIn) {
  const used = new Set();
  const out = [];

  for (const m of rawMarkets) {
    if (used.has(m.id)) continue;

    // Find a counterpart already in the seed data with the same type but a
    // different side (e.g., the two sides of a Moneyline market).
    const counterpart = rawMarkets.find(x =>
      !used.has(x.id) && x.id !== m.id &&
      x.type === m.type && playerKeyOf(x) === playerKeyOf(m) &&
      x.side !== m.side
    );

    used.add(m.id);
    if (counterpart) used.add(counterpart.id);

    out.push(buildPair(m, counterpart, homeAbbrIn, awayAbbrIn, eventUrlIn));
  }
  return out;
}

// A "player key" so player props pair only against the same player.
function playerKeyOf(m) {
  if (m.type !== "Player Points") return "_";
  // Side examples: "Cunningham o28.5", "Cunningham u28.5"
  return (m.side || "").split(" ")[0];
}

function buildPair(yesRaw, counterpartRaw, homeT, awayT, eventUrlIn) {
  const yes = sideFromRaw(yesRaw, homeT, awayT, /* isYes */ true);
  let no;
  if (counterpartRaw) {
    no = sideFromRaw(counterpartRaw, homeT, awayT, /* isYes */ false);
  } else {
    no = synthesizeOppositeSide(yesRaw, homeT, awayT);
  }

  const title = displayTitle(yesRaw, no, homeT, awayT);

  return {
    id: yesRaw.id + (counterpartRaw ? `+${counterpartRaw.id}` : "+syn"),
    type: yesRaw.type,
    title,
    urlEvent: eventUrlIn,
    yes,
    no,
    snapshot: { yes: yes.price, no: no.price },
  };
}

function sideFromRaw(raw, homeT, awayT, isYes) {
  const { shortLabel, color } = sideAppearance(raw, homeT, awayT, isYes);
  const history = seedHistory(raw.price);
  return {
    id: raw.id,
    raw,
    label: shortLabel,
    longLabel: raw.label,
    side: raw.side,
    price: raw.price,
    delta24: 0,
    history,
    color,
    url: raw.url,
  };
}

function synthesizeOppositeSide(yesRaw, homeT, awayT) {
  // Build an opposite side at price 1 - yes, with mirrored history.
  const oppPrice = clamp(1 - yesRaw.price, 0.05, 0.95);
  const fakeRaw = synthesizeOppositeRaw(yesRaw, homeT, awayT, oppPrice);
  const { shortLabel, color } = sideAppearance(fakeRaw, homeT, awayT, /* isYes */ false);
  const history = seedHistory(oppPrice);
  return {
    id: yesRaw.id + ":no",
    raw: fakeRaw,
    label: shortLabel,
    longLabel: fakeRaw.label,
    side: fakeRaw.side,
    price: oppPrice,
    delta24: 0,
    history,
    color,
    url: yesRaw.url,
  };
}

function synthesizeOppositeRaw(yesRaw, homeT, awayT, oppPrice) {
  const t = yesRaw.type;
  if (t === "Total") {
    const line = parseLine(yesRaw.side || yesRaw.label, 210);
    return { id: yesRaw.id + ":no", type: t, side: `Under ${line}`, label: `Under ${line}`, price: oppPrice };
  }
  if (t === "Player Points") {
    const player = (yesRaw.side || "").split(" ")[0];
    const line = parseLine(yesRaw.side || yesRaw.label, 0);
    return { id: yesRaw.id + ":no", type: t, side: `${player} u${line}`, label: `${player} under ${line} pts`, price: oppPrice };
  }
  if (t === "Spread") {
    // "DET -3.5" → "ORL +3.5"
    const m = (yesRaw.side || "").match(/(\w+)\s+([+-])(\d+\.?\d*)/);
    if (m) {
      const team = m[1];
      const sign = m[2];
      const line = m[3];
      const otherTeam = team === homeT ? awayT : homeT;
      const otherSign = sign === "-" ? "+" : "-";
      return { id: yesRaw.id + ":no", type: t, side: `${otherTeam} ${otherSign}${line}`, label: `${otherTeam} cover ${otherSign}${line}`, price: oppPrice };
    }
  }
  if (t === "1H Moneyline") {
    const team = (yesRaw.side || "").split(" ")[0];
    const otherTeam = team === homeT ? awayT : homeT;
    return { id: yesRaw.id + ":no", type: t, side: `${otherTeam} 1H`, label: `${otherTeam} to lead at halftime`, price: oppPrice };
  }
  if (t === "Series") {
    const team = (yesRaw.side || "").split(" ")[0];
    const otherTeam = team === homeT ? awayT : homeT;
    return { id: yesRaw.id + ":no", type: t, side: `${otherTeam} series`, label: `${otherTeam} to win series`, price: oppPrice };
  }
  // Moneyline default
  const team = (yesRaw.side || "").split(" ")[0];
  const otherTeam = team === homeT ? awayT : homeT;
  return { id: yesRaw.id + ":no", type: t, side: otherTeam, label: `${otherTeam} to win`, price: oppPrice };
}

function sideAppearance(raw, homeT, awayT, isYes) {
  const t = raw.type;
  if (t === "Total") {
    const isOver = (raw.side || "").toLowerCase().startsWith("over");
    const isUnder = (raw.side || "").toLowerCase().startsWith("under");
    const line = parseLine(raw.side || raw.label, 210);
    return {
      shortLabel: isUnder ? `Under ${line}` : `Over ${line}`,
      color: isUnder ? COLOR.under : COLOR.over,
    };
  }
  if (t === "Player Points") {
    const isUnder = /\bu(nder)?\b|\bu\d/.test(raw.side || "");
    const line = parseLine(raw.side || raw.label, 0);
    return {
      shortLabel: isUnder ? `Under ${line}` : `Over ${line}`,
      color: isUnder ? COLOR.noNeutral : COLOR.yesNeutral,
    };
  }
  if (t === "Spread") {
    // Use the side as-is for label — already terse like "DET -3.5".
    const team = (raw.side || "").split(" ")[0];
    return { shortLabel: raw.side, color: "#" + teamHex(team) };
  }
  if (t === "1H Moneyline" || t === "Series") {
    const team = (raw.side || "").split(" ")[0];
    return { shortLabel: team, color: "#" + teamHex(team) };
  }
  // Moneyline
  const team = (raw.side || "").split(" ")[0];
  return { shortLabel: team, color: "#" + teamHex(team) };
}

function displayTitle(yesRaw, noSide, homeT, awayT) {
  const t = yesRaw.type;
  if (t === "Player Points") {
    const player = ((yesRaw.side || "").split(" ")[0]) || "Player";
    return `${player} — points`;
  }
  if (t === "Series") return `Series winner`;
  if (t === "1H Moneyline") return `1st-half moneyline`;
  return t;
}

// ---- Splash picks (unchanged from prior pass) ----

async function hydrateSplashPicks(cfg, homeAbbrIn, awayAbbrIn) {
  const home = cfg?.homeTeam || homeAbbrIn;
  const away = cfg?.awayTeam || awayAbbrIn;
  if (!home || !away) return;
  const ev = { league, home: { abbr: home }, away: { abbr: away } };
  const match = await matchEspnToSplash(ev);
  if (!match || !match.props?.length) return;

  const groups = groupPropsByPlayer(match.props);
  const propTypes = uniqueOrdered(match.props.map(p => p.type_display));

  splashPropsHtml = `
    <section class="splash-picks">
      <header class="splash-picks__header">
        <div>
          <div class="splash-picks__eyebrow">Splash Quick Picks</div>
          <h3 class="splash-picks__title">Players and Teams <span class="splash-picks__count">${groups.length} players · ${match.props.length} props</span></h3>
        </div>
        <a class="splash-picks__cta" href="https://app.splashsports.com/quick-picks/board" target="_blank" rel="noopener">Play on Splash ↗</a>
      </header>
      <div class="splash-picks__type-row">
        ${propTypes.map(t => `<span class="splash-picks__type-chip">${escape(t)}</span>`).join("")}
      </div>
      <div class="splash-picks__players">
        ${groups.map(playerCardHtml).join("")}
      </div>
    </section>
  `;
  renderMarkets();
}

function uniqueOrdered(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) { if (!seen.has(x)) { seen.add(x); out.push(x); } }
  return out;
}

function playerCardHtml(g) {
  const teamLogo = g.team_alias
    ? `<img class="qp-player__team-logo" src="https://a.espncdn.com/i/teamlogos/nba/500/${g.team_alias.toLowerCase()}.png" alt="${escape(g.team_alias)}" />`
    : "";
  const teamColor = g.team_color || "#6b7280";
  const playLink = "https://app.splashsports.com/quick-picks/board";
  return `
    <div class="qp-player" style="--team-color:${escape(teamColor)}">
      <div class="qp-player__head">
        <div class="qp-player__avatar" aria-hidden="true">${escape(playerInitials(g.entity_name))}</div>
        ${teamLogo}
        <div class="qp-player__name-wrap">
          <div class="qp-player__name">${escape(g.entity_name)}</div>
          <div class="qp-player__team">${escape(g.team_alias || "")}${g.position ? ` · ${escape(g.position)}` : ""}</div>
        </div>
      </div>
      <div class="qp-player__props">
        ${g.props.map(p => `
          <div class="qp-prop">
            <span class="qp-prop__type">${escape(p.type_display)}</span>
            <a class="qp-pill qp-pill--more" href="${escape(playLink)}" target="_blank" rel="noopener">
              <span class="qp-pill__verb">More</span>
              <span class="qp-pill__line">${formatLine(p.line)}</span>
            </a>
            <a class="qp-pill qp-pill--less" href="${escape(playLink)}" target="_blank" rel="noopener">
              <span class="qp-pill__verb">Less</span>
              <span class="qp-pill__line">${formatLine(p.line)}</span>
            </a>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function formatLine(line) {
  if (line == null) return "";
  return Number.isInteger(line) ? `${line}.5` : String(line);
}

// ---- Live updates ----

export function updateMarketsFromPlay(play, summary) {
  if (!pairs.length) return;
  const home = summary.header?.competitions?.[0]?.competitors?.find(c => c.homeAway === "home");
  const away = summary.header?.competitions?.[0]?.competitors?.find(c => c.homeAway === "away");
  if (!home || !away) return;

  const homeScore = parseInt(home.score, 10) || 0;
  const awayScore = parseInt(away.score, 10) || 0;
  const period = summary.header?.competitions?.[0]?.status?.period || 1;
  const clock = summary.header?.competitions?.[0]?.status?.displayClock || "";

  const totalPts = homeScore + awayScore;
  const margin = homeScore - awayScore;
  const elapsed = (period - 1) + (1 - parseClock(clock) / 12);
  const remaining = Math.max(0, 4 - elapsed);
  const ctx = { margin, totalPts, remaining, period, clock };

  for (const pair of pairs) {
    const yesNew = clamp(derivePrice(pair.yes, pair, ctx) + (Math.random() - 0.5) * 0.01, 0.02, 0.98);
    const noNew = clamp(1 - yesNew, 0.02, 0.98);

    advanceSide(pair.yes, yesNew);
    advanceSide(pair.no, noNew);

    // Swing detection on yes side anchor.
    const anchor = pair.snapshot.yes;
    if (Math.abs(yesNew - anchor) >= SWING_THRESHOLD) {
      injectMarketMove({
        id: `mm:${pair.yes.id}:${play.id}`,
        marketId: pair.yes.id,
        label: pair.yes.longLabel || pair.title,
        from: anchor,
        to: yesNew,
        delta: yesNew - anchor,
        trigger: shorten(play.text || "(play)"),
        afterPlayId: play.id,
        periodLabel: `Q${period}`,
        clock,
        url: pair.yes.url,
      });
      pair.snapshot.yes = yesNew;
      pair.snapshot.no = noNew;
    }
  }

  renderMarkets();
}

function advanceSide(side, newPrice) {
  side.history.push(newPrice);
  if (side.history.length > HISTORY_LEN) side.history.shift();
  side.price = newPrice;
  side.delta24 = newPrice - side.history[0];
}

function derivePrice(side, pair, st) {
  // Returns the "yes-side" probability (the winning probability for `side`).
  const t = pair.type;
  const sideIsHome = side.side === homeAbbr || side.side?.startsWith(homeAbbr || "__");
  const remainingPenalty = clamp(1 - st.remaining / 4, 0, 1);

  if (t === "Moneyline") {
    const lead = sideIsHome ? st.margin : -st.margin;
    const x = (lead / 6) * (1 + remainingPenalty * 1.5);
    return clamp(sigmoid(x), 0.05, 0.95);
  }
  if (t === "Spread") {
    const sideIsHomeSpread = side.side?.startsWith(homeAbbr || "__");
    const lead = sideIsHomeSpread ? st.margin : -st.margin;
    return clamp(0.5 + (lead / 14) * (1 + remainingPenalty), 0.1, 0.9);
  }
  if (t === "Total") {
    const isUnder = (side.side || "").toLowerCase().startsWith("under");
    const elapsedFrac = clamp((st.period - 1 + (1 - parseClock(st.clock || "12") / 12)) / 4, 0, 1);
    if (elapsedFrac < 0.1) return side.price;
    const projected = st.totalPts / elapsedFrac;
    const line = parseLine(side.label, 210);
    const x = (projected - line) / 12;
    const target = sigmoid(x);
    const overProb = clamp(side.price * (1 - elapsedFrac) + target * elapsedFrac, 0.1, 0.9);
    return isUnder ? clamp(1 - overProb, 0.1, 0.9) : overProb;
  }
  if (t === "1H Moneyline") {
    if (st.period >= 3) return side.price;
    const lead = sideIsHome ? st.margin : -st.margin;
    return clamp(0.5 + (lead / 12), 0.05, 0.95);
  }
  if (t === "Series") {
    return clamp(side.price + (Math.random() - 0.5) * 0.005, 0.1, 0.95);
  }
  // Player props: slow drift
  return clamp(side.price + (Math.random() - 0.5) * 0.02, 0.1, 0.9);
}

// ---- Render ----

function renderMarkets() {
  if (!rootEl) return;

  const marketsHtml = pairs.length ? `
    <section class="poly-section">
      <header class="splash-picks__header">
        <div>
          <div class="splash-picks__eyebrow">Polymarket</div>
          <h3 class="splash-picks__title">Game Markets <span class="splash-picks__count">${pairs.length} markets</span></h3>
        </div>
        ${eventUrl ? `<a class="splash-picks__cta splash-picks__cta--ghost" href="${escape(eventUrl)}" target="_blank" rel="noopener">Open event on Polymarket ↗</a>` : ""}
      </header>
      <div class="poly-grid">
        ${pairs.map(pairCardHtml).join("")}
      </div>
    </section>
  ` : "";

  rootEl.innerHTML = `${splashPropsHtml}${marketsHtml || (splashPropsHtml ? "" : `<p class="muted">No markets configured for this game.</p>`)}`;

  requestAnimationFrame(() => pairs.forEach(p => drawDualSparkline(p)));
}

// Called by game.js once the ESPN summary has populated the team
// abbreviations. We re-trigger the Polymarket discovery so the markets tab
// fills in even when the static seed has no entry for this game id.
export function setMatchupContext(opts) {
  if (opts.homeAbbr && !homeAbbr) homeAbbr = opts.homeAbbr;
  if (opts.awayAbbr && !awayAbbr) awayAbbr = opts.awayAbbr;
  if (homeAbbr && awayAbbr) hydratePolymarketLive();
}

export function refreshSparklines() {
  requestAnimationFrame(() => pairs.forEach(p => drawDualSparkline(p)));
}

function pairCardHtml(p) {
  return `
    <div class="poly-card" data-pair-id="${escape(p.id)}">
      <div class="poly-card__header">
        <div class="poly-card__type">${escape(p.title)}</div>
        <a class="poly-card__source" href="${escape(p.urlEvent || p.yes.url || "https://polymarket.com")}" target="_blank" rel="noopener" title="View on Polymarket">↗ Polymarket</a>
      </div>
      <canvas class="poly-card__chart" id="chart-${escape(p.id)}"></canvas>
      <div class="poly-card__sides">
        ${sidePillHtml(p.yes, "yes")}
        ${sidePillHtml(p.no, "no")}
      </div>
    </div>
  `;
}

function sidePillHtml(side, kind) {
  const pct = Math.round(side.price * 100);
  const delta = side.delta24;
  const deltaCls = Math.abs(delta) < 0.005 ? "is-flat" : (delta > 0 ? "is-up" : "is-down");
  const deltaStr = `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(1)}%`;
  return `
    <a class="poly-pill poly-pill--${kind}" href="${escape(side.url || "https://polymarket.com")}" target="_blank" rel="noopener" style="--pill-color:${side.color}">
      <span class="poly-pill__label">${escape(side.label)}</span>
      <span class="poly-pill__price">${pct}%</span>
      <span class="poly-pill__delta ${deltaCls}">${deltaStr}</span>
    </a>
  `;
}

function drawDualSparkline(p) {
  const canvas = document.getElementById(`chart-${p.id}`);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = w * devicePixelRatio;
  canvas.height = h * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.clearRect(0, 0, w, h);

  // 50% guideline.
  ctx.strokeStyle = "rgba(0,0,0,0.06)";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // If we have OHLC candles from the live Polymarket prices-history feed,
  // render the YES side as candlesticks (Polymarket-style — green up, red
  // down) and overlay the NO side as a dashed counter-line. Otherwise fall
  // back to the simple two-line sparkline used during seed data.
  const yesCandles = p.yes?.candles || [];
  if (yesCandles.length >= 2) {
    drawCandlesticks(ctx, yesCandles, w, h);
    drawSimpleLine(ctx, p.no.history, p.no.color, w, h, /* dashed */ true);
  } else {
    drawSimpleLine(ctx, p.yes.history, p.yes.color, w, h);
    drawSimpleLine(ctx, p.no.history, p.no.color, w, h);
  }
}

function drawSimpleLine(ctx, pts, color, w, h, dashed = false) {
  if (!pts || !pts.length) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  if (dashed) ctx.setLineDash([3, 3]);
  ctx.beginPath();
  pts.forEach((v, i) => {
    const x = (i / (pts.length - 1 || 1)) * w;
    const y = h - clamp(v, 0, 1) * (h - 6) - 3;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawCandlesticks(ctx, candles, w, h) {
  // Domain: percent (0..1) on Y; left to right by time index on X.
  const padX = 2;
  const innerW = Math.max(1, w - padX * 2);
  const colW = innerW / candles.length;
  const wickX = padX + colW / 2;
  const bodyW = Math.max(2, Math.min(8, colW * 0.65));

  const yFor = (v) => h - clamp(v, 0, 1) * (h - 6) - 3;

  candles.forEach((c, i) => {
    const cx = padX + i * colW + colW / 2;
    const high = yFor(c.h);
    const low = yFor(c.l);
    const open = yFor(c.o);
    const close = yFor(c.c);
    const up = c.c >= c.o;
    // Splash palette: teal-deep for bullish candles, muted Splash red for
    // bearish. Reads instantly like a chart but stays inside our brand.
    const color = up ? "#1BC4CF" : "#ef4444";

    // Wick
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, high);
    ctx.lineTo(cx, low);
    ctx.stroke();

    // Body
    const bodyTop = Math.min(open, close);
    const bodyBottom = Math.max(open, close);
    const bodyH = Math.max(1, bodyBottom - bodyTop);
    if (up) {
      ctx.fillStyle = color;
      ctx.fillRect(cx - bodyW / 2, bodyTop, bodyW, bodyH);
    } else {
      ctx.fillStyle = "#fff";
      ctx.fillRect(cx - bodyW / 2, bodyTop, bodyW, bodyH);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(cx - bodyW / 2 + 0.5, bodyTop + 0.5, bodyW - 1, bodyH - 1);
    }
  });
}

// ---- Helpers ----

function seedHistory(price) {
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
  const m = (label || "").match(/(\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : fallback;
}

function shorten(s) {
  return s.length > 60 ? s.slice(0, 60) + "…" : s;
}
