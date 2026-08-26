import type { AgentDef } from "#core/agents/agent-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_BUILDER_AGENT_IDLE_TIMEOUT_MS,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import {
  builderHarnessPreflightStep,
  inspectTargetTaskStep,
} from "./queue-preflight-steps.js";
import { builderRepairChecks } from "./repair-checks.js";
import {
  BUILDER_TASK_EVENT,
  builderTaskResources,
  verifyBuilderTaskContractAfterReconcile,
} from "./task-contract.js";

export const agent: AgentDef = {
  name: "builder",
  role: "Ship the one immutable task contract assigned to this isolated run.",
  promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  skills: ["tool-cache", "working-memory"],
  writeScope: [],
};

const builderWorkflow: WorkflowDefinitionInput = {
  name: "builder",
  description: "Implement one targeted task inside a runtime-owned repository sandbox.",
  tags: ["monitored"],
  defaultAutonomyMode: "autonomous",
  repository: "write",
  integration: {
    validationCommand: ["pnpm", "check"],
    postReconcile: verifyBuilderTaskContractAfterReconcile,
  },
  resources: builderTaskResources,
  inputSchema: {
    type: "object",
    additionalProperties: true,
    required: [
      "taskId",
      "taskPath",
      "taskState",
      "taskUpdatedAt",
      "taskDigest",
      "idempotencyKey",
    ],
    properties: {
      taskId: {
        type: "string",
        pattern: "^task-[a-z0-9][a-z0-9-]*$",
      },
      taskPath: { type: "string", minLength: 1 },
      taskState: { enum: ["ready", "doing"] },
      taskUpdatedAt: { type: "string", minLength: 1 },
      taskDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
      idempotencyKey: { type: "string", minLength: 1 },
    },
  },
  triggers: [{ event: BUILDER_TASK_EVENT, queueMode: "all" }],
  steps: [
    inspectTargetTaskStep,
    builderHarnessPreflightStep,
    {
      id: "build",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      timeoutMs: null,
      idleTimeoutMs: AUTONOMY_BUILDER_AGENT_IDLE_TIMEOUT_MS,
      when: (ctx) =>
        inspectTargetTaskStep.outputRequired(ctx).ready &&
        stepSucceeded("preflight-builder-harness")(ctx),
      repairLoop: { checks: builderRepairChecks() },
    },
  ],
};

export default builderWorkflow;
