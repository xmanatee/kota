import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveAgentRunDirFromContext } from "#core/workflow/agent-run-dir.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import { AUTONOMY_ISSUE_PROJECTION_STATE_KEY, type AutonomyIssueProjection, decodeAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
import { writeIssueEvidence } from "#modules/autonomy/issue-evidence.js";
import { readVerifiedRepoTaskFile } from "#modules/repo-tasks/repo-tasks-domain.js";
import { runBuilderHarnessPreflight } from "./builder-harness-preflight.js";
import { builderRecoveryRevision } from "./recovery.js";
import {
  type BuilderTaskTarget,
  inspectBuilderTaskTargetOperation,
} from "./task-contract.js";

export const inspectTargetTaskStep = typedCodeStep<BuilderTaskTarget & { recoveryRevision: string | null }>({
  id: "inspect-target-task",
  type: "code",
  exposeOutputToAgent: true,
  exposedOutputTrust: "untrusted",
  validate: (raw) =>
    expectStructuredOutput<BuilderTaskTarget & { recoveryRevision: string | null }>(raw, [
      "actionable",
      "taskId",
      "taskPath",
      "taskState",
      "taskDigest",
      "reason",
    ]),
  run: async (ctx) => {
    const target = await ctx.runBlocking(inspectBuilderTaskTargetOperation, {
      workspaceRoot: ctx.scopeRoot,
      payload: ctx.trigger.payload,
    });
    if (!target.actionable) return { ...target, recoveryRevision: null };
    const recoveryRevision = await builderRecoveryRevision({ ...ctx, runId: ctx.workflow.runId });
    // Collection yields to concurrent publication. Recheck canonical intent
    // before handing the admitted source to an agent.
    const refreshed = await ctx.runBlocking(inspectBuilderTaskTargetOperation, {
      workspaceRoot: ctx.scopeRoot, payload: ctx.trigger.payload,
    });
    if (!refreshed.actionable) return { ...refreshed, recoveryRevision: null };
    const source = readVerifiedRepoTaskFile(ctx.scopeRoot, "open", target.taskId);
    if (source === null) throw new Error("Admitted task disappeared during inspection");
    const agentDir = resolveAgentRunDirFromContext(ctx);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "admitted-task.md"), source.content, { mode: 0o600 });
    return { ...refreshed, recoveryRevision };
  },
});

export const taskIssueEvidenceStep = typedCodeStep<{ evidencePath: string | null }>({
  id: "capture-task-issue-evidence",
  type: "code",
  exposeOutputToAgent: true,
  exposedOutputTrust: "untrusted",
  when: (ctx) => inspectTargetTaskStep.outputRequired(ctx).actionable,
  validate: (raw) => expectStructuredOutput<{ evidencePath: string | null }>(raw, ["evidencePath"]),
  run: async (ctx) => {
    const task = inspectTargetTaskStep.outputRequired(ctx);
    const projection = decodeAutonomyIssueProjection(
      ctx.state.read<AutonomyIssueProjection>(AUTONOMY_ISSUE_PROJECTION_STATE_KEY).value,
    );
    const refs = projection.issues
      .filter((issue) => issue.links.taskIds.includes(task.taskId))
      .flatMap((issue) => issue.evidenceRefs);
    const source = readVerifiedRepoTaskFile(ctx.scopeRoot, "open", task.taskId);
    const namedTokens = new Set(source?.content.match(/[A-Za-z0-9][A-Za-z0-9._-]*/g) ?? []);
    return { evidencePath: await writeIssueEvidence(ctx, refs, [...namedTokens].filter((token) =>
      /^[a-z0-9]{6}$/.test(token) || /^\d{4}-\d{2}-\d{2}T/.test(token))) };
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
