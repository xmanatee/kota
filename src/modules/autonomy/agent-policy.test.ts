import { describe, expect, it } from "vitest";
import type { WorkflowAgentStepInput } from "#core/workflow/step-input-base.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { AUTONOMY_DISALLOWED_TOOLS } from "./shared.js";
import builderWorkflow from "./workflows/builder/workflow.js";
import decomposerWorkflow from "./workflows/decomposer/workflow.js";
import explorerWorkflow from "./workflows/explorer/workflow.js";
import improverWorkflow from "./workflows/improver/workflow.js";
import inboxSorterWorkflow from "./workflows/inbox-sorter/workflow.js";
import prReviewerWorkflow from "./workflows/pr-reviewer/workflow.js";
import researchRetryWorkflow from "./workflows/research-retry/workflow.js";
import securityReviewWorkflow from "./workflows/security-review/workflow.js";

const MUTATING_AGENT_WORKFLOWS = [
  builderWorkflow,
  decomposerWorkflow,
  explorerWorkflow,
  improverWorkflow,
  inboxSorterWorkflow,
];

const TOP_LEVEL_AGENT_WORKFLOWS = [
  ...MUTATING_AGENT_WORKFLOWS,
  prReviewerWorkflow,
];

const PORTABLE_AGENT_OPTION_WORKFLOWS = [
  ...TOP_LEVEL_AGENT_WORKFLOWS,
  researchRetryWorkflow,
  securityReviewWorkflow,
];

function agentSteps(workflow: WorkflowDefinitionInput): WorkflowAgentStepInput[] {
  return workflow.steps.filter((step): step is WorkflowAgentStepInput => step.type === "agent");
}

describe("autonomy agent policy", () => {
  it("runs top-level autonomy agents without reasoning or repair caps", () => {
    for (const workflow of TOP_LEVEL_AGENT_WORKFLOWS) {
      for (const step of agentSteps(workflow)) {
        expect(step.maxTurns, `${workflow.name}.${step.id}.maxTurns`).toBeUndefined();
        const repairLoop = step.repairLoop as Record<string, unknown> | undefined;
        expect(repairLoop?.maxTurnsPerRepair, `${workflow.name}.${step.id}.repairLoop.maxTurnsPerRepair`).toBeUndefined();
        expect(repairLoop?.maxRepairAttempts, `${workflow.name}.${step.id}.repairLoop.maxRepairAttempts`).toBeUndefined();
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

  it("uses portable effort instead of provider-specific thinking controls", () => {
    for (const workflow of PORTABLE_AGENT_OPTION_WORKFLOWS) {
      for (const step of agentSteps(workflow)) {
        expect(step.effort, `${workflow.name}.${step.id}.effort`).toBeDefined();
        expect(step.thinkingEnabled, `${workflow.name}.${step.id}.thinkingEnabled`).toBeUndefined();
        expect(step.thinkingBudget, `${workflow.name}.${step.id}.thinkingBudget`).toBeUndefined();
      }
    }
  });
});
