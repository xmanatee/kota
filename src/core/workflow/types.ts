import type { ScopePolicySnapshot } from "#core/daemon/scope-policy-authority.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { RunEvidenceReader, TransactionalRunState } from "./run-context.js";
import type { RepositoryAccess } from "./run-sandbox.js";
import type { WorkflowStepContext } from "./run-types.js";
import type { WorkflowNotifyConfig } from "./step-input-base.js";
import type { WorkflowStepInput } from "./step-input-types.js";
import type { WorkflowStep } from "./step-types.js";
import type {
  WorkflowRunTrigger,
  WorkflowTrigger,
  WorkflowTriggerInput,
} from "./trigger-types.js";

export type WorkflowDefinitionInput = {
  name: string;
  description?: string;
  enabled?: boolean;
  runTimeoutMs?: number;
  /**
   * Absolute path to the root of the module that ships this workflow. Relative
   * paths inside the definition (notably `promptPath`) are resolved against
   * this root so a workflow can be contributed by a module whose source lives
   * outside the daemon's current `workspaceRoot` (e.g. KOTA's own autonomy
   * workflows while the daemon is pointed at an external scope).
   * When omitted, the loader falls back to the daemon's scope directory.
   */
  moduleRoot?: string;
  /**
   * Workflow-level default for every agent step's `autonomyMode`. When set, any
   * agent step in this workflow (including steps nested inside parallel, branch,
   * or foreach) that omits its own `autonomyMode` inherits this value. When
   * omitted, every agent step in the workflow must declare its own mode; the
   * validator rejects any step that leaves the mode undefined. Individual
   * steps may still override this default with a stricter mode.
   */
  defaultAutonomyMode?: AutonomyMode;
  /** Repository access granted through the run-owned sandbox. */
  repository: RepositoryAccess;
  /** Required for writers; runtime reruns it after rebases and repairs. */
  integration?: WorkflowIntegrationPolicy;
  /** Logical resources claimed atomically before the run consumes capacity. */
  resources?: WorkflowResourceResolver;
  /**
   * Synchronous owner completion after lifecycle success and cleanup, inside the
   * success/state/outbox transaction. Local effects MUST be idempotent: a crash
   * or rollback replays this hook on the same run. External non-idempotent
   * actions belong in separate workflows. Promise-returning hooks are rejected.
   */
  finalize?: WorkflowFinalizer;
  /**
   * Optional definition-owned admission check that runs after trigger payload
   * validation but before any pending-queue or dispatch-idempotency mutation.
   * Use this for canonical, scope-local replay watermarks that cannot be
   * expressed by an event filter alone.
   */
  triggerAdmission?: WorkflowTriggerAdmissionResolver;
  /** Pure domain assessment used only by the retained run's recovery owner. */
  recovery?: WorkflowRecoveryResolver;
  /** Resolve fresh domain supply for resources requested by a deliberate yield. */
  availableWork?: WorkflowAvailableWorkResolver;
  /**
   * Optional JSON Schema object describing the expected shape of trigger payloads.
   * When present, the runtime validates each trigger payload against this schema
   * before queuing the run. Invalid payloads are rejected with a descriptive error.
   * Workflows without this field accept any payload (existing behavior).
   */
  inputSchema?: Record<string, unknown>;
  /**
   * Optional JSON Schema object describing the expected shape of the workflow's
   * last step output. When present and the run completes successfully, the runtime
   * validates the last step output against this schema. A mismatch marks the run
   * `completed-with-warnings` and appends a structured warning — the output is
   * still recorded. Workflows without this field behave exactly as before.
   */
  outputSchema?: Record<string, unknown>;
  /**
   * Rate limit configuration for inbound webhook triggers. When set, the daemon
   * rejects requests that exceed the cap with 429 Too Many Requests. The counter
   * uses a sliding 60-second window and resets in daemon memory (lost on restart).
   * Default: no cap applied.
   */
  webhookRateLimit?: { maxPerMinute: number };
  /**
   * Per-event notification suppression for this workflow. Omit to use defaults
   * (onFailure: true, onSuccess: false).
   */
  notify?: WorkflowNotifyConfig;
  tags?: readonly string[];
  triggers: WorkflowTriggerInput[];
  steps: WorkflowStepInput[];
};

export type WorkflowIntegrationPolicy = Readonly<{
  validationCommand: readonly [string, ...string[]];
  /** Additional module-owned checks; all must pass. */
  additionalValidationCommands?: readonly (readonly [string, ...string[]])[];
  /** Require the selected scope's configured project check in the shared sandbox. */
  projectValidation?: boolean;
  /**
   * Pure semantic guard evaluated against the exact canonical snapshot a
   * writer was reconciled onto. The runtime executes it while publication is
   * serialized, immediately before moving the canonical ref.
   */
  postReconcile?: WorkflowPostReconcileInvariant;
}>;

export type WorkflowPostReconcileInvariantInput = Readonly<{
  /** Reconciled writer workspace at `head`. */
  workspaceRoot: string;
  /** Clean canonical repository at `canonicalHead`. */
  repoRoot: string;
  /** Canonical scope artifact directory. */
  stateDir: string;
  /** Durable identity of the writer whose publication is being guarded. */
  runId: string;
  /** Fresh scope-filtered ownership observations from the runtime. */
  runEvidence?: RunEvidenceReader;
  /** Read the latest canonical scope state without using the run's snapshot. */
  readState: <T = unknown>(key: string) => Readonly<{
    revision: number;
    value: T | null;
  }>;
  workflowName: string;
  trigger: WorkflowRunTrigger;
  baseHead: string;
  head: string;
  canonicalHead: string;
  signal: AbortSignal;
}>;

