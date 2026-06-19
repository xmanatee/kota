import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
  getRepoInboxDir,
  getRepoTaskStateDir,
  listFullRepoTasks,
  REPO_TASK_STATES,
  type RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { slugifyTaskTitle } from "#modules/repo-tasks/repo-tasks-operations.js";
import type {
  ExistingWorkItem,
  ProgressReviewAgentOutput,
  ProgressReviewAppliedAction,
  ProgressReviewEvidenceIdPacket,
  ProgressReviewFollowUpTaskOutput,
  ProgressReviewOwnerQuestionOutput,
  TaskAttrs,
} from "./types.js";

function taskPathForId(projectDir: string, state: RepoTaskState, id: string): string {
  return join(getRepoTaskStateDir(projectDir, state), `${id}.md`);
}

function taskRelativePath(state: RepoTaskState, id: string): string {
  return join("data", "tasks", state, `${id}.md`);
}

function findExistingTask(projectDir: string, id: string, title: string): ExistingWorkItem | null {
  const scopeId = deriveDirectoryScopeId(projectDir);
  for (const state of REPO_TASK_STATES) {
    const candidate = taskPathForId(projectDir, state, id);
    if (existsSync(candidate)) {
      return { id, state, path: taskRelativePath(state, id), scopeId };
    }
  }

  const normalizedTitle = title.trim().toLowerCase();
  for (const record of listFullRepoTasks(projectDir)) {
    if (record.title.trim().toLowerCase() === normalizedTitle) {
      return {
        id: record.id,
        state: record.state,
        path: taskRelativePath(record.state, record.id),
        scopeId,
      };
    }
  }
  return findExistingInboxEntry(projectDir, id, title);
}

function uniqueProjectDirs(projectDirs: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const projectDir of projectDirs) {
    const resolved = resolve(projectDir);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    unique.push(projectDir);
  }
  return unique;
}

export function taskDedupeProjectDirs(
  projectDir: string,
  evidence: ProgressReviewEvidenceIdPacket,
): string[] {
  if (evidence.scope?.kind !== "global") return [projectDir];
  return uniqueProjectDirs([
    projectDir,
    ...(evidence.scopes ?? []).flatMap((scope) =>
      scope.scope.directoryRoot ? [scope.scope.directoryRoot] : [],
    ),
  ]);
}

function findExistingTaskAcrossProjectDirs(
  projectDirs: readonly string[],
  id: string,
  title: string,
): ExistingWorkItem | null {
  for (const projectDir of projectDirs) {
    const existing = findExistingTask(projectDir, id, title);
    if (existing) return existing;
  }
  return null;
}

function normalizeRelatedText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function firstMarkdownHeading(body: string): string | null {
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("# ")) return line.slice(2).trim();
  }
  return null;
}

function findExistingInboxEntry(
  projectDir: string,
  id: string,
  title: string,
): ExistingWorkItem | null {
  const inboxDir = getRepoInboxDir(projectDir);
  if (!existsSync(inboxDir)) return null;
  const normalizedTitle = normalizeRelatedText(title);
  for (const file of readdirSync(inboxDir).sort()) {
    if (!file.endsWith(".md") || file === "AGENTS.md") continue;
    const path = join(inboxDir, file);
    const inboxId = file.slice(0, -".md".length);
    if (inboxId === id) {
      return {
        id: inboxId,
        state: "inbox",
        path: join("data", "inbox", file),
        scopeId: deriveDirectoryScopeId(projectDir),
      };
    }
    const raw = readFileSync(path, "utf-8");
    const { attrs, body } = parseFlatFrontMatter(raw);
    const frontmatterTitle = attrs.title;
    const candidates = [
      typeof frontmatterTitle === "string" ? frontmatterTitle : "",
      firstMarkdownHeading(body) ?? "",
      body,
    ];
    if (candidates.some((candidate) => normalizeRelatedText(candidate).includes(normalizedTitle))) {
      return {
        id: inboxId,
        state: "inbox",
        path: join("data", "inbox", file),
        scopeId: deriveDirectoryScopeId(projectDir),
      };
    }
  }
  return null;
}

function stageBestEffort(projectDir: string, path: string): void {
  try {
    execFileSync("git", ["add", path], {
      cwd: projectDir,
      env: withProtectedGitBareRepositoryEnv(),
      stdio: "ignore",
    });
  } catch {
    // The workflow commit step stages final tracked changes. In tests and
    // sandboxed runs, the file on disk is still the important mutation.
  }
}

