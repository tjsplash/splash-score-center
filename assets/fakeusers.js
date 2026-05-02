// Ambient activity simulator — fake users dropping chat messages and
// reacting to recent plays so the demo feels alive even when only one
// real person is watching. Disabled automatically if the user has set
// "splash-sc:no-fakes" in localStorage.

import { get, set, chatKey, reactionsKey } from "./storage.js?v2026050207";
import { teamHex } from "./script.js?v2026050207";

const PERSONAS = [
  { name: "AnimalAndDan", team: null },
  { name: "BostonRob", team: "BOS" },
  { name: "ColeFromKC", team: null },
  { name: "VinnyDFS", team: "NYK" },
  { name: "Marisa_in_Cle", team: "CLE" },
  { name: "DubsForever", team: "GSW" },
  { name: "PaoloHive", team: "ORL" },
  { name: "ATLscreamer", team: "ATL" },
  { name: "CavsFanCorey", team: "CLE" },
  { name: "LakeShowJ", team: "LAL" },
  { name: "DetroitMike", team: "DET" },
  { name: "RaptorAnnie", team: "TOR" },
  { name: "HoustonHeat", team: "HOU" },
  { name: "QuickPicksQ", team: null },
  { name: "WhaleWatchPete", team: null },
  { name: "ProfessorParley", team: null },
];

const GENERIC_LINES = [
  "this is going to be a wire-act game",
  "tell me why my survivor entry is sweating",
  "elimination games hit different",
  "who's got the over riding tonight?",
  "bench is going to decide this one",
  "free Polymarket plug — I'm hammering the live ML",
  "anybody else doing a quickpicks parlay rn",
  "the energy in this arena is unreal on the broadcast",
  "if my guy doesn't get a bucket soon I'm going to lose it",
  "good thing splash actually pays out same day",
  "I forgot how good NBA playoff basketball is",
  "broadcast crew nailing it tonight",
  "this is a referee decides the game type of vibe",
  "betting the under is a public service",
  "let's gooo",
];

const TEAM_LINES = {
  BOS: ["Tatum better lock in", "Defense wins championships", "Celtics in 5 was the lock"],
  CLE: ["Mitchell carrying us tonight", "Allen needs more touches", "Mobley getting cooked early"],
  TOR: ["Scottie needs to take this over", "RJ big game vibes", "We are NOT done yet"],
  DET: ["Cade is HIM", "Pistons fans you ok?", "Just give Cade the ball"],
  ORL: ["Paolo for MVP", "Magic defense looks elite", "Suggs locking up"],
  LAL: ["LeBron in elimination mode is unmatched", "AD has to be the rim protector tonight", "Lakers in 6 incoming"],
  HOU: ["Sengün cooking down low", "Rockets young legs", "Houston we have liftoff"],
  NYK: ["Brunson ball", "Hart is everywhere"],
  GSW: ["Chef Curry never folds", "Splash brothers vibes"],
  ATL: ["Trae cooking", "Hawks fans we are HERE"],
};

const REACTION_EMOJIS = ["🔥", "😱", "🤯", "💀", "🏀", "🤡", "🚨"];

let intervalIds = [];

export function startFakeActivity({ gameId, getPlays }) {
  if (get("no-fakes", false)) return () => {};
  if (intervalIds.length) return stopFakeActivity;

  // Drop a chat message every 22-55s.
  intervalIds.push(setInterval(() => maybePostChat(gameId, getPlays), randomBetween(22000, 55000)));
  // React to a random recent play every 14-32s.
  intervalIds.push(setInterval(() => maybeReactToPlay(gameId, getPlays), randomBetween(14000, 32000)));

  // Also do an immediate first message so it feels alive on load.
  setTimeout(() => maybePostChat(gameId, getPlays), 6000);
  setTimeout(() => maybeReactToPlay(gameId, getPlays), 9000);

  return stopFakeActivity;
}

export function stopFakeActivity() {
  intervalIds.forEach(clearInterval);
  intervalIds = [];
}

function maybePostChat(gameId, getPlays) {
  const persona = pick(PERSONAS);
  let body;
  // 35% chance to comment on the most recent scoring play, otherwise a generic line.
  const plays = getPlays();
  const lastScore = plays.find(p => p.scoreValue && p.scoreValue > 0);
  if (lastScore && Math.random() < 0.35) {
    body = pickReactionLineFor(lastScore);
  } else if (persona.team && TEAM_LINES[persona.team] && Math.random() < 0.4) {
    body = pick(TEAM_LINES[persona.team]);
  } else {
    body = pick(GENERIC_LINES);
  }
  const list = get(chatKey(gameId), []);
  list.push({ name: persona.name, team: persona.team, body, ts: Date.now(), fake: true });
  set(chatKey(gameId), list);
  window.dispatchEvent(new CustomEvent("fake:chat", { detail: { gameId } }));
}

function maybeReactToPlay(gameId, getPlays) {
  const plays = getPlays() || [];
  if (!plays.length) return;
  // Bias toward newer + higher-scoring plays.
  const recent = plays.slice(0, 8);
  const target = recent[Math.floor(Math.random() * Math.min(4, recent.length))];
  if (!target) return;
  const persona = pick(PERSONAS);
  const emoji = pickEmojiFor(target);
  const key = reactionsKey(gameId, target.id);
  const counts = get(key, {});
  const arr = counts[emoji] || [];
  if (!arr.includes(persona.name)) {
    arr.push(persona.name);
    counts[emoji] = arr;
    set(key, counts);
    window.dispatchEvent(new CustomEvent("fake:reaction", { detail: { gameId, playId: target.id, emoji } }));
  }
}

function pickReactionLineFor(play) {
  const t = (play.text || "").toLowerCase();
  if (t.includes("dunk")) return pick(["MAMMOTH dunk", "posterized 💀", "send the replay"]);
  if (t.includes("three") || t.includes("3-pt")) return pick(["BANGGGG 🎯", "wet 🌧️", "ice in his veins"]);
  if (t.includes("turnover")) return pick(["yikes 💀", "give it back", "fundamentals please"]);
  if (t.includes("block")) return pick(["GET THAT OUT 🛡️", "rejected", "send it home"]);
  if (t.includes("steal")) return pick(["pickpocket 🥷", "free points incoming", "elite hands"]);
  if (t.includes("foul")) return pick(["call was sus", "phantom whistle", "refs cooking again"]);
  return pick(["bucket", "what a play", "huge swing", "this is must-watch"]);
}

function pickEmojiFor(play) {
  const t = (play.text || "").toLowerCase();
  if (t.includes("dunk")) return "💀";
  if (t.includes("three") || t.includes("3-pt")) return "🎯";
  if (t.includes("turnover")) return "🤡";
  if (t.includes("block")) return "🛡️";
  if (t.includes("steal")) return "🥷";
  if (t.includes("foul")) return "⚖️";
  if (play.scoreValue && play.scoreValue >= 2) return "🔥";
  return pick(REACTION_EMOJIS);
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomBetween(min, max) { return Math.floor(min + Math.random() * (max - min)); }
