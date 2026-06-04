import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import {
  getRepoInboxDir,
  getRepoTaskStateDir,
  listFullRepoTasks,
  REPO_TASK_STATES,
  type RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { slugifyTaskTitle } from "#modules/repo-tasks/repo-tasks-operations.js";
import {
  isScopeImprovementWriteAllowed,
  readScopeImprovementConfig,
  stageBestEffort,
  writeScopeImprovementState,
} from "./scope-improvement-state.js";
import {
  SCOPE_IMPROVEMENT_ARTIFACT,
  type ScopeImprovementActionResult,
  type ScopeImprovementAppliedAction,
  type ScopeImprovementArtifact,
  type ScopeImprovementRecommendation,
} from "./scope-improvement-types.js";

function taskPathForId(projectDir: string, state: RepoTaskState, id: string): string {
  return join(getRepoTaskStateDir(projectDir, state), `${id}.md`);
}

function findExistingTask(projectDir: string, id: string, title: string): string | null {
  for (const state of REPO_TASK_STATES) {
    const path = taskPathForId(projectDir, state, id);
    if (existsSync(path)) return join("data", "tasks", state, `${id}.md`);
  }
  const normalizedTitle = title.trim().toLowerCase();
  for (const task of listFullRepoTasks(projectDir)) {
    if (task.title.trim().toLowerCase() === normalizedTitle) {
      return join("data", "tasks", task.state, `${task.id}.md`);
    }
  }
  const inboxDir = getRepoInboxDir(projectDir);
  if (!existsSync(inboxDir)) return null;
  for (const file of readdirSync(inboxDir)) {
    if (file === `${id}.md`) return join("data", "inbox", file);
  }
  return null;
}

function writeTask(args: {
  projectDir: string;
  runId: string;
  recommendation: Extract<ScopeImprovementRecommendation, { kind: "create-task" }>;
}): ScopeImprovementAppliedAction {
  const id = `task-${slugifyTaskTitle(args.recommendation.title)}`;
  if (id === "task-") {
    return skipped(args.recommendation.signature, "title produced an empty task slug");
  }
  const existing = findExistingTask(
    args.projectDir,
    id,
    args.recommendation.title,
  );
  if (existing) {
    return skipped(
      args.recommendation.signature,
      `matching task already exists at ${existing}`,
    );
  }
  const path = taskPathForId(args.projectDir, "ready", id);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    serializeFlatFrontMatter(taskAttrs(id, args.recommendation), taskBody(args)),
    "utf-8",
  );
  stageBestEffort(args.projectDir, path);
  return {
    kind: "created-task",
    taskId: id,
    path: relative(args.projectDir, path),
    signature: args.recommendation.signature,
  };
}

function taskAttrs(
  id: string,
  recommendation: Extract<ScopeImprovementRecommendation, { kind: "create-task" }>,
): Record<string, string> {
  const now = new Date().toISOString();
  return {
    id,
    title: recommendation.title,
    status: "ready",
    priority: "p2",
    area: "autonomy",
    summary: recommendation.summary,
    created_at: now,
    updated_at: now,
  };
}

function taskBody(args: {
  runId: string;
  recommendation: Extract<ScopeImprovementRecommendation, { kind: "create-task" }>;
}): string {
  return [
    "",
    "## Problem",
    "",
    args.recommendation.summary,
    "",
    "## Desired Outcome",
    "",
    `Resolve the scope-improvement finding from run ${args.runId}.`,
    "",
    "## Constraints",
    "",
    "- Preserve the cited evidence ids until this task is resolved.",
    "- Keep the work scoped to the directory that produced the finding.",
    "",
    "## Done When",
    "",
    "- The cited improvement is implemented or explicitly rejected with evidence.",
    "- The scope-improvement artifact remains enough to audit the decision.",
    "",
    "## Source / Intent",
    "",
    `Created by scope-improver workflow run ${args.runId}.`,
    "",
    "Evidence ids:",
    "",
    ...args.recommendation.evidenceIds.map((id) => `- ${id}`),
    "",
    "## Initiative",
    "",
    "Scope-aware continuous improvement.",
    "",
    "## Acceptance Evidence",
    "",
    "- Scope-improvement artifact and narrow validation output.",
    "",
  ].join("\n");
}

