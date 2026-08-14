import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  decodeWorkflowCommitOutcome,
  type WorkflowCommitOutcome,
} from "#modules/autonomy/commit-result.js";
import { assertOutboundGitHubCommentBodyIsSafe } from "#modules/autonomy/github-comment-safety.js";
import {
  onNormalTrigger,
  onRecoveryTrigger,
  resetWorktreeForRecoveryOperation,
} from "#modules/autonomy/recovery.js";
import { runCheck, stepSucceeded } from "#modules/autonomy/shared.js";
import {
  workflowCommitOperation,
  workflowCommitValidationOperation,
} from "#modules/autonomy/workflow-commit-operations.js";
import {
  assessMentionTrigger,
  type GithubMentionIntakeAssessment,
  validateAssessment,
} from "./mention-assessment.js";
import {
  boundedBody,
  type CreatedTaskReference,
  createMentionTaskOperation,
  type PreparedIntakeComment,
  taskReferenceResponse,
  validateCreatedTaskReference,
  validatePreparedComment,
} from "./task-support.js";

const COMMENT_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

const assessMentionIntake = typedCodeStep<GithubMentionIntakeAssessment>({
  id: "assess-mention-intake",
  type: "code",
  when: onNormalTrigger,
  validate: validateAssessment,
  run: ({ trigger }) => assessMentionTrigger(trigger),
});

const createTask = typedCodeStep<CreatedTaskReference>({
  id: "create-task",
  type: "code",
  when: (ctx) =>
    ctx.trigger.event !== "runtime.recovered" &&
    assessMentionIntake.outputRequired(ctx).taskEligible,
  validate: validateCreatedTaskReference,
  run: (ctx) => {
    const assessment = assessMentionIntake.outputRequired(ctx);
    if (assessment.decision !== "create_task") {
      throw new Error("cannot create a task for a non-create GitHub mention assessment");
    }
    return ctx.runBlocking(createMentionTaskOperation, {
      projectDir: ctx.projectDir,
      taskTitle: assessment.taskTitle,
      taskSummary: assessment.taskSummary,
      taskBody: assessment.taskBody,
    });
  },
});

const writeCommitMessage = typedCodeStep<{ written: boolean; path: string }>({
  id: "write-commit-message",
  type: "code",
  when: (ctx) => createTask.output(ctx)?.kind === "created",
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean; path: string }>(raw, [
      "written",
      "path",
    ]),
  run: (ctx) => {
    const task = createTask.outputRequired(ctx);
    const assessment = assessMentionIntake.outputRequired(ctx);
    if (assessment.decision !== "create_task") {
      throw new Error("cannot write commit message without a created task assessment");
    }
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    const path = join(ctx.workflow.runDirPath, "commit-message.txt");
    writeFileSync(
      path,
      [
        `github-mention-intake: create ${task.taskId}`,
        "",
        `Captured trusted GitHub implementation mention from ${assessment.fields.repo}#${assessment.fields.issueNumber}.`,
        `Task path: ${relative(ctx.projectDir, task.path)}`,
        "",
      ].join("\n"),
      "utf-8",
    );
    return { written: true, path };
  },
});

const validateBeforeCommit = typedCodeStep<{ ok: true }>({
  id: "validate-before-commit",
  type: "code",
  when: stepSucceeded("write-commit-message"),
  validate: (raw) => {
    const object = expectStructuredOutput<{ ok: true }>(raw, ["ok"]);
    if (object.ok !== true) {
      throw new Error(`expected ok: true, got ${String(object.ok)}`);
    }
    return object;
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

const commitTask = typedCodeStep<WorkflowCommitOutcome>({
  id: "commit-task",
  type: "code",
  when: stepSucceeded("validate-before-commit"),
  validate: decodeWorkflowCommitOutcome,
  run: (ctx) =>
    ctx.runBlocking(workflowCommitOperation, {
      projectDir: ctx.projectDir,
      runDirPath: ctx.workflow.runDirPath,
    }),
});

const prepareComment = typedCodeStep<PreparedIntakeComment>({
  id: "prepare-comment",
  type: "code",
  validate: validatePreparedComment,
  when: (ctx) => {
    const assessment = assessMentionIntake.output(ctx);
    if (!assessment?.commentEligible) return false;
    if (assessment.decision === "needs_detail") return true;
    const task = createTask.output(ctx);
    return Boolean(task && (task.kind === "existing" || stepSucceeded("commit-task")(ctx)));
  },
  run: (ctx) => {
    const assessment = assessMentionIntake.outputRequired(ctx);
    if (assessment.decision === "needs_detail") {
      const body = boundedBody(assessment.responseBody);
      assertOutboundGitHubCommentBodyIsSafe(body);
      return {
        repo: assessment.fields.repo,
        issueNumber: assessment.fields.issueNumber,
        originalCommentId: assessment.fields.commentId,
        mode: "needs_detail",
        body,
      };
    }
    if (assessment.decision !== "create_task") {
      throw new Error("cannot prepare intake comment for skipped GitHub mention");
    }
    const task = createTask.outputRequired(ctx);
    const body = boundedBody(
      taskReferenceResponse(assessment.fields, {
        ...task,
        path: relative(ctx.projectDir, task.path),
      }),
    );
    assertOutboundGitHubCommentBodyIsSafe(body);
    return {
      repo: assessment.fields.repo,
      issueNumber: assessment.fields.issueNumber,
      originalCommentId: assessment.fields.commentId,
      mode: task.kind,
      body,
    };
  },
});

const githubMentionIntakeWorkflow: WorkflowDefinitionInput = {
  name: "github-mention-intake",
  description: "Capture trusted GitHub implementation mentions into repo-local task intake.",
  tags: ["monitored"],
  recoveryCapable: true,
  triggers: [{ event: "runtime.recovered" }],
  steps: [
    {
      id: "reset-for-recovery",
      type: "code",
      when: onRecoveryTrigger,
      run: (ctx) =>
        ctx.runBlocking(resetWorktreeForRecoveryOperation, {
          projectDir: ctx.projectDir,
          workflowName: "github-mention-intake",
        }),
    },
    assessMentionIntake,
    createTask,
    writeCommitMessage,
    validateBeforeCommit,
    commitTask,
    prepareComment,
    {
      id: "approve-comment",
      type: "approval",
      timeoutMs: COMMENT_APPROVAL_TIMEOUT_MS,
      defaultResolution: "deny",
      reason: "Approve posting one bounded KOTA task-intake reference comment to the originating GitHub issue or pull request.",
      when: stepSucceeded("prepare-comment"),
    },
    {
      id: "post-comment",
      type: "tool",
      tool: "github_comment",
      when: stepSucceeded("approve-comment"),
      input: (ctx) => {
        const comment = prepareComment.outputRequired(ctx);
        return { repo: comment.repo, number: comment.issueNumber, body: comment.body };
      },
    },
    {
      id: "emit-intake-comment-posted",
      type: "emit",
      when: stepSucceeded("post-comment"),
      event: "workflow.github-mention.intake.posted",
      payload: (ctx) => {
        const comment = prepareComment.outputRequired(ctx);
        return {
          repo: comment.repo,
          issueNumber: comment.issueNumber,
          originalCommentId: comment.originalCommentId,
          mode: comment.mode,
        };
      },
    },
  ],
};

export default githubMentionIntakeWorkflow;
