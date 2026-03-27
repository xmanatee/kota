import { existsSync, mkdirSync } from "node:fs";
import {
  JsonFileError,
  writeJsonFileAtomic,
} from "../json-file.js";
import type {
  WorkflowAgentBackoffState,
  WorkflowDefinition,
  WorkflowQueuedRun,
  WorkflowRunMetadata,
  WorkflowRunStatus,
  WorkflowRunTrigger,
  WorkflowRuntimeState,
  WorkflowStep,
} from "./types.js";

export const STATE_FILE = "workflow-state.json";

export type WorkflowSnapshot = {
  name: string;
  description?: string;
  enabled: boolean;
  definitionPath: string;
  triggers: WorkflowDefinition["triggers"];
  steps: Array<Record<string, unknown>>;
};

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWorkflowRunStatus(value: unknown): value is WorkflowRunStatus {
  return (
    value === "success" ||
    value === "failed" ||
    value === "interrupted" ||
    value === "completed-with-warnings"
  );
}

function isWorkflowAgentBackoffState(
  value: unknown,
): value is WorkflowAgentBackoffState {
  return (
    isPlainObject(value) &&
    (value.kind === "rate_limit" ||
      value.kind === "auth" ||
      value.kind === "provider") &&
    typeof value.failureCount === "number" &&
    Number.isInteger(value.failureCount) &&
    value.failureCount > 0 &&
    typeof value.until === "string" &&
    value.until.trim().length > 0 &&
    typeof value.updatedAt === "string" &&
    value.updatedAt.trim().length > 0 &&
    typeof value.reason === "string" &&
    value.reason.trim().length > 0
  );
}

function isWorkflowRunTrigger(value: unknown): value is WorkflowRunTrigger {
  return (
    isPlainObject(value) &&
    typeof value.event === "string" &&
    isPlainObject(value.payload)
  );
}

function isQueuedRun(value: unknown): value is WorkflowQueuedRun {
  return (
    isPlainObject(value) &&
    typeof value.workflowName === "string" &&
    isWorkflowRunTrigger(value.trigger) &&
    Number.isFinite(value.enqueuedAtMs) &&
    Number.isFinite(value.notBeforeMs)
  );
}

export function assertWorkflowRuntimeState(
  path: string,
  value: unknown,
): asserts value is WorkflowRuntimeState {
  if (!isPlainObject(value)) {
    throw new JsonFileError(path, "parse", "invalid workflow state shape");
  }
  const completedRuns = value.completedRuns;
  if (
    typeof completedRuns !== "number" ||
    !Number.isInteger(completedRuns) ||
    completedRuns < 0
  ) {
    throw new JsonFileError(
      path,
      "parse",
      "workflow state missing completedRuns",
    );
  }
  if (
    !Array.isArray(value.pendingRuns) ||
    value.pendingRuns.some((item) => !isQueuedRun(item))
  ) {
    throw new JsonFileError(path, "parse", "workflow state has invalid pendingRuns");
  }
  if (!isPlainObject(value.workflows)) {
    throw new JsonFileError(path, "parse", "workflow state has invalid workflows");
  }
  if (
    value.agentBackoff !== undefined &&
    !isWorkflowAgentBackoffState(value.agentBackoff)
  ) {
    throw new JsonFileError(
      path,
      "parse",
      "workflow state has invalid agentBackoff",
    );
  }
  for (const [workflowName, entry] of Object.entries(value.workflows)) {
    if (!isPlainObject(entry)) {
      throw new JsonFileError(
        path,
        "parse",
        `workflow state entry "${workflowName}" is invalid`,
      );
    }
    for (const key of ["lastRunId", "lastStartedAt", "lastCompletedAt"] as const) {
      const current = entry[key];
      if (
        current !== undefined &&
        (typeof current !== "string" || !current.trim())
      ) {
        throw new JsonFileError(
          path,
          "parse",
          `workflow state entry "${workflowName}" has invalid ${key}`,
        );
      }
    }
    if (
      entry.lastStatus !== undefined &&
      !isWorkflowRunStatus(entry.lastStatus)
    ) {
      throw new JsonFileError(
        path,
        "parse",
        `workflow state entry "${workflowName}" has invalid lastStatus`,
      );
    }
  }
  if (value.activeRuns !== undefined) {
    if (!Array.isArray(value.activeRuns)) {
      throw new JsonFileError(path, "parse", "workflow state has invalid activeRuns");
    }
    for (const entry of value.activeRuns) {
      if (
        !isPlainObject(entry) ||
        typeof entry.runId !== "string" ||
        typeof entry.workflow !== "string" ||
        typeof entry.startedAt !== "string"
      ) {
        throw new JsonFileError(path, "parse", "workflow state has invalid activeRuns entry");
      }
    }
  }
}

