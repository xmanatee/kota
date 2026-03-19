import type {
  SDKPermissionMode,
  SDKSettingSource,
} from "../agent-sdk/types.js";
import type { BusEvents } from "../event-bus.js";
import type { ToolResult } from "../tools/index.js";

export type WorkflowFilterValue = string | number | boolean;

export type WorkflowTriggerInput = {
  event: keyof BusEvents | string;
  filter?: Record<string, WorkflowFilterValue>;
  cooldownMs?: number;
};

export type WorkflowTrigger = {
  event: string;
  filter?: Record<string, WorkflowFilterValue>;
  cooldownMs: number;
};

export type WorkflowRunTrigger = {
  event: string;
  payload: Record<string, unknown>;
};

export type WorkflowRunStatus = "success" | "failed" | "interrupted";

export type WorkflowStepStatus = "success" | "failed" | "skipped";

export type WorkflowRuntimeState = {
  activeRunId?: string;
  activeWorkflow?: string;
  activeStartedAt?: string;
  completedRuns: number;
  pendingRuns: WorkflowQueuedRun[];
  workflows: Record<
    string,
    {
      lastRunId?: string;
      lastStartedAt?: string;
      lastCompletedAt?: string;
      lastStatus?: WorkflowRunStatus;
    }
  >;
};

export type WorkflowContextInfo = {
  name: string;
  definitionPath: string;
  runId: string;
  runDir: string;
  runDirPath: string;
};

export type WorkflowStepContext = {
  projectDir: string;
  workflow: WorkflowContextInfo;
  trigger: WorkflowRunTrigger;
  previousOutput: unknown;
  stepOutputs: Record<string, unknown>;
  stepResults: Record<string, WorkflowStepResult>;
  stepOutputList: unknown[];
  runTool: (
    name: string,
    input: Record<string, unknown>,
  ) => Promise<ToolResult>;
  emit: (event: string, payload: Record<string, unknown>) => void;
  requestRestart: (reason: string) => void;
  readPrompt: (promptPath: string) => string;
  readRuntimeState: () => WorkflowRuntimeState;
};

export type WorkflowValueResolver<T> =
  | T
  | ((context: WorkflowStepContext) => T | Promise<T>);

export type WorkflowPredicate = (
  context: WorkflowStepContext,
) => boolean | Promise<boolean>;

type WorkflowBaseStep = {
  id: string;
  when?: WorkflowPredicate;
};

export type WorkflowToolStepInput = WorkflowBaseStep & {
  type: "tool";
  tool: string;
  input?: WorkflowValueResolver<Record<string, unknown>>;
};

export type WorkflowAgentStepInput = WorkflowBaseStep & {
  type: "agent";
  promptPath: string;
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  permissionMode?: SDKPermissionMode;
  allowedTools?: string[];
  disallowedTools?: string[];
  settingSources?: SDKSettingSource[];
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

export type WorkflowCodeStepInput = WorkflowBaseStep & {
  type: "code";
  run: (context: WorkflowStepContext) => Promise<unknown> | unknown;
};

export type WorkflowStepInput =
  | WorkflowToolStepInput
  | WorkflowAgentStepInput
  | WorkflowEmitStepInput
  | WorkflowRestartStepInput
  | WorkflowCodeStepInput;

export type WorkflowDefinitionInput = {
  name: string;
  description?: string;
  enabled?: boolean;
  triggers: WorkflowTriggerInput[];
  steps: WorkflowStepInput[];
};

export type RegisteredWorkflowDefinitionInput = WorkflowDefinitionInput & {
  definitionPath: string;
};

export type WorkflowToolStep = WorkflowBaseStep & {
  type: "tool";
  tool: string;
  input?: WorkflowValueResolver<Record<string, unknown>>;
};

export type WorkflowAgentStep = WorkflowBaseStep & {
  type: "agent";
  promptPath: string;
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  permissionMode: SDKPermissionMode;
  allowedTools?: string[];
  disallowedTools?: string[];
  settingSources: SDKSettingSource[];
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
};

export type WorkflowStep =
  | WorkflowToolStep
  | WorkflowAgentStep
  | WorkflowEmitStep
  | WorkflowRestartStep
  | WorkflowCodeStep;

export type WorkflowDefinition = {
  name: string;
  description?: string;
  enabled: boolean;
  definitionPath: string;
  triggers: WorkflowTrigger[];
  steps: WorkflowStep[];
};

export type WorkflowQueuedRun = {
  workflowName: string;
  trigger: WorkflowRunTrigger;
  enqueuedAtMs: number;
  notBeforeMs: number;
};

export type WorkflowStepResult = {
  id: string;
  type: WorkflowStep["type"];
  status: WorkflowStepStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  output?: unknown;
  error?: string;
};

export type WorkflowRunMetadata = {
  id: string;
  workflow: string;
  definitionPath: string;
  trigger: WorkflowRunTrigger;
  startedAt: string;
  completedAt?: string;
  status: WorkflowRunStatus | "running";
  durationMs?: number;
  runDir: string;
  steps: WorkflowStepResult[];
};
