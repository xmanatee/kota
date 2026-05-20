import type { AgentHarnessStepOverrides } from "#core/agent-harness/types.js";
import type { ModelTier } from "#core/model/model-router.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type {
  WorkflowPredicate,
  WorkflowRepairLoopConfig,
  WorkflowStepContext,
  WorkflowValueResolver,
} from "./run-types.js";
import type { WorkflowAgentStepOutputValidator, WorkflowBaseStep } from "./step-input-base.js";
import type { CodeStepOutputValidator } from "./step-input-code.js";
import type { WorkflowRetryConfig } from "./trigger-types.js";

export type WorkflowToolStep = WorkflowBaseStep & {
  type: "tool";
  tool: string;
  input?: WorkflowValueResolver<Record<string, unknown>>;
  retry?: WorkflowRetryConfig;
};

export type WorkflowAgentStep = WorkflowBaseStep & {
  type: "agent";
  /** Name of the agent definition used, if the step was configured via agentName. */
  agentName?: string;
  /**
   * Registered agent harness name. Populated by the validator when the step
   * declares `harness`, from `KotaConfig.defaultAgentHarness` when pinned, or
   * from the active preset's harness.
   */
  harness: string;
  promptPath: string;
  /**
   * Absolute filesystem root inherited from the enclosing workflow definition.
   * `promptPath` is resolved against this root by the step executor and the
   * repair loop so workflows contributed by KOTA's own modules keep reading
   * their prompts from KOTA's install tree even when the daemon is running
   * against an external project.
   */
  moduleRoot: string;
  /**
   * Concrete model id used when the step is dispatched. Always populated by
   * the validator: when the input declared `tier`, the validator resolves
   * the tier through `KotaConfig.modelTiers` (or the shipped default
   * mapping) and stores the result here. When the input declared `model`,
   * the validator stores it verbatim after the harness's optional
   * `validateModelId` gate.
   */
  model: string;
  /**
   * The neutral tier the input declared, preserved for telemetry and for
   * future re-resolution when the active preset changes. Unset when the
   * step input declared `model` directly.
   */
  tier?: ModelTier;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxTurns?: number;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  /**
   * Validated per-step harness-specific options. Single-key record whose key
   * equals the step's resolved harness name and whose value is the
   * adapter-private fragment returned by `AgentHarness.validateStepOptions`.
   * Opaque to core at runtime — the step executor threads the fragment to
   * the resolved harness through `AgentHarnessRunOptions.harnessOverrides`,
   * and only the adapter knows the fragment's shape.
   */
  harnessOptions?: Record<string, AgentHarnessStepOverrides>;
  /** Operator supervision mode applied to this agent step. */
  autonomyMode: AutonomyMode;
  retry?: WorkflowRetryConfig;
  repairLoop?: WorkflowRepairLoopConfig;
  outputFormat?: "json";
  outputSchema?: Record<string, unknown>;
  validate?: WorkflowAgentStepOutputValidator;
};

export type WorkflowEmitStep = WorkflowBaseStep & {
  type: "emit";
  event: string;
  payload?: WorkflowValueResolver<Record<string, unknown>>;
};

export type WorkflowRestartStep = WorkflowBaseStep & {
  type: "restart";
  reason?: WorkflowValueResolver<string>;
  requires: string[];
};

export type WorkflowCodeStep = WorkflowBaseStep & {
  type: "code";
  run: (context: WorkflowStepContext) => Promise<unknown> | unknown;
  /**
   * Runtime decoder propagated by the step validator. When present, the
   * executor runs it on the raw `run()` result and replaces the persisted
   * output with the decoded value, throwing `WorkflowStepOutputValidationError`
   * on rejection.
   */
  validate?: CodeStepOutputValidator<unknown>;
};

export type WorkflowTriggerStep = WorkflowBaseStep & {
  type: "trigger";
  workflow: string;
  payload?: WorkflowValueResolver<Record<string, unknown>>;
  waitFor: "queued" | "completed";
};

export type WorkflowParallelGroup = {
  id: string;
  type: "parallel";
  /** Code and agent steps to run concurrently. */
  steps: (WorkflowCodeStep | WorkflowAgentStep)[];
  when?: WorkflowPredicate;
  continueOnFailure?: boolean;
  /** Maximum number of agent steps allowed to run simultaneously. Defaults to group size. */
  maxParallelAgents?: number;
};

export type WorkflowBranchStep = WorkflowBaseStep & {
  type: "branch";
  condition: WorkflowPredicate;
  ifTrue: WorkflowStep[];
  ifFalse: WorkflowStep[];
};

export type WorkflowForeachStep = WorkflowBaseStep & {
  type: "foreach";
  items: WorkflowValueResolver<unknown[]>;
  as: string;
  steps: (WorkflowCodeStep | WorkflowAgentStep)[];
  /** Maximum number of items to execute concurrently. Defaults to 1 (serial). */
  maxConcurrency?: number;
  /** When true and `continueOnFailure: true`, retries re-run only failed items. */
  retryFailedItems?: boolean;
};

export type WorkflowApprovalStep = WorkflowBaseStep & {
  type: "approval";
  reason?: string;
  defaultResolution?: "deny" | "approve";
};

export type WorkflowAwaitEventStep = WorkflowBaseStep & {
  type: "await-event";
  event: string;
  matchField: string;
  matchValue: WorkflowValueResolver<string | number>;
  awaitTimeoutMs?: number;
};

export type WorkflowStep =
  | WorkflowToolStep
  | WorkflowAgentStep
  | WorkflowEmitStep
  | WorkflowRestartStep
  | WorkflowCodeStep
  | WorkflowTriggerStep
  | WorkflowParallelGroup
  | WorkflowBranchStep
  | WorkflowForeachStep
  | WorkflowApprovalStep
  | WorkflowAwaitEventStep;
