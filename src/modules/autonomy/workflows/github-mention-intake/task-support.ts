import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { expectStructuredOutput } from "#core/workflow/step-input-code.js";
import { assertOutboundGitHubCommentBodyIsSafe } from "#modules/autonomy/github-comment-safety.js";
import {
  getRepoTaskStateDir,
  writeRepoTaskFile,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  createNormalizedTask,
  showTask,
} from "#modules/repo-tasks/repo-tasks-operations.js";
import { isNonEmptyString, type NormalizedMentionFields, surfaceLabel } from "./mention-fields.js";
import { taskIdFromTitle } from "./task-content.js";

const MAX_COMMENT_BODY_CHARS = 4_000;

export type CreatedTaskReference = {
  kind: "created" | "existing";
  taskId: string;
  path: string;
  title: string;
};

export type PreparedIntakeComment = {
  repo: string;
  issueNumber: number;
  isPullRequest: boolean;
  originalCommentId: number;
  mode: "created" | "existing" | "needs_detail";
  body: string;
};

export function createMentionTaskInWorker(input: {
  workspaceRoot: string;
  taskTitle: string;
  taskSummary: string;
  taskBody: string;
}): CreatedTaskReference {
  const worktree = getRepoWorktreeStatus(input.workspaceRoot);
  if (worktree.available && worktree.dirty) {
    throw new Error(
      `Repository has existing changes before GitHub mention intake can create a task: ${worktree.summary}`,
    );
  }
  const taskId = taskIdFromTitle(input.taskTitle);
  const existing = showTask(input.workspaceRoot, taskId);
  if (existing.found) {
    return {
      kind: "existing",
      taskId,
      path: join(getRepoTaskStateDir(input.workspaceRoot, existing.state), `${taskId}.md`),
      title: input.taskTitle,
    };
  }
  const result = createNormalizedTask(input.workspaceRoot, {
    title: input.taskTitle,
    priority: "p2",
    area: "modules",
    state: "ready",
    summary: input.taskSummary,
  });
  if (!result.ok) {
    throw new Error(
      `failed to create GitHub mention task: ${result.reason}${result.message ? `: ${result.message}` : ""}`,
    );
  }
  const content = readFileSync(result.path, "utf-8");
  const { attrs } = parseFlatFrontMatter(content);
  writeRepoTaskFile(
    input.workspaceRoot,
    result.path,
    serializeFlatFrontMatter(attrs, input.taskBody),
  );
  return {
    kind: "created",
    taskId: result.id,
    path: result.path,
    title: input.taskTitle,
  };
}

export const createMentionTaskOperation = defineWorkflowBlockingOperation<
  {
    workspaceRoot: string;
    taskTitle: string;
    taskSummary: string;
    taskBody: string;
  },
  CreatedTaskReference
>(import.meta.url, "createMentionTaskInWorker");

export function validateCreatedTaskReference(
  raw: Parameters<typeof expectStructuredOutput<CreatedTaskReference>>[0],
): CreatedTaskReference {
  const object = expectStructuredOutput<CreatedTaskReference>(raw, [
    "kind",
    "taskId",
    "path",
    "title",
  ]);
  if (object.kind !== "created" && object.kind !== "existing") {
    throw new Error(`task reference kind must be created or existing, got ${object.kind}`);
  }
  if (
    !isNonEmptyString(object.taskId) ||
    !isNonEmptyString(object.path) ||
    !isNonEmptyString(object.title)
  ) throw new Error("task reference is incomplete");
  return object;
}

export function validatePreparedComment(
  raw: Parameters<typeof expectStructuredOutput<PreparedIntakeComment>>[0],
): PreparedIntakeComment {
  const object = expectStructuredOutput<PreparedIntakeComment>(raw, [
    "repo",
    "issueNumber",
    "isPullRequest",
    "originalCommentId",
    "mode",
    "body",
  ]);
  if (
    !isNonEmptyString(object.repo) ||
    typeof object.issueNumber !== "number" ||
    typeof object.isPullRequest !== "boolean" ||
    typeof object.originalCommentId !== "number" ||
    !isNonEmptyString(object.body)
  ) throw new Error("prepared comment is incomplete");
  if (
    object.mode !== "created" &&
    object.mode !== "existing" &&
    object.mode !== "needs_detail"
  ) throw new Error(`invalid prepared comment mode: ${object.mode}`);
  assertOutboundGitHubCommentBodyIsSafe(object.body);
  return object;
}

export function boundedBody(body: string): string {
  const trimmed = body.trim();
  return trimmed.length <= MAX_COMMENT_BODY_CHARS
    ? trimmed
    : `${trimmed.slice(0, MAX_COMMENT_BODY_CHARS - 28).trimEnd()}\n\n[Response truncated]`;
}

export function taskReferenceResponse(
  fields: NormalizedMentionFields,
  task: CreatedTaskReference,
): string {
  if (task.kind === "existing") {
    return [
      `Thanks for the implementation mention on ${surfaceLabel(fields)}.`,
      "",
      `I found existing KOTA task \`${task.taskId}\` for this GitHub reference: \`${task.path}\`.`,
    ].join("\n");
  }
  return [
    `Thanks for the implementation mention on ${surfaceLabel(fields)}.`,
    "",
    `Created KOTA task \`${task.taskId}\` in \`${task.path}\`. The task records the GitHub provenance and labels the request text as untrusted source material.`,
  ].join("\n");
}
