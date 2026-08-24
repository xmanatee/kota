import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { WorkflowRuntime } from "./runtime.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  predicate: () => boolean,
  message: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(10);
  }
  if (predicate()) return;
  throw new Error(message);
}

function makeProjectDir(): string {
  const projectDir = join(
    tmpdir(),
    `kota-parallel-dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, ".gitignore"), ".kota/\n");
  execFileSync("git", ["init"], { cwd: projectDir, stdio: "ignore" });
  execFileSync("git", ["add", ".gitignore"], { cwd: projectDir, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-m", "init"],
    { cwd: projectDir, stdio: "ignore" },
  );
  return projectDir;
}

function countWorkflowRuns(projectDir: string, workflowName: string): number {
  const runsDir = join(projectDir, ".kota", "runs");
  if (!existsSync(runsDir)) return 0;
  return readdirSync(runsDir).filter((runId) => runId.includes(workflowName)).length;
}

describe("runtime parallel same-workflow dispatch", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("dispatches the resolved concurrency-group capacity from one burst trigger", async () => {
    const bus = new EventBus();
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 60_000,
      codeConcurrency: 4,
      workflows: [
        {
          name: "parallel-worker",
          definitionPath: "src/core/workflow/runtime-dispatch-parallel-runs.test.ts",
          moduleRoot: process.cwd(),
          maxConcurrentRuns: ({ concurrencyLimit }) => concurrencyLimit,
          dispatchBurst: ({ concurrencyLimit }) => concurrencyLimit,
          triggers: [{ event: "work.available", cooldownMs: 0 }],
          steps: [
            {
              id: "hold",
              type: "code",
              run: async () => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                await new Promise<void>((resolve) => releases.push(resolve));
                active -= 1;
                return { ok: true };
              },
            },
          ],
        },
      ],
    });

    runtime.start();
    try {
      bus.emit("work.available", { actionableCount: 4 });
      await waitUntil(
        () => maxActive === 4,
        "Timed out waiting for four same-workflow runs to dispatch",
      );
      expect(runtime.getState().activeRuns?.map((run) => run.workflow).sort()).toEqual([
        "parallel-worker",
        "parallel-worker",
        "parallel-worker",
        "parallel-worker",
      ]);
    } finally {
      while (releases.length > 0) releases.shift()!();
      await runtime.stop();
    }

    expect(maxActive).toBe(4);
    expect(countWorkflowRuns(projectDir, "parallel-worker")).toBe(4);
  });

  it("keeps burst-triggered same-workflow runs serialized without maxConcurrentRuns", async () => {
    const bus = new EventBus();
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 60_000,
      codeConcurrency: 2,
      workflows: [
        {
          name: "serial-worker",
          definitionPath: "src/core/workflow/runtime-dispatch-parallel-runs.test.ts",
          moduleRoot: process.cwd(),
          dispatchBurst: 2,
          triggers: [{ event: "work.available", cooldownMs: 0 }],
          steps: [
            {
              id: "hold",
              type: "code",
              run: async () => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                await new Promise<void>((resolve) => releases.push(resolve));
                active -= 1;
                return { ok: true };
              },
            },
          ],
        },
      ],
    });

    runtime.start();
    try {
      bus.emit("work.available", { actionableCount: 2 });
      await waitUntil(() => releases.length === 1, "Timed out waiting for first run");
      await wait(50);
      expect(maxActive).toBe(1);
      expect(runtime.getState().pendingRuns).toHaveLength(1);

      releases.shift()!();
      await waitUntil(() => releases.length === 1, "Timed out waiting for second run");
    } finally {
      while (releases.length > 0) releases.shift()!();
      await runtime.stop();
    }

    expect(maxActive).toBe(1);
    expect(countWorkflowRuns(projectDir, "serial-worker")).toBe(2);
  });
});
