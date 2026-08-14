/**
 * Recurring review-scrutiny escalation.
 *
 * Review-scrutiny artifacts are diagnostic until a stable grouped pattern
 * crosses conservative sample and ratio thresholds. This workflow turns those
 * repeated thin reviewer acceptances into one repair task per pattern.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  decodeWorkflowCommitOutcome,
  type WorkflowCommitOutcome,
} from "#modules/autonomy/commit-result.js";
import {
  onNormalTrigger,
  onRecoveryTrigger,
  resetWorktreeForRecoveryOperation,
} from "#modules/autonomy/recovery.js";
import {
  buildReviewScrutinyAttentionDigest,
  type ReviewScrutinyEscalationApplied,
  type ReviewScrutinyEscalationDetection,
  type ReviewScrutinyEscalationProposal,
} from "#modules/autonomy/review-scrutiny-escalation.js";
import { runCheck, stepCommitRequiresDaemonRestart } from "#modules/autonomy/shared.js";
import {
  workflowCommitOperation,
  workflowCommitValidationOperation,
} from "#modules/autonomy/workflow-commit-operations.js";
import {
  inspectReviewScrutinyPatternsOperation,
  type ReviewScrutinyInspection,
} from "./inspection.js";
import {
  applyReviewScrutinyTasksOperation,
  proposeReviewScrutinyTasksOperation,
} from "./task-operations.js";

type Inspection = ReviewScrutinyInspection;

type ProposalOutput = {
  proposals: ReviewScrutinyEscalationProposal[];
};

type ApplyOutput = {
  applied: ReviewScrutinyEscalationApplied[];
};

export type ReviewScrutinyEscalationArtifact = {
  generatedAt: string;
  dirty: boolean;
  status: Inspection["status"];
  detection: ReviewScrutinyEscalationDetection;
  proposals: ReviewScrutinyEscalationProposal[];
  applied: ReviewScrutinyEscalationApplied[];
};

const inspectPatterns = typedCodeStep<Inspection>({
  id: "inspect-patterns",
  type: "code",
  when: onNormalTrigger,
  validate: (raw) =>
    expectStructuredOutput<Inspection>(raw, [
      "dirty",
      "status",
      "detection",
    ]),
  run: ({ projectDir, runBlocking }) =>
    runBlocking(inspectReviewScrutinyPatternsOperation, { projectDir }),
});

const proposeTasks = typedCodeStep<ProposalOutput>({
  id: "propose-tasks",
  type: "code",
  when: (ctx) => {
    const inspection = inspectPatterns.output(ctx);
    return Boolean(
      inspection && !inspection.dirty && inspection.detection.patterns.length > 0,
    );
  },
  validate: (raw) => expectStructuredOutput<ProposalOutput>(raw, ["proposals"]),
  run: (ctx) => {
    const inspection = inspectPatterns.outputRequired(ctx);
    const config = {
      ...inspection.detection.thresholds,
      nowMs: Date.now(),
    };
    return ctx.runBlocking(proposeReviewScrutinyTasksOperation, {
      projectDir: ctx.projectDir,
      patterns: inspection.detection.patterns,
      config,
    });
  },
});

const applyTasks = typedCodeStep<ApplyOutput>({
  id: "apply-tasks",
  type: "code",
  when: (ctx) => proposeTasks.output(ctx) !== undefined,
  validate: (raw) => expectStructuredOutput<ApplyOutput>(raw, ["applied"]),
  run: (ctx) => {
    return ctx.runBlocking(applyReviewScrutinyTasksOperation, {
      projectDir: ctx.projectDir,
      proposals: proposeTasks.outputRequired(ctx).proposals,
      nowIso: new Date().toISOString(),
    });
  },
});

const writeArtifact = typedCodeStep<{ written: boolean; path: string }>({
  id: "write-artifact",
  type: "code",
  when: (ctx) => inspectPatterns.output(ctx) !== undefined,
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean; path: string }>(raw, [
      "written",
      "path",
    ]),
  run: (ctx) => {
    const inspection = inspectPatterns.outputRequired(ctx);
    const artifact: ReviewScrutinyEscalationArtifact = {
      generatedAt: new Date().toISOString(),
      dirty: inspection.dirty,
      status: inspection.status,
      detection: inspection.detection,
      proposals: proposeTasks.output(ctx)?.proposals ?? [],
      applied: applyTasks.output(ctx)?.applied ?? [],
    };
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    const artifactPath = join(
      ctx.workflow.runDirPath,
      "review-scrutiny-escalation.json",
    );
    writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    return { written: true, path: artifactPath };
  },
});

function actionLandedOnDisk(applied: ReviewScrutinyEscalationApplied): boolean {
  return (
    applied.kind === "created" ||
    applied.kind === "refreshed" ||
    applied.kind === "promoted" ||
    applied.kind === "recreated"
  );
}

const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  when: (ctx) =>
    (applyTasks.output(ctx)?.applied ?? []).some(actionLandedOnDisk),
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean }>(raw, ["written"]),
  run: (ctx) => {
    const applied = applyTasks.outputRequired(ctx).applied.filter(actionLandedOnDisk);
    const subjects = applied.map((item) => `${item.kind} ${item.taskId}`);
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    const message = [
      `review-scrutiny-escalator: ${subjects.join(", ")}`,
      "",
      "Escalated recurring thin reviewer acceptances into repair tasks.",
    ].join("\n");
    writeFileSync(join(ctx.workflow.runDirPath, "commit-message.txt"), `${message}\n`);
    return { written: true };
  },
});

const validateBeforeCommit = typedCodeStep<{ ok: true }>({
  id: "validate-before-commit",
  type: "code",
  when: (ctx) => writeCommitMessage.output(ctx)?.written === true,
  validate: (raw) => {
    const obj = expectStructuredOutput<{ ok: true }>(raw, ["ok"]);
    if (obj.ok !== true) throw new Error(`expected ok: true, got ${String(obj.ok)}`);
    return obj;
  },
  run: async (ctx) => {
    await runCheck("pnpm run validate-tasks", ctx.projectDir, { signal: ctx.signal });
    await ctx.runBlocking(workflowCommitValidationOperation, {
      projectDir: ctx.projectDir,
      runDirPath: ctx.workflow.runDirPath,
    });
    return { ok: true } as const;
  },
});

const commitChanges = typedCodeStep<WorkflowCommitOutcome>({
  id: "commit",
  type: "code",
  when: (ctx) => validateBeforeCommit.output(ctx)?.ok === true,
  validate: decodeWorkflowCommitOutcome,
  run: (ctx) =>
    ctx.runBlocking(workflowCommitOperation, {
      projectDir: ctx.projectDir,
      runDirPath: ctx.workflow.runDirPath,
    }),
});

const reviewScrutinyEscalator: WorkflowDefinitionInput = {
  name: "review-scrutiny-escalator",
  description:
    "Detect recurring thin reviewer acceptances and open or refresh evidence-backed repair tasks.",
  recoveryCapable: true,
  // Code-only workflow: no agent step inherits an autonomy mode.
  triggers: [
    {
      event: "workflow.completed",
      filter: { tags: ["monitored"] },
    },
    { event: "runtime.recovered" },
  ],
  steps: [
    {
      id: "reset-for-recovery",
      type: "code",
      when: onRecoveryTrigger,
      run: (ctx) =>
        ctx.runBlocking(resetWorktreeForRecoveryOperation, {
          projectDir: ctx.projectDir,
          workflowName: "review-scrutiny-escalator",
        }),
    },
    inspectPatterns,
    proposeTasks,
    applyTasks,
    writeArtifact,
    writeCommitMessage,
    validateBeforeCommit,
    commitChanges,
    {
      id: "emit-attention",
      type: "emit",
      when: (ctx) => (inspectPatterns.output(ctx)?.detection.patterns.length ?? 0) > 0,
      event: "workflow.attention.digest",
      payload: (ctx) => {
        const inspection = inspectPatterns.outputRequired(ctx);
        const appliedByPattern = new Map(
          (applyTasks.output(ctx)?.applied ?? []).map((applied) => [
            applied.patternFingerprint,
            applied,
          ]),
        );
        return buildReviewScrutinyAttentionDigest(
          inspection.detection.patterns.map((pattern) => {
            const applied = appliedByPattern.get(pattern.fingerprint);
            return {
              surface: pattern.surface,
              workflow: pattern.workflow,
              taskId: pattern.taskId,
              action: applied?.kind ?? "skipped",
              thinAcceptances: pattern.thinAcceptances,
              approvalLikeDecisions: pattern.approvalLikeDecisions,
              runIds: pattern.runIds,
            };
          }),
        );
      },
    },
    {
      id: "request-restart",
      type: "restart",
      when: stepCommitRequiresDaemonRestart("commit"),
      reason:
        "review-scrutiny-escalator committed review scrutiny repair task changes",
      requires: ["commit"],
    },
  ],
};

export default reviewScrutinyEscalator;
