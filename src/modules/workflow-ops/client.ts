/**
 * Workflow namespace client contract.
 *
 * The workflow-ops module owns the `workflow` KotaClient namespace surface
 * end-to-end: this file declares the result/option types and the
 * `WorkflowClient` interface that the `KotaClient` aggregate composes. The
 * local-side handler (`localClient(ctx)` in `index.ts`) and the daemon-side
 * handler (`daemonClient(link)` factory in `index.ts` via
 * `buildWorkflowDaemonHandler`) realize this contract.
 */

import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import type {
  WorkflowDefinitionSummary,
  WorkflowLiveStatus,
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "#core/daemon/daemon-control.js";

/** Filters accepted by `client.workflow.listRuns`. */
export type WorkflowRunsListFilter = {
  workflow?: string;
  limit?: number;
  tag?: string;
  causedByRunId?: string;
  projectId?: string;
};

export type WorkflowRunsListResult = {
  runs: WorkflowRunSummary[];
};

/** Project scope accepted by workflow runtime reads. */
export type WorkflowStatusFilter = {
  projectId?: string;
};

/**
 * Workflow runtime snapshot returned by `client.workflow.status()`.
 *
 * Wraps the daemon's `WorkflowLiveStatus` with `pendingAbort`, which only the
 * daemon-down path can observe (a stale abort signal file lingering after a
 * crash). The daemon-up path always reports `pendingAbort: false` because the
 * daemon processes abort RPCs synchronously and never persists the file.
 */
export type WorkflowStatusSnapshot = WorkflowLiveStatus & {
  pendingAbort: boolean;
};

/** Result of `workflow.pause` / `workflow.resume`. `already` is true when the
 * call was a no-op (already paused / not paused). */
export type WorkflowPauseResult = { paused: boolean; already: boolean };

/**
 * Result of `workflow.abort` (active runs).
 *
 * `applied` means the daemon processed the abort synchronously and `count` is
 * how many active runs were told to abort. `signaled` means no daemon was
 * reachable and the local implementor wrote an abort signal file; the daemon
 * (or next process) will pick it up later. `runs` carries the per-run detail
 * the CLI surfaces in its "abort signal written for N runs:" path.
 */
export type WorkflowAbortResult =
  | { status: "applied"; count: number }
  | {
      status: "signaled";
      runs: { runId: string; workflow: string }[];
    };

/**
 * Result of `workflow.reload`.
 *
 * `applied` means the daemon synchronously reloaded its definitions and
 * `count` is the loaded definition count. `signaled` means no daemon was
 * reachable and a reload signal file was written; the next daemon cycle will
 * pick it up.
 */
export type WorkflowReloadResult =
  | { status: "applied"; count: number }
  | { status: "signaled" };

/** Result of `workflow.enable` / `workflow.disable`. */
export type WorkflowEnableResult =
  | { ok: true }
  | { ok: false; reason: "not_found" };

export type WorkflowDisableResult = WorkflowEnableResult;

/** Result of `workflow.cancelRun(id)` for a queued run. */
export type WorkflowCancelRunResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "active" };

/** Result of `workflow.abortRun(id)` for a single active run. */
export type WorkflowAbortRunResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "queued" };

/**
 * Capabilities that require a running daemon. The daemon-down path returns
 * `{ ok: false, reason: "daemon_required" }` so the CLI surfaces the same
 * structured error every time, no ad-hoc null sentinels.
 */
export type WorkflowDaemonRequiredResult = {
  ok: false;
  reason: "daemon_required";
};

/**
 * Result of `workflow.getRun(id)`.
 *
 * Daemon-up: full `WorkflowRunDetail` from in-memory tracker, including live
 * status for an active run. Daemon-down: same shape reconstructed from the run
 * artifact (`metadata.json`); some fields the daemon adds (e.g. `triggerPayload`
 * normalized through the runtime) round-trip through the artifact unchanged.
 */
