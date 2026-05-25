import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEventBus } from "#core/events/event-bus.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import { Daemon } from "./daemon.js";
import { resetScheduler } from "./scheduler.js";

vi.mock("./task-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./task-store.js")>();
  return { ...actual, initTaskStore: vi.fn() };
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Snapshot the set of entries present in a directory. Returns an empty set if
 * the directory does not exist so callers can diff snapshots before/after a
 * test without special-casing first-run state.
 */
function snapshotDirEntries(dir: string): Set<string> {
  try {
    return new Set(readdirSync(dir));
  } catch {
    return new Set();
  }
}

describe("daemon operates against external project fixture", () => {
  // The KOTA source tree is this test file's own repo. Any run, task, or state
  // that lands here during the test is a leak from the fixture project.
  const kotaRoot = process.cwd();
  let fixtureDir: string;
  let kotaRunsBefore: Set<string>;
  let kotaTasksReadyBefore: Set<string>;
  let kotaTasksBacklogBefore: Set<string>;
  let kotaTasksDoingBefore: Set<string>;
  let kotaInboxBefore: Set<string>;

  beforeEach(() => {
    resetEventBus();
    resetScheduler();
    fixtureDir = join(
      tmpdir(),
      `kota-ext-fixture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(fixtureDir, ".kota"), { recursive: true });
    writeFileSync(join(fixtureDir, ".gitignore"), ".kota/\n");
    writeFileSync(
      join(fixtureDir, "package.json"),
      JSON.stringify({ name: "external-fixture" }),
    );
    execSync("git init && git add .", { cwd: fixtureDir });
    execSync(
      'git -c user.email="t@t" -c user.name="T" commit -m "init"',
      { cwd: fixtureDir },
    );

    kotaRunsBefore = snapshotDirEntries(join(kotaRoot, ".kota", "runs"));
    kotaTasksReadyBefore = snapshotDirEntries(join(kotaRoot, "data", "tasks", "ready"));
    kotaTasksBacklogBefore = snapshotDirEntries(join(kotaRoot, "data", "tasks", "backlog"));
    kotaTasksDoingBefore = snapshotDirEntries(join(kotaRoot, "data", "tasks", "doing"));
    kotaInboxBefore = snapshotDirEntries(join(kotaRoot, "data", "inbox"));
  });

  afterEach(() => {
    // Strong isolation invariant: no run, task, or inbox entry under the KOTA
    // source tree may have appeared during the test. If a production code
    // path silently falls back to process.cwd() instead of the configured
    // projectDir, these sets diverge and the assertion fails loudly.
    expect(
      snapshotDirEntries(join(kotaRoot, ".kota", "runs")),
      "no run may have escaped into KOTA's .kota/runs",
    ).toEqual(kotaRunsBefore);
    expect(
      snapshotDirEntries(join(kotaRoot, "data", "tasks", "ready")),
      "no task may have escaped into KOTA's data/tasks/ready",
    ).toEqual(kotaTasksReadyBefore);
    expect(
      snapshotDirEntries(join(kotaRoot, "data", "tasks", "backlog")),
      "no task may have escaped into KOTA's data/tasks/backlog",
    ).toEqual(kotaTasksBacklogBefore);
    expect(
      snapshotDirEntries(join(kotaRoot, "data", "tasks", "doing")),
      "no task may have escaped into KOTA's data/tasks/doing",
    ).toEqual(kotaTasksDoingBefore);
    expect(
      snapshotDirEntries(join(kotaRoot, "data", "inbox")),
      "no entry may have escaped into KOTA's data/inbox",
    ).toEqual(kotaInboxBefore);

    rmSync(fixtureDir, { recursive: true, force: true });
    resetEventBus();
    resetScheduler();
  });

  it(
    "boots the daemon, runs a workflow step to completion, and keeps file activity inside the fixture",
    async () => {
      const sentinelPath = join(fixtureDir, "data", "ran.txt");

      const observedProjectDirs: string[] = [];

      const daemon = new Daemon({
        projectDir: fixtureDir,
        idleIntervalMs: 50,
        pollIntervalMs: 60_000,
        workflows: [
          registerWorkflowDefinition("test/fixture-noop.ts", {
            name: "fixture-noop",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "write-sentinel",
                type: "code",
                run: (context) => {
                  observedProjectDirs.push(context.projectDir);
                  mkdirSync(join(context.projectDir, "data"), { recursive: true });
                  writeFileSync(join(context.projectDir, "data", "ran.txt"), "ok");
                  return "wrote";
                },
              },
            ],
          }),
        ],
      });

      const startPromise = daemon.start();
      try {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (daemon.getState().completedRuns >= 1) break;
          await wait(25);
        }
        expect(
          daemon.getState().completedRuns,
          "at least one workflow run must complete",
        ).toBeGreaterThanOrEqual(1);
      } finally {
        await daemon.stop();
        await startPromise;
      }

      // The code step ran with the configured projectDir, not process.cwd().
      expect(observedProjectDirs.length).toBeGreaterThanOrEqual(1);
      for (const observed of observedProjectDirs) {
        expect(observed).toBe(fixtureDir);
      }

      // The sentinel landed inside the fixture, not the KOTA tree.
      expect(existsSync(sentinelPath)).toBe(true);
      expect(existsSync(join(kotaRoot, "data", "ran.txt"))).toBe(false);

      // Run artifacts are recorded under the fixture's .kota/runs.
      const fixtureRunsDir = join(fixtureDir, ".kota", "runs");
      expect(existsSync(fixtureRunsDir)).toBe(true);
      const fixtureRunIds = readdirSync(fixtureRunsDir);
      expect(fixtureRunIds.length).toBeGreaterThanOrEqual(1);

      const runMeta = JSON.parse(
        readFileSync(join(fixtureRunsDir, fixtureRunIds[0], "metadata.json"), "utf-8"),
      );
      expect(runMeta.workflow).toBe("fixture-noop");
      expect(runMeta.status).toBe("success");
      // runDir is stored relative to projectDir — it must not climb out of it.
      expect(runMeta.runDir).not.toMatch(/\.\./);
      expect(runMeta.runDir.startsWith(".kota/runs/")).toBe(true);

      // Daemon state was persisted to the fixture's .kota, not the KOTA tree.
      expect(existsSync(join(fixtureDir, ".kota", "daemon-state.json"))).toBe(true);

      // The step output was persisted inside the fixture's run dir.
      const stepRecord = JSON.parse(
        readFileSync(
          join(fixtureRunsDir, fixtureRunIds[0], "steps", "write-sentinel.json"),
          "utf-8",
        ),
      );
      expect(stepRecord.status).toBe("success");
      expect(stepRecord.output).toBe("wrote");
    },
  );

  it("logs ignored untrusted project config during daemon startup", async () => {
    writeFileSync(
      join(fixtureDir, ".kota", "config.json"),
      JSON.stringify({
        guardrails: { toolOverrides: { process: "allow" } },
        defaultAgentHarness: "repo-harness",
        providers: { memory: "repo-memory" },
        foreignModules: [{ transport: "stdio", command: "repo-owned-module" }],
      }),
    );

    const stderrLines: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrLines.push(String(chunk));
      return true;
    });

    const daemon = new Daemon({
      projectDir: fixtureDir,
      idleIntervalMs: 50,
      pollIntervalMs: 60_000,
      workflows: [],
    });
    const startPromise = daemon.start();
    try {
      await wait(100);
    } finally {
      await daemon.stop();
      await startPromise;
      stderrSpy.mockRestore();
    }

    const output = stderrLines.join("");
    expect(output).toContain("ignored untrusted project config");
    expect(output).toContain(join(fixtureDir, ".kota", "config.json"));
    expect(output).toContain("guardrail policy (guardrails)");
    expect(output).toContain("foreign module launch (foreignModules)");
    expect(output).toContain("trustedProjects");
  });
});
