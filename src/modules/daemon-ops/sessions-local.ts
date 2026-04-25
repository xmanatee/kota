/**
 * Local-side `sessions` namespace handler.
 *
 * No daemon is reachable in this branch (the selector chose
 * `LocalKotaClient`), so there are no live interactive sessions to
 * enumerate. Mutations surface `daemon_required` to mirror other
 * contract namespaces that depend on the running daemon for
 * authoritative state.
 */
import type { SessionsClient } from "#core/server/kota-client.js";

export function sessionsLocalClient(): SessionsClient {
  return {
    async list() {
      return { sessions: [] };
    },
    async setAutonomyMode() {
      return { ok: false, reason: "daemon_required" };
    },
  };
}
