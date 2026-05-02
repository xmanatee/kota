import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import { consolidationTaskIdForCapability } from "#modules/autonomy/fan-out-consolidation.js";
import fanOutConsolidatorWorkflow from "./workflow.js";

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

const FAN_OUT_TITLES = [
  { id: "task-add-cross-store-retract-seam", title: "Add cross-store retract seam mirroring capture", area: "modules" },
  { id: "task-telegram-retract", title: "Land Telegram /retract-<store> commands consuming the cross-store retract seam", area: "channel" },
  { id: "task-web-retract-panel", title: "Add web RetractPanel consuming the cross-store retract seam", area: "client" },
  { id: "task-macos-daemon-client-retract", title: "Add macOS DaemonClient.retract with discriminated RetractResult types", area: "client" },
  { id: "task-mobile-retract-screen", title: "Add mobile RetractScreen consuming a new DaemonClient.retract", area: "client" },
];

function makeDoneTask(id: string, title: string, area: string, updatedAt: string): string {
  return [
    "---",
    `id: ${id}`,
    `title: ${title}`,
    "status: done",
    "priority: p2",
    `area: ${area}`,
    `summary: ${title}`,
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
  ].join("\n");
}

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fan-out-consolidator-wf-"));
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

describe("fan-out-consolidator workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("seeds a consolidation task in ready/ when a fan-out batch is detected", async () => {
    await mockCleanWorktree();
    const projectDir = makeProjectDir();
    const baseMs = Date.now() - 5 * 24 * 60 * 60 * 1000;
    for (let i = 0; i < FAN_OUT_TITLES.length; i++) {
      const t = FAN_OUT_TITLES[i]!;
      const updatedAt = new Date(baseMs + i * 24 * 60 * 60 * 1000).toISOString();
      writeFileSync(
        join(projectDir, "data", "tasks", "done", `${t.id}.md`),
        makeDoneTask(t.id, t.title, t.area, updatedAt),
      );
    }
    commitInitial(projectDir);

    const harness = new WorkflowTestHarness(fanOutConsolidatorWorkflow, {
      trigger: { event: "workflow.build.committed", payload: {} },
      projectDir,
    });
    const result = await harness.run();

    expect(result.status).toBe("success");
    const consolidationPath = join(
      projectDir,
      "data",
      "tasks",
      "ready",
      `${consolidationTaskIdForCapability("retract")}.md`,
    );
    expect(existsSync(consolidationPath)).toBe(true);
    const written = readFileSync(consolidationPath, "utf-8");
    expect(written).toContain("area: client");
    expect(written).toContain("Information architecture");
  });

  it("skips seeding when the worktree is dirty (recovery safety)", async () => {
    await mockDirtyWorktree();
    const projectDir = makeProjectDir();
    const baseMs = Date.now() - 5 * 24 * 60 * 60 * 1000;
    for (let i = 0; i < FAN_OUT_TITLES.length; i++) {
      const t = FAN_OUT_TITLES[i]!;
      const updatedAt = new Date(baseMs + i * 24 * 60 * 60 * 1000).toISOString();
      writeFileSync(
        join(projectDir, "data", "tasks", "done", `${t.id}.md`),
        makeDoneTask(t.id, t.title, t.area, updatedAt),
      );
    }
    commitInitial(projectDir);

    const harness = new WorkflowTestHarness(fanOutConsolidatorWorkflow, {
      trigger: { event: "workflow.build.committed", payload: {} },
      projectDir,
    });
    const result = await harness.run();

    expect(result.status).toBe("success");
    const consolidationPath = join(
      projectDir,
      "data",
      "tasks",
      "ready",
      `${consolidationTaskIdForCapability("retract")}.md`,
    );
    expect(existsSync(consolidationPath)).toBe(false);
  });

  it("skips agent-step build when triggered by recovery", async () => {
    await mockCleanWorktree();
    const projectDir = makeProjectDir();
    commitInitial(projectDir);

    const harness = new WorkflowTestHarness(fanOutConsolidatorWorkflow, {
      trigger: { event: "runtime.recovered", payload: {} },
      projectDir,
    });
    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["detect-and-seed"]?.status).not.toBe("success");
  });

  it("does not seed when no fan-out batch is detected (single-surface only)", async () => {
    await mockCleanWorktree();
    const projectDir = makeProjectDir();
    writeFileSync(
      join(projectDir, "data", "tasks", "done", "task-tighten-internal.md"),
      makeDoneTask(
        "task-tighten-internal",
        "Tighten internal protocol invariant",
        "core",
        new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      ),
    );
    commitInitial(projectDir);

    const harness = new WorkflowTestHarness(fanOutConsolidatorWorkflow, {
      trigger: { event: "workflow.build.committed", payload: {} },
      projectDir,
    });
    const result = await harness.run();

    expect(result.status).toBe("success");
    const detectStep = result.steps["detect-and-seed"];
    expect(detectStep.status).toBe("success");
    const detection = detectStep.output as { touchedDisk: boolean };
    expect(detection.touchedDisk).toBe(false);
    expect(result.steps["commit"]?.status).not.toBe("success");
  });
});
