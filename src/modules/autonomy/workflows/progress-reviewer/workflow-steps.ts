import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import {
  checkCommitStageable,
  commitWorkflowChanges,
} from "#modules/autonomy/commit.js";
import {
  decodeWorkflowCommitOutcome,
  type WorkflowCommitOutcome,
} from "#modules/autonomy/commit-result.js";
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
  digestProgressReviewEvidencePacket,
  PROGRESS_REVIEW_EVIDENCE_ARTIFACT,
  type ProgressReviewActionResult,
  type ProgressReviewAgentEvidencePacket,
  type ProgressReviewArtifact,
  type ProgressReviewEvidenceHandle,
  type ProgressReviewEvidencePacket,
  readProgressReviewEvidencePacketFromHandle,
  validateProgressReviewAgentEvidencePacket,
  validateProgressReviewEvidenceHandle,
  writeProgressReviewArtifact,
} from "./progress-review.js";
import {
  deferProgressReviewSemanticInput,
  inspectProgressReviewSemanticInput,
  type ProgressReviewSemanticInput,
  recordProgressReviewSemanticInput,
} from "./semantic-input.js";

export const REVIEW_AGENT_TIMEOUT_MS = 30 * 60 * 1000;
export const agent: AgentDef = {
  name: "progress-reviewer",
  role: "Assess a semantic strategic boundary against canonical scoped state and return structured steering recommendations.",
  promptPath: "src/modules/autonomy/workflows/progress-reviewer/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  writeScope: "deny-all",
};

type WorktreeInspection = {
  dirty: boolean;
};

function writeProgressReviewEvidencePacket(
  runDirPath: string,
  packet: ProgressReviewEvidencePacket,
): ProgressReviewEvidenceHandle {
  const artifactPath = join(runDirPath, PROGRESS_REVIEW_EVIDENCE_ARTIFACT);
  writeJsonFileAtomic(artifactPath, packet);
  return {
    generatedAt: packet.generatedAt,
    artifact: PROGRESS_REVIEW_EVIDENCE_ARTIFACT,
    artifactPath,
    contentSha256: digestProgressReviewEvidencePacket(packet),
  };
}

function readProgressReviewEvidencePacket(
  ctx: WorkflowStepContext,
): ProgressReviewEvidencePacket {
  return readProgressReviewEvidencePacketFromHandle(
    collectEvidence.outputRequired(ctx),
  );
}

export const inspectSemanticInput = typedCodeStep<ProgressReviewSemanticInput>({
  id: "inspect-semantic-input",
  type: "code",
  when: onNormalTrigger,
  validate: (raw) =>
    expectStructuredOutput<ProgressReviewSemanticInput>(raw, [
      "automatic",
      "shouldReview",
      "boundary",
      "inputRevision",
      "evidenceRefs",
      "reason",
      "deliveryAttempt",
    ]),
  run: ({ projectDir, trigger }) =>
    inspectProgressReviewSemanticInput({ projectDir, trigger }),
});

export const inspectWorktree = typedCodeStep<WorktreeInspection>({
  id: "inspect-worktree",
  type: "code",
  when: (ctx) =>
    onNormalTrigger(ctx) &&
    inspectSemanticInput.output(ctx)?.shouldReview === true,
  validate: (raw) => expectStructuredOutput<WorktreeInspection>(raw, ["dirty"]),
  run: ({ projectDir }) => {
    const worktree = getRepoWorktreeStatus(projectDir);
    return { dirty: worktree.available && worktree.dirty };
  },
});

export const deferSemanticInput = typedCodeStep<{ deferred: true }>({
  id: "defer-semantic-input",
  type: "code",
  when: (ctx) => {
    const input = inspectSemanticInput.output(ctx);
    return onNormalTrigger(ctx) &&
      input?.automatic === true &&
      input.shouldReview &&
      inspectWorktree.output(ctx)?.dirty === true;
  },
  validate: (raw) => {
    const output = expectStructuredOutput<{ deferred: true }>(raw, ["deferred"]);
    if (output.deferred !== true) {
      throw new Error("expected deferred progress semantic input");
    }
    return output;
  },
  run: (ctx) => {
    deferProgressReviewSemanticInput({
      projectDir: ctx.projectDir,
      input: inspectSemanticInput.outputRequired(ctx),
    });
    return { deferred: true } as const;
  },
});

