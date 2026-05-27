import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";

export type TaskReviewState = "doing" | "blocked" | "done";

export type TaskReviewTarget = {
  path: string;
  state: TaskReviewState;
  content: string;
};

const REVIEW_STATES: TaskReviewState[] = ["done", "blocked"];

export function findTaskReviewTarget(projectDir: string): TaskReviewTarget | null {
  const doing = findTaskInState(projectDir, "doing");
  if (doing) return doing;

  const staged = findStagedTask(projectDir);
  if (staged) return staged;

  return null;
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

function findStagedTask(projectDir: string): TaskReviewTarget | null {
  const status = execFileSync(
    "git",
    ["diff", "--cached", "--name-status", "--", "data/tasks/done/", "data/tasks/blocked/"],
    {
      cwd: projectDir,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

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
