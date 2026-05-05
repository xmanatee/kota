/**
 * KotaClient — the typed contract every CLI subcommand consumes for
 * daemon-or-local access to KOTA capabilities.
 *
 * The contract is the single public surface CLI code imports. Two
 * implementors realize it:
 *
 * - `DaemonControlClient` (HTTP) — talks to a running daemon over
 *   `127.0.0.1` using the bearer token published in
 *   `.kota/daemon-control.json`.
 * - `LocalKotaClient` (in-process) — talks directly to the local stores
 *   and providers when no daemon is reachable.
 *
 * A single `resolveKotaClient` selector picks one implementor at CLI
 * startup. Subcommands consume `ctx.client.<namespace>.<method>` and
 * never re-decide that policy themselves.
 *
 * New capabilities are added as namespaces. Each namespace is a typed
 * sub-interface with the operations the CLI needs. Module-owned local
 * implementations are registered through ModuleContext and assembled
 * into the `LocalKotaClient` by the selector.
 */
import type {
  WorkflowDefinitionSummary,
  WorkflowLiveStatus,
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "#core/daemon/daemon-control.js";
// Per-namespace client interfaces are owned by their module. The aggregate
// imports them back to compose the contract — this is the only sanctioned
// `#modules/*` import direction in `src/core/server/`. The narrow exception
// is enforced in `src/core/agent-harness/no-module-imports-in-core.test.ts`.
import type { AgentsClient } from "#modules/agent-ops/client.js";
import type { AnswerClient } from "#modules/answer/client.js";
import type { ApprovalsClient } from "#modules/approval-queue/client.js";
import type { CaptureClient } from "#modules/capture/client.js";
import type { ConfigClient } from "#modules/config/client.js";
import type {
  DaemonOpsClient,
  SessionsClient,
} from "#modules/daemon-ops/client.js";
import type { DoctorClient } from "#modules/doctor/client.js";
import type { EvalHarnessClient } from "#modules/eval-harness/client.js";
import type { AuditClient } from "#modules/guardrails-audit/client.js";
import type { HarnessParityClient } from "#modules/harness-parity/client.js";
import type { HistoryClient } from "#modules/history/client.js";
import type { KnowledgeClient } from "#modules/knowledge/client.js";
import type { McpServerClient } from "#modules/mcp-server/client.js";
import type { MemoryClient } from "#modules/memory/client.js";
import type {
  ModulesAdminClient,
  ModulesClient,
} from "#modules/module-manager/client.js";
import type { OwnerQuestionsClient } from "#modules/owner-questions/client.js";
import type { RecallClient } from "#modules/recall/client.js";
import type { RepoTasksClient } from "#modules/repo-tasks/client.js";
import type { RetractClient } from "#modules/retract/client.js";
import type { SecretsClient } from "#modules/secrets/client.js";
import type { SkillsClient } from "#modules/skill-ops/client.js";
import type { VoiceClient } from "#modules/voice/client.js";
import type { WebClient } from "#modules/web/client.js";
import type { WebhookClient } from "#modules/webhook/client.js";

/** Filters accepted by `client.workflow.listRuns`. */
export type WorkflowRunsListFilter = {
  workflow?: string;
  limit?: number;
  tag?: string;
  causedByRunId?: string;
};

export type WorkflowRunsListResult = {
  runs: WorkflowRunSummary[];
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
 * local implementor sources from run artifacts and persisted state.
 * Dispatch-state mutations (`pause`, `resume`, `abort`, `reload`) work
 * daemon-down via signal files: the local implementor writes the signal
 * and the next daemon cycle picks it up. Definition mutations
 * (`enable`, `disable`) and per-run mutations (`cancelRun`, `abortRun`)
 * touch in-memory daemon state and surface `daemon_required` when no
 * daemon is reachable.
 */
export interface WorkflowClient {
  listRuns(filter?: WorkflowRunsListFilter): Promise<WorkflowRunsListResult>;
  status(): Promise<WorkflowStatusSnapshot>;
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
 * The single typed surface CLI code imports for daemon-or-local access.
 *
 * The contract grows by adding namespaces here, delegating in
 * `DaemonControlClient` to existing or new HTTP routes, and exposing
 * matching local handlers from the owning module's top-level
 * `localClient(ctx)` factory.
 */
export interface KotaClient {
  readonly workflow: WorkflowClient;
  readonly approvals: ApprovalsClient;
  readonly secrets: SecretsClient;
  readonly tasks: RepoTasksClient;
  readonly memory: MemoryClient;
  readonly ownerQuestions: OwnerQuestionsClient;
  readonly history: HistoryClient;
  readonly knowledge: KnowledgeClient;
  readonly sessions: SessionsClient;
  readonly modules: ModulesClient;
  readonly agents: AgentsClient;
  readonly skills: SkillsClient;
  readonly harnessParity: HarnessParityClient;
  readonly webhook: WebhookClient;
  readonly voice: VoiceClient;
  readonly web: WebClient;
  readonly mcpServer: McpServerClient;
  readonly audit: AuditClient;
  readonly config: ConfigClient;
  readonly modulesAdmin: ModulesAdminClient;
  readonly daemonOps: DaemonOpsClient;
  readonly doctor: DoctorClient;
  readonly evalHarness: EvalHarnessClient;
  readonly recall: RecallClient;
  readonly answer: AnswerClient;
  readonly capture: CaptureClient;
  readonly retract: RetractClient;
}

/**
 * Names of every namespace on `KotaClient`. Local handler registration
 * is keyed by these names; the selector validates that every namespace
 * is wired before constructing a `LocalKotaClient`.
 */
export const KOTA_CLIENT_NAMESPACES = [
  "workflow",
  "approvals",
  "secrets",
  "tasks",
  "memory",
  "ownerQuestions",
  "history",
  "knowledge",
  "sessions",
  "modules",
  "agents",
  "skills",
  "harnessParity",
  "webhook",
  "voice",
  "web",
  "mcpServer",
  "audit",
  "config",
  "modulesAdmin",
  "daemonOps",
  "doctor",
  "evalHarness",
  "recall",
  "answer",
  "capture",
  "retract",
] as const satisfies ReadonlyArray<keyof KotaClient>;

export type KotaClientNamespace = (typeof KOTA_CLIENT_NAMESPACES)[number];

/** Local-side handler bundle: one namespace impl per declared capability. */
export type LocalClientHandlers = {
  [K in KotaClientNamespace]: KotaClient[K];
};

/**
 * Daemon-side handler bundle: one namespace impl per declared capability.
 *
 * Symmetric to `LocalClientHandlers`. `DaemonControlClient` is built by
 * assembling a `DaemonClientHandlers` map from a core-side stub plus any
 * module that contributes a `daemonClient(link)` factory on its
 * `KotaModule`. The selector validates full coverage and rejects partially
 * wired clients.
 */
export type DaemonClientHandlers = {
  [K in KotaClientNamespace]: KotaClient[K];
};
