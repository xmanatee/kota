import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPromotionRationale, compareBacklogCandidates } from "./promotion.js";

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "backlog-promoter-test-"));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
    writeFileSync(join(dir, "data", "tasks", state, "AGENTS.md"), `# ${state}\n`);
  }
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  return dir;
}

function writeTask(
  projectDir: string,
  state: string,
  id: string,
  attrs: {
    priority?: string;
    area?: string;
    updatedAt?: string;
    anchor?: boolean;
    dependsOn?: string[];
    taskClass?: "Product" | "Safety" | "Platform" | "Meta";
    body?: string;
  } = {},
): void {
  const priority = attrs.priority ?? "p2";
  const area = attrs.area ?? "modules";
  const updatedAt = attrs.updatedAt ?? "2026-04-01T00:00:00.000Z";
  const lines = [
    "---",
    `id: ${id}`,
    `title: ${id}`,
    `status: ${state}`,
    `priority: ${priority}`,
    `area: ${area}`,
    `summary: ${id} summary`,
    `created_at: ${updatedAt}`,
    `updated_at: ${updatedAt}`,
  ];
  if (attrs.anchor) lines.push("anchor: true");
  if (attrs.taskClass) lines.push(`task_class: ${attrs.taskClass}`);
  if (attrs.dependsOn) lines.push(`depends_on: [${attrs.dependsOn.join(", ")}]`);
  lines.push("---", "");
  if (attrs.body) lines.push(attrs.body);
  writeFileSync(
    join(projectDir, "data", "tasks", state, `${id}.md`),
    `${lines.join("\n")}\n`,
  );
}

