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

function runGit(projectDir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: projectDir, encoding: "utf-8" }).trim();
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
    doneWhen: ["A focused policy-revocation regression passes."],
    sourceIntent: "Preserve the confirmed security finding.",
    initiative: "Safe autonomous coding infrastructure.",
    acceptanceEvidence: ["A regression transcript proves revoked access is denied."],
  };
  return {
    rationale: "Separate authority revision from harness cancellation.",
    subtasks: [
      {
        ...base,
        title: "Resolve current authority at hosted tool boundaries",
        reuseTaskId: null,
        dependsOn: [],
      },
      {
        ...base,
        title: "Cancel opaque harnesses after authority revocation",
        reuseTaskId: null,
        dependsOn: [0],
      },
    ],
  };
}

describe("applyDecompositionPlan", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-decomposition-actions-"));
    runGit(projectDir, ["init", "-q"]);
    runGit(projectDir, ["config", "user.email", "test@example.com"]);
    runGit(projectDir, ["config", "user.name", "Test"]);
    const readyDir = join(projectDir, "data", "tasks", "ready");
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
    runGit(projectDir, ["add", "."]);
    runGit(projectDir, ["commit", "-qm", "seed"]);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("creates ordered ready tasks and retires the original through task APIs", () => {
    const result = applyDecompositionPlan({
      projectDir,
      taskId: ORIGINAL_ID,
      failedRunId: "run-failed-builder",
      plan: plan(),
    });

    expect(result.subtaskIds).toEqual([
      "task-resolve-current-authority-at-hosted-tool-boundarie",
      "task-cancel-opaque-harnesses-after-authority-revocation",
    ]);
    expect(result.mutatedTaskPaths).toEqual([
      "data/tasks/ready/task-resolve-current-authority-at-hosted-tool-boundarie.md",
      "data/tasks/ready/task-cancel-opaque-harnesses-after-authority-revocation.md",
    ]);
    const original = showTask(projectDir, ORIGINAL_ID);
    expect(original).toMatchObject({ found: true, state: "dropped" });
    if (!original.found) throw new Error("original task missing");
    expect(original.content).toContain("## Decomposed");
    for (const id of result.subtaskIds) {
      expect(showTask(projectDir, id)).toMatchObject({ found: true, state: "ready" });
    }
    const second = showTask(projectDir, result.subtaskIds[1]!);
    if (!second.found) throw new Error("second subtask missing");
    expect(parseFlatFrontMatter(second.content).attrs.depends_on).toEqual([
      result.subtaskIds[0],
    ]);
    expect(readFileSync(join(projectDir, "data", "tasks", "ready", `${result.subtaskIds[0]}.md`), "utf-8"))
      .toContain("Decomposed from `task-original-security-fix`");
  });

  it("reuses a semantic match and carries parent dependencies through the lifecycle", () => {
    const originalPath = join(
      projectDir,
      "data",
      "tasks",
      "ready",
      `${ORIGINAL_ID}.md`,
    );
    const parsedOriginal = parseFlatFrontMatter(
      readFileSync(originalPath, "utf-8"),
    );
    writeFileSync(
      originalPath,
      serializeFlatFrontMatter(
        { ...parsedOriginal.attrs, depends_on: ["task-authority-foundation"] },
        parsedOriginal.body,
      ),
    );
    const existingId = "task-existing-hosted-authority-boundary";
    const existingPath = join(
      projectDir,
      "data",
      "tasks",
      "ready",
      `${existingId}.md`,
    );
    writeFileSync(
      existingPath,
      serializeFlatFrontMatter(
        {
          id: existingId,
          title: "Existing hosted authority boundary",
          status: "ready",
          priority: "p1",
          area: "security",
          task_class: "Safety",
          summary: "Resolve current authority at hosted tool boundaries.",
          created_at: "2026-08-03T00:00:00.000Z",
          updated_at: "2026-08-03T00:00:00.000Z",
        },
        "\n## Problem\n\nHosted calls can retain stale authority.\n\n" +
          "## Acceptance Evidence\n\n- A revocation regression.\n",
      ),
    );

    const reusePlan = plan();
    reusePlan.subtasks[0]!.reuseTaskId = existingId;
    const result = applyDecompositionPlan({
      projectDir,
      taskId: ORIGINAL_ID,
      failedRunId: "run-failed-builder",
      plan: reusePlan,
    });

    expect(result.subtaskIds).toEqual([
      existingId,
      "task-cancel-opaque-harnesses-after-authority-revocation",
    ]);
    expect(result.mutatedTaskPaths).toEqual([
      `data/tasks/ready/${existingId}.md`,
      "data/tasks/ready/task-cancel-opaque-harnesses-after-authority-revocation.md",
    ]);
    const reused = showTask(projectDir, existingId);
    if (!reused.found) throw new Error("reused task missing");
    expect(parseFlatFrontMatter(reused.content).attrs.depends_on).toEqual([
      "task-authority-foundation",
    ]);
    expect(reused.content).toContain(
      "Reused for `task-original-security-fix` after builder run `run-failed-builder`.",
    );
    expect(reused.content).toContain("- A revocation regression.");
    const created = showTask(projectDir, result.subtaskIds[1]!);
    if (!created.found) throw new Error("created task missing");
    expect(parseFlatFrontMatter(created.content).attrs.depends_on).toEqual([
      "task-authority-foundation",
      existingId,
    ]);
    expect(
      existsSync(
        join(
          projectDir,
          "data",
          "tasks",
          "ready",
          "task-resolve-current-authority-at-hosted-tool-boundarie.md",
        ),
      ),
    ).toBe(false);
    const original = showTask(projectDir, ORIGINAL_ID);
    if (!original.found) throw new Error("dropped original missing");
    expect(original.content).toContain(`- ${existingId}`);
  });

  it("rejects an existing decomposition before creating subtasks", () => {
    const originalPath = join(
      projectDir,
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
        projectDir,
        taskId: ORIGINAL_ID,
        failedRunId: "run-failed-builder",
        plan: plan(),
      }),
    ).toThrow("already records a decomposition");
    expect(
      existsSync(
        join(
          projectDir,
          "data",
          "tasks",
          "ready",
          "task-resolve-current-authority-at-hosted-tool-boundarie.md",
        ),
      ),
    ).toBe(false);
  });
});
