import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import { runBuilderHarnessPreflight } from "./builder-harness-preflight.js";
import {
  type BuilderTaskTarget,
  inspectBuilderTaskTargetOperation,
} from "./task-contract.js";
import { workflowWorkspaceDir } from "./workspace.js";

export const inspectTargetTaskStep = typedCodeStep<BuilderTaskTarget>({
  id: "inspect-target-task",
  type: "code",
  exposeOutputToAgent: true,
  exposedOutputTrust: "untrusted",
  validate: (raw) =>
    expectStructuredOutput<BuilderTaskTarget>(raw, [
      "actionable",
      "taskId",
      "taskPath",
      "taskState",
      "taskDigest",
      "reason",
    ]),
  run: (ctx) =>
    ctx.runBlocking(inspectBuilderTaskTargetOperation, {
      workspaceRoot: workflowWorkspaceDir(ctx),
      payload: ctx.trigger.payload,
    }),
});

export const builderHarnessPreflightStep = {
  id: "preflight-builder-harness",
  type: "code" as const,
  when: (ctx: WorkflowStepContext) => inspectTargetTaskStep.outputRequired(ctx).actionable,
  run: (ctx: WorkflowStepContext) =>
    runBuilderHarnessPreflight({
      agentRuntime: ctx.agentRuntime,
      runDirPath: ctx.workflow.runDirPath,
    }),
};
