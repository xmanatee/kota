import { describe, expect, it } from "vitest";
import type { WorkflowAgentStepInput, WorkflowDefinitionInput } from "#core/workflow/types.js";
import { AUTONOMY_DISALLOWED_TOOLS } from "./shared.js";
import builderWorkflow from "./workflows/builder/workflow.js";
import decomposerWorkflow from "./workflows/decomposer/workflow.js";
import explorerWorkflow from "./workflows/explorer/workflow.js";
import improverWorkflow from "./workflows/improver/workflow.js";
import inboxSorterWorkflow from "./workflows/inbox-sorter/workflow.js";
import prReviewerWorkflow from "./workflows/pr-reviewer/workflow.js";

const MUTATING_AGENT_WORKFLOWS = [
  builderWorkflow,
  decomposerWorkflow,
  explorerWorkflow,
  improverWorkflow,
  inboxSorterWorkflow,
  prReviewerWorkflow,
];

function agentSteps(workflow: WorkflowDefinitionInput): WorkflowAgentStepInput[] {
  return workflow.steps.filter((step): step is WorkflowAgentStepInput => step.type === "agent");
}

describe("autonomy agent policy", () => {
  it("runs top-level autonomy agents without turn or spend caps", () => {
    for (const workflow of MUTATING_AGENT_WORKFLOWS) {
      for (const step of agentSteps(workflow)) {
        expect(step.maxTurns, `${workflow.name}.${step.id}.maxTurns`).toBeUndefined();
        expect(step.maxBudgetUsd, `${workflow.name}.${step.id}.maxBudgetUsd`).toBeUndefined();
        expect(step.maxCostUsd, `${workflow.name}.${step.id}.maxCostUsd`).toBeUndefined();
        expect(step.repairLoop?.maxTurnsPerRepair, `${workflow.name}.${step.id}.repairLoop.maxTurnsPerRepair`).toBeUndefined();
        expect(step.repairLoop?.maxRepairAttempts, `${workflow.name}.${step.id}.repairLoop.maxRepairAttempts`).toBeUndefined();
      }
    }
  });

  it("prevents hidden low-tier subagent delegation and scratch worktree entry", () => {
    for (const workflow of MUTATING_AGENT_WORKFLOWS) {
      for (const step of agentSteps(workflow)) {
        expect(step.disallowedTools, `${workflow.name}.${step.id}.disallowedTools`).toEqual(
          AUTONOMY_DISALLOWED_TOOLS,
        );
      }
    }
  });
});
