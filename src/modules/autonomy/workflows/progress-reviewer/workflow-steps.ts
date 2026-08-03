import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import { readOptionalJsonFile, writeJsonFileAtomic } from "#core/util/json-file.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import {
  type CodeStepOutputValidator,
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
  PROGRESS_REVIEW_EVIDENCE_ARTIFACT,
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

type ProgressReviewEvidenceHandle = {
  generatedAt: string;
  artifact: typeof PROGRESS_REVIEW_EVIDENCE_ARTIFACT;
  artifactPath: string;
};

const validateProgressReviewEvidencePacket: CodeStepOutputValidator<
  ProgressReviewEvidencePacket
> = (raw) => {
  return expectStructuredOutput<ProgressReviewEvidencePacket>(raw, [
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
  ]);
};

const validateProgressReviewEvidenceHandle: CodeStepOutputValidator<
  ProgressReviewEvidenceHandle
> = (raw) => {
  const handle = expectStructuredOutput<ProgressReviewEvidenceHandle>(raw, [
    "generatedAt",
    "artifact",
    "artifactPath",
  ]);
  if (handle.artifact !== PROGRESS_REVIEW_EVIDENCE_ARTIFACT) {
    throw new Error(
      `unexpected progress-review evidence artifact ${String(handle.artifact)}`,
    );
  }
  if (typeof handle.generatedAt !== "string" || !handle.generatedAt.trim()) {
    throw new Error("progress-review evidence generatedAt must be non-empty");
  }
  if (typeof handle.artifactPath !== "string" || !handle.artifactPath.trim()) {
    throw new Error("progress-review evidence artifactPath must be non-empty");
  }
  return handle;
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
  };
}

function readProgressReviewEvidencePacket(
  ctx: WorkflowStepContext,
): ProgressReviewEvidencePacket {
  const handle = collectEvidence.outputRequired(ctx);
  const raw = readOptionalJsonFile<unknown>(handle.artifactPath);
  if (raw === null) {
    throw new Error(
      `progress-review evidence artifact is missing: ${handle.artifactPath}`,
    );
  }
  return validateProgressReviewEvidencePacket(raw);
}

export const inspectWorktree = typedCodeStep<WorktreeInspection>({
  id: "inspect-worktree",
  type: "code",
  when: onNormalTrigger,
  validate: (raw) => expectStructuredOutput<WorktreeInspection>(raw, ["dirty"]),
  run: ({ projectDir }) => {
    const worktree = getRepoWorktreeStatus(projectDir);
    return { dirty: worktree.available && worktree.dirty };
  },
});

export const collectEvidence = typedCodeStep<ProgressReviewEvidenceHandle>({
  id: "collect-evidence",
  type: "code",
  when: onNormalTrigger,
  validate: validateProgressReviewEvidenceHandle,
  run: ({ projectDir, stateDir, eventJournal, trigger, workflow }) => {
    const packet = collectProgressReviewEvidence({
      projectDir,
      stateDir,
      eventJournal,
      trigger,
      now: new Date(),
    });
    return writeProgressReviewEvidencePacket(workflow.runDirPath, packet);
  },
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
    expectStructuredOutput<{ written: boolean; path: string }>(raw, [
      "written",
      "path",
    ]),
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

export function needsAttention(review: ProgressReviewAgentOutput): boolean {
  return review.verdict === "needs-steering" || review.verdict === "blocked";
}
