import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { getCriticPromptHash } from "#modules/autonomy/critic.js";

export const NOW = Date.parse("2026-06-23T12:00:00.000Z");

export async function mockCleanWorktree() {
  const { getRepoWorktreeStatus } = await import("#core/util/repo-worktree.js");
  vi.mocked(getRepoWorktreeStatus).mockReturnValue({
    available: true,
    dirty: false,
    trackedDirty: false,
    entries: [],
    fingerprint: "",
    summary: "clean",
    headSha: "abc1234",
  });
}

export function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "review-scrutiny-workflow-"));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
  }
  mkdirSync(join(dir, ".kota", "runs"), { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  execFileSync("git", ["commit", "--allow-empty", "-m", "initial", "--quiet"], {
    cwd: dir,
  });
  return dir;
}

export function writeTask(
  projectDir: string,
  id: string,
  options: { area?: string; taskClass?: string } = {},
): void {
  const updatedAt = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
  writeFileSync(
    join(projectDir, "data", "tasks", "done", `${id}.md`),
    [
      "---",
      `id: ${id}`,
      `title: ${id}`,
      "status: done",
      "priority: p2",
      `area: ${options.area ?? "autonomy"}`,
      `task_class: ${options.taskClass ?? "Meta"}`,
      "summary: test",
      `created_at: ${updatedAt}`,
      `updated_at: ${updatedAt}`,
      "---",
      "",
      "## Problem",
      "",
      "Test task.",
      "",
    ].join("\n"),
    "utf-8",
  );
}

export function seedCriticRun(
  projectDir: string,
  id: string,
  minutesAgo: number,
  taskId: string,
): void {
  writeCriticRun(projectDir, id, minutesAgo, taskId, {
    verdict: "pass",
    warnings: [],
  });
}

export function seedWarningBackedCriticRun(
  projectDir: string,
  id: string,
  minutesAgo: number,
  taskId: string,
): void {
  writeCriticRun(projectDir, id, minutesAgo, taskId, {
    verdict: "pass_with_warnings",
    warnings: [
      "Accepted reviewer verdict omitted warnings, critical issues, and file-line citations; review-scrutiny recorded this reviewer-evidence gap.",
    ],
  });
}

export function listReadyTaskPaths(projectDir: string): string[] {
  return execFileSync(
    "find",
    [join(projectDir, "data", "tasks", "ready"), "-name", "*.md"],
    { encoding: "utf-8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
}

export function readTextFile(path: string): string {
  return readFileSync(path, "utf-8");
}

export function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function writeCriticRun(
  projectDir: string,
  id: string,
  minutesAgo: number,
  taskId: string,
  review: { verdict: "pass" | "pass_with_warnings"; warnings: string[] },
): void {
  const completedAt = new Date(NOW - minutesAgo * 60 * 1000).toISOString();
  const metadata: WorkflowRunMetadata = {
    id,
    workflow: "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: { event: "workflow.completed", schemaRef: null, payload: {} },
    startedAt: new Date(NOW - minutesAgo * 60 * 1000 - 1000).toISOString(),
    completedAt,
    status: "success",
    durationMs: 1000,
    runDir: `.kota/runs/${id}`,
    steps: [],
  };
  const runDir = join(projectDir, ".kota", "runs", id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2));
  writeFileSync(
    join(runDir, "run-summary.json"),
    JSON.stringify({ taskId }, null, 2),
  );
  writeFileSync(
    join(runDir, "critic-review.json"),
    JSON.stringify({
      verdict: review.verdict,
      critical_issues: [],
      warnings: review.warnings,
      summary: "Accepted.",
      reviewerPromptHash: getCriticPromptHash(),
    }, null, 2),
  );
}
