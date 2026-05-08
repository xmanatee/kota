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
  lines.push("---", "");
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
        summary: "",
        updatedAt: older,
        body: "",
        anchor: false,
      },
      {
        id: "task-p1-modules-new",
        title: "p1 modules",
        state: "backlog" as const,
        priority: "p1",
        area: "modules",
        summary: "",
        updatedAt: newer,
        body: "",
        anchor: false,
      },
    ];
    const sorted = [...records].sort(compareBacklogCandidates);
    expect(sorted[0].id).toBe("task-p1-modules-new");
    expect(sorted[1].id).toBe("task-p2-architecture-old");
  });

  it("uses strategic area as a tie-break within the same priority", () => {
    const updatedAt = "2026-04-01T00:00:00.000Z";
    const records = [
      {
        id: "task-p1-client",
        title: "client",
        state: "backlog" as const,
        priority: "p1",
        area: "client",
        summary: "",
        updatedAt,
        body: "",
        anchor: false,
      },
      {
        id: "task-p1-autonomy",
        title: "autonomy",
        state: "backlog" as const,
        priority: "p1",
        area: "autonomy",
        summary: "",
        updatedAt,
        body: "",
        anchor: false,
      },
    ];
    const sorted = [...records].sort(compareBacklogCandidates);
    expect(sorted[0].id).toBe("task-p1-autonomy");
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
        summary: "",
        updatedAt: "2026-04-30T00:00:00.000Z",
        body: "",
        anchor: false,
      },
      {
        id: "task-p1-old",
        title: "old",
        state: "backlog" as const,
        priority: "p1",
        area: "autonomy",
        summary: "",
        updatedAt: "2026-03-01T00:00:00.000Z",
        body: "",
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
    });
    writeTask(projectDir, "backlog", "task-p1-arch", {
      priority: "p1",
      area: "architecture",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    writeTask(projectDir, "backlog", "task-p1-modules-old", {
      priority: "p1",
      area: "modules",
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
    // (2026-03-01) on the age tie-break.
    expect(selectedIds).toEqual(["task-p1-modules-old", "task-p1-arch"]);
    expect(rationale.selected[0].reason).toMatch(/priority p1/);
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
    expect(rationale.summary).toMatch(/Promoted 2 of 4 promotable backlog/);
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
