import type { InteractiveSession } from "./daemon-control.js";

/**
 * Removes sessions whose lastActive timestamp is older than idleTtlMs from `now`.
 * Returns the IDs of removed sessions.
 */
export function sweepExpiredSessions(
  sessions: Map<string, InteractiveSession>,
  now: number,
  idleTtlMs: number,
): string[] {
  const expired: string[] = [];
  for (const [id, session] of sessions) {
    if (now - session.lastActive > idleTtlMs) {
      expired.push(id);
    }
  }
  for (const id of expired) {
    sessions.delete(id);
  }
  return expired;
}
