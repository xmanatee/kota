import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import type { EventSchemaReference } from "#core/events/event-bus.js";
import type { ScopeSelector } from "#core/server/scope-selector.js";

export type WorkflowTrialBlockedSideEffect = {
  stepId: string;
  tool: string;
  reason: string;
  effect: {
    kind: string;
    scope: string;
    openWorld: boolean;
  };
  manifest?: {
    moduleName: string;
    effectId: string;
    categories: readonly string[];
    capabilityIds: readonly string[];
  };
};

export type WorkflowTrialChangedFile = {
  path: string;
  change: "created" | "modified" | "deleted";
};

export type WorkflowTrialPayload = KotaJsonObject;

export type WorkflowTrialEvent = {
  type: string;
  schemaRef: EventSchemaReference | null;
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
  scopeId?: string;
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

export type WorkflowTrialOptions = ScopeSelector & {
  payload?: WorkflowTrialPayload;
  repeat?: number;
  compareWorkflows?: string[];
  comparePayloads?: WorkflowTrialPayload[];
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
