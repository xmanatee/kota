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

export const inspectTargetTaskStep = typedCodeStep<BuilderTaskTarget & { recoveryRevision: string }>({
  id: "inspect-target-task",
  type: "code",
  exposeOutputToAgent: true,
  exposedOutputTrust: "untrusted",
  validate: (raw) =>
    expectStructuredOutput<BuilderTaskTarget & { recoveryRevision: string }>(raw, [
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
    if (target.actionable) {
      const source = readVerifiedRepoTaskFile(ctx.scopeRoot, "open", target.taskId);
      if (source === null) throw new Error("Admitted task disappeared during inspection");
      const agentDir = resolveAgentRunDirFromContext(ctx);
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, "admitted-task.md"), source.content, { mode: 0o600 });
    }
    return { ...target, recoveryRevision: await builderRecoveryRevision({ ...ctx, runId: ctx.workflow.runId }) };
  },
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
    const source = readVerifiedRepoTaskFile(ctx.scopeRoot, "open", task.taskId);
    const namedTokens = new Set(source?.content.match(/[A-Za-z0-9][A-Za-z0-9._-]*/g) ?? []);
    // A task may explicitly name another run without being that run's incident
    // owner. Select only named, same-scope runs through runtime authority.
    for (const run of ctx.runEvidence?.listRuns() ?? []) {
      const shortId = run.id.split("-").at(-1)!;
      if (namedTokens.has(run.id) || (shortId.length >= 6 && namedTokens.has(shortId))) {
        refs.push({ kind: "run", ref: `.kota/runs/${run.id}/metadata.json` });
      }
    }
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
