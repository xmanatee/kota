import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import backlogPromoterWorkflow from "./workflow.js";

vi.mock("#core/util/repo-worktree.js", () => ({
  getRepoWorktreeStatus: vi.fn(),
}));

vi.mock("#modules/autonomy/commit.js", async () => {
  const actual =
    await vi.importActual<typeof import("#modules/autonomy/commit.js")>(
      "#modules/autonomy/commit.js",
    );
  return {
    ...actual,
    commitWorkflowChanges: vi.fn(() => ({ committed: true })),
    checkCommitStageable: vi.fn(() => "ok"),
  };
});

vi.mock("#modules/autonomy/shared.js", async () => {
  const actual =
    await vi.importActual<typeof import("#modules/autonomy/shared.js")>(
      "#modules/autonomy/shared.js",
    );
  return {
    ...actual,
    runCheck: vi.fn(() => "ok"),
    checkNoScratchArtifacts: vi.fn(() => "ok"),
    checkCommitMessageExists: vi.fn(() => "ok"),
  };
});

async function mockCleanWorktree() {
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

async function mockDirtyWorktree() {
  const { getRepoWorktreeStatus } = await import("#core/util/repo-worktree.js");
  vi.mocked(getRepoWorktreeStatus).mockReturnValue({
    available: true,
    dirty: true,
    trackedDirty: true,
    entries: ["M src/foo.ts"],
    fingerprint: "M src/foo.ts",
    summary: "src/foo.ts",
    headSha: "abc1234",
  });
}

const TASK_TEMPLATE = (
  id: string,
  options: { priority?: string; area?: string; updatedAt?: string } = {},
): string => {
  const priority = options.priority ?? "p2";
  const area = options.area ?? "modules";
  const updatedAt = options.updatedAt ?? "2026-04-01T00:00:00.000Z";
  return [
    "---",
    `id: ${id}`,
    `title: ${id}`,
    "status: backlog",
    `priority: ${priority}`,
    `area: ${area}`,
    `summary: ${id} summary`,
    `created_at: ${updatedAt}`,
    `updated_at: ${updatedAt}`,
    "---",
    "",
    "## Problem",
    "Body.",
    "",
    "## Desired Outcome",
    "Outcome.",
    "",
    "## Constraints",
    "Constraints.",
    "",
    "## Done When",
    "- when",
    "",
    "## Source / Intent",
    "Owner asked for this on 2026-04-01.",
    "",
    "## Initiative",
    "Initiative paragraph.",
    "",
    "## Acceptance Evidence",
    "- Tests.",
    "",
  ].join("\n");
};

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "backlog-promoter-wf-"));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
    writeFileSync(join(dir, "data", "tasks", state, "AGENTS.md"), `# ${state}\n`);
  }
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  return dir;
}

function commitInitial(dir: string) {
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "initial", "--quiet"], { cwd: dir });
}

