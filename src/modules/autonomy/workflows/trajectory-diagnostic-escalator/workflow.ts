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
  applyTrajectoryDiagnosticEscalation,
  buildTrajectoryDiagnosticAttentionDigest,
  DEFAULT_TRAJECTORY_DIAGNOSTIC_PATTERN_RUNS,
  DEFAULT_TRAJECTORY_DIAGNOSTIC_WINDOW_MS,
  detectRecurringTrajectoryDiagnosticPatterns,
  proposeTrajectoryDiagnosticEscalation,
  type TrajectoryDiagnosticEscalationApplied,
  type TrajectoryDiagnosticEscalationProposal,
  type TrajectoryDiagnosticPattern,
} from "#modules/autonomy/trajectory-diagnostic-escalation.js";

type Thresholds = {
  thresholdRuns: number;
  windowMs: number;
};

type Inspection = {
  dirty: boolean;
  status: "dirty" | "none" | "patterns-detected";
  patterns: TrajectoryDiagnosticPattern[];
  thresholds: Thresholds;
};

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
    const thresholdRuns = readPositiveIntegerEnv(
      "KOTA_TRAJECTORY_DIAGNOSTIC_PATTERN_RUNS",
      DEFAULT_TRAJECTORY_DIAGNOSTIC_PATTERN_RUNS,
    );
    const windowMs =
      readPositiveIntegerEnv(
        "KOTA_TRAJECTORY_DIAGNOSTIC_WINDOW_DAYS",
        DEFAULT_TRAJECTORY_DIAGNOSTIC_WINDOW_MS / (24 * 60 * 60 * 1000),
      ) *
      24 *
      60 *
      60 *
      1000;
    const patterns = detectRecurringTrajectoryDiagnosticPatterns(
      join(projectDir, ".kota", "runs"),
      { thresholdRuns, windowMs },
    );
    return {
      dirty,
      status: dirty
        ? "dirty"
        : patterns.length > 0
          ? "patterns-detected"
          : "none",
      patterns,
      thresholds: { thresholdRuns, windowMs },
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
        proposeTrajectoryDiagnosticEscalation(ctx.projectDir, pattern)
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
        applyTrajectoryDiagnosticEscalation(proposal, {
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
      run: ({ projectDir }) =>
        resetWorktreeForRecovery({
          projectDir,
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
      when: stepCommitted("commit"),
      reason:
        "trajectory-diagnostic-escalator committed trajectory diagnostic repair task changes",
      requires: ["commit"],
    },
  ],
};

export default trajectoryDiagnosticEscalator;
