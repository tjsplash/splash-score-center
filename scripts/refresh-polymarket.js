#!/usr/bin/env node
//
// Refresh data/polymarket-events.json from Polymarket's gamma-api.
//
// gamma-api.polymarket.com only sends CORS for https://polymarket.com, so a
// static GitHub Pages site can't call it from the browser. We snapshot the
// per-league events on-demand and ship the JSON in the repo. The browser
// then reads the snapshot via fetch("data/polymarket-events.json") which is
// same-origin and CORS-trivial.
//
// Usage:
//   node scripts/refresh-polymarket.js
//
// Add a cron / GitHub Action to keep it fresh in production.

const https = require("https");
const fs = require("fs");
const path = require("path");

const TAGS = ["nba", "mlb", "nhl"];
const OUT = path.resolve(__dirname, "..", "data", "polymarket-events.json");

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0 SplashScoreCenter/1.0" } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`parse ${url}: ${e.message}`)); }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

(async () => {
  const out = {};
  for (const tag of TAGS) {
    process.stderr.write(`Fetching ${tag}… `);
    try {
      const events = await get(
        `https://gamma-api.polymarket.com/events?tag_slug=${tag}&active=true&closed=false&limit=80&order=volume24hr&ascending=false`,
      );
      out[tag] = (events || []).map((e) => ({
        id: e.id,
        title: e.title,
        slug: e.slug,
        startDate: e.startDate,
        endDate: e.endDate,
        markets: (e.markets || []).map((m) => ({
          id: m.id,
          conditionId: m.conditionId,
          question: m.question,
          slug: m.slug,
          outcomes: m.outcomes,
          outcomePrices: m.outcomePrices,
          clobTokenIds: m.clobTokenIds,
          volume: m.volume,
          startDate: m.startDate,
          endDate: m.endDate,
          groupItemTitle: m.groupItemTitle,
          active: m.active,
          closed: m.closed,
        })),
      }));
      process.stderr.write(`${out[tag].length} events\n`);
    } catch (e) {
      process.stderr.write(`failed (${e.message})\n`);
      out[tag] = [];
    }
  }
  out._snapshot = { timestamp: new Date().toISOString() };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  process.stderr.write(`Wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(1)} kB)\n`);
})();
