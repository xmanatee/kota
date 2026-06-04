import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { JsonSchemaObject } from "#core/util/json-schema-validator.js";
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
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HARNESS,
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepCommitted,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import { inboundSignalReceived } from "#modules/inbound-signals/events.js";
import { assertTaskQueueValid } from "#modules/repo-tasks/task-queue-validation.js";
import { progressReviewRequested } from "./events.js";
import {
  applyProgressReviewActions,
  collectProgressReviewEvidence,
  decodeProgressReviewAgentOutput,
  decodeProgressReviewAgentOutputForEvidence,
  type ProgressReviewActionResult,
  type ProgressReviewAgentOutput,
  type ProgressReviewArtifact,
  type ProgressReviewEvidencePacket,
  writeProgressReviewArtifact,
} from "./progress-review.js";

const REVIEW_AGENT_TIMEOUT_MS = 30 * 60 * 1000;
const PROGRESS_REVIEW_SCHEDULE_EVENT = "autonomy.progress-review.scheduled";

const progressReviewOutputSchema = {
  type: "object",
  required: ["verdict", "summary", "claims", "followUpTasks", "ownerQuestions"],
  additionalProperties: false,
  properties: {
    verdict: { type: "string" },
    summary: { type: "string" },
    claims: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "claim", "evidenceIds", "confidence"],
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          claim: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } },
          confidence: { type: "string" },
        },
      },
    },
    followUpTasks: {
      type: "array",
      items: {
        type: "object",
        required: [
          "title",
          "summary",
          "priority",
          "area",
          "evidenceIds",
          "acceptanceEvidence",
        ],
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          priority: { type: "string" },
          area: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } },
          acceptanceEvidence: { type: "string" },
        },
      },
    },
    ownerQuestions: {
      type: "array",
      items: {
        type: "object",
        required: ["question", "reason", "evidenceIds"],
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          reason: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } },
          proposedAnswers: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} satisfies JsonSchemaObject;

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

const inspectWorktree = typedCodeStep<WorktreeInspection>({
  id: "inspect-worktree",
  type: "code",
  when: onNormalTrigger,
  validate: (raw) => expectStructuredOutput<WorktreeInspection>(raw, ["dirty"]),
  run: ({ projectDir }) => {
    const worktree = getRepoWorktreeStatus(projectDir);
    return { dirty: worktree.available && worktree.trackedDirty };
  },
});

const collectEvidence = typedCodeStep<ProgressReviewEvidencePacket>({
  id: "collect-evidence",
  type: "code",
  when: onNormalTrigger,
  exposeOutputToAgent: true,
  validate: (raw) =>
    expectStructuredOutput<ProgressReviewEvidencePacket>(raw, [
      "generatedAt",
      "triggerKind",
      "scope",
      "window",
      "evidence",
      "approvals",
      "excluded",
    ]),
  run: ({ projectDir, trigger }) =>
    collectProgressReviewEvidence({
      projectDir,
      trigger,
      now: new Date(),
    }),
});

const applyActions = typedCodeStep<ProgressReviewActionResult>({
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
        collectEvidence.outputRequired(ctx),
      ),
    }),
});

function emptyActions(): ProgressReviewActionResult {
  return {
    createdTaskIds: [],
    ownerQuestionIds: [],
    applied: [],
    touchedTaskQueue: false,
  };
}

const writeArtifact = typedCodeStep<{ written: boolean; path: string }>({
  id: "write-artifact",
  type: "code",
  when: stepSucceeded("review-evidence"),
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean; path: string }>(raw, [
      "written",
      "path",
    ]),
  run: (ctx) => {
    const artifact: ProgressReviewArtifact = {
      generatedAt: new Date().toISOString(),
      evidence: collectEvidence.outputRequired(ctx),
      review: decodeProgressReviewAgentOutputForEvidence(
        ctx.stepOutputs["review-evidence"],
        collectEvidence.outputRequired(ctx),
      ),
      actions: applyActions.output(ctx) ?? emptyActions(),
    };
    const artifactPath = writeProgressReviewArtifact(ctx.workflow.runDirPath, artifact);
    return { written: true, path: artifactPath };
  },
});

