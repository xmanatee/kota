import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import { readRepairIterations } from "./repair-iteration-output.js";
import type { WorkflowStep } from "./step-types.js";
import type { WorkflowDefinition } from "./types.js";

export const STATE_FILE = "workflow-state.json";

export type WorkflowSnapshot = {
  name: string;
  description?: string;
  enabled: boolean;
  definitionPath: string;
  defaultAutonomyMode?: AutonomyMode;
  triggers: WorkflowDefinition["triggers"];
  steps: Array<Record<string, unknown>>;
};

export type RepairSummary = {
  attempts: number;
  failedChecksByAttempt: string[][];
  totalCostUsd: number;
};

function summarizeStep(step: WorkflowStep): Record<string, unknown> {
  if (step.type === "tool") {
    return {
      id: step.id,
      type: step.type,
      tool: step.tool,
      ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
      ...(step.exposeOutputToAgent ? { exposeOutputToAgent: true } : {}),
    };
  }
  if (step.type === "agent") {
    return {
      id: step.id,
      type: step.type,
      promptPath: step.promptPath,
      model: step.model,
      effort: step.effort,
      maxTurns: step.maxTurns,
      autonomyMode: step.autonomyMode,
      allowedTools: step.allowedTools,
      disallowedTools: step.disallowedTools,
      ...(step.harnessOptions ? { harnessOptions: step.harnessOptions } : {}),
      ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
      ...(step.exposeOutputToAgent ? { exposeOutputToAgent: true } : {}),
    };
  }
  if (step.type === "emit") {
    return {
      id: step.id,
      type: step.type,
      event: step.event,
      ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
      ...(step.exposeOutputToAgent ? { exposeOutputToAgent: true } : {}),
    };
  }
  if (step.type === "restart") {
    return {
      id: step.id,
      type: step.type,
      requires: step.requires,
      ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
      ...(step.exposeOutputToAgent ? { exposeOutputToAgent: true } : {}),
    };
  }
  if (step.type === "parallel") {
    return {
      id: step.id,
      type: step.type,
      ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
    };
  }
  return {
    id: step.id,
    type: step.type,
    ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
    ...(step.exposeOutputToAgent ? { exposeOutputToAgent: true } : {}),
  };
}

export function extractRepairSummary(output: unknown): RepairSummary | null {
  const iterations = readRepairIterations(output);
  if (iterations.length === 0) return null;
  let totalCostUsd = 0;
  const failedChecksByAttempt: string[][] = [];
  for (const iter of iterations) {
    failedChecksByAttempt.push(iter.failures.map((f) => f.id));
    totalCostUsd += iter.agentCostUsd ?? 0;
  }
  return { attempts: iterations.length, failedChecksByAttempt, totalCostUsd };
}

export function buildWorkflowSnapshot(workflow: WorkflowDefinition): WorkflowSnapshot {
  return {
    name: workflow.name,
    description: workflow.description,
    enabled: workflow.enabled,
    definitionPath: workflow.definitionPath,
    defaultAutonomyMode: workflow.defaultAutonomyMode,
    triggers: workflow.triggers,
    steps: workflow.steps.map(summarizeStep),
  };
}
