/** Known event payloads. Extend this map to add new typed events. */
export type BusEvents = {
  "runtime.idle": {
    timestamp: string;
    idleIntervalMs: number;
  };
  "runtime.restart_requested": {
    reason?: string;
    workflow?: string;
    runId?: string;
    requires?: string[];
  };
  "workflow.started": {
    workflow: string;
    runId: string;
    triggerEvent: string;
    definitionPath: string;
    runDir: string;
    startedAt: string;
  };
  "workflow.completed": {
    workflow: string;
    runId: string;
    status: "success" | "failed" | "interrupted" | "completed-with-warnings";
    triggerEvent: string;
    durationMs: number;
    definitionPath: string;
    runDir: string;
  };
  "workflow.step.started": {
    workflow: string;
    runId: string;
    stepId: string;
    stepType: "tool" | "agent" | "emit" | "restart" | "code" | "parallel" | "trigger" | "branch" | "foreach" | "approval";
    runDir: string;
    definitionPath: string;
    startedAt: string;
  };
  "workflow.step.completed": {
    workflow: string;
    runId: string;
    stepId: string;
    stepType: "tool" | "agent" | "emit" | "restart" | "code" | "parallel" | "trigger" | "branch" | "foreach" | "approval";
    status: "success" | "failed" | "skipped";
    durationMs: number;
    costUsd?: number;
    runDir: string;
    definitionPath: string;
  };
  "session.start": { sessionId: string; label?: string };
  "session.end": {
    sessionId: string;
    label?: string;
    error?: string;
    durationMs: number;
  };
  "session.state": {
    sessionId: string;
    from: string;
    to: string;
    meta?: Record<string, unknown>;
  };
  "schedule.fire": {
    itemId: number;
    description: string;
  };
  "knowledge.create": {
    id: string;
    title: string;
    type: string;
    tags: string[];
    scope: string;
  };
  "knowledge.update": {
    id: string;
    fields: string[];
  };
  "knowledge.delete": {
    id: string;
  };
  "file.changed": {
    watchId: string;
    path: string;
    changes: { path: string; type: "create" | "change" | "delete" }[];
  };
  "confirm.requested": {
    action: string;
    risk: string;
    details: string;
    timeout: number;
  };
  "confirm.resolved": {
    action: string;
    risk: string;
    approved: boolean;
    reason: string;
  };
  "approval.requested": {
    id: string;
    tool: string;
    risk: string;
    reason: string;
    source: string;
  };
  "approval.resolved": {
    id: string;
    tool: string;
    approved: boolean;
    reason: string;
  };
  "workflow.failure.alert": {
    workflow: string;
    runId: string;
    status: "failed" | "interrupted";
    durationMs: number;
    errorSummary: string;
    text: string;
  };
  "workflow.budget.exceeded": {
    dailySpend: number;
    budget: number;
    text: string;
  };
  "workflow.attention.digest": {
    items: { label: string; detail: string }[];
    text: string;
  };
  "workflow.cost.limit.reached": {
    totalCost: number;
    hardLimit: number;
    text: string;
    pauseSignalFile: string;
  };
  "workflow.cost.anomaly": {
    workflow: string;
    runId: string;
    runCostUsd: number;
    baselineCostUsd: number;
    threshold: number;
    text: string;
  };
  "workflow.cost.ceiling.exceeded": {
    workflow: string;
    runId: string;
    stepId: string;
    budgetUsd: number;
    actualCostUsd?: number;
  };
  "workflow.build.committed": {
    runId: string;
    taskId: string | null;
    commitMessage: string;
    costUsd: number | null;
    durationMs: number | null;
  };
  "approval.expired": {
    id: string;
    tool: string;
  };
  "workflow.approval.timeout": {
    id: string;
    tool: string;
    defaultResolution: "deny" | "approve";
  };
  "approval.changed": {
    id: string;
    pendingCount: number;
  };
  "task.changed": {
    counts: { pending: number; in_progress: number; done: number };
  };
  "session.registered": {
    id: string;
    createdAt: string;
  };
  "session.unregistered": {
    id: string;
  };
  "extension.failed": {
    name: string;
    reason: string;
  };
};

/** An event as seen by wildcard listeners: type + payload. */
export type BusEnvelope<K extends string = string> = {
  type: K;
  payload: K extends keyof BusEvents ? BusEvents[K] : Record<string, unknown>;
};

export type BusEventHandler<T = Record<string, unknown>> = (payload: T) => void;