export type WorkflowGetRunResult =
  | { found: true; run: WorkflowRunDetail }
  | { found: false };

/**
 * Options accepted by `workflow.triggerByName`.
 *
 * The CLI does its own pre-validation (definition exists, enabled, cooldown,
 * already-queued) using `getValidatedWorkflowDefinitions(ctx)` and
 * `workflow.status()`; the contract carries only the enqueue itself. `event`
 * and `runId` mirror the per-trigger fields the daemon already exposes — the
 * CLI's `replay`/`resume-run` paths use them to thread their own trigger label
 * and pinned run id through.
 */
export type WorkflowTriggerOptions = {
  tags?: string[];
  payload?: Record<string, unknown>;
  /** Override cooldown gating when computing notBeforeMs. */
  force?: boolean;
  /** Trigger event label written into the queued run's trigger record. */
  event?: string;
  /** Pinned run id (used by replay/resume to propagate a deterministic id). */
  runId?: string;
  /** Earliest dispatch time for the daemon-down enqueue path (ms epoch). */
  notBeforeMs?: number;
};

/**
 * Result of `workflow.triggerByName`. `path` distinguishes the daemon-applied
 * enqueue (the daemon accepted the trigger and may have started the run
 * immediately) from the daemon-down path (a pending run was appended to the
 * persisted queue and will start on the next daemon cycle). `runId` is the
 * pinned id when the caller supplied one; the daemon may also return its own
 * generated id which the CLI surfaces verbatim.
 */
export type WorkflowTriggerResult =
  | { ok: true; path: "daemon" | "queue"; queued: string; runId?: string }
  | { ok: false; reason: "already_queued" };

export type WorkflowTrialBlockedSideEffect = {
  stepId: string;
  tool: string;
  reason: string;
  effect: {
    kind: string;
    scope: string;
    openWorld: boolean;
  };
};

export type WorkflowTrialChangedFile = {
  path: string;
  change: "created" | "modified" | "deleted";
};

export type WorkflowTrialPayload = KotaJsonObject;

export type WorkflowTrialEvent = {
  type: string;
  payload: WorkflowTrialPayload;
};

export type WorkflowTrialAttemptReport = {
  id: string;
  workflow: string;
  payload: WorkflowTrialPayload;
  status: "passed" | "failed" | "blocked";
  trialProjectPath: string;
  workflowRunId?: string;
  stepStatuses: Array<{
    id: string;
    type: string;
    status: string;
    durationMs: number;
  }>;
  changedFiles: WorkflowTrialChangedFile[];
  taskMutations: WorkflowTrialChangedFile[];
  storeMutations: WorkflowTrialChangedFile[];
  busEvents: WorkflowTrialEvent[];
  queuedWorkflows: Array<{
    workflow: string;
    runId: string;
    waitFor: "queued" | "completed";
    payload: WorkflowTrialPayload;
    status: "queued" | "completed" | "failed";
  }>;
  blockedExternalSideEffects: WorkflowTrialBlockedSideEffect[];
  reportPath: string;
  error?: string;
};

export type WorkflowTrialSummary = {
  runId: string;
  workflow: string;
  projectId?: string;
  sourceProjectPath: string;
  reportDir: string;
  payload: WorkflowTrialPayload;
  repeat: number;
  attempts: WorkflowTrialAttemptReport[];
  comparison: {
    workflows: string[];
    payloadVariants: WorkflowTrialPayload[];
  };
  passed: number;
  failed: number;
  blocked: number;
  status: "passed" | "failed";
};

export type WorkflowTrialOptions = {
  payload?: WorkflowTrialPayload;
  repeat?: number;
  compareWorkflows?: string[];
  comparePayloads?: WorkflowTrialPayload[];
  projectId?: string;
};

