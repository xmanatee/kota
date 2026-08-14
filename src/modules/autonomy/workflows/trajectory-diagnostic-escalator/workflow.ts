/**
 * Recurring trajectory-diagnostic escalation.
 *
 * Successful workflow runs can still carry repeated process-quality warnings.
 * This workflow reads the typed trajectory-diagnostics artifacts written beside
 * agent-step artifacts, opens or refreshes one repair task per stable pattern,
 * and emits an operator attention item naming the generated task id.
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
import { runCheck, stepCommitRequiresDaemonRestart } from "#modules/autonomy/shared.js";
import {
  buildTrajectoryDiagnosticAttentionDigest,
  type TrajectoryDiagnosticEscalationApplied,
  type TrajectoryDiagnosticEscalationProposal,
  type TrajectoryDiagnosticPattern,
} from "#modules/autonomy/trajectory-diagnostic-escalation.js";
import {
  workflowCommitOperation,
  workflowCommitValidationOperation,
} from "#modules/autonomy/workflow-commit-operations.js";
import {
  inspectTrajectoryDiagnosticPatternsOperation,
  type TrajectoryDiagnosticInspection,
  type TrajectoryDiagnosticThresholds,
} from "./inspection.js";
import {
  applyTrajectoryDiagnosticTasksOperation,
  proposeTrajectoryDiagnosticTasksOperation,
} from "./task-operations.js";

type Thresholds = TrajectoryDiagnosticThresholds;
type Inspection = TrajectoryDiagnosticInspection;

type ProposalOutput = {
  proposals: TrajectoryDiagnosticEscalationProposal[];
};

type ApplyOutput = {
  applied: TrajectoryDiagnosticEscalationApplied[];
};

export type TrajectoryDiagnosticEscalationArtifact = {
  generatedAt: string;
  thresholds: Thresholds;
  patterns: TrajectoryDiagnosticPattern[];
  proposals: TrajectoryDiagnosticEscalationProposal[];
  applied: TrajectoryDiagnosticEscalationApplied[];
};

const inspectPatterns = typedCodeStep<Inspection>({
  id: "inspect-patterns",
  type: "code",
  when: onNormalTrigger,
  validate: (raw) =>
    expectStructuredOutput<Inspection>(raw, [
      "dirty",
      "status",
      "patterns",
      "thresholds",
    ]),
  run: ({ projectDir, runBlocking }) =>
    runBlocking(inspectTrajectoryDiagnosticPatternsOperation, { projectDir }),
});

const proposeTasks = typedCodeStep<ProposalOutput>({
  id: "propose-tasks",
  type: "code",
  when: (ctx) => {
    const inspection = inspectPatterns.output(ctx);
    return Boolean(
      inspection && !inspection.dirty && inspection.patterns.length > 0,
    );
  },
  validate: (raw) => expectStructuredOutput<ProposalOutput>(raw, ["proposals"]),
  run: (ctx) => {
    const inspection = inspectPatterns.outputRequired(ctx);
    return ctx.runBlocking(proposeTrajectoryDiagnosticTasksOperation, {
      projectDir: ctx.projectDir,
      patterns: inspection.patterns,
    });
  },
});

const applyTasks = typedCodeStep<ApplyOutput>({
  id: "apply-tasks",
  type: "code",
  when: (ctx) => proposeTasks.output(ctx) !== undefined,
  validate: (raw) => expectStructuredOutput<ApplyOutput>(raw, ["applied"]),
  run: (ctx) => {
    return ctx.runBlocking(applyTrajectoryDiagnosticTasksOperation, {
      projectDir: ctx.projectDir,
      proposals: proposeTasks.outputRequired(ctx).proposals,
      nowIso: new Date().toISOString(),
    });
  },
});

const writeArtifact = typedCodeStep<{ written: boolean; path: string }>({
  id: "write-artifact",
  type: "code",
  when: (ctx) => (inspectPatterns.output(ctx)?.patterns.length ?? 0) > 0,
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean; path: string }>(raw, [
      "written",
      "path",
    ]),
  run: (ctx) => {
    const inspection = inspectPatterns.outputRequired(ctx);
    const proposals = proposeTasks.output(ctx)?.proposals ?? [];
    const applied = applyTasks.output(ctx)?.applied ?? [];
    const artifact: TrajectoryDiagnosticEscalationArtifact = {
      generatedAt: new Date().toISOString(),
      thresholds: inspection.thresholds,
      patterns: inspection.patterns,
      proposals,
      applied,
    };
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    const artifactPath = join(
      ctx.workflow.runDirPath,
      "trajectory-diagnostic-escalation.json",
    );
    writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    return { written: true, path: artifactPath };
  },
});

function actionLandedOnDisk(
  applied: TrajectoryDiagnosticEscalationApplied,
): boolean {
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
      `trajectory-diagnostic-escalator: ${subjects.join(", ")}`,
      "",
      "Escalated recurring workflow trajectory-diagnostic patterns into repair tasks.",
    ].join("\n");
    writeFileSync(
      join(ctx.workflow.runDirPath, "commit-message.txt"),
      `${message}\n`,
    );
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

const trajectoryDiagnosticEscalator: WorkflowDefinitionInput = {
  name: "trajectory-diagnostic-escalator",
  description:
    "Detect recurring workflow trajectory-diagnostic warnings and open or refresh evidence-backed repair tasks.",
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
          workflowName: "trajectory-diagnostic-escalator",
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
      when: (ctx) => (inspectPatterns.output(ctx)?.patterns.length ?? 0) > 0,
      event: "workflow.attention.digest",
      payload: (ctx) => {
        const inspection = inspectPatterns.outputRequired(ctx);
        const appliedByPattern = new Map(
          (applyTasks.output(ctx)?.applied ?? []).map((applied) => [
            applied.patternFingerprint,
            applied,
          ]),
        );
        return buildTrajectoryDiagnosticAttentionDigest(
          inspection.patterns.map((pattern) => {
            const applied = appliedByPattern.get(pattern.fingerprint);
            return {
              workflow: pattern.workflow,
              stepId: pattern.stepId,
              code: pattern.code,
              taskId: pattern.taskId,
              action: applied?.kind ?? "skipped",
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
        "trajectory-diagnostic-escalator committed trajectory diagnostic repair task changes",
      requires: ["commit"],
    },
  ],
};

export default trajectoryDiagnosticEscalator;
