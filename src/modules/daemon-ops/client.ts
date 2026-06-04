/**
 * Sessions and daemonOps namespace client contracts.
 *
 * The daemon-ops module owns both the `sessions` and `daemonOps` KotaClient
 * namespace surfaces end-to-end: this file declares the result types and the
 * `SessionsClient` / `DaemonOpsClient` interfaces that the `KotaClient`
 * aggregate composes. The local-side handlers (`sessionsLocalClient` in
 * `sessions-local.ts` and the `daemonOps` closure in `index.ts` backed by
 * `daemon-ops-operations.ts`) and the daemon-side handlers
 * (`daemonClient(link)` factory in `index.ts`) realize these contracts.
 *
 * The three-arm `SessionsSetAutonomyModeResult` (`{ ok: true; ... } | { ok:
 * false; reason: "not_found" } | { ok: false; reason: "daemon_required" }`)
 * is the sessions namespace contract. Both handlers can emit
 * `daemon_required`: the local handler emits it unconditionally because no
 * daemon is reachable, and the daemon-side factory emits it on transient
 * transport failures (network error, JSON parse failure inside the `try`
 * block). A successful HTTP response with status 200/404 collapses into the
 * `{ ok: true }` / `{ ok: false, reason: "not_found" }` arms instead.
 */

import type {
  DaemonLiveStatus,
  InteractiveSession,
} from "#core/daemon/daemon-control.js";
import type {
  ConfiguredProject,
  ProjectId,
} from "#core/daemon/scope-registry.js";
import type { SessionGuardrailsReloadSummary } from "#core/events/event-bus-types.js";
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

/**
 * Result of `daemonOps.status()`.
 *
 * `running` carries the live daemon status payload (already shaped like
 * `DaemonLiveStatus`); `not_running` surfaces when no daemon is
 * reachable; `stale` surfaces when a control file points at a pid that
 * is no longer alive. The operator CLI maps each variant to its
 * existing exit-code path. `managed` reflects whether an OS service
 * unit is installed for the daemon.
 */
export type DaemonOpsStatusResult =
  | { state: "running"; managed: boolean; status: DaemonLiveStatus }
  | { state: "not_running"; managed: boolean }
  | { state: "stale"; managed: boolean; pid: number };

/** Result of `daemonOps.pid()`. */
export type DaemonOpsPidResult =
  | { state: "running"; pid: number }
  | { state: "not_running" }
  | { state: "stale"; pid: number };

/** Result of `daemonOps.stop(opts)`. */
export type DaemonOpsStopResult =
  | { ok: true }
  | { ok: false; reason: "not_running" }
  | { ok: false; reason: "stale"; pid: number }
  | { ok: false; reason: "timeout"; pid: number };

/** Result of `daemonOps.reload()`. */
export type DaemonOpsReloadResult =
  | {
      ok: true;
      workflows: number;
      changedModules: string[];
      sessionGuardrails: SessionGuardrailsReloadSummary;
    }
  | { ok: false; reason: "not_running" }
  | { ok: false; reason: "reload_failed" };

/**
 * Daemon-supervisor operations exposed to operator CLIs.
 *
 * Every method works daemon-up by definition (the supervisor is the
 * thing being inspected); the local handler reads `.kota/daemon-control.json`
 * to detect not-running and stale-control-file states without re-doing
 * that file logic in the CLI handler.
 */
export interface DaemonOpsClient {
  status(): Promise<DaemonOpsStatusResult>;
  pid(): Promise<DaemonOpsPidResult>;
  stop(options?: { timeoutSec?: number }): Promise<DaemonOpsStopResult>;
  reload(): Promise<DaemonOpsReloadResult>;
}

/**
 * Result of `projects.list()`.
 *
 * The daemon-up arm carries the full registry projection plus the
 * operator-selected `activeProjectId` (or `null` when no selection is in
 * force — routes fall back to `defaultProjectId` in that case). The
 * `daemon_required` arm signals the local handler reached this code with
 * no daemon to ask: there is no project registry to read offline.
 */
export type ProjectsListResult =
  | {
      ok: true;
      projects: ConfiguredProject[];
      defaultProjectId: ProjectId;
      activeProjectId: ProjectId | null;
    }
  | { ok: false; reason: "daemon_required" };

/**
 * Result of `projects.use(projectId | null)`. The success arm echoes the
 * new active selection; `not_found` rejects unknown ids; `daemon_required`
 * surfaces when no daemon is reachable to mutate.
 */
export type ProjectsUseResult =
  | { ok: true; activeProjectId: ProjectId | null }
  | { ok: false; reason: "not_found"; projectId: string }
  | { ok: false; reason: "daemon_required" };

/**
 * Project-selection operations exposed to operator CLIs and clients.
 *
 * The daemon owns the configured project registry plus the
 * operator-selected active project; this namespace is the typed contract
 * every client (CLI, native app, web dashboard) reaches for both reads
 * and the typed switch call. Routes that take optional `?projectId=` fall
 * back to the active selection when the parameter is absent, so a
 * `kota project use <id>` selection scopes subsequent inspection commands
 * without each one re-passing `--project`.
 */
export interface ProjectsClient {
  list(): Promise<ProjectsListResult>;
  use(projectId: string | null): Promise<ProjectsUseResult>;
}