function writeSafeEdit(args: {
  projectDir: string;
  recommendation: Extract<ScopeImprovementRecommendation, { kind: "safe-edit" }>;
}): ScopeImprovementAppliedAction {
  const config = readScopeImprovementConfig(args.projectDir);
  if (!isScopeImprovementWriteAllowed(config, args.recommendation.path)) {
    return skipped(
      args.recommendation.signature,
      `policy does not allow autonomous edit of ${args.recommendation.path}`,
    );
  }
  const path = join(args.projectDir, args.recommendation.path);
  if (existsSync(path)) {
    return skipped(
      args.recommendation.signature,
      `${args.recommendation.path} already exists`,
    );
  }
  writeFileSync(
    path,
    [
      "# Scope Guidance",
      "",
      "This directory is a KOTA-managed scope.",
      "",
      "- Record durable scope constraints here before broad autonomous improvement work.",
      "- Keep task-specific acceptance evidence in normal KOTA task files or run artifacts.",
      "",
    ].join("\n"),
    "utf-8",
  );
  stageBestEffort(args.projectDir, path);
  return {
    kind: "safe-edit",
    path: args.recommendation.path,
    signature: args.recommendation.signature,
  };
}

function enqueueQuestion(args: {
  projectDir: string;
  runId: string;
  recommendation: Extract<ScopeImprovementRecommendation, { kind: "owner-question" }>;
}): ScopeImprovementAppliedAction {
  const queue = new OwnerQuestionQueue(join(args.projectDir, ".kota", "owner-questions"));
  const existing = queue.list("pending").find(
    (item) =>
      item.question.trim().toLowerCase() ===
      args.recommendation.question.trim().toLowerCase(),
  );
  if (existing) {
    return skipped(
      args.recommendation.signature,
      `matching pending owner question already exists: ${existing.id}`,
    );
  }
  const item = queue.enqueue({
    context:
      `Scope improvement run ${args.runId} cited evidence ids: ` +
      args.recommendation.evidenceIds.join(", "),
    question: args.recommendation.question,
    reason: args.recommendation.reason,
    source: "scope-improver",
    answerBehavior: "record-only",
    origin: {
      kind: "workflow",
      workflowName: "scope-improver",
      runId: args.runId,
      stepId: "apply-recommendations",
      taskId: null,
    },
    proposedAnswers: args.recommendation.proposedAnswers,
  });
  return {
    kind: "owner-question",
    questionId: item.id,
    signature: args.recommendation.signature,
  };
}

function skipped(signature: string, reason: string): ScopeImprovementAppliedAction {
  return { kind: "skipped", signature, reason };
}

export function applyScopeImprovementRecommendations(args: {
  projectDir: string;
  runId: string;
  inputs: ScopeImprovementArtifact["inputs"];
  recommendations: readonly ScopeImprovementRecommendation[];
}): ScopeImprovementActionResult {
  const applied = args.recommendations.map((recommendation) => {
    if (recommendation.kind === "create-task") {
      return writeTask({ projectDir: args.projectDir, runId: args.runId, recommendation });
    }
    if (recommendation.kind === "owner-question") {
      return enqueueQuestion({ projectDir: args.projectDir, runId: args.runId, recommendation });
    }
    if (recommendation.kind === "safe-edit") {
      return writeSafeEdit({ projectDir: args.projectDir, recommendation });
    }
    return skipped(recommendation.signature, recommendation.reason);
  });
  writeScopeImprovementState({
    projectDir: args.projectDir,
    inputs: args.inputs,
    actions: applied,
  });
  return summarizeActions(applied);
}

function summarizeActions(
  applied: ScopeImprovementAppliedAction[],
): ScopeImprovementActionResult {
  const createdTaskIds = applied
    .filter((action): action is Extract<ScopeImprovementAppliedAction, { kind: "created-task" }> =>
      action.kind === "created-task",
    )
    .map((action) => action.taskId);
  const ownerQuestionIds = applied
    .filter((action): action is Extract<ScopeImprovementAppliedAction, { kind: "owner-question" }> =>
      action.kind === "owner-question",
    )
    .map((action) => action.questionId);
  const safeEditPaths = applied
    .filter((action): action is Extract<ScopeImprovementAppliedAction, { kind: "safe-edit" }> =>
      action.kind === "safe-edit",
    )
    .map((action) => action.path);
  return {
    createdTaskIds,
    ownerQuestionIds,
    safeEditPaths,
    applied,
    requiresCommit: createdTaskIds.length > 0 || safeEditPaths.length > 0,
  };
}

export function writeScopeImprovementArtifact(
  runDirPath: string,
  artifact: ScopeImprovementArtifact,
): string {
  mkdirSync(runDirPath, { recursive: true });
  const path = join(runDirPath, SCOPE_IMPROVEMENT_ARTIFACT);
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");
  return path;
}
