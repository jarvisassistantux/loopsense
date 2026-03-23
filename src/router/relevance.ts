import type { LoopSenseEvent } from '../types.js';

const recentEventKeys = new Map<string, number>();
const DEDUPE_WINDOW_MS = 5_000;

setInterval(() => {
  const now = Date.now();
  for (const [k, ts] of recentEventKeys) {
    if (now - ts > DEDUPE_WINDOW_MS * 2) {
      recentEventKeys.delete(k);
    }
  }
}, DEDUPE_WINDOW_MS * 5).unref();

export function isDuplicate(event: LoopSenseEvent): boolean {
  const key = `${event.watch_id}:${event.event_type}:${event.summary}`;
  const lastSeen = recentEventKeys.get(key);
  const now = Date.now();

  if (lastSeen && now - lastSeen < DEDUPE_WINDOW_MS) {
    return true;
  }

  recentEventKeys.set(key, now);
  return false;
}
