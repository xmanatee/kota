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
import { assertTaskQueueValid } from "#modules/repo-tasks/task-queue-validation.js";
import { applyDecompositionPlan } from "./decomposition-actions.js";
import type { DecompositionPlan } from "./decomposition-plan.js";

const ORIGINAL_ID = "task-original-security-fix";

function runGit(workspaceRoot: string, args: string[]): string {
  return execFileSync("git", args, { cwd: workspaceRoot, encoding: "utf-8" }).trim();
}

function plan(): DecompositionPlan {
  const base = {
    reuseTaskId: null,
    priority: "p1" as const,
    problem: "The current authorization path retains stale authority.",
    desiredOutcome: "Every authorization boundary reads current authority.",
    constraints: ["Do not weaken the authorization boundary."],
    howWeWillKnow: ["Revoked access is denied at the owning public boundary."],
  };
  return { action: "replace",
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
    const activeDir = join(workspaceRoot, "data", "tasks");
    mkdirSync(join(activeDir, "archive"), { recursive: true });
    for (const id of ["task-prerequisite", "task-existing-prerequisite"]) {
      writeFileSync(join(activeDir, "archive", `${id}.md`), serializeFlatFrontMatter({ status: "done" }, `# ${id}\n\nPrerequisite completed.\n`));
    }
    writeFileSync(
      join(activeDir, `${ORIGINAL_ID}.md`),
      serializeFlatFrontMatter(
        {
          status: "open",
          priority: "p1",
          depends_on: ["task-prerequisite"],
        },
        "# Original security fix\n\n## Problem\n\nAuthority is stale.\n",
      ),
    );
    runGit(workspaceRoot, ["add", "."]);
    runGit(workspaceRoot, ["commit", "-qm", "seed"]);
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("creates ordered open tasks and archives the original through task APIs", () => {
    const dependentPath = join(workspaceRoot, "data/tasks/task-dependent.md");
    writeFileSync(dependentPath, serializeFlatFrontMatter({ status: "open", priority: "p2", depends_on: [ORIGINAL_ID] }, "# Dependent\n\nDeliver the dependent outcome.\n"));
    const result = applyDecompositionPlan({
      workspaceRoot,
      taskId: ORIGINAL_ID,
      failedRunId: "run-failed-builder",
      plan: plan(),
      heldTaskIds: [],
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
      expect(showTask(workspaceRoot, id)).toMatchObject({ found: true, state: "open" });
    }
    const second = showTask(workspaceRoot, result.subtaskIds[1]!);
    if (!second.found) throw new Error("second subtask missing");
    expect(parseFlatFrontMatter(second.content).attrs.depends_on).toEqual([
      "task-prerequisite",
      result.subtaskIds[0],
    ]);
    const first = showTask(workspaceRoot, result.subtaskIds[0]!);
    if (!first.found) throw new Error("first subtask missing");
    expect(parseFlatFrontMatter(first.content).attrs.depends_on).toEqual([
      "task-prerequisite",
    ]);
    expect(readFileSync(join(workspaceRoot, "data", "tasks", `${result.subtaskIds[0]}.md`), "utf-8"))
      .toContain("Decomposed from `task-original-security-fix`");
    expect(parseFlatFrontMatter(readFileSync(dependentPath, "utf8")).attrs.depends_on).toEqual(result.subtaskIds);
    expect(() => assertTaskQueueValid(workspaceRoot)).not.toThrow();
  });

  it("rejects an existing decomposition before creating subtasks", () => {
    const originalPath = join(
      workspaceRoot,
      "data",
      "tasks",
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
        heldTaskIds: [],
      }),
    ).toThrow("already records a decomposition");
    expect(
      existsSync(
        join(
          workspaceRoot,
          "data",
          "tasks",
          "task-resolve-current-authority-at-hosted-tool-boundarie.md",
        ),
      ),
    ).toBe(false);
  });

  it("reuses an existing task and links dependencies without creating a duplicate", () => {
    const existingId = "task-existing-authority-boundary";
    const existingTitle = "Existing authority boundary";
    writeFileSync(
      join(workspaceRoot, "data", "tasks", `${existingId}.md`),
      serializeFlatFrontMatter(
        {
          status: "open",
          priority: "p1",
          depends_on: ["task-existing-prerequisite"],
        },
        `# ${existingTitle}\n\n## Desired Outcome\n\nKeep the existing acceptance evidence.\n`,
      ),
    );
    const reusePlan = plan();
    reusePlan.subtasks[0] = {
      ...reusePlan.subtasks[0]!,
      reuseTaskId: existingId,
      title: existingTitle,
    };

    const result = applyDecompositionPlan({
      workspaceRoot,
      taskId: ORIGINAL_ID,
      failedRunId: "run-failed-builder",
      plan: reusePlan,
      heldTaskIds: [],
    });

    expect(result.subtaskIds[0]).toBe(existingId);
    const reused = showTask(workspaceRoot, existingId);
    if (!reused.found) throw new Error("reused task missing");
    expect(reused.content).toContain("Keep the existing acceptance evidence.");
    expect(parseFlatFrontMatter(reused.content).attrs.depends_on).toEqual([
      "task-existing-prerequisite",
      "task-prerequisite",
    ]);
    expect(
      existsSync(
        join(
          workspaceRoot,
          "data",
          "tasks",
          "task-existing-authority-boundary.md",
        ),
      ),
    ).toBe(true);
  });

  it("rejects held dependents and invalid replacement graphs before any task writes", () => {
    const dependentPath = join(workspaceRoot, "data/tasks/task-dependent.md");
    writeFileSync(dependentPath, serializeFlatFrontMatter({ status: "open", priority: "p2", depends_on: [ORIGINAL_ID] }, "# Dependent\n\nDeliver the dependent outcome.\n"));
    const before = runGit(workspaceRoot, ["diff", "--", "data/tasks"]);
    const dependentBefore = readFileSync(dependentPath, "utf8");
    const input = { workspaceRoot, taskId: ORIGINAL_ID, failedRunId: "run-failed-builder", plan: plan(), heldTaskIds: ["task-dependent"] };
    expect(() => applyDecompositionPlan(input)).toThrow("held task:task-dependent");
    expect(showTask(workspaceRoot, ORIGINAL_ID)).toMatchObject({ state: "open" });
    expect(showTask(workspaceRoot, "task-resolve-current-authority-at-hosted-tool-boundarie")).toMatchObject({ found: false });
    const cyclic = plan();
    cyclic.subtasks[0] = { ...cyclic.subtasks[0]!, reuseTaskId: "task-dependent", title: "Dependent" };
    expect(() => applyDecompositionPlan({ ...input, heldTaskIds: [], plan: cyclic })).toThrow("cannot depend on itself");
    expect(runGit(workspaceRoot, ["diff", "--", "data/tasks"])).toBe(before);
    expect(readFileSync(dependentPath, "utf8")).toBe(dependentBefore);
  });
});