export type WorkflowPostReconcileInvariantResult =
  | Readonly<{ satisfied: true }>
  | Readonly<{ satisfied: false; reason: string }>;

export type WorkflowPostReconcileInvariant = (
  input: WorkflowPostReconcileInvariantInput,
) => WorkflowPostReconcileInvariantResult;

export type WorkflowResourceInput = {
  scopeRoot: string;
  /** Canonical scope artifact directory. */
  stateDir: string;
  workflowName: string;
  trigger: WorkflowRunTrigger;
  /** Present during restoration, including publication recovery. Discovery-based
   * resolvers retain this admission snapshot instead of selecting new work. */
  admittedResources?: readonly string[];
};

export type WorkflowRecoveryDecision =
  | { resume: false; reason: string }
  | { resume: true; trigger: WorkflowRunTrigger; revision: string };

export type WorkflowRecoveryResolver = (
  input: WorkflowTriggerAdmissionInput & { runId: string; signal: AbortSignal },
) => WorkflowRecoveryDecision | Promise<WorkflowRecoveryDecision>;

export type WorkflowResourceResolver = (
  input: WorkflowResourceInput,
) => readonly string[];

export type WorkflowFinalizationContext = Readonly<{
  runId: string;
  scopeId: string;
  scopeRoot: string;
  stateDir: string;
  trigger: WorkflowRunTrigger;
  stepOutputs: WorkflowStepContext["stepOutputs"];
  /** Reads latest canonical values; writes use the run's existing staged CAS. */
  state: TransactionalRunState;
  /** Stable step ids share the run's existing emit-intent namespace. */
  emit(event: string, payload: Readonly<Record<string, unknown>>, stepId: string): void;
}>;

export type WorkflowFinalizer = (context: WorkflowFinalizationContext) => void;

export type WorkflowTriggerAdmissionInput = {
  scopeRoot: string;
  stateDir: string;
  runtimeStateDir: string;
  /** Canonical scope identity resolved by the queue before repository isolation. */
  scopeId: string;
  workflowName: string;
  trigger: WorkflowRunTrigger;
  state: Pick<TransactionalRunState, "read">;
};

export type WorkflowTriggerAdmissionDecision =
  | { admitted: true }
  | { admitted: false; reason: string };

export type WorkflowTriggerAdmissionResolver = (
  input: WorkflowTriggerAdmissionInput,
) => WorkflowTriggerAdmissionDecision;

export type WorkflowContributionSource = "bundled" | "installed" | "foreign";

export type RegisteredWorkflowDefinitionInput = WorkflowDefinitionInput & {
  definitionPath: string;
  /**
   * Name of the module that contributed this workflow. Populated by the module
   * loader when iterating contributions; absent for workflows registered
   * directly (e.g. by tests or by the daemon config's `workflows` array).
   */
  contributingModule?: string;
  /**
   * Where the contributing module was discovered. Populated by the module
   * loader in lockstep with `contributingModule`. Used by the validator to
   * produce actionable error messages on name collisions.
   *
   * - `"bundled"` — KOTA's own `src/modules/*` tree.
   * - `"installed"` — the target scope's `<workspaceRoot>/.kota/modules/*`.
   * - `"foreign"` — a module registered via `foreignModules` in config.
   */
  moduleSource?: WorkflowContributionSource;
};

export type WorkflowDefinition = {
  name: string;
  description?: string;
  enabled: boolean;
  runTimeoutMs?: number;
  /**
   * Absolute filesystem root of the module that ships this workflow. Populated
   * by the loader (or the module itself) and used at runtime to resolve
   * `promptPath` values against KOTA's own install tree even when the daemon
   * is pointed at an external scope directory.
   */
  moduleRoot: string;
  /**
   * Workflow-level default for agent-step autonomy mode. Populated by the
   * loader when the workflow definition sets `defaultAutonomyMode`; used only
   * by the validator when normalizing agent steps and not re-read at runtime.
   */
  defaultAutonomyMode?: AutonomyMode;
  repository: RepositoryAccess;
  integration?: WorkflowIntegrationPolicy;
  resources?: WorkflowResourceResolver;
  finalize?: WorkflowFinalizer;
  /** Definition-owned pre-queue semantic replay admission. */
  triggerAdmission?: WorkflowTriggerAdmissionResolver;
  recovery?: WorkflowRecoveryResolver;
  /** Resolve fresh domain supply for resources requested by a deliberate yield. */
  availableWork?: WorkflowAvailableWorkResolver;
  /** Optional JSON Schema for validating trigger payloads at enqueue time. */
  inputSchema?: Record<string, unknown>;
  /** Optional JSON Schema for validating the last step output on successful completion. */
  outputSchema?: Record<string, unknown>;
  /**
   * Rate limit configuration for inbound webhook triggers. When set, the daemon
   * enforces a sliding 60-second window cap and returns 429 when exceeded.
   * Default: no cap applied.
   */
  webhookRateLimit?: { maxPerMinute: number };
  /**
   * Per-event notification suppression for this workflow.
   * Omit to use defaults (onFailure: true, onSuccess: false).
   */
  notify?: WorkflowNotifyConfig;
  tags: readonly string[];
  definitionPath: string;
  triggers: WorkflowTrigger[];
  steps: WorkflowStep[];
};

/** Domain supplies candidates; the ordinary trigger queue retains admission authority. */
export type WorkflowAvailableWorkResolver = (input: Readonly<{
  scopeRoot: string;
  stateDir: string;
  runtimeStateDir: string;
  scopeId: string;
  capacity: number;
  resources: readonly string[];
  scopePolicySnapshot: ScopePolicySnapshot | null;
}>) => readonly WorkflowRunTrigger[];
