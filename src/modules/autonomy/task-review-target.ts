import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import type { WorkflowCommandRunner } from "#core/workflow/workflow-command.js";

export type TaskReviewState = "open" | "blocked" | "done" | "dropped";

export type TaskReviewTarget = {
  path: string;
  state: TaskReviewState;
  content: string;
};

export type TaskReviewContract = Readonly<{
  taskId: string;
  taskPath: string;
}>;

const REVIEW_STATES: TaskReviewState[] = ["done", "dropped", "blocked"];
const BUILDER_TASK_PATH_PATTERN = /^data\/tasks\/(task-[a-z0-9][a-z0-9-]*)\.md$/;

export async function readTaskReviewMutationStatus(
  workspaceRoot: string,
  runCommand: WorkflowCommandRunner,
): Promise<string> {
  const result = await runCommand({
    command: "git",
    args: [
      "diff",
      "HEAD",
      "--name-status",
      "--",
      "data/tasks/",
    ],
    cwd: workspaceRoot,
  });
  return result.stdout.text;
}

export function findTaskReviewTarget(
  workspaceRoot: string,
  mutationStatus: string,
): TaskReviewTarget | null {
  const open = findTaskInState(workspaceRoot, "open");
  if (open) return open;

  const mutated = findMutatedTask(workspaceRoot, mutationStatus);
  if (mutated) return mutated;

  return null;
}

export function findExpectedTaskReviewTarget(
  workspaceRoot: string,
  expected: TaskReviewContract,
): TaskReviewTarget {
  const pathTaskId = expected.taskPath.match(BUILDER_TASK_PATH_PATTERN)?.[1];
  if (pathTaskId !== expected.taskId) {
    throw new Error(
      `Expected task ${expected.taskId} has mismatched contract path ${expected.taskPath}.`,
    );
  }

  const candidates = [
    `data/tasks/${expected.taskId}.md`,
    `data/tasks/archive/${expected.taskId}.md`,
  ].flatMap((path) => {
    const absolutePath = join(workspaceRoot, path);
    if (!existsSync(absolutePath)) return [];
    const content = readFileSync(absolutePath, "utf8");
    const status = parseFlatFrontMatter(content).attrs.status;
    if (status !== "open" && status !== "blocked" && status !== "done" && status !== "dropped") {
      throw new Error(`Expected task ${expected.taskId} has invalid status ${String(status)}.`);
    }
    return [{ path, state: status as TaskReviewState, content }];
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
  return candidate;
}

function findTaskInState(workspaceRoot: string, state: TaskReviewState): TaskReviewTarget | null {
  const dir = join(workspaceRoot, "data/tasks");
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "AGENTS.md")
    .filter((f) => parseFlatFrontMatter(readFileSync(join(dir, f), "utf8")).attrs.status === state)
    .sort();

  if (files.length === 0) return null;

  const relPath = `data/tasks/${files[0]}`;
  return {
    path: relPath,
    state,
    content: readFileSync(join(workspaceRoot, relPath), "utf8"),
  };
}

function findMutatedTask(
  workspaceRoot: string,
  status: string,
): TaskReviewTarget | null {
  const candidates: TaskReviewTarget[] = [];
  for (const line of status.split("\n")) {
    const relPath = line.split("\t").at(-1);
    if (!relPath) continue;
    if (!/^data\/tasks\/(?:archive\/)?task-.+\.md$/.test(relPath)) continue;
    const absPath = join(workspaceRoot, relPath);
    if (!existsSync(absPath)) continue;
    const content = readFileSync(absPath, "utf8");
    const state = parseFlatFrontMatter(content).attrs.status as TaskReviewState;
    if (!REVIEW_STATES.includes(state)) continue;

    candidates.push({
      path: relPath,
      state,
      content,
    });
  }

  return (
    candidates.find((candidate) => candidate.state === "done") ??
    candidates.find((candidate) => candidate.state === "dropped") ??
    candidates.find((candidate) => candidate.state === "blocked") ??
    null
  );
}
