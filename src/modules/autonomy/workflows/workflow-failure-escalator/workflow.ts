/**
 * Persistent workflow failure escalation.
 *
 * Monitored workflow completions can reveal local, repeated failure patterns
 * that are too deterministic to leave only in improver context. This workflow
 * reads recent run metadata, opens or refreshes one repair task per stable
 * non-infrastructure pattern, and emits an attention digest item naming the
 * generated task id.
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
  workflowCommitOperation,
  workflowCommitValidationOperation,
} from "#modules/autonomy/workflow-commit-operations.js";
import {
  buildWorkflowFailureAttentionDigest,
  type WorkflowFailureEscalationApplied,
  type WorkflowFailureEscalationProposal,
  type WorkflowFailurePattern,
} from "#modules/autonomy/workflow-failure-escalation.js";
import {
  inspectWorkflowFailurePatternsOperation,
  type WorkflowFailureInspection,
  type WorkflowFailureThresholds,
} from "./inspection.js";
import {
  applyWorkflowFailureTasksOperation,
  proposeWorkflowFailureTasksOperation,
} from "./task-operations.js";

type Thresholds = WorkflowFailureThresholds;
type Inspection = WorkflowFailureInspection;

type ProposalOutput = {
  proposals: WorkflowFailureEscalationProposal[];
};

type ApplyOutput = {
  applied: WorkflowFailureEscalationApplied[];
};

export type WorkflowFailureEscalationArtifact = {
  generatedAt: string;
  thresholds: Thresholds;
  patterns: WorkflowFailurePattern[];
  proposals: WorkflowFailureEscalationProposal[];
  applied: WorkflowFailureEscalationApplied[];
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
    runBlocking(inspectWorkflowFailurePatternsOperation, { projectDir }),
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
    return ctx.runBlocking(proposeWorkflowFailureTasksOperation, {
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
    return ctx.runBlocking(applyWorkflowFailureTasksOperation, {
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
    const artifact: WorkflowFailureEscalationArtifact = {
      generatedAt: new Date().toISOString(),
      thresholds: inspection.thresholds,
      patterns: inspection.patterns,
      proposals,
      applied,
    };
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    const artifactPath = join(
      ctx.workflow.runDirPath,
      "workflow-failure-escalation.json",
    );
    writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    return { written: true, path: artifactPath };
  },
});

function actionLandedOnDisk(applied: WorkflowFailureEscalationApplied): boolean {
  return (
    applied.kind === "created" ||
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
      `workflow-failure-escalator: ${subjects.join(", ")}`,
      "",
      "Escalated persistent non-infrastructure workflow failure patterns into repair tasks.",
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

const workflowFailureEscalator: WorkflowDefinitionInput = {
  name: "workflow-failure-escalator",
  description:
    "Detect persistent non-infrastructure workflow failures and open or refresh evidence-backed repair tasks.",
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
          workflowName: "workflow-failure-escalator",
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
        return buildWorkflowFailureAttentionDigest(
          inspection.patterns.map((pattern) => {
            const applied = appliedByPattern.get(pattern.fingerprint);
            return {
              workflow: pattern.workflow,
              taskId: pattern.taskId,
              action: applied?.kind ?? "skipped",
              kind: pattern.kind,
              signal: pattern.signalLabel,
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
      reason: "workflow-failure-escalator committed workflow repair task changes",
      requires: ["commit"],
    },
  ],
};

export default workflowFailureEscalator;
