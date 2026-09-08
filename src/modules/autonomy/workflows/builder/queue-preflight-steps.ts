import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import { AUTONOMY_ISSUE_PROJECTION_STATE_KEY, type AutonomyIssueProjection, decodeAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
import { writeIssueEvidence } from "#modules/autonomy/issue-evidence.js";
import { runBuilderHarnessPreflight } from "./builder-harness-preflight.js";
import {
  type BuilderTaskTarget,
  inspectBuilderTaskTargetOperation,
} from "./task-contract.js";

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
      workspaceRoot: ctx.scopeRoot,
      payload: ctx.trigger.payload,
    }),
});

export const taskIssueEvidenceStep = typedCodeStep<{ evidencePath: string | null }>({
  id: "capture-task-issue-evidence",
  type: "code",
  exposeOutputToAgent: true,
  exposedOutputTrust: "untrusted",
  when: (ctx) => inspectTargetTaskStep.outputRequired(ctx).actionable,
  validate: (raw) => expectStructuredOutput<{ evidencePath: string | null }>(raw, ["evidencePath"]),
  run: (ctx) => {
    const task = inspectTargetTaskStep.outputRequired(ctx);
    const projection = decodeAutonomyIssueProjection(
      ctx.state.read<AutonomyIssueProjection>(AUTONOMY_ISSUE_PROJECTION_STATE_KEY).value,
    );
    const refs = projection.issues
      .filter((issue) => issue.links.taskIds.includes(task.taskId))
      .flatMap((issue) => issue.evidenceRefs);
    return { evidencePath: writeIssueEvidence(ctx, refs) };
  },
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
