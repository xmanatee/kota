import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import {
  AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
  type AutonomyIssueProjection,
  decodeAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import { taskQueueValidationOperation } from "#modules/repo-tasks/task-queue-validation-operation.js";
import { collectProgressReviewGitEvidence } from "./progress-review/git-evidence.js";
import {
  collectProgressReviewEvidenceOperation,
  compactProgressReviewEvidenceForAgent,
  decodeProgressReviewAgentOutputForEvidence,
  digestProgressReviewEvidencePacket,
  PROGRESS_REVIEW_EVIDENCE_ARTIFACT,
  type ProgressReviewActionResult,
  type ProgressReviewAgentEvidencePacket,
  type ProgressReviewArtifact,
  type ProgressReviewEvidenceHandle,
  type ProgressReviewEvidencePacket,
  progressReviewActionOperation,
  readProgressReviewEvidencePacketFromHandle,
  validateProgressReviewAgentEvidencePacket,
  validateProgressReviewEvidenceHandle,
  writeProgressReviewArtifact,
} from "./progress-review.js";
import {
  inspectProgressReviewSemanticInput,
  type ProgressReviewSemanticInput,
} from "./semantic-input.js";

export const REVIEW_AGENT_TIMEOUT_MS = 30 * 60 * 1000;
export const agent: AgentDef = {
  name: "progress-reviewer",
  role: "Assess a semantic strategic boundary against canonical scoped state and return structured steering recommendations.",
  promptPath: "src/modules/autonomy/workflows/progress-reviewer/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  writeScope: "deny-all",
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
  run: ({ scopeDir, state, trigger }) =>
    inspectProgressReviewSemanticInput({ scopeDir, state, trigger }),
});

export const collectEvidence = typedCodeStep<ProgressReviewEvidenceHandle>({
  id: "collect-evidence",
  type: "code",
  when: (ctx) =>
    inspectSemanticInput.output(ctx)?.shouldReview === true,
  validate: validateProgressReviewEvidenceHandle,
  run: async (ctx) => {
    const { projectDir, scopeDir, stateDir, trigger, workflow } = ctx;
    const now = new Date();
    const gitEvidenceByScope = await collectProgressReviewGitEvidence({
      projectDir,
      scopeDir,
      stateDir,
      trigger,
      now,
      runCommand: ctx.runCommand,
    });
    const packet = await ctx.runBlocking(collectProgressReviewEvidenceOperation, {
      projectDir,
      scopeDir,
      stateDir,
      trigger,
      nowIso: now.toISOString(),
      semanticInput: inspectSemanticInput.outputRequired(ctx),
      gitEvidenceByScope,
      autonomyIssueProjection: decodeAutonomyIssueProjection(
        ctx.state.read<AutonomyIssueProjection>(
          AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
        ).value,
      ),
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
  when: stepSucceeded("review-evidence"),
  validate: (raw) =>
    expectStructuredOutput<ProgressReviewActionResult>(raw, [
      "createdTaskIds",
      "ownerQuestionIds",
      "applied",
      "touchedTaskQueue",
    ]),
  run: async (ctx) => {
    const evidence = readProgressReviewEvidencePacket(ctx);
    return ctx.runBlocking(progressReviewActionOperation, {
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

export const validateChanges = typedCodeStep<{ ok: true }>({
  id: "validate-changes",
  type: "code",
  when: (ctx) => writeCommitMessage.output(ctx)?.written === true,
  validate: (raw) => {
    const obj = expectStructuredOutput<{ ok: true }>(raw, ["ok"]);
    if (obj.ok !== true) throw new Error(`expected ok: true, got ${String(obj.ok)}`);
    return obj;
  },
  run: async (ctx) => {
    await ctx.runBlocking(taskQueueValidationOperation, {
      projectDir: ctx.projectDir,
    });
    await ctx.runCommand({
      command: "pnpm",
      args: ["run", "validate-tasks"],
      cwd: ctx.projectDir,
    });
    return { ok: true } as const;
  },
});

export function needsAttention(actions: ProgressReviewActionResult): boolean {
  return actions.applied.some((action) =>
    action.kind === "created-task" ||
    action.kind === "updated-task" ||
    action.kind === "owner-question" ||
    action.kind === "updated-owner-question" ||
    action.kind === "owner-question-pending"
  );
}