describe("compareBacklogCandidates", () => {
  it("orders by priority before strategic area or age", () => {
    const newer = "2026-04-30T00:00:00.000Z";
    const older = "2026-03-01T00:00:00.000Z";
    const records = [
      {
        id: "task-p2-architecture-old",
        title: "p2 arch",
        state: "backlog" as const,
        priority: "p2",
        area: "architecture",
        taskClass: "Unclassified" as const,
        summary: "",
        updatedAt: older,
        body: "",
        dependsOn: [],
        anchor: false,
      },
      {
        id: "task-p1-modules-new",
        title: "p1 modules",
        state: "backlog" as const,
        priority: "p1",
        area: "modules",
        taskClass: "Unclassified" as const,
        summary: "",
        updatedAt: newer,
        body: "",
        dependsOn: [],
        anchor: false,
      },
    ];
    const sorted = [...records].sort(compareBacklogCandidates);
    expect(sorted[0].id).toBe("task-p1-modules-new");
    expect(sorted[1].id).toBe("task-p2-architecture-old");
  });

  it("uses task_class before strategic area within the same priority", () => {
    const updatedAt = "2026-04-01T00:00:00.000Z";
    const records = [
      {
        id: "task-p1-client",
        title: "client",
        state: "backlog" as const,
        priority: "p1",
        area: "client",
        taskClass: "Product" as const,
        summary: "",
        updatedAt,
        body: "",
        dependsOn: [],
        anchor: false,
      },
      {
        id: "task-p1-autonomy",
        title: "autonomy",
        state: "backlog" as const,
        priority: "p1",
        area: "autonomy",
        taskClass: "Platform" as const,
        summary: "",
        updatedAt,
        body: "",
        dependsOn: [],
        anchor: false,
      },
    ];
    const sorted = [...records].sort(compareBacklogCandidates);
    expect(sorted[0].id).toBe("task-p1-client");
    expect(sorted[1].id).toBe("task-p1-autonomy");
  });

  it("prefers actionable Product and Safety work over same-priority Meta repair work", () => {
    const updatedAt = "2026-04-01T00:00:00.000Z";
    const records = [
      {
        id: "task-p1-meta-old",
        title: "meta",
        state: "backlog" as const,
        priority: "p1",
        area: "autonomy",
        taskClass: "Meta" as const,
        summary: "",
        updatedAt: "2026-02-01T00:00:00.000Z",
        body: "",
        dependsOn: [],
        anchor: false,
      },
      {
        id: "task-p1-product-new",
        title: "product",
        state: "backlog" as const,
        priority: "p1",
        area: "client",
        taskClass: "Product" as const,
        summary: "",
        updatedAt,
        body: "",
        dependsOn: [],
        anchor: false,
      },
      {
        id: "task-p1-safety-new",
        title: "safety",
        state: "backlog" as const,
        priority: "p1",
        area: "modules",
        taskClass: "Safety" as const,
        summary: "",
        updatedAt,
        body: "",
        dependsOn: [],
        anchor: false,
      },
    ];
    const sorted = [...records].sort(compareBacklogCandidates);
    expect(sorted.map((record) => record.id)).toEqual([
      "task-p1-safety-new",
      "task-p1-product-new",
      "task-p1-meta-old",
    ]);
  });

  it("lets generated runtime-posture repair outrank same-priority Product and Safety work", () => {
    const updatedAt = "2026-04-01T00:00:00.000Z";
    const runtimeRepairBody = [
      "## Product / Safety Link",
      "",
      "Persistent monitored workflow failures are a runtime posture blocker:",
      "autonomy cannot reliably ship or review Product/Safety work while this root cause keeps recurring.",
      "",
      "<!-- workflow-failure-pattern-fingerprint: workflow-failure:consecutive-failures:builder:repair-check:abc123 -->",
    ].join("\n");
    const records = [
      {
        id: "task-p1-product-new",
        title: "product",
        state: "backlog" as const,
        priority: "p1",
        area: "client",
        taskClass: "Product" as const,
        summary: "",
        updatedAt,
        body: "",
        dependsOn: [],
        anchor: false,
      },
      {
        id: "task-p1-safety-new",
        title: "safety",
        state: "backlog" as const,
        priority: "p1",
        area: "modules",
        taskClass: "Safety" as const,
        summary: "",
        updatedAt,
        body: "",
        dependsOn: [],
        anchor: false,
      },
      {
        id: "task-repair-workflow-failure-pattern-runtime",
        title: "runtime repair",
        state: "backlog" as const,
        priority: "p1",
        area: "autonomy",
        taskClass: "Meta" as const,
        summary: "",
        updatedAt,
        body: runtimeRepairBody,
        dependsOn: [],
        anchor: false,
      },
    ];

    const sorted = [...records].sort(compareBacklogCandidates);

    expect(sorted.map((record) => record.id)).toEqual([
      "task-repair-workflow-failure-pattern-runtime",
      "task-p1-safety-new",
      "task-p1-product-new",
    ]);
  });

  it("uses strategic area as a tie-break after task class", () => {
    const updatedAt = "2026-04-01T00:00:00.000Z";
    const records = [
      {
        id: "task-p1-client",
        title: "client",
        state: "backlog" as const,
        priority: "p1",
        area: "client",
        taskClass: "Product" as const,
        summary: "",
        updatedAt,
        body: "",
        dependsOn: [],
        anchor: false,
      },
      {
        id: "task-p1-product-core",
        title: "core",
        state: "backlog" as const,
        priority: "p1",
        area: "core",
        taskClass: "Product" as const,
        summary: "",
        updatedAt,
        body: "",
        dependsOn: [],
        anchor: false,
      },
    ];
    const sorted = [...records].sort(compareBacklogCandidates);
    expect(sorted[0].id).toBe("task-p1-product-core");
    expect(sorted[1].id).toBe("task-p1-client");
  });

  it("uses oldest updated_at as the final tie-break", () => {
    const records = [
      {
        id: "task-p1-recent",
        title: "recent",
        state: "backlog" as const,
        priority: "p1",
        area: "autonomy",
        taskClass: "Platform" as const,
        summary: "",
        updatedAt: "2026-04-30T00:00:00.000Z",
        body: "",
        dependsOn: [],
        anchor: false,
      },
      {
        id: "task-p1-old",
        title: "old",
        state: "backlog" as const,
        priority: "p1",
        area: "autonomy",
        taskClass: "Platform" as const,
        summary: "",
        updatedAt: "2026-03-01T00:00:00.000Z",
        body: "",
        dependsOn: [],
        anchor: false,
      },
    ];
    const sorted = [...records].sort(compareBacklogCandidates);
    expect(sorted[0].id).toBe("task-p1-old");
  });
});

