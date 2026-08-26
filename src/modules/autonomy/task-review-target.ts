import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import type { WorkflowCommandRunner } from "#core/workflow/workflow-command.js";

export type TaskReviewState = "doing" | "blocked" | "done";

export type TaskReviewTarget = {
  path: string;
  state: TaskReviewState;
  content: string;
};

export type TaskReviewContract = Readonly<{
  taskId: string;
  taskPath: string;
}>;

const REVIEW_STATES: TaskReviewState[] = ["done", "blocked"];
const EXACT_REVIEW_STATES: TaskReviewState[] = ["doing", "done", "blocked"];
const BUILDER_TASK_PATH_PATTERN =
  /^data\/tasks\/(?:ready|doing)\/(task-[a-z0-9][a-z0-9-]*)\.md$/;

export async function readTaskReviewMutationStatus(
  projectDir: string,
  runCommand: WorkflowCommandRunner,
): Promise<string> {
  const result = await runCommand({
    command: "git",
    args: [
      "diff",
      "HEAD",
      "--name-status",
      "--",
      "data/tasks/done/",
      "data/tasks/blocked/",
    ],
    cwd: projectDir,
  });
  return result.stdout.text;
}

export function findTaskReviewTarget(
  projectDir: string,
  mutationStatus: string,
): TaskReviewTarget | null {
  const doing = findTaskInState(projectDir, "doing");
  if (doing) return doing;

  const mutated = findMutatedTask(projectDir, mutationStatus);
  if (mutated) return mutated;

  return null;
}

export function findExpectedTaskReviewTarget(
  projectDir: string,
  expected: TaskReviewContract,
): TaskReviewTarget {
  const pathTaskId = expected.taskPath.match(BUILDER_TASK_PATH_PATTERN)?.[1];
  if (pathTaskId !== expected.taskId) {
    throw new Error(
      `Expected task ${expected.taskId} has mismatched contract path ${expected.taskPath}.`,
    );
  }

  const filename = `${expected.taskId}.md`;
  const candidates = EXACT_REVIEW_STATES.flatMap((state) => {
    const path = `data/tasks/${state}/${filename}`;
    const absolutePath = join(projectDir, path);
    return existsSync(absolutePath)
      ? [{ path, state, content: readFileSync(absolutePath, "utf8") }]
      : [];
  });

  if (candidates.length === 0) {
    throw new Error(`Expected task ${expected.taskId} was not found in the workspace.`);
  }
  if (candidates.length > 1) {
    throw new Error(
      `Expected task ${expected.taskId} is ambiguous: found ${candidates.map((candidate) => candidate.path).join(", ")}.`,
    );
  }

  const candidate = candidates[0];
  const contentTaskId = parseFlatFrontMatter(candidate.content).attrs.id;
  if (contentTaskId !== expected.taskId) {
    const actual = typeof contentTaskId === "string"
      ? contentTaskId
      : contentTaskId === undefined
        ? "no task id"
        : JSON.stringify(contentTaskId);
    throw new Error(
      `Expected task ${expected.taskId}, but ${candidate.path} contains ${actual}.`,
    );
  }

  return candidate;
}

function findTaskInState(projectDir: string, state: TaskReviewState): TaskReviewTarget | null {
  const dir = join(projectDir, "data/tasks", state);
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "AGENTS.md")
    .sort();

  if (files.length === 0) return null;

  const relPath = `data/tasks/${state}/${files[0]}`;
  return {
    path: relPath,
    state,
    content: readFileSync(join(projectDir, relPath), "utf8"),
  };
}

function findMutatedTask(
  projectDir: string,
  status: string,
): TaskReviewTarget | null {
  const candidates: TaskReviewTarget[] = [];
  for (const line of status.split("\n")) {
    const relPath = line.split("\t").at(-1);
    if (!relPath) continue;
    const match = relPath?.match(/^data\/tasks\/(done|blocked)\/task-.+\.md$/);
    if (!match) continue;

    const state = match[1] as TaskReviewState;
    if (!REVIEW_STATES.includes(state)) continue;

    const absPath = join(projectDir, relPath);
    if (!existsSync(absPath)) continue;

    candidates.push({
      path: relPath,
      state,
      content: readFileSync(absPath, "utf8"),
    });
  }

  return (
    candidates.find((candidate) => candidate.state === "done") ??
    candidates.find((candidate) => candidate.state === "blocked") ??
    null
  );
}
