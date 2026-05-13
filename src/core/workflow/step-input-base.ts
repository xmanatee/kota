import type { ModelTier } from "#core/model/model-router.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type {
  WorkflowPredicate,
  WorkflowRepairLoopConfig,
  WorkflowValueResolver,
} from "./run-types.js";
import type { WorkflowRetryConfig } from "./trigger-types.js";

export type WorkflowBaseStep = {
  id: string;
  when?: WorkflowPredicate;
  continueOnFailure?: boolean;
  /**
   * Maximum time in milliseconds this step is allowed to run. If the step does
   * not complete within this deadline the run fails with a timeout error and the
   * normal failure path executes (failed record, workflow.failure.alert emitted).
   * When omitted, the executor applies DEFAULT_STEP_TIMEOUT_MS as a hang rail.
   * Set this only when a step has a clearer operational deadline.
   */
  timeoutMs?: number;
  /**
   * When true, this step's output is injected into later agent-step prompts.
   * Keep this off by default and only expose runtime-only facts that the agent
   * cannot reasonably discover from the repository itself.
   */
  exposeOutputToAgent?: boolean;
};

export type WorkflowToolStepInput = WorkflowBaseStep & {
  type: "tool";
  tool: string;
  input?: WorkflowValueResolver<Record<string, unknown>>;
  retry?: WorkflowRetryConfig;
};

export type WorkflowAgentStepInput = WorkflowBaseStep & {
  type: "agent";
  /**
   * Optional logical agent label. Use this for model overrides and telemetry.
   * Execution does not resolve workflow steps through a global agent catalog.
   */
  agentName?: string;
  /** Path to the prompt markdown file, relative to the owning module's root. */
  promptPath?: string;
  /**
   * Name of the agent harness adapter this step should run on. Must match a
   * harness registered with the core `agent-harness` registry. When omitted,
   * the step inherits `KotaConfig.defaultAgentHarness` when pinned, otherwise
   * the active preset's harness. There is no hidden fallback to a literal
   * `claude-agent-sdk`.
   */
  harness?: string;
  /**
   * Concrete model id the harness should run. Mutually exclusive with `tier`
   * — the validator throws when both or neither is declared. Use this only
   * when the workflow genuinely needs a specific provider id; prefer `tier`
   * for harness-portable steps.
   */
  model?: string;
  /**
   * Neutral capability tier resolved through the active config's
   * `modelTiers` map at validation time. Mutually exclusive with `model`.
   * Survives a harness/preset swap without per-step edits — the resolved
   * model id depends on `KotaConfig.modelTiers` (or the shipped default
   * tier-to-model mapping for the configured preset).
   */
  tier?: ModelTier;
  /**
   * How hard the model should think on each step. Required — KOTA workflows
   * optimize for quality, so every agent step must declare its effort level
   * explicitly rather than relying on a hidden default.
   */
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxTurns?: number;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  /**
   * Harness-neutral passthrough for per-step options that only one registered
   * harness knows how to interpret. The block is a single-key object whose key
   * must match the step's resolved harness name; the value is opaque to core
   * and validated by that harness's `validateStepOptions` method. Leave unset
   * to inherit the harness defaults. The core validator rejects any key that
   * does not match the resolved harness, and any harness without a registered
   * `validateStepOptions`.
   */
  harnessOptions?: Record<string, unknown>;
  /**
   * Operator supervision mode for this step. Orthogonal to per-tool risk
   * classification. Required in effect: the validator rejects an agent step
   * that neither sets this nor inherits it from the enclosing workflow's
   * `defaultAutonomyMode`. Declaring the mode is how a workflow states its
   * supervision intent — there is no repo-wide default.
   */
  autonomyMode?: AutonomyMode;
  retry?: WorkflowRetryConfig;
  repairLoop?: WorkflowRepairLoopConfig;
  /**
   * When set to "json", a short instruction is appended to the agent prompt asking
   * it to end its response with a fenced JSON block. After the step completes, the
   * last fenced JSON block is extracted from the agent's final message and becomes
   * the step output (parsed). The step fails if no valid JSON block is found.
   */
  outputFormat?: "json";
  /**
   * Optional JSON Schema object (same subset as inputSchema/outputSchema at the
   * definition level) to validate the extracted JSON against. Requires
   * outputFormat: "json". A schema mismatch fails the step with a descriptive error.
   */
  outputSchema?: Record<string, unknown>;
};

export type WorkflowEmitStepInput = WorkflowBaseStep & {
  type: "emit";
  event: string;
  payload?: WorkflowValueResolver<Record<string, unknown>>;
};

export type WorkflowRestartStepInput = WorkflowBaseStep & {
  type: "restart";
  reason?: WorkflowValueResolver<string>;
  requires?: string[];
};

export type WorkflowNotifyConfig = {
  /**
   * When false, suppresses `workflow.failure.alert` for this workflow.
   * Default: true (emit on failure).
   */
  onFailure?: boolean;
  /**
   * When false, suppresses `workflow.build.committed` emit steps for this workflow.
   * Default: false (suppress by default — this event is opt-in at the channel level).
   */
  onSuccess?: boolean;
};