describe("backlog-promoter workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("promotes the top backlog batch and writes a rationale artifact", async () => {
    await mockCleanWorktree();
    const projectDir = makeProjectDir();
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-p1-arch.md"),
      TASK_TEMPLATE("task-p1-arch", {
        priority: "p1",
        area: "architecture",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }),
    );
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-p1-modules-old.md"),
      TASK_TEMPLATE("task-p1-modules-old", {
        priority: "p1",
        area: "modules",
        updatedAt: "2026-02-01T00:00:00.000Z",
      }),
    );
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-p3-cleanup.md"),
      TASK_TEMPLATE("task-p3-cleanup", {
        priority: "p3",
        area: "modules",
      }),
    );
    commitInitial(projectDir);

    const harness = new WorkflowTestHarness(backlogPromoterWorkflow, {
      trigger: { event: "autonomy.queue.needs-promotion", payload: {} },
      projectDir,
    });
    const result = await harness.run();

    expect(result.status).toBe("success");
    const moves = result.steps["apply-promotion"].output as {
      promotions: Array<{ id: string; toState: string }>;
    };
    const promotedIds = moves.promotions.map((p) => p.id);
    // Ranking: both p1 strategic; older updated_at wins the tie.
    expect(promotedIds).toEqual(["task-p1-modules-old", "task-p1-arch"]);
    for (const id of promotedIds) {
      expect(existsSync(join(projectDir, "data", "tasks", "ready", `${id}.md`))).toBe(true);
    }
    expect(
      existsSync(join(projectDir, "data", "tasks", "backlog", "task-p3-cleanup.md")),
    ).toBe(true);

    const writeRationaleOutput = result.steps["write-rationale"].output as {
      written: boolean;
      artifactPath: string;
    };
    expect(writeRationaleOutput.written).toBe(true);
    const artifact = JSON.parse(readFileSync(writeRationaleOutput.artifactPath, "utf-8")) as {
      selected: Array<{ id: string; reason: string }>;
      rejected: Array<{ id: string; state: string }>;
      candidates: Array<{ id: string }>;
      summary: string;
    };
    expect(artifact.selected.map((s) => s.id)).toEqual([
      "task-p1-modules-old",
      "task-p1-arch",
    ]);
    expect(artifact.rejected.map((r) => r.id)).toContain("task-p3-cleanup");
    expect(artifact.summary).toMatch(/Promoted 2 of 3 backlog/);

    const emitted = result.emitted.find((e) => e.event === "autonomy.backlog.promoted");
    expect(emitted).toBeDefined();
    expect(emitted?.payload).toMatchObject({
      promotedTaskIds: expect.arrayContaining(["task-p1-arch", "task-p1-modules-old"]),
    });
  });

  it("records blocked alternatives in the rationale even though they are not promoted", async () => {
    await mockCleanWorktree();
    const projectDir = makeProjectDir();
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-p2-fanout.md"),
      TASK_TEMPLATE("task-p2-fanout", { priority: "p2", area: "client" }),
    );
    const blockedTask = TASK_TEMPLATE("task-p1-blocked-arch", {
      priority: "p1",
      area: "architecture",
    }).replace("status: backlog", "status: blocked");
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-p1-blocked-arch.md"),
      blockedTask,
    );
    commitInitial(projectDir);

    const harness = new WorkflowTestHarness(backlogPromoterWorkflow, {
      trigger: { event: "autonomy.queue.needs-promotion", payload: {} },
      projectDir,
    });
    const result = await harness.run();

    const writeRationaleOutput = result.steps["write-rationale"].output as {
      artifactPath: string;
    };
    const artifact = JSON.parse(readFileSync(writeRationaleOutput.artifactPath, "utf-8")) as {
      selected: Array<{ id: string }>;
      rejected: Array<{ id: string; state: string; reason: string }>;
    };
    expect(artifact.selected.map((s) => s.id)).toEqual(["task-p2-fanout"]);
    const blockedRejection = artifact.rejected.find((r) => r.id === "task-p1-blocked-arch");
    expect(blockedRejection?.state).toBe("blocked");
    expect(blockedRejection?.reason).toMatch(/precondition/);
  });

  it("skips promotion entirely when only blocked work exists", async () => {
    await mockCleanWorktree();
    const projectDir = makeProjectDir();
    const blockedTask = TASK_TEMPLATE("task-blocked", { priority: "p1" }).replace(
      "status: backlog",
      "status: blocked",
    );
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-blocked.md"),
      blockedTask,
    );
    commitInitial(projectDir);

    const harness = new WorkflowTestHarness(backlogPromoterWorkflow, {
      trigger: { event: "autonomy.queue.needs-promotion", payload: {} },
      projectDir,
    });
    const result = await harness.run();

    expect(result.steps["write-rationale"].status).toBe("skipped");
    expect(result.steps["apply-promotion"].status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
    expect(
      result.emitted.some((e) => e.event === "autonomy.backlog.promoted"),
    ).toBe(false);
  });

  it("skips promotion when the worktree is dirty", async () => {
    await mockDirtyWorktree();
    const projectDir = makeProjectDir();
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", "task-foo.md"),
      TASK_TEMPLATE("task-foo", { priority: "p1" }),
    );
    commitInitial(projectDir);

    const harness = new WorkflowTestHarness(backlogPromoterWorkflow, {
      trigger: { event: "autonomy.queue.needs-promotion", payload: {} },
      projectDir,
    });
    const result = await harness.run();

    expect(result.steps["write-rationale"].status).toBe("skipped");
    expect(result.steps["apply-promotion"].status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
  });

  it("skips all work on runtime.recovered triggers", async () => {
    await mockCleanWorktree();
    const projectDir = makeProjectDir();
    const harness = new WorkflowTestHarness(backlogPromoterWorkflow, {
      trigger: { event: "runtime.recovered", payload: {} },
      projectDir,
    });
    const result = await harness.run();
    expect(result.steps["inspect-backlog"].status).toBe("skipped");
    expect(result.steps["write-rationale"].status).toBe("skipped");
    expect(result.steps["apply-promotion"].status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
  });
});
