import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import { checkCommitStageable, commitWorkflowChanges } from "#modules/autonomy/commit.js";
import { onNormalTrigger } from "#modules/autonomy/recovery.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import { assertTaskQueueValid } from "#modules/repo-tasks/task-queue-validation.js";
import {
  applyProgressReviewActions,
  collectProgressReviewEvidence,
  compactProgressReviewEvidenceForAgent,
  decodeProgressReviewAgentOutputForEvidence,
  type ProgressReviewActionResult,
  type ProgressReviewAgentEvidencePacket,
  type ProgressReviewAgentOutput,
  type ProgressReviewArtifact,
  type ProgressReviewEvidencePacket,
  writeProgressReviewArtifact,
} from "./progress-review.js";

export const REVIEW_AGENT_TIMEOUT_MS = 30 * 60 * 1000;

export const agent: AgentDef = {
  name: "progress-reviewer",
  role: "Assess bounded scoped activity evidence and return structured steering recommendations.",
  promptPath: "src/modules/autonomy/workflows/progress-reviewer/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  writeScope: [".kota/runs/"],
};

type WorktreeInspection = {
  dirty: boolean;
};

export const inspectWorktree = typedCodeStep<WorktreeInspection>({
  id: "inspect-worktree",
  type: "code",
  when: onNormalTrigger,
  validate: (raw) => expectStructuredOutput<WorktreeInspection>(raw, ["dirty"]),
  run: ({ projectDir }) => {
    const worktree = getRepoWorktreeStatus(projectDir);
    return { dirty: worktree.available && worktree.trackedDirty };
  },
});

export const collectEvidence = typedCodeStep<ProgressReviewEvidencePacket>({
  id: "collect-evidence",
  type: "code",
  when: onNormalTrigger,
  validate: (raw) =>
    expectStructuredOutput<ProgressReviewEvidencePacket>(raw, [
      "generatedAt",
      "triggerKind",
      "triggerEvent",
      "scope",
      "window",
      "scopes",
      "evidence",
      "approvals",
      "excluded",
      "taskClassDistribution",
      "operatorJourneyRisks",
    ]),
  run: ({ projectDir, stateDir, eventJournal, trigger }) =>
    collectProgressReviewEvidence({
      projectDir,
      stateDir,
      eventJournal,
      trigger,
      now: new Date(),
    }),
});

export const prepareReviewInput = typedCodeStep<ProgressReviewAgentEvidencePacket>({
  id: "prepare-review-input",
  type: "code",
  when: stepSucceeded("collect-evidence"),
  exposeOutputToAgent: true,
  validate: (raw) =>
    expectStructuredOutput<ProgressReviewAgentEvidencePacket>(raw, [
      "generatedAt",
      "triggerKind",
      "triggerEvent",
      "scope",
      "window",
      "batch",
      "scopes",
      "counts",
      "deadLetterCounts",
      "operatorJourneyRisks",
      "evidence",
      "excluded",
    ]),
  run: (ctx) =>
    compactProgressReviewEvidenceForAgent(collectEvidence.outputRequired(ctx)),
});

export const applyActions = typedCodeStep<ProgressReviewActionResult>({
  id: "apply-actions",
  type: "code",
  when: (ctx) => {
    if (!stepSucceeded("review-evidence")(ctx)) return false;
    return inspectWorktree.output(ctx)?.dirty === false;
  },
  validate: (raw) =>
    expectStructuredOutput<ProgressReviewActionResult>(raw, [
      "createdTaskIds",
      "ownerQuestionIds",
      "applied",
      "touchedTaskQueue",
    ]),
  run: (ctx) =>
    applyProgressReviewActions({
      projectDir: ctx.projectDir,
      runId: ctx.workflow.runId,
      evidence: collectEvidence.outputRequired(ctx),
      review: decodeProgressReviewAgentOutputForEvidence(
        ctx.stepOutputs["review-evidence"],
        prepareReviewInput.outputRequired(ctx),
      ),
    }),
});

export function emptyActions(): ProgressReviewActionResult {
  return {
    createdTaskIds: [],
    ownerQuestionIds: [],
    applied: [],
    touchedTaskQueue: false,
  };
}

export const writeArtifact = typedCodeStep<{ written: boolean; path: string }>({
  id: "write-artifact",
  type: "code",
  when: stepSucceeded("review-evidence"),
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean; path: string }>(raw, [
      "written",
      "path",
    ]),
  run: (ctx) => {
    const reviewInput = prepareReviewInput.outputRequired(ctx);
    const artifact: ProgressReviewArtifact = {
      generatedAt: new Date().toISOString(),
      evidence: collectEvidence.outputRequired(ctx),
      reviewInput,
      review: decodeProgressReviewAgentOutputForEvidence(
        ctx.stepOutputs["review-evidence"],
        reviewInput,
      ),
      actions: applyActions.output(ctx) ?? emptyActions(),
    };
    const artifactPath = writeProgressReviewArtifact(ctx.workflow.runDirPath, artifact);
    return { written: true, path: artifactPath };
  },
});

export const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  when: (ctx) => applyActions.output(ctx)?.touchedTaskQueue === true,
  validate: (raw) => expectStructuredOutput<{ written: boolean }>(raw, ["written"]),
  run: (ctx) => {
    const actions = applyActions.outputRequired(ctx);
    const lines = [
      `progress-reviewer: create ${actions.createdTaskIds.length} follow-up task(s)`,
      "",
      ...actions.createdTaskIds.map((id) => `- create ${id}`),
    ];
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    writeFileSync(
      join(ctx.workflow.runDirPath, "commit-message.txt"),
      `${lines.join("\n")}\n`,
      "utf-8",
    );
    return { written: true };
  },
});

export const validateBeforeCommit = typedCodeStep<{ ok: true }>({
  id: "validate-before-commit",
  type: "code",
  when: (ctx) => writeCommitMessage.output(ctx)?.written === true,
  validate: (raw) => {
    const obj = expectStructuredOutput<{ ok: true }>(raw, ["ok"]);
    if (obj.ok !== true) throw new Error(`expected ok: true, got ${String(obj.ok)}`);
    return obj;
  },
  run: (ctx) => {
    assertTaskQueueValid(ctx.projectDir, { minReady: 0 });
    runCheck("pnpm run validate-tasks", ctx.projectDir);
    checkNoScratchArtifacts(ctx.projectDir);
    checkCommitStageable(ctx.projectDir);
    checkCommitMessageExists(ctx.workflow.runDirPath, ctx.projectDir);
    return { ok: true } as const;
  },
});

export const commitChanges = typedCodeStep<{ committed: boolean }>({
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

export function needsAttention(review: ProgressReviewAgentOutput): boolean {
  return review.verdict === "needs-steering" || review.verdict === "blocked";
}