describe("buildPromotionRationale", () => {
  it("selects the top batch and records candidates and rejected alternatives", () => {
    const projectDir = makeProjectDir();
    writeTask(projectDir, "backlog", "task-p2-fanout", {
      priority: "p2",
      area: "client",
      taskClass: "Product",
    });
    writeTask(projectDir, "backlog", "task-p1-arch", {
      priority: "p1",
      area: "architecture",
      taskClass: "Platform",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    writeTask(projectDir, "backlog", "task-p1-modules-old", {
      priority: "p1",
      area: "modules",
      taskClass: "Platform",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    writeTask(projectDir, "backlog", "task-p3-cleanup", {
      priority: "p3",
      area: "modules",
    });
    writeTask(projectDir, "blocked", "task-p1-blocked-arch", {
      priority: "p1",
      area: "architecture",
    });

    const rationale = buildPromotionRationale(projectDir);

    const selectedIds = rationale.selected.map((s) => s.id);
    // Both p1 strategic; task-p1-modules-old (2026-02-01) beats task-p1-arch
    // (2026-03-01) on the age tie-break after class and area.
    expect(selectedIds).toEqual(["task-p1-modules-old", "task-p1-arch"]);
    expect(rationale.selected[0].reason).toMatch(/priority p1/);
    expect(rationale.selected[0].reason).toMatch(/task_class Platform/);
    expect(rationale.selected[0].reason).toMatch(/strategic area/);

    const rejectedIds = rationale.rejected.map((r) => r.id);
    expect(rejectedIds).toContain("task-p2-fanout");
    expect(rejectedIds).toContain("task-p3-cleanup");
    expect(rejectedIds).toContain("task-p1-blocked-arch");

    const blockedRejection = rationale.rejected.find(
      (r) => r.id === "task-p1-blocked-arch",
    );
    expect(blockedRejection?.state).toBe("blocked");

    expect(rationale.candidates.length).toBe(5);
    expect(rationale.summary).toMatch(
      /Promoted 2 of 4 frontier-improving backlog/,
    );
    expect(rationale.summary).toMatch(/task-p1-blocked-arch/);
  });

  it("returns an empty selection when only blocked work remains", () => {
    const projectDir = makeProjectDir();
    writeTask(projectDir, "blocked", "task-p1-stuck", { priority: "p1" });

    const rationale = buildPromotionRationale(projectDir);

    expect(rationale.selected).toHaveLength(0);
    expect(rationale.rejected.map((r) => r.id)).toEqual(["task-p1-stuck"]);
    expect(rationale.summary).toMatch(/No backlog tasks were available/);
  });

  it("respects a smaller batch limit", () => {
    const projectDir = makeProjectDir();
    writeTask(projectDir, "backlog", "task-a", { priority: "p1" });
    writeTask(projectDir, "backlog", "task-b", { priority: "p1" });
    writeTask(projectDir, "backlog", "task-c", { priority: "p1" });

    const rationale = buildPromotionRationale(projectDir, { batchLimit: 1 });

    expect(rationale.selected).toHaveLength(1);
    expect(rationale.rejected.filter((r) => r.state === "backlog")).toHaveLength(2);
  });

  it("promotes backlog work only when it improves the ready frontier", () => {
    const projectDir = makeProjectDir();
    writeTask(projectDir, "ready", "task-p2-meta-ready", {
      priority: "p2",
      taskClass: "Meta",
      area: "autonomy",
      body: [
        "## Product / Safety Link",
        "",
        "This task supports Product/Safety delivery.",
      ].join("\n"),
    });
    writeTask(projectDir, "backlog", "task-p1-product", {
      priority: "p1",
      taskClass: "Product",
      area: "client",
    });
    writeTask(projectDir, "backlog", "task-p3-safety", {
      priority: "p3",
      taskClass: "Safety",
      area: "core",
    });

    const rationale = buildPromotionRationale(projectDir);

    expect(rationale.selected.map((task) => task.id)).toEqual([
      "task-p1-product",
    ]);
    expect(rationale.frontier).toMatchObject({
      incumbentTaskId: "task-p2-meta-ready",
      improved: true,
    });
    expect(
      rationale.rejected.find((task) => task.id === "task-p3-safety")?.reason,
    ).toContain("does not outrank ready frontier");
  });

  it("does not promote backlog work when ready already has the better task", () => {
    const projectDir = makeProjectDir();
    writeTask(projectDir, "ready", "task-p1-safety-ready", {
      priority: "p1",
      taskClass: "Safety",
      area: "core",
    });
    writeTask(projectDir, "backlog", "task-p1-product", {
      priority: "p1",
      taskClass: "Product",
      area: "client",
    });

    const rationale = buildPromotionRationale(projectDir);

    expect(rationale.selected).toEqual([]);
    expect(rationale.frontier).toMatchObject({
      incumbentTaskId: "task-p1-safety-ready",
      improved: false,
    });
    expect(rationale.summary).toContain(
      "No backlog task outranks the current ready frontier",
    );
  });

  it("skips backlog candidates that cannot enter ready as actionable work", () => {
    const projectDir = makeProjectDir();
    writeTask(projectDir, "backlog", "task-meta-without-product-safety-link", {
      priority: "p1",
      taskClass: "Meta",
      area: "autonomy",
    });
    writeTask(projectDir, "backlog", "task-valid-platform", {
      priority: "p2",
      taskClass: "Platform",
      area: "core",
    });

    const rationale = buildPromotionRationale(projectDir, { batchLimit: 1 });

    expect(rationale.selected.map((s) => s.id)).toEqual(["task-valid-platform"]);
    const rejected = rationale.rejected.find((r) =>
      r.id === "task-meta-without-product-safety-link"
    );
    expect(rejected?.reason).toContain("cannot enter ready/");
    expect(rejected?.reason).toContain("Product / Safety Link");
    expect(rationale.summary).toContain("not ready-actionable");
  });

  it("selects generated runtime-posture repair before same-priority Product and Safety work", () => {
    const projectDir = makeProjectDir();
    const runtimeRepairBody = [
      "## Product / Safety Link",
      "",
      "Persistent monitored workflow failures are a runtime posture blocker:",
      "autonomy cannot reliably ship or review Product/Safety work while this root cause keeps recurring.",
      "",
      "<!-- workflow-failure-pattern-fingerprint: workflow-failure:consecutive-failures:builder:repair-check:abc123 -->",
    ].join("\n");
    writeTask(projectDir, "backlog", "task-p1-safety", {
      priority: "p1",
      taskClass: "Safety",
    });
    writeTask(projectDir, "backlog", "task-p1-product", {
      priority: "p1",
      taskClass: "Product",
    });
    writeTask(projectDir, "backlog", "task-repair-workflow-failure-pattern-runtime", {
      priority: "p1",
      taskClass: "Meta",
      area: "autonomy",
      body: runtimeRepairBody,
    });

    const rationale = buildPromotionRationale(projectDir, { batchLimit: 1 });

    expect(rationale.selected).toHaveLength(1);
    expect(rationale.selected[0].id).toBe(
      "task-repair-workflow-failure-pattern-runtime",
    );
    expect(rationale.selected[0].reason).toContain("runtime posture repair");
    expect(rationale.summary).toContain("proven runtime repair first");
  });

  it("keeps P1 Product delivery ahead of non-runtime Meta urgency", () => {
    const projectDir = makeProjectDir();
    writeTask(projectDir, "backlog", "task-p0-meta", {
      priority: "p0",
      taskClass: "Meta",
      area: "autonomy",
      body: [
        "## Product / Safety Link",
        "",
        "This task supports Product/Safety delivery but is not a runtime posture repair.",
      ].join("\n"),
    });
    writeTask(projectDir, "backlog", "task-p1-product", {
      priority: "p1",
      taskClass: "Product",
      area: "client",
    });

    const rationale = buildPromotionRationale(projectDir, { batchLimit: 1 });

    expect(rationale.selected.map((task) => task.id)).toEqual([
      "task-p1-product",
    ]);
  });

  it("rejects backlog candidates with unfinished hard dependencies", () => {
    const projectDir = makeProjectDir();
    writeTask(projectDir, "backlog", "task-dependent", {
      priority: "p1",
      dependsOn: ["task-enabler"],
    });
    writeTask(projectDir, "backlog", "task-enabler", { priority: "p2" });

    const rationale = buildPromotionRationale(projectDir);

    expect(rationale.selected.map((s) => s.id)).toEqual(["task-enabler"]);
    const rejected = rationale.rejected.find((r) => r.id === "task-dependent");
    expect(rejected?.reason).toContain("waiting on task dependencies: task-enabler");
    expect(rationale.summary).toContain("task-dependent");
  });

  it("skips strategic anchor tasks even when they would otherwise rank highest", () => {
    const projectDir = makeProjectDir();
    writeTask(projectDir, "backlog", "task-strategic-anchor", {
      priority: "p1",
      area: "architecture",
      updatedAt: "2026-02-01T00:00:00.000Z",
      anchor: true,
    });
    writeTask(projectDir, "backlog", "task-real-work", {
      priority: "p2",
      area: "architecture",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });

    const rationale = buildPromotionRationale(projectDir);

    expect(rationale.selected.map((s) => s.id)).toEqual(["task-real-work"]);
    const anchorRejection = rationale.rejected.find(
      (r) => r.id === "task-strategic-anchor",
    );
    expect(anchorRejection?.reason).toMatch(/strategic anchor/);
    expect(rationale.summary).toMatch(/Strategic anchors skipped/);
    expect(rationale.summary).toMatch(/task-strategic-anchor/);
  });

  it("returns empty selection when only anchor tasks remain", () => {
    const projectDir = makeProjectDir();
    writeTask(projectDir, "backlog", "task-only-anchor", {
      priority: "p1",
      area: "architecture",
      anchor: true,
    });

    const rationale = buildPromotionRationale(projectDir);

    expect(rationale.selected).toHaveLength(0);
    expect(rationale.summary).toMatch(/No backlog tasks were available/);
    expect(rationale.summary).toMatch(/Strategic anchors skipped/);
  });
});
