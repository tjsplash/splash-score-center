// PGA Tour AppSync GraphQL client.
//
// Reverse-engineered from www.pgatour.com — public AppSync endpoint with a
// long-lived public API key embedded in their Next.js bundle.
//
// Key queries we use:
//   LeaderboardCompressedV3(id: tournamentId)
//     → rich per-player data: position, total, today, thru, currentRound,
//       currentHole, teeTime, totalStrokes, etc.
//   LeaderboardStrokesCompressed(id: tournamentId)
//     → one entry per player with their CURRENT live stroke:
//       { playerId, currentHole, currentShot, par, yardage, playByPlay,
//         scoreStatus, finalStroke }. playByPlay is the human-readable
//       text we'd otherwise have to scrape.
//   shotDetailsV4Compressed(tournamentId, playerId, round)
//     → per-hole structured data; full stroke array is only populated
//       during a live round.
//   Tournaments(ids: [...])
//     → tournament metadata so we can map an ESPN event by name.
//
// All "Compressed" payloads are base64 + gzip JSON. We decompress with the
// browser's native DecompressionStream.

const ENDPOINT = "https://2e65od6spzbsjcc34gyycxz2ry.appsync-api.us-east-2.amazonaws.com/graphql";
const API_KEY = "da2-coitqxzlkrdknf6y6laddb3w4e";

async function gql(query, variables) {
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error(`pgatour ${r.status}`);
  const d = await r.json();
  if (d.errors?.length) throw new Error(d.errors.map(e => e.message).join("; "));
  return d.data;
}

async function decompressBase64Gzip(b64) {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  return JSON.parse(text);
}

// --- Tournament discovery + ESPN ↔ PGA Tour mapping ----

const tournamentMetaCache = new Map(); // id → { id, name, status, currentRound, ... }

export async function fetchTournamentsByIds(ids) {
  const fresh = ids.filter(id => !tournamentMetaCache.has(id));
  if (fresh.length) {
    const data = await gql(
      `query Tournaments($ids: [ID!]) {
        tournaments(ids: $ids) {
          id tournamentName tournamentStatus currentRound roundDisplay
          roundStatusDisplay roundStatusColor timezone
        }
      }`,
      { ids: fresh },
    );
    for (const t of data.tournaments || []) {
      tournamentMetaCache.set(t.id, {
        id: t.id,
        name: t.tournamentName,
        status: t.tournamentStatus,
        currentRound: t.currentRound,
        roundDisplay: t.roundDisplay,
        roundStatusDisplay: t.roundStatusDisplay,
        timezone: t.timezone,
      });
    }
  }
  return ids.map(id => tournamentMetaCache.get(id)).filter(Boolean);
}

// PGA Tour tournament IDs follow a stable R{YEAR}{TOURNAMENT_CODE} pattern.
// Brute-force probing a wide range of IDs each session was too slow for an
// interactive page, so we keep a small curated list of recent / upcoming
// PGA TOUR codes — broad enough to catch any active week, narrow enough to
// answer in <2 s.
const PGA_TOURNAMENT_CODES = [
  "004","005","006","007","008","010","011","012","013","014","015",
  "016","018","020","021","022","023","024","026","027","028","029",
  "030","032","033","034","088","457","460","464","465","467","470",
  "471","472","480","489","493","496","498","523","556",
];

let activeTournamentPromise = null;

export async function findActiveTournament(espnEventName, currentYear) {
  if (activeTournamentPromise) return activeTournamentPromise;
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  activeTournamentPromise = (async () => {
    const year = currentYear || new Date().getFullYear() + 1; // PGA "season"
    const years = [year, year - 1];
    const ids = years.flatMap(y => PGA_TOURNAMENT_CODES.map(c => `R${y}${c}`));
    let found = [];
    try { found = await fetchTournamentsByIds(ids); } catch {}
    if (espnEventName) {
      const target = norm(espnEventName);
      const byName = found.find(t => norm(t.name) && (norm(t.name).includes(target) || target.includes(norm(t.name))));
      if (byName) return byName;
    }
    return (
      found.find(t => t.status === "IN_PROGRESS") ||
      found.find(t => t.status === "OFFICIAL") ||
      null
    );
  })().catch(() => null);
  return activeTournamentPromise;
}

// --- Leaderboard (rich) ----

const leaderboardCache = new Map(); // id → { ts, data }
const LEADERBOARD_TTL_MS = 30000;

export async function fetchLeaderboard(tournamentId) {
  const cached = leaderboardCache.get(tournamentId);
  if (cached && Date.now() - cached.ts < LEADERBOARD_TTL_MS) return cached.data;
  const data = await gql(
    `query LeaderboardCompressedV3($id: ID!) {
      leaderboardCompressedV3(id: $id) { id payload }
    }`,
    { id: tournamentId },
  );
  const payload = data.leaderboardCompressedV3?.payload;
  if (!payload) return null;
  const decoded = await decompressBase64Gzip(payload);
  leaderboardCache.set(tournamentId, { ts: Date.now(), data: decoded });
  return decoded;
}

// --- Live stroke-by-stroke ----

const strokesCache = new Map(); // id → { ts, data }
const STROKES_TTL_MS = 10000;

export async function fetchLiveStrokes(tournamentId) {
  const cached = strokesCache.get(tournamentId);
  if (cached && Date.now() - cached.ts < STROKES_TTL_MS) return cached.data;
  const data = await gql(
    `query LeaderboardStrokesCompressed($id: ID!) {
      leaderboardStrokesCompressed(id: $id) { id payload }
    }`,
    { id: tournamentId },
  );
  const payload = data.leaderboardStrokesCompressed?.payload;
  if (!payload) return null;
  const decoded = await decompressBase64Gzip(payload);
  strokesCache.set(tournamentId, { ts: Date.now(), data: decoded });
  return decoded;
}

// --- Per-player shot detail (per round) ----

const shotDetailCache = new Map(); // `${id}:${player}:${round}` → data

export async function fetchShotDetails(tournamentId, playerId, round) {
  const key = `${tournamentId}:${playerId}:${round}`;
  if (shotDetailCache.has(key)) return shotDetailCache.get(key);
  const data = await gql(
    `query shotDetailsV4Compressed($tournamentId: ID!, $playerId: ID!, $round: Int!) {
      shotDetailsV4Compressed(tournamentId: $tournamentId, playerId: $playerId, round: $round) {
        id payload
      }
    }`,
    { tournamentId, playerId, round },
  );
  const payload = data.shotDetailsV4Compressed?.payload;
  if (!payload) return null;
  const decoded = await decompressBase64Gzip(payload);
  shotDetailCache.set(key, decoded);
  return decoded;
}