export type WorkflowTrialResult =
  | {
      ok: true;
      summary: WorkflowTrialSummary;
    }
  | {
      ok: false;
      reason: "daemon_required" | "invalid_request" | "unknown_workflow" | "unknown_project";
      message: string;
      summary?: WorkflowTrialSummary;
    };

/**
 * Result of `workflow.listDefinitions`. `source` carries which side produced
 * the listing so callers can render attribution; the daemon listing includes
 * `runtimeEnabled` overrides while the static listing reflects the definition
 * file as-loaded.
 */
export type WorkflowDefinitionsResult = {
  source: "daemon" | "static";
  definitions: WorkflowDefinitionSummary[];
};

/**
 * Workflow runtime operations.
 *
 * Reads (`listRuns`, `status`) work both daemon-up and daemon-down — the
 * local implementor sources from run artifacts and persisted state. The
 * daemon-up `status` path accepts `projectId` so scoped clients can read the
 * selected project's workflow runtime.
 * Dispatch-state mutations (`pause`, `resume`, `abort`, `reload`) work
 * daemon-down via signal files: the local implementor writes the signal
 * and the next daemon cycle picks it up. Definition mutations
 * (`enable`, `disable`) and per-run mutations (`cancelRun`, `abortRun`)
 * touch in-memory daemon state and surface `daemon_required` when no
 * daemon is reachable.
 */
export interface WorkflowClient {
  listRuns(filter?: WorkflowRunsListFilter): Promise<WorkflowRunsListResult>;
  status(filter?: WorkflowStatusFilter): Promise<WorkflowStatusSnapshot>;
  /**
   * Look up a single run. Daemon-up consults the daemon's in-memory tracker;
   * daemon-down reads the run artifact under `.kota/runs/`.
   */
  getRun(id: string): Promise<WorkflowGetRunResult>;
  /**
   * Enumerate registered workflow definitions. Daemon-up returns the
   * daemon's runtime view (with `runtimeEnabled` overrides); daemon-down
   * reflects the static definition source as loaded from the workspace.
   */
  listDefinitions(): Promise<WorkflowDefinitionsResult>;
  pause(): Promise<WorkflowPauseResult>;
  resume(): Promise<WorkflowPauseResult>;
  abort(): Promise<WorkflowAbortResult>;
  reload(): Promise<WorkflowReloadResult>;
  /**
   * Enqueue a manual workflow run. Daemon-up posts to the daemon's
   * `/workflow/trigger`; daemon-down appends a pending run to the persisted
   * queue so the next daemon cycle picks it up.
   */
  triggerByName(
    name: string,
    options?: WorkflowTriggerOptions,
  ): Promise<WorkflowTriggerResult>;
  trial(
    name: string,
    options?: WorkflowTrialOptions,
  ): Promise<WorkflowTrialResult>;
  enable(
    name: string,
  ): Promise<WorkflowEnableResult | WorkflowDaemonRequiredResult>;
  disable(
    name: string,
  ): Promise<WorkflowDisableResult | WorkflowDaemonRequiredResult>;
  cancelRun(
    id: string,
  ): Promise<WorkflowCancelRunResult | WorkflowDaemonRequiredResult>;
  abortRun(
    id: string,
  ): Promise<WorkflowAbortRunResult | WorkflowDaemonRequiredResult>;
}

/**
 * Daemon `/workflow/trigger` only accepts a `payload` object that the
 * runtime spreads into the run's trigger payload. The daemon imposes its own
 * `event` ("manual") and `_runId` (generated server-side), so the CLI-side
 * `event`, `runId`, `force`, and `notBeforeMs` options on
 * `WorkflowTriggerOptions` are honored only on the daemon-down enqueue path.
 * The HTTP request carries the user-extension payload alone.
 */
export function buildTriggerHttpPayload(
  options: WorkflowTriggerOptions | undefined,
): Record<string, unknown> | undefined {
  if (!options?.payload) return undefined;
  return Object.keys(options.payload).length > 0 ? options.payload : undefined;
}
