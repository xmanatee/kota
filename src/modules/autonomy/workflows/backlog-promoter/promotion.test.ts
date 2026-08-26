import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import { buildPromotionRationale, compareBacklogCandidates } from "./promotion.js";

const projects: string[] = [];

function record(
  id: string,
  priority: string,
  updatedAt: string,
  taskClass: RepoTaskFullRecord["taskClass"] = "Unclassified",
): RepoTaskFullRecord {
  return {
    id,
    title: id,
    state: "backlog",
    priority,
    area: "core",
    taskClass,
    summary: "",
    updatedAt,
    body: "",
    dependsOn: [],
    anchor: false,
  };
}

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "backlog-promotion-"));
  projects.push(dir);
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
  }
  return dir;
}

function writeTask(args: {
  projectDir: string;
  id: string;
  state?: "backlog" | "ready" | "done";
  priority?: string;
  updatedAt?: string;
  taskClass?: string;
  anchor?: boolean;
  dependsOn?: string[];
}): void {
  const state = args.state ?? "backlog";
  const updatedAt = args.updatedAt ?? "2026-08-26T00:00:00.000Z";
  const lines = [
    "---",
    `id: ${args.id}`,
    `title: ${args.id}`,
    `status: ${state}`,
    `priority: ${args.priority ?? "p2"}`,
    "area: core",
    `summary: ${args.id}`,
    `created_at: ${updatedAt}`,
    `updated_at: ${updatedAt}`,
    ...(args.taskClass ? [`task_class: ${args.taskClass}`] : []),
    ...(args.anchor ? ["anchor: true"] : []),
    ...(args.dependsOn
      ? [`depends_on: [${args.dependsOn.join(", ")}]`]
      : []),
    "---",
    "",
    "Natural task intent.",
  ];
  writeFileSync(
    join(args.projectDir, "data", "tasks", state, `${args.id}.md`),
    `${lines.join("\n")}\n`,
  );
}

afterEach(() => {
  for (const dir of projects.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("backlog promotion order", () => {
  it("orders by priority, then age, then id", () => {
    const records = [
      record("task-p2-old", "p2", "2026-01-01T00:00:00.000Z"),
      record("task-p1-new", "p1", "2026-03-01T00:00:00.000Z"),
      record("task-p1-old", "p1", "2026-02-01T00:00:00.000Z"),
    ];

    expect(records.sort(compareBacklogCandidates).map((item) => item.id)).toEqual([
      "task-p1-old",
      "task-p1-new",
      "task-p2-old",
    ]);
  });

  it("does not use task class as an execution preference", () => {
    const updatedAt = "2026-02-01T00:00:00.000Z";
    const records = [
      record("task-z-product", "p1", updatedAt, "Product"),
      record("task-a-unclassified", "p1", updatedAt),
      record("task-m-meta", "p1", updatedAt, "Meta"),
    ];

    expect(records.sort(compareBacklogCandidates).map((item) => item.id)).toEqual([
      "task-a-unclassified",
      "task-m-meta",
      "task-z-product",
    ]);
  });

  it("selects a small priority-and-age batch", () => {
    const projectDir = project();
    writeTask({ projectDir, id: "task-p2", priority: "p2" });
    writeTask({
      projectDir,
      id: "task-p1-new",
      priority: "p1",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    writeTask({
      projectDir,
      id: "task-p1-old",
      priority: "p1",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const rationale = buildPromotionRationale(projectDir);

    expect(rationale.selected.map((item) => item.id)).toEqual([
      "task-p1-old",
      "task-p1-new",
    ]);
    expect(rationale.summary).toContain("task labels and prose do not gate execution");
  });

  it("skips anchors and dependency-waiting work", () => {
    const projectDir = project();
    writeTask({ projectDir, id: "task-anchor", priority: "p0", anchor: true });
    writeTask({ projectDir, id: "task-enabler", priority: "p2" });
    writeTask({
      projectDir,
      id: "task-waiting",
      priority: "p0",
      dependsOn: ["task-enabler"],
    });
    writeTask({ projectDir, id: "task-free", priority: "p1" });

    const rationale = buildPromotionRationale(projectDir);

    expect(rationale.selected.map((item) => item.id)).toContain("task-free");
    expect(rationale.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "task-anchor" }),
      expect.objectContaining({ id: "task-waiting" }),
    ]));
  });

  it("promotes only work that outranks the current ready frontier", () => {
    const projectDir = project();
    writeTask({
      projectDir,
      id: "task-ready",
      state: "ready",
      priority: "p1",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    writeTask({
      projectDir,
      id: "task-backlog",
      priority: "p1",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });

    expect(buildPromotionRationale(projectDir).selected).toEqual([]);
  });
});
