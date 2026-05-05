/**
 * Sessions namespace client contract.
 *
 * The daemon-ops module owns the `sessions` KotaClient namespace surface
 * end-to-end: this file declares the result types and the `SessionsClient`
 * interface that the `KotaClient` aggregate composes. Both the local-side
 * handler (`sessionsLocalClient` in `sessions-local.ts`) and the daemon-side
 * handler (`daemonClient(link)` in `index.ts`) realize this contract.
 *
 * The three-arm `SessionsSetAutonomyModeResult` (`{ ok: true; ... } | { ok:
 * false; reason: "not_found" } | { ok: false; reason: "daemon_required" }`)
 * is the namespace contract. Both handlers can emit `daemon_required`: the
 * local handler emits it unconditionally because no daemon is reachable, and
 * the daemon-side factory emits it on transient transport failures (network
 * error, JSON parse failure inside the `try` block). A successful HTTP
 * response with status 200/404 collapses into the `{ ok: true }` /
 * `{ ok: false, reason: "not_found" }` arms instead.
 */

import type { InteractiveSession } from "#core/daemon/daemon-control.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";

export type SessionsListResult = {
  sessions: InteractiveSession[];
};

/**
 * Result of `sessions.setAutonomyMode`. `serveOwned` indicates the session is
 * registered through `kota serve` rather than owned by the daemon directly;
 * the daemon updates its advisory metadata and returns success, but the
 * authoritative change must reach the owning serve process.
 */
export type SessionsSetAutonomyModeResult =
  | { ok: true; autonomyMode: AutonomyMode; source: "daemon" | "serve"; serveOwned: boolean }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "daemon_required" };

/**
 * Interactive-session operations.
 *
 * `list` enumerates sessions registered with the daemon — both `kota serve`
 * registrations and daemon-owned chat sessions. `setAutonomyMode` mutates a
 * session's supervision posture; daemon-owned sessions update in-place and
 * serve-registered sessions get advisory metadata updated with `serveOwned:
 * true` so the caller knows the authoritative change must reach the owning
 * serve process.
 *
 * Local mode (no daemon reachable) returns an empty session list and
 * surfaces `daemon_required` from `setAutonomyMode` — interactive sessions
 * only exist while a runtime host is alive.
 */
export interface SessionsClient {
  list(): Promise<SessionsListResult>;
  setAutonomyMode(id: string, mode: AutonomyMode): Promise<SessionsSetAutonomyModeResult>;
}