export const collectEvidence = typedCodeStep<ProgressReviewEvidenceHandle>({
  id: "collect-evidence",
  type: "code",
  when: (ctx) =>
    onNormalTrigger(ctx) &&
    inspectSemanticInput.output(ctx)?.shouldReview === true,
  validate: validateProgressReviewEvidenceHandle,
  run: (ctx) => {
    const { projectDir, stateDir, eventJournal, trigger, workflow } = ctx;
    const packet = collectProgressReviewEvidence({
      projectDir,
      stateDir,
      eventJournal,
      trigger,
      now: new Date(),
      semanticInput: inspectSemanticInput.outputRequired(ctx),
    });
    return writeProgressReviewEvidencePacket(workflow.runDirPath, packet);
  },
});

export const prepareReviewInput = typedCodeStep<ProgressReviewAgentEvidencePacket>({
  id: "prepare-review-input",
  type: "code",
  when: stepSucceeded("collect-evidence"),
  exposeOutputToAgent: true,
  validate: validateProgressReviewAgentEvidencePacket,
  run: (ctx) =>
    compactProgressReviewEvidenceForAgent(readProgressReviewEvidencePacket(ctx)),
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
  run: (ctx) => {
    const evidence = readProgressReviewEvidencePacket(ctx);
    return applyProgressReviewActions({
      projectDir: ctx.projectDir,
      runId: ctx.workflow.runId,
      evidence,
      review: decodeProgressReviewAgentOutputForEvidence(
        ctx.stepOutputs["review-evidence"],
        prepareReviewInput.outputRequired(ctx),
        evidence,
      ),
    });
  },
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
    expectStructuredOutput<{ written: boolean; path: string }>(raw, ["written", "path"]),
  run: (ctx) => {
    const reviewInput = prepareReviewInput.outputRequired(ctx);
    const evidence = readProgressReviewEvidencePacket(ctx);
    const artifact: ProgressReviewArtifact = {
      generatedAt: new Date().toISOString(),
      evidence,
      reviewInput,
      review: decodeProgressReviewAgentOutputForEvidence(
        ctx.stepOutputs["review-evidence"],
        reviewInput,
        evidence,
      ),
      actions: applyActions.output(ctx) ?? emptyActions(),
    };
    const artifactPath = writeProgressReviewArtifact(ctx.workflow.runDirPath, artifact, {
      runId: ctx.workflow.runId,
      workflow: ctx.workflow.name,
    });
    recordProgressReviewSemanticInput({
      projectDir: ctx.projectDir,
      input: inspectSemanticInput.outputRequired(ctx),
      consumedAt: artifact.generatedAt,
    });
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
    writeFileSync(join(ctx.workflow.runDirPath, "commit-message.txt"), `${lines.join("\n")}\n`);
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
  run: async (ctx) => {
    assertTaskQueueValid(ctx.projectDir, { minReady: 0 });
    await runCheck("pnpm run validate-tasks", ctx.projectDir, { signal: ctx.signal });
    checkNoScratchArtifacts(ctx.projectDir);
    checkCommitStageable(ctx.projectDir);
    checkCommitMessageExists(ctx.workflow.runDirPath, ctx.projectDir);
    return { ok: true } as const;
  },
});

export const commitChanges = typedCodeStep<WorkflowCommitOutcome>({
  id: "commit",
  type: "code",
  when: (ctx) => validateBeforeCommit.output(ctx)?.ok === true,
  validate: decodeWorkflowCommitOutcome,
  run: ({ projectDir, workflow }) =>
    commitWorkflowChanges(projectDir, workflow.runDirPath),
});

export function needsAttention(actions: ProgressReviewActionResult): boolean {
  return actions.applied.some((action) =>
    action.kind === "created-task" ||
    action.kind === "updated-task" ||
    action.kind === "owner-question" ||
    action.kind === "updated-owner-question"
  );
}
