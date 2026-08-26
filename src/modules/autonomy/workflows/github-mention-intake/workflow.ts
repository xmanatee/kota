import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { assertOutboundGitHubCommentBodyIsSafe } from "#modules/autonomy/github-comment-safety.js";
import { stepSucceeded } from "#modules/autonomy/shared.js";
import { inboundSignalWorkflowTargeted } from "#modules/inbound-signals/events.js";
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

const assessMentionIntake = typedCodeStep<GithubMentionIntakeAssessment>({
  id: "assess-mention-intake",
  type: "code",
  validate: validateAssessment,
  run: ({ trigger }) => assessMentionTrigger(trigger),
});

const createTask = typedCodeStep<CreatedTaskReference>({
  id: "create-task",
  type: "code",
  when: (ctx) => assessMentionIntake.outputRequired(ctx).taskEligible,
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
        `Task path: ${task.path}`,
        "",
      ].join("\n"),
      "utf-8",
    );
    return { written: true, path };
  },
});

const validateChanges = typedCodeStep<{ ok: true }>({
  id: "validate-changes",
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
    await ctx.runCommand({
      command: "pnpm",
      args: ["run", "validate-tasks"],
      cwd: ctx.projectDir,
    });
    return { ok: true } as const;
  },
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
    return Boolean(task && (task.kind === "existing" || stepSucceeded("validate-changes")(ctx)));
  },
  run: (ctx) => {
    const assessment = assessMentionIntake.outputRequired(ctx);
    if (assessment.decision === "needs_detail") {
      const body = boundedBody(assessment.responseBody);
      assertOutboundGitHubCommentBodyIsSafe(body);
      return {
        repo: assessment.fields.repo,
        issueNumber: assessment.fields.issueNumber,
        isPullRequest: assessment.fields.isPullRequest,
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
      taskReferenceResponse(assessment.fields, task),
    );
    assertOutboundGitHubCommentBodyIsSafe(body);
    return {
      repo: assessment.fields.repo,
      issueNumber: assessment.fields.issueNumber,
      isPullRequest: assessment.fields.isPullRequest,
      originalCommentId: assessment.fields.commentId,
      mode: task.kind,
      body,
    };
  },
});

const githubMentionIntakeWorkflow: WorkflowDefinitionInput = {
  name: "github-mention-intake",
  repository: "write",
  integration: { validationCommand: ["pnpm", "validate-tasks"] },
  description: "Capture trusted GitHub implementation mentions into repo-local task intake.",
  tags: ["monitored"],
  triggers: [{ event: inboundSignalWorkflowTargeted }],
  steps: [
    assessMentionIntake,
    createTask,
    writeCommitMessage,
    validateChanges,
    prepareComment,
    {
      id: "emit-intake-comment-requested",
      type: "emit",
      when: stepSucceeded("prepare-comment"),
      event: "github-mention-intake.comment.requested",
      payload: (ctx) => {
        const comment = prepareComment.outputRequired(ctx);
        return {
          ...comment,
          idempotencyKey:
            `github-mention-intake:${comment.repo}:${comment.originalCommentId}:${comment.mode}`,
        };
      },
    },
  ],
};

export default githubMentionIntakeWorkflow;
