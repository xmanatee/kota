import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { createTestWorkflowRuntime } from "./testing/runtime-fixture.js";

describe("runtime trigger admission", () => {
  let workspaceRoot: string;
  const runStates: Array<{ close(): void }> = [];

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "kota-trigger-admission-"));
    writeFileSync(join(workspaceRoot, ".gitignore"), ".kota/\n");
    execFileSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
    execFileSync("git", ["add", ".gitignore"], {
      cwd: workspaceRoot,
      stdio: "ignore",
    });
    execFileSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-m", "init"],
      { cwd: workspaceRoot, stdio: "ignore" },
    );
  });

  afterEach(() => {
    for (const runState of runStates.splice(0)) runState.close();
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("applies definition-owned admission before pending queue mutation", async () => {
    const bus = new EventBus();
    const admittedVersions: number[] = [];
    const { runtime, runState } = createTestWorkflowRuntime({
      bus,
      scopeRoot: workspaceRoot,
      idleIntervalMs: 60_000,
      workflows: [
        {
          repository: "read",
          name: "admitted-listener",
          definitionPath: "src/core/workflow/runtime-trigger-admission.test.ts",
          moduleRoot: process.cwd(),
          triggers: [{ event: "work.changed", queueMode: "latest" }],
          triggerAdmission: ({ trigger }) => {
            const version = Number(trigger.payload.version);
            admittedVersions.push(version);
            return version > 1
              ? { admitted: true }
              : { admitted: false, reason: "revision was already consumed" };
          },
          steps: [{ id: "noop", type: "code", run: () => ({ ok: true }) }],
        },
      ],
    });
    runStates.push(runState);

    runtime.start();
    runtime.setDispatchPaused(true);
    bus.emit("work.changed", { version: 1 });
    expect(runtime.getState().pendingRuns).toEqual([]);
    bus.emit("work.changed", { version: 2 });
    await runtime.stop();

    expect(admittedVersions).toEqual([1, 2]);
    expect(runtime.getState().pendingRuns).toMatchObject([
      { trigger: { payload: { version: 2 } } },
    ]);
  });

  it("coalesces explicitly keyed deliveries when latest is requested", async () => {
    const bus = new EventBus();
    const { runtime, runState } = createTestWorkflowRuntime({
      bus,
      scopeRoot: workspaceRoot,
      idleIntervalMs: 60_000,
      workflows: [
        {
          repository: "read",
          name: "latest-keyed-listener",
          definitionPath: "src/core/workflow/runtime-trigger-admission.test.ts",
          moduleRoot: process.cwd(),
          triggers: [{ event: "work.changed", queueMode: "latest" }],
          steps: [{ id: "noop", type: "code", run: () => ({ ok: true }) }],
        },
      ],
    });
    runStates.push(runState);

    runtime.start();
    runtime.setDispatchPaused(true);
    bus.emit("work.changed", { version: 1, idempotencyKey: "revision:1" });
    const firstRunId = runtime.getState().pendingRuns[0]?.runId;
    bus.emit("work.changed", { version: 2, idempotencyKey: "revision:2" });
    await runtime.stop();

    expect(runtime.getState().pendingRuns).toMatchObject([
      {
        runId: firstRunId,
        trigger: {
          payload: { version: 2, idempotencyKey: "revision:2" },
        },
      },
    ]);
  });
});