function buildTaskBody(args: {
  runId: string;
  review: ProgressReviewAgentOutput;
  task: ProgressReviewFollowUpTaskOutput;
}): string {
  const evidenceIds = args.task.evidenceIds.map((id) => `- ${id}`).join("\n");
  return [
    "",
    "## Problem",
    "",
    args.task.summary,
    "",
    "## Desired Outcome",
    "",
    `Resolve the progress-review finding from run ${args.runId}.`,
    "",
    "## Constraints",
    "",
    "- Preserve the cited evidence ids until the task is resolved.",
    "- Do not treat this seeded task as proof that the finding is already fixed.",
    "",
    "## Done When",
    "",
    "- The cited progress gap is fixed or explicitly disproven with evidence.",
    "- Acceptance evidence is recorded in this task or its run artifact.",
    "",
    "## Source / Intent",
    "",
    `Created by progress-reviewer workflow run ${args.runId}.`,
    "",
    `review verdict: ${args.review.verdict}`,
    `review summary: ${args.review.summary}`,
    "",
    "Evidence ids:",
    "",
    evidenceIds,
    "",
    "## Initiative",
    "",
    "Outcome-aware autonomy progress review.",
    "",
    "## Acceptance Evidence",
    "",
    `- ${args.task.acceptanceEvidence}`,
    "",
  ].join("\n");
}

export function writeFollowUpTask(args: {
  projectDir: string;
  dedupeProjectDirs: readonly string[];
  runId: string;
  review: ProgressReviewAgentOutput;
  task: ProgressReviewFollowUpTaskOutput;
}): ProgressReviewAppliedAction {
  const id = `task-${slugifyTaskTitle(args.task.title)}`;
  if (id === "task-") {
    return {
      kind: "skipped-task",
      title: args.task.title,
      reason: "title produced an empty task slug",
    };
  }
  const existing = findExistingTaskAcrossProjectDirs(args.dedupeProjectDirs, id, args.task.title);
  if (existing) {
    return {
      kind: "skipped-task",
      title: args.task.title,
      reason: "matching task already exists",
      existingTaskId: existing.id,
      existingState: existing.state,
      existingPath: existing.path,
      existingScopeId: existing.scopeId,
    };
  }
  const taskPath = taskPathForId(args.projectDir, "ready", id);
  mkdirSync(dirname(taskPath), { recursive: true });
  const now = new Date().toISOString();
  const attrs: TaskAttrs = {
    id,
    title: args.task.title,
    status: "ready",
    priority: args.task.priority,
    area: args.task.area,
    summary: args.task.summary,
    created_at: now,
    updated_at: now,
  };
  writeFileSync(taskPath, serializeFlatFrontMatter(attrs, buildTaskBody(args)), "utf-8");
  stageBestEffort(args.projectDir, taskPath);
  return {
    kind: "created-task",
    taskId: id,
    path: taskPath.slice(args.projectDir.length + 1),
    title: args.task.title,
  };
}

function findPendingOwnerQuestion(queue: OwnerQuestionQueue, question: string): string | null {
  const normalized = question.trim().toLowerCase();
  const existing = queue.list("pending").find(
    (item) => item.question.trim().toLowerCase() === normalized,
  );
  return existing?.id ?? null;
}

export function enqueueOwnerQuestion(args: {
  projectDir: string;
  runId: string;
  question: ProgressReviewOwnerQuestionOutput;
}): ProgressReviewAppliedAction {
  const queue = new OwnerQuestionQueue(join(args.projectDir, ".kota", "owner-questions"));
  const existingId = findPendingOwnerQuestion(queue, args.question.question);
  if (existingId) {
    return {
      kind: "skipped-owner-question",
      question: args.question.question,
      reason: `matching pending owner question already exists: ${existingId}`,
    };
  }
  const item = queue.enqueue({
    context: `Progress review run ${args.runId} cited evidence ids: ${args.question.evidenceIds.join(", ")}`,
    question: args.question.question,
    reason: args.question.reason,
    source: "progress-reviewer",
    answerBehavior: "record-only",
    origin: {
      kind: "workflow",
      workflowName: "progress-reviewer",
      runId: args.runId,
      stepId: "apply-actions",
      taskId: null,
    },
    proposedAnswers: args.question.proposedAnswers,
  });
  return { kind: "owner-question", questionId: item.id, question: item.question };
}
