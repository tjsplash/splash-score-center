// Tiny localStorage wrapper namespaced under "splash-sc:".
// Keeps comment / reaction state durable across refreshes.

const PREFIX = "splash-sc:";

export function get(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function set(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota or disabled — ignore */
  }
}

export function update(key, mutator, fallback = null) {
  const current = get(key, fallback);
  const next = mutator(current);
  set(key, next);
  return next;
}

export function commentsKey(gameId, playId) {
  return `comments:${gameId}:${playId}`;
}

export function reactionsKey(gameId, playId) {
  return `reactions:${gameId}:${playId}`;
}

export function chatKey(gameId) {
  return `chat:${gameId}`;
}
