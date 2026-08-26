import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import { showTask } from "#modules/repo-tasks/repo-tasks-operations.js";
import { applyDecompositionPlan } from "./decomposition-actions.js";
import type { DecompositionPlan } from "./decomposition-plan.js";

const ORIGINAL_ID = "task-original-security-fix";

function runGit(workspaceRoot: string, args: string[]): string {
  return execFileSync("git", args, { cwd: workspaceRoot, encoding: "utf-8" }).trim();
}

function plan(): DecompositionPlan {
  const base = {
    summary: "Complete one bounded authorization outcome.",
    priority: "p1" as const,
    area: "security",
    taskClass: "Safety" as const,
    problem: "The current authorization path retains stale authority.",
    desiredOutcome: "Every authorization boundary reads current authority.",
    constraints: ["Do not weaken the authorization boundary."],
    howWeWillKnow: ["Revoked access is denied at the owning public boundary."],
  };
  return {
    rationale: "Separate authority revision from harness cancellation.",
    subtasks: [
      { ...base, title: "Resolve current authority at hosted tool boundaries", dependsOn: [] },
      {
        ...base,
        title: "Cancel opaque harnesses after authority revocation",
        dependsOn: [0],
      },
    ],
  };
}

describe("applyDecompositionPlan", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "kota-decomposition-actions-"));
    runGit(workspaceRoot, ["init", "-q"]);
    runGit(workspaceRoot, ["config", "user.email", "test@example.com"]);
    runGit(workspaceRoot, ["config", "user.name", "Test"]);
    const readyDir = join(workspaceRoot, "data", "tasks", "ready");
    mkdirSync(readyDir, { recursive: true });
    writeFileSync(
      join(readyDir, `${ORIGINAL_ID}.md`),
      serializeFlatFrontMatter(
        {
          id: ORIGINAL_ID,
          title: "Original security fix",
          status: "ready",
          priority: "p1",
          area: "security",
          task_class: "Safety",
          summary: "Fix stale authority.",
          created_at: "2026-08-03T00:00:00.000Z",
          updated_at: "2026-08-03T00:00:00.000Z",
        },
        "\n## Problem\n\nAuthority is stale.\n",
      ),
    );
    runGit(workspaceRoot, ["add", "."]);
    runGit(workspaceRoot, ["commit", "-qm", "seed"]);
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("creates ordered ready tasks and retires the original through task APIs", () => {
    const result = applyDecompositionPlan({
      workspaceRoot,
      taskId: ORIGINAL_ID,
      failedRunId: "run-failed-builder",
      plan: plan(),
    });

    expect(result.subtaskIds).toEqual([
      "task-resolve-current-authority-at-hosted-tool-boundarie",
      "task-cancel-opaque-harnesses-after-authority-revocation",
    ]);
    const original = showTask(workspaceRoot, ORIGINAL_ID);
    expect(original).toMatchObject({ found: true, state: "dropped" });
    if (!original.found) throw new Error("original task missing");
    expect(original.content).toContain("## Decomposed");
    for (const id of result.subtaskIds) {
      expect(showTask(workspaceRoot, id)).toMatchObject({ found: true, state: "ready" });
    }
    const second = showTask(workspaceRoot, result.subtaskIds[1]!);
    if (!second.found) throw new Error("second subtask missing");
    expect(parseFlatFrontMatter(second.content).attrs.depends_on).toEqual([
      result.subtaskIds[0],
    ]);
    expect(readFileSync(join(workspaceRoot, "data", "tasks", "ready", `${result.subtaskIds[0]}.md`), "utf-8"))
      .toContain("Decomposed from `task-original-security-fix`");
  });

  it("rejects an existing decomposition before creating subtasks", () => {
    const originalPath = join(
      workspaceRoot,
      "data",
      "tasks",
      "ready",
      `${ORIGINAL_ID}.md`,
    );
    writeFileSync(
      originalPath,
      `${readFileSync(originalPath, "utf-8").trim()}\n\n## Decomposed\n\n- task-existing\n`,
    );

    expect(() =>
      applyDecompositionPlan({
        workspaceRoot,
        taskId: ORIGINAL_ID,
        failedRunId: "run-failed-builder",
        plan: plan(),
      }),
    ).toThrow("already records a decomposition");
    expect(
      existsSync(
        join(
          workspaceRoot,
          "data",
          "tasks",
          "ready",
          "task-resolve-current-authority-at-hosted-tool-boundarie.md",
        ),
      ),
    ).toBe(false);
  });
});
