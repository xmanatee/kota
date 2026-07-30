export type WorkflowDefinitionTriggerSummary =
  | { type: "event"; event: string; filter?: Record<string, string | string[]> }
  | { type: "cron"; schedule: string }
  | { type: "interval"; intervalMs: number }
  | { type: "webhook" }
  | { type: "watch"; patterns: string[]; debounceMs: number };

export type WorkflowDefinitionSummary = {
  name: string;
  enabled: boolean;
  runtimeEnabled?: boolean;
  stepCount: number;
  triggers: WorkflowDefinitionTriggerSummary[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
};

export type WorkflowActiveRun = {
  runId: string;
  workflow: string;
  startedAt: string;
  currentStep?: string;
};

export type WorkflowQueuedRun = {
  runId: string;
  workflowName: string;
};

export type WorkflowLiveStatus = {
  activeRuns: WorkflowActiveRun[];
  pendingRuns: WorkflowQueuedRun[];
  queueLength: number;
  completedRuns: number;
  totalCostUsd?: number;
  paused: boolean;
  dispatchWindowBlocked?: boolean;
  dispatchWindowOpensAt?: string;
  agentConcurrency: number;
  codeConcurrency: number;
  workflows: Record<string, { enabled: boolean }>;
};

export type WorkflowRunSummary = {
  id: string;
  workflow: string;
  status: string;
  triggerEvent: string;
  startedAt: string;
  durationMs?: number;
  totalCostUsd?: number;
  triggeredByRunId?: string;
  causedBy?: { runId: string; workflow: string };
  retryOf?: string;
  resumedFromRunId?: string;
  tags?: string[];
};

export type WorkflowRunStepSummary = {
  id: string;
  type: string;
  status: string;
  durationMs: number;
  error?: string;
  costUsd?: number;
  toolCalls?: Array<{ tool: string; count: number }>;
};

export type WorkflowRunDetail = WorkflowRunSummary & {
  completedAt?: string;
  triggerPayload?: Record<string, unknown>;
  steps: WorkflowRunStepSummary[];
  warnings?: Array<{ type: string; message: string }>;
};
