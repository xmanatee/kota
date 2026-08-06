import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import {
  normalizeGeneratedTaskScalar,
  renderGeneratedTaskProse,
} from "#modules/autonomy/generated-task-text.js";
import {
  type ClassifiedWorkflowGeneratedTask,
  classifyWorkflowGeneratedTask,
} from "#modules/autonomy/workflow-generated-task-class.js";
import {
  getRepoInboxDir,
  getRepoTaskStateDir,
  listFullRepoTasks,
  REPO_TASK_STATES,
  type RepoTaskState,
  writeRepoTaskFile,
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

function normalizeFrontMatterScalar(field: string, value: string): string {
  return normalizeGeneratedTaskScalar("progress-review follow-up task", field, value);
}

function normalizeListScalar(field: string, value: string): string {
  return normalizeFrontMatterScalar(field, value);
}

function normalizeFollowUpTask(
  task: ProgressReviewFollowUpTaskOutput,
): ProgressReviewFollowUpTaskOutput {
  return {
    ...task,
    title: normalizeFrontMatterScalar("title", task.title),
    area: normalizeFrontMatterScalar("area", task.area),
    summary: normalizeFrontMatterScalar("summary", task.summary),
    evidenceIds: task.evidenceIds.map((id) => normalizeListScalar("evidence id", id)),
  };
}

function buildTaskBody(args: {
  runId: string;
  review: ProgressReviewAgentOutput;
  task: ProgressReviewFollowUpTaskOutput;
  taskClass: ClassifiedWorkflowGeneratedTask;
}): string {
  const evidenceIds = args.task.evidenceIds.map((id) => `- ${id}`).join("\n");
  const runId = normalizeListScalar("run id", args.runId);
  return [
    "",
    "## Problem",
    "",
    renderGeneratedTaskProse(args.task.summary),
    "",
    "## Desired Outcome",
    "",
    `Resolve the progress-review finding from run ${runId}.`,
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
    `Created by progress-reviewer workflow run ${runId}.`,
    "",
    `review verdict: ${args.review.verdict}`,
    "review summary:",
    "",
    renderGeneratedTaskProse(args.review.summary),
    "",
    "Evidence ids:",
    "",
    evidenceIds,
    "",
    ...(args.taskClass === "Meta"
      ? [
        "## Product / Safety Link",
        "",
        "This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.",
        "",
      ]
      : []),
    "## Initiative",
    "",
    "Outcome-aware autonomy progress review.",
    "",
    "## Acceptance Evidence",
    "",
    "- Review-provided acceptance evidence:",
    "",
    renderGeneratedTaskProse(args.task.acceptanceEvidence),
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
  const task = normalizeFollowUpTask(args.task);
  const id = `task-${slugifyTaskTitle(task.title)}`;
  if (id === "task-") {
    return {
      kind: "skipped-task",
      title: task.title,
      reason: "title produced an empty task slug",
    };
  }
  const existing = findExistingTaskAcrossProjectDirs(args.dedupeProjectDirs, id, task.title);
  if (existing) {
    return {
      kind: "skipped-task",
      title: task.title,
      reason: "matching task already exists",
      existingTaskId: existing.id,
      existingState: existing.state,
      existingPath: existing.path,
      existingScopeId: existing.scopeId,
    };
  }
  const taskPath = taskPathForId(args.projectDir, "ready", id);
  const now = new Date().toISOString();
  const taskClass = classifyWorkflowGeneratedTask({
    workflowName: "progress-reviewer",
    area: task.area,
    title: task.title,
    summary: task.summary,
  });
  const attrs: TaskAttrs = {
    id,
    title: task.title,
    status: "ready",
    priority: task.priority,
    area: task.area,
    task_class: taskClass,
    summary: task.summary,
    created_at: now,
    updated_at: now,
  };
  writeRepoTaskFile(
    args.projectDir,
    taskPath,
    serializeFlatFrontMatter(attrs, buildTaskBody({ ...args, task, taskClass })),
  );
  return {
    kind: "created-task",
    taskId: id,
    path: taskPath.slice(args.projectDir.length + 1),
    title: task.title,
  };
}

export function enqueueOwnerQuestion(args: {
  projectDir: string;
  runId: string;
  question: ProgressReviewOwnerQuestionOutput;
}): ProgressReviewAppliedAction {
  const queue = new OwnerQuestionQueue(join(args.projectDir, ".kota", "owner-questions"));
  const { item, created } = queue.enqueueDeduplicated({
    dedupeKey: `progress-reviewer:${args.question.topicKey}`,
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
  if (!created) {
    return {
      kind: "skipped-owner-question",
      question: args.question.question,
      reason: `matching pending owner question already exists: ${item.id}`,
    };
  }
  return { kind: "owner-question", questionId: item.id, question: item.question };
}
