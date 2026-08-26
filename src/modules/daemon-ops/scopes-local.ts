/**
 * Local-side `scopes` namespace handler.
 *
 * The daemon owns the project registry plus the operator-selected active
 * project; both are runtime state held by a live daemon. With no daemon
 * reachable (the selector chose `LocalKotaClient`), there is no registry
 * to read and no selection to mutate, so both methods surface
 * `daemon_required`.
 */
import type { ScopesClient } from "./client.js";

export function scopesLocalClient(): ScopesClient {
  return {
    async list() {
      return { ok: false, reason: "daemon_required" };
    },
    async use() {
      return { ok: false, reason: "daemon_required" };
    },
    async inspectAuthority() {
      return { ok: false, reason: "daemon_required" };
    },
    async validateAuthority() {
      return { ok: false, reason: "daemon_required" };
    },
    async applyAuthority() {
      return { ok: false, reason: "daemon_required" };
    },
  };
}