export function assertWorkflowRunMetadata(
  path: string,
  value: unknown,
): asserts value is WorkflowRunMetadata {
  if (!isPlainObject(value)) {
    throw new JsonFileError(path, "parse", "invalid workflow run metadata shape");
  }
  if (
    typeof value.id !== "string" ||
    typeof value.workflow !== "string" ||
    typeof value.definitionPath !== "string" ||
    !isWorkflowRunTrigger(value.trigger) ||
    typeof value.startedAt !== "string" ||
    typeof value.runDir !== "string" ||
    !Array.isArray(value.steps)
  ) {
    throw new JsonFileError(path, "parse", "workflow run metadata is incomplete");
  }
  if (
    value.status !== "running" &&
    !isWorkflowRunStatus(value.status)
  ) {
    throw new JsonFileError(path, "parse", "workflow run metadata has invalid status");
  }
}

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

export function safeJsonStringify(value: unknown, indent?: number): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_, current) => {
      if (typeof current === "bigint") return current.toString();
      if (typeof current === "function") {
        return `[Function ${current.name || "anonymous"}]`;
      }
      if (current instanceof Error) {
        return {
          name: current.name,
          message: current.message,
          stack: current.stack,
        };
      }
      if (current instanceof Map) {
        return Object.fromEntries(current);
      }
      if (current instanceof Set) {
        return Array.from(current);
      }
      if (current && typeof current === "object") {
        if (seen.has(current)) return "[Circular]";
        seen.add(current);
      }
      return current;
    },
    indent,
  );
}

export function writeJsonFile(path: string, value: unknown): void {
  writeJsonFileAtomic(path, value, (current) => safeJsonStringify(current, 2));
}

export function formatRunId(workflowName: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${workflowName}-${suffix}`;
}

function summarizeStep(step: WorkflowStep): Record<string, unknown> {
  if (step.type === "tool") {
    return {
      id: step.id,
      type: step.type,
      tool: step.tool,
      ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
    };
  }
  if (step.type === "agent") {
    return {
      id: step.id,
      type: step.type,
      promptPath: step.promptPath,
      model: step.model,
      maxTurns: step.maxTurns,
      maxBudgetUsd: step.maxBudgetUsd,
      permissionMode: step.permissionMode,
      allowedTools: step.allowedTools,
      disallowedTools: step.disallowedTools,
      settingSources: step.settingSources,
      ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
    };
  }
  if (step.type === "emit") {
    return {
      id: step.id,
      type: step.type,
      event: step.event,
      ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
    };
  }
  if (step.type === "restart") {
    return {
      id: step.id,
      type: step.type,
      requires: step.requires,
      ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
    };
  }
  return {
    id: step.id,
    type: step.type,
    ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
  };
}

export type RepairSummary = {
  attempts: number;
  failedChecksByAttempt: string[][];
  totalCostUsd: number;
};

export function extractRepairSummary(output: unknown): RepairSummary | null {
  if (!isPlainObject(output)) return null;
  const iterations = output.repairIterations;
  if (!Array.isArray(iterations) || iterations.length === 0) return null;
  let totalCostUsd = 0;
  const failedChecksByAttempt: string[][] = [];
  for (const iter of iterations) {
    if (!isPlainObject(iter)) continue;
    const failures = Array.isArray(iter.failures) ? iter.failures : [];
    failedChecksByAttempt.push(
      failures.filter(isPlainObject).map((f) => (typeof f.id === "string" ? f.id : "?")),
    );
    totalCostUsd += typeof iter.agentCostUsd === "number" ? iter.agentCostUsd : 0;
  }
  return { attempts: iterations.length, failedChecksByAttempt, totalCostUsd };
}

export function buildWorkflowSnapshot(workflow: WorkflowDefinition): WorkflowSnapshot {
  return {
    name: workflow.name,
    description: workflow.description,
    enabled: workflow.enabled,
    definitionPath: workflow.definitionPath,
    triggers: workflow.triggers,
    steps: workflow.steps.map(summarizeStep),
  };
}
