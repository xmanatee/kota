import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { WorkflowNotifyConfig } from "./step-input-base.js";
import type { WorkflowStepInput } from "./step-input-types.js";
import type { WorkflowStep } from "./step-types.js";
import type {
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
   * outside the daemon's current `projectDir` (e.g. KOTA's own autonomy
   * workflows while the daemon is pointed at an external project).
   * When omitted, the loader falls back to the daemon's project directory.
   */
  moduleRoot?: string;
  /**
   * When true, this workflow is eligible for dirty-worktree recovery dispatch.
   * Only workflows that can commit, stash, or reset should declare this.
   */
  recoveryCapable?: boolean;
  /**
   * Workflow-level default for every agent step's `autonomyMode`. When set, any
   * agent step in this workflow (including steps nested inside parallel, branch,
   * or foreach) that omits its own `autonomyMode` inherits this value. When
   * omitted, every agent step in the workflow must declare its own mode; the
   * validator rejects any step that leaves the mode undefined. Individual
   * steps may still override this default with a stricter mode.
   */
  defaultAutonomyMode?: AutonomyMode;
  /**
   * Named concurrency group for this workflow. Workflows in the same named group
   * run at most one at a time. Omit to use type-based defaults: agent-step
   * workflows use the default "agent" group (agentConcurrency cap), code-only
   * workflows use the "code" group (codeConcurrency cap).
   */
  concurrencyGroup?: string;
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

export type WorkflowContributionSource = "project" | "installed" | "foreign";

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
   * - `"project"` — KOTA's own `src/modules/*` tree.
   * - `"installed"` — the target project's `<projectDir>/.kota/modules/*`.
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
   * is pointed at an external project directory.
   */
  moduleRoot: string;
  recoveryCapable: boolean;
  /**
   * Workflow-level default for agent-step autonomy mode. Populated by the
   * loader when the workflow definition sets `defaultAutonomyMode`; used only
   * by the validator when normalizing agent steps and not re-read at runtime.
   */
  defaultAutonomyMode?: AutonomyMode;
  /**
   * Named concurrency group. Workflows in the same named group run at most one
   * at a time. Omit to use type-based defaults ("agent" or "code").
   */
  concurrencyGroup?: string;
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
