import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  AgentTokenBudgetLedger,
  type AgentTokenBudgetSnapshot,
} from "#core/agent-harness/token-budget.js";
import type { KotaConfig } from "#core/config/config.js";
import { writeJsonFile } from "../run-io.js";
import type { WorkflowRunMetadata } from "../run-types.js";
import type { WorkflowAgentStep } from "../step-types.js";

export type AgentTokenBudgetArtifact = {
  artifactKind: "agent-token-budget";
  schemaVersion: 1;
  workflow: string;
  runId: string;
  stepId: string;
  snapshot: AgentTokenBudgetSnapshot;
};

export function resolveWorkflowRunTokenBudget(
  config: KotaConfig | undefined,
): AgentTokenBudgetLedger | undefined {
  const tokenBudget = config?.workflow?.agentTokenBudget;
  if (tokenBudget === undefined) return undefined;
  return new AgentTokenBudgetLedger(tokenBudget);
}

export function resolveAgentStepTokenBudget(
  step: WorkflowAgentStep,
  runTokenBudget: AgentTokenBudgetLedger | undefined,
  config: KotaConfig | undefined,
): AgentTokenBudgetLedger | undefined {
  if (step.tokenBudget !== undefined) {
    return runTokenBudget?.createChild(step.tokenBudget) ??
      new AgentTokenBudgetLedger(step.tokenBudget);
  }
  if (runTokenBudget !== undefined) return runTokenBudget;
  const tokenBudget = config?.workflow?.agentTokenBudget;
  if (tokenBudget === undefined) return undefined;
  return new AgentTokenBudgetLedger(tokenBudget);
}

export function writeAgentTokenBudgetArtifact(
  stepId: string,
  metadata: WorkflowRunMetadata,
  projectDir: string,
  tokenBudget: AgentTokenBudgetLedger | undefined,
): void {
  if (tokenBudget === undefined) return;
  const filePath = join(
    resolve(projectDir, metadata.runDir),
    "steps",
    `${stepId}.token-budget.json`,
  );
  mkdirSync(dirname(filePath), { recursive: true });
  const artifact: AgentTokenBudgetArtifact = {
    artifactKind: "agent-token-budget",
    schemaVersion: 1,
    workflow: metadata.workflow,
    runId: metadata.id,
    stepId,
    snapshot: tokenBudget.snapshot(),
  };
  writeJsonFile(filePath, artifact);
}
