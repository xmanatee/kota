import type { InteractiveSession } from "./daemon-control.js";

/**
 * Removes sessions whose lastActive timestamp is older than idleTtlMs from `now`.
 * Returns the removed session records so callers can emit scoped lifecycle
 * events after deletion.
 */
export function sweepExpiredSessions(
  sessions: Map<string, InteractiveSession>,
  now: number,
  idleTtlMs: number,
): InteractiveSession[] {
  const expired: InteractiveSession[] = [];
  for (const session of sessions.values()) {
    if (now - session.lastActive > idleTtlMs) {
      expired.push(session);
    }
  }
  for (const session of expired) {
    sessions.delete(session.id);
  }
  return expired;
}
