import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { WorkflowRuntime } from "./runtime.js";

describe("runtime trigger admission", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-trigger-admission-"));
    writeFileSync(join(projectDir, ".gitignore"), ".kota/\n");
    execFileSync("git", ["init"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["add", ".gitignore"], {
      cwd: projectDir,
      stdio: "ignore",
    });
    execFileSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-m", "init"],
      { cwd: projectDir, stdio: "ignore" },
    );
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("applies definition-owned admission before pending queue mutation", async () => {
    const bus = new EventBus();
    const admittedVersions: number[] = [];
    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 60_000,
      workflows: [
        {
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
    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 60_000,
      workflows: [
        {
          name: "latest-keyed-listener",
          definitionPath: "src/core/workflow/runtime-trigger-admission.test.ts",
          moduleRoot: process.cwd(),
          triggers: [{ event: "work.changed", queueMode: "latest" }],
          steps: [{ id: "noop", type: "code", run: () => ({ ok: true }) }],
        },
      ],
    });

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
