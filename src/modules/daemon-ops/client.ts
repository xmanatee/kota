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
 * is the sessions namespace contract. The local handler emits
 * `daemon_required` because no daemon is reachable. Once the selector chooses
 * a daemon client, transport, HTTP, and protocol failures remain visible
 * exceptions. A successful HTTP response with status 200/404 collapses into
 * the `{ ok: true }` / `{ ok: false, reason: "not_found" }` arms instead.
 */

import type {
  DaemonLiveStatus,
  DaemonSseStreamEvent,
  InteractiveSession,
} from "#core/daemon/daemon-control.js";
import type {
  ScopeAuthorityFailure,
  ScopeAuthorityMutation,
  ScopeAuthorityMutationResult,
  ScopeAuthorityOperatorActionValue,
  ScopeAuthorityValidationResult,
  ScopeAuthorityView,
} from "#core/daemon/scope-authority-types.js";
import type {
  DirectoryScope,
  ScopeId,
} from "#core/daemon/scope-registry.js";
import type { SessionGuardrailsReloadSummary } from "#core/events/event-bus-types.js";
import type { ScopeSelector } from "#core/server/scope-selector.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { UiActionExecutionResult } from "./operator-ui-actions.js";
import type { UiJsonValue, UiSurfaceBundle } from "./operator-ui-types.js";

export type UiActionExecuteInput = ScopeSelector & {
  surfaceId: string;
  actionId: string;
  parameters?: UiJsonValue;
};

export type UiEventWatchInput = {
  eventTypes?: readonly string[];
  signal?: AbortSignal;
};

/**
 * Shared operator UI surface operations.
 *
 * `listSurfaces` returns the daemon/client-neutral UI contribution graph.
 * `executeAction` resolves a stable action id from that graph and dispatches
 * the typed operation declared by the contributing surface.
 */
export interface UiClient {
  listSurfaces(selector?: ScopeSelector): Promise<UiSurfaceBundle>;
  executeAction(input: UiActionExecuteInput): Promise<UiActionExecutionResult>;
  watchEvents(input?: UiEventWatchInput): AsyncIterable<DaemonSseStreamEvent>;
}

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
 * existing exit-code path. `serviceInstalled` reflects whether an OS service
 * unit is installed on the operator host; it does not claim that the current
 * daemon process was launched by that unit.
 */
export type DaemonOpsStatusResult =
  | { state: "running"; serviceInstalled: boolean; status: DaemonLiveStatus }
  | { state: "not_running"; serviceInstalled: boolean }
  | { state: "stale"; serviceInstalled: boolean; pid: number }
  | { state: "unreachable"; serviceInstalled: boolean; pid: number };

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
  | { ok: false; reason: "unavailable"; pid: number }
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
  status(filter?: ScopeSelector): Promise<DaemonOpsStatusResult>;
  pid(): Promise<DaemonOpsPidResult>;
  stop(options?: { timeoutSec?: number }): Promise<DaemonOpsStopResult>;
  reload(): Promise<DaemonOpsReloadResult>;
}

/**
 * Result of `scopes.list()`.
 *
 * The daemon-up arm carries the full registry projection plus the
 * operator-selected `activeScopeId` (or `null` when no selection is in
 * force — routes fall back to `defaultScopeId` in that case). The
 * `daemon_required` arm signals the local handler reached this code with
 * no daemon to ask: there is no project registry to read offline.
 */
export type ScopesListResult =
  | {
      ok: true;
      scopes: DirectoryScope[];
      defaultScopeId: ScopeId;
      activeScopeId: ScopeId | null;
    }
  | { ok: false; reason: "daemon_required" };

/**
 * Result of `scopes.use(scopeId | null)`. The success arm echoes the
 * new active selection; `not_found` rejects unknown ids; `daemon_required`
 * surfaces when no daemon is reachable to mutate.
 */
export type ScopesUseResult =
  | { ok: true; activeScopeId: ScopeId | null }
  | { ok: false; reason: "not_found"; scopeId: string }
  | { ok: false; reason: "daemon_required" };

export type ScopeAuthorityInspectResult =
  | { ok: true; authority: ScopeAuthorityView }
  | ScopeAuthorityFailure
  | { ok: false; reason: "daemon_required" };

export type ScopeAuthorityClientValidationResult =
  | ScopeAuthorityValidationResult
  | { ok: false; reason: "daemon_required" };

export type ScopeAuthorityClientMutationResult =
  | ScopeAuthorityMutationResult
  | { ok: false; reason: "daemon_required" };

/**
 * Scope-selection operations exposed to operator CLIs and clients.
 *
 * The daemon owns the configured scope registry plus the
 * operator-selected active scope; this namespace is the typed contract
 * every client (CLI, native app, web dashboard) reaches for both reads
 * and the typed switch call. Routes that take optional `?scopeId=` fall
 * back to the active selection when the parameter is absent, so a
 * `kota scopes use <id>` selection scopes subsequent inspection commands
 * without each one re-passing `--scope`.
 */
export interface ScopesClient {
  list(): Promise<ScopesListResult>;
  use(scopeId: string | null): Promise<ScopesUseResult>;
  inspectAuthority?(scopeId: string): Promise<ScopeAuthorityInspectResult>;
  validateAuthority?(
    scopeId: string,
    mutation: ScopeAuthorityMutation,
  ): Promise<ScopeAuthorityClientValidationResult>;
  applyAuthority?(
    scopeId: string,
    mutation: ScopeAuthorityMutation,
    operatorAction: ScopeAuthorityOperatorActionValue,
  ): Promise<ScopeAuthorityClientMutationResult>;
}
