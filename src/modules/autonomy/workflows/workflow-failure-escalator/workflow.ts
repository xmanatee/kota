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
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { checkCommitStageable, commitWorkflowChanges } from "#modules/autonomy/commit.js";
import {
  onNormalTrigger,
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepCommitted,
} from "#modules/autonomy/shared.js";
import {
  applyWorkflowFailureEscalation,
  buildWorkflowFailureAttentionDigest,
  DEFAULT_CONSECUTIVE_FAILURE_RUNS,
  DEFAULT_FAILURE_RATE_MIN_RUNS,
  DEFAULT_FAILURE_RATE_MIN_WINDOW_MS,
  DEFAULT_REPEATED_WARNING_RUNS,
  detectPersistentWorkflowFailurePatterns,
  proposeWorkflowFailureEscalation,
  type WorkflowFailureEscalationApplied,
  type WorkflowFailureEscalationProposal,
  type WorkflowFailurePattern,
} from "#modules/autonomy/workflow-failure-escalation.js";

type Thresholds = {
  consecutiveFailureRuns: number;
  failureRateMinRuns: number;
  failureRateMinWindowMs: number;
  repeatedWarningRuns: number;
};

type Inspection = {
  dirty: boolean;
  status: "dirty" | "none" | "patterns-detected";
  patterns: WorkflowFailurePattern[];
  thresholds: Thresholds;
};

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

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isSafeInteger(raw) || raw <= 0) return fallback;
  return raw;
}

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
  run: ({ projectDir }) => {
    const worktree = getRepoWorktreeStatus(projectDir);
    const dirty = worktree.available && worktree.trackedDirty;
    const thresholds = {
      consecutiveFailureRuns: readPositiveIntegerEnv(
        "KOTA_WORKFLOW_FAILURE_CONSECUTIVE_RUNS",
        DEFAULT_CONSECUTIVE_FAILURE_RUNS,
      ),
      failureRateMinRuns: readPositiveIntegerEnv(
        "KOTA_WORKFLOW_FAILURE_RATE_MIN_RUNS",
        DEFAULT_FAILURE_RATE_MIN_RUNS,
      ),
      failureRateMinWindowMs:
        readPositiveIntegerEnv(
          "KOTA_WORKFLOW_FAILURE_RATE_MIN_DAYS",
          DEFAULT_FAILURE_RATE_MIN_WINDOW_MS / (24 * 60 * 60 * 1000),
        ) *
        24 *
        60 *
        60 *
        1000,
      repeatedWarningRuns: readPositiveIntegerEnv(
        "KOTA_WORKFLOW_FAILURE_WARNING_RUNS",
        DEFAULT_REPEATED_WARNING_RUNS,
      ),
    };
    const patterns = detectPersistentWorkflowFailurePatterns(
      join(projectDir, ".kota", "runs"),
      {
        consecutiveFailureRuns: thresholds.consecutiveFailureRuns,
        failureRateMinRuns: thresholds.failureRateMinRuns,
        failureRateMinWindowMs: thresholds.failureRateMinWindowMs,
        repeatedWarningRuns: thresholds.repeatedWarningRuns,
      },
    );
    return {
      dirty,
      status: dirty
        ? "dirty"
        : patterns.length > 0
          ? "patterns-detected"
          : "none",
      patterns,
      thresholds,
    };
  },
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
    return {
      proposals: inspection.patterns.map((pattern) =>
        proposeWorkflowFailureEscalation(ctx.projectDir, pattern)
      ),
    };
  },
});

const applyTasks = typedCodeStep<ApplyOutput>({
  id: "apply-tasks",
  type: "code",
  when: (ctx) => proposeTasks.output(ctx) !== undefined,
  validate: (raw) => expectStructuredOutput<ApplyOutput>(raw, ["applied"]),
  run: (ctx) => {
    const proposals = proposeTasks.outputRequired(ctx).proposals;
    return {
      applied: proposals.map((proposal) =>
        applyWorkflowFailureEscalation(proposal, {
          projectDir: ctx.projectDir,
          nowIso: new Date().toISOString(),
        })
      ),
    };
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
  run: (ctx) => {
    runCheck("pnpm run validate-tasks", ctx.projectDir);
    checkNoScratchArtifacts(ctx.projectDir);
    checkCommitStageable(ctx.projectDir);
    checkCommitMessageExists(ctx.workflow.runDirPath, ctx.projectDir);
    return { ok: true } as const;
  },
});

const commitChanges = typedCodeStep<{ committed: boolean }>({
  id: "commit",
  type: "code",
  when: (ctx) => validateBeforeCommit.output(ctx)?.ok === true,
  validate: (raw) =>
    expectStructuredOutput<{ committed: boolean }>(raw, ["committed"]),
  run: ({ projectDir, workflow }) => {
    const result = commitWorkflowChanges(projectDir, workflow.runDirPath);
    return { committed: Boolean(result.committed) };
  },
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
      run: ({ projectDir }) =>
        resetWorktreeForRecovery({
          projectDir,
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
      when: stepCommitted("commit"),
      reason: "workflow-failure-escalator committed workflow repair task changes",
      requires: ["commit"],
    },
  ],
};

export default workflowFailureEscalator;
