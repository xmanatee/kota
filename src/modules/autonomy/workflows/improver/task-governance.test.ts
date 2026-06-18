import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectImproverTaskGovernance } from "./task-governance.js";

const projectDirs: string[] = [];

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "improver-task-governance-"));
  projectDirs.push(dir);
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
  }
  return dir;
}

function writeTask(
  projectDir: string,
  state: string,
  id: string,
  options: {
    taskClass?: "Product" | "Safety" | "Platform" | "Meta";
    priority?: string;
    updatedAt?: string;
    body?: string;
  } = {},
): void {
  const updatedAt = options.updatedAt ?? "2026-06-01T00:00:00.000Z";
  const lines = [
    "---",
    `id: ${id}`,
    `title: ${id}`,
    `status: ${state}`,
    `priority: ${options.priority ?? "p1"}`,
    "area: autonomy",
    `summary: ${id} summary`,
    `created_at: ${updatedAt}`,
    `updated_at: ${updatedAt}`,
  ];
  if (options.taskClass) lines.push(`task_class: ${options.taskClass}`);
  lines.push("---", "", options.body ?? "## Problem\n\nTask body.\n");
  writeFileSync(
    join(projectDir, "data", "tasks", state, `${id}.md`),
    `${lines.join("\n")}\n`,
  );
}

afterEach(() => {
  for (const dir of projectDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("collectImproverTaskGovernance", () => {
  it("summarizes open tasks by task_class in governance order", () => {
    const projectDir = makeProjectDir();
    writeTask(projectDir, "ready", "task-product", { taskClass: "Product" });
    writeTask(projectDir, "doing", "task-safety", { taskClass: "Safety" });
    writeTask(projectDir, "backlog", "task-platform", { taskClass: "Platform" });
    writeTask(projectDir, "blocked", "task-meta", { taskClass: "Meta" });
    writeTask(projectDir, "ready", "task-unclassified");
    writeTask(projectDir, "done", "task-done-product", { taskClass: "Product" });

    const evidence = collectImproverTaskGovernance(
      projectDir,
      new Date("2026-06-18T00:00:00.000Z"),
    );

    expect(evidence.generatedAt).toBe("2026-06-18T00:00:00.000Z");
    expect(evidence.openByTaskClass).toEqual([
      { taskClass: "Safety", count: 1 },
      { taskClass: "Product", count: 1 },
      { taskClass: "Platform", count: 1 },
      { taskClass: "Meta", count: 1 },
      { taskClass: "Unclassified", count: 1 },
    ]);
  });

  it("flags actionable Meta tasks that lack a Product / Safety Link", () => {
    const projectDir = makeProjectDir();
    writeTask(projectDir, "ready", "task-meta-missing-link", {
      taskClass: "Meta",
      body: "## Problem\n\nRepair loop polish.\n",
    });
    writeTask(projectDir, "doing", "task-meta-linked", {
      taskClass: "Meta",
      body:
        "## Problem\n\nRepair runtime.\n\n" +
        "## Product / Safety Link\n\n" +
        "Runtime failures block Product/Safety shipping.\n",
    });

    const evidence = collectImproverTaskGovernance(projectDir);

    expect(evidence.actionableMetaWithoutProductSafetyLink).toEqual([
      expect.objectContaining({
        taskId: "task-meta-missing-link",
        state: "ready",
        reason: expect.stringContaining("Product / Safety Link"),
      }),
    ]);
  });

  it("flags done Product tasks that mention no operator-journey evidence", () => {
    const projectDir = makeProjectDir();
    writeTask(projectDir, "done", "task-product-without-evidence", {
      taskClass: "Product",
      updatedAt: "2026-06-02T00:00:00.000Z",
      body: "## Acceptance Evidence\n\n- Unit test output.\n",
    });
    writeTask(projectDir, "done", "task-product-with-transcript", {
      taskClass: "Product",
      updatedAt: "2026-06-03T00:00:00.000Z",
      body:
        "## Acceptance Evidence\n\n" +
        "- `.kota/runs/demo/transcript.txt` captures the operator command.\n",
    });

    const evidence = collectImproverTaskGovernance(projectDir);

    expect(evidence.productDoneWithoutOperatorEvidence).toEqual([
      expect.objectContaining({
        taskId: "task-product-without-evidence",
        reason: expect.stringContaining("operator-journey evidence"),
      }),
    ]);
  });
});