const writeCommitMessage = typedCodeStep<{ written: boolean }>({
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
    assertTaskQueueValid(ctx.projectDir, { minReady: 0 });
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

function needsAttention(review: ProgressReviewAgentOutput): boolean {
  return review.verdict === "needs-steering" || review.verdict === "blocked";
}

const progressReviewerWorkflow: WorkflowDefinitionInput = {
  name: "progress-reviewer",
  description:
    "Review bounded scoped activity evidence and create normal follow-up tasks or owner questions when steering is needed.",
  tags: ["progress-reviewer"],
  recoveryCapable: true,
  defaultAutonomyMode: "passive",
  triggers: [
    {
      event: progressReviewRequested.name,
      cooldownMs: 60_000,
    },
    {
      event: PROGRESS_REVIEW_SCHEDULE_EVENT,
      schedule: "0 */6 * * *",
      cooldownMs: 60 * 60 * 1000,
    },
    {
      event: "workflow.completed",
      filter: { tags: ["monitored"] },
      batch: {
        maxCount: 5,
        maxAgeMs: 6 * 60 * 60 * 1000,
        groupBy: "projectId",
        maxBufferSize: 20,
        overflow: "flush-oldest",
      },
    },
    {
      event: "workflow.build.committed",
      batch: {
        maxCount: 3,
        maxAgeMs: 6 * 60 * 60 * 1000,
        groupBy: "projectId",
        maxBufferSize: 12,
        overflow: "flush-oldest",
      },
    },
    {
      event: inboundSignalReceived.name,
      batch: {
        maxCount: 10,
        idleTimeoutMs: 10 * 60 * 1000,
        groupBy: ["channel", "sourceId"],
        maxBufferSize: 30,
        overflow: "flush-oldest",
      },
    },
    {
      event: "runtime.recovered",
    },
  ],
  steps: [
    {
      id: "reset-for-recovery",
      type: "code",
      when: onRecoveryTrigger,
      run: ({ projectDir }) =>
        resetWorktreeForRecovery({
          projectDir,
          workflowName: "progress-reviewer",
        }),
    },
    inspectWorktree,
    collectEvidence,
    {
      id: "review-evidence",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      harness: AUTONOMY_AGENT_HARNESS,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: agent.effort,
      allowedTools: ["Read", "LS", "Grep", "Glob"],
      timeoutMs: REVIEW_AGENT_TIMEOUT_MS,
      maxTurns: 8,
      outputFormat: "json",
      outputSchema: progressReviewOutputSchema,
      validate: decodeProgressReviewAgentOutput,
      when: stepSucceeded("collect-evidence"),
    },
    applyActions,
    writeArtifact,
    writeCommitMessage,
    validateBeforeCommit,
    commitChanges,
    {
      id: "emit-attention",
      type: "emit",
      when: (ctx) => {
        if (!stepSucceeded("write-artifact")(ctx)) return false;
        return needsAttention(decodeProgressReviewAgentOutput(ctx.stepOutputs["review-evidence"]));
      },
      event: "workflow.attention.digest",
      payload: (ctx) => {
        const review = decodeProgressReviewAgentOutput(ctx.stepOutputs["review-evidence"]);
        const actions = applyActions.output(ctx) ?? emptyActions();
        return {
          items: [
            {
              label: "Progress review",
              detail: `${review.verdict}: ${review.summary}`,
            },
          ],
          text:
            `Progress review ${review.verdict}: ${review.summary}\n` +
            `Follow-up tasks: ${actions.createdTaskIds.join(", ") || "none"}\n` +
            `Owner questions: ${actions.ownerQuestionIds.join(", ") || "none"}`,
        };
      },
    },
    {
      id: "request-restart",
      type: "restart",
      when: stepCommitted("commit"),
      reason: "progress-reviewer committed progress review follow-up tasks",
      requires: ["commit"],
    },
  ],
};

export { progressReviewOutputSchema };
export default progressReviewerWorkflow;
