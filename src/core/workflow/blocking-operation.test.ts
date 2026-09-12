import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { ProcessSupervisor } from "#core/execution/process-supervisor.js";
import {
  defineWorkflowBlockingOperation,
  runWorkflowBlockingOperation,
} from "./blocking-operation.js";
import { withWorkflowBlockingOperation } from "./blocking-operation-context.js";
import type { WorkflowStepContext } from "./run-types.js";
import type {
  BlockingFixtureInput,
  BlockingFixtureOutput,
} from "./testing/blocking-operation-fixture.js";

const fixtureModule = new URL(
  "./testing/blocking-operation-fixture.js",
  import.meta.url,
).href;

const cpuBlockingOperation = defineWorkflowBlockingOperation<
  BlockingFixtureInput,
  BlockingFixtureOutput
>(fixtureModule, "runCpuBlockingFixture");

describe("workflow blocking operation boundary", () => {
  it("loads source workers using KOTA's loader from a directory without tsx", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "kota-blocking-external-"));
    const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
    const runnerUrl = new URL("./blocking-operation.ts", import.meta.url).href;
    const operationUrl = new URL(
      "./testing/blocking-operation-fixture.ts",
      import.meta.url,
    ).href;
    try {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          "--import", loader,
          "--input-type=module",
          "--eval",
          `
            import assert from "node:assert/strict";
            import { defineWorkflowBlockingOperation, runWorkflowBlockingOperation }
              from ${JSON.stringify(runnerUrl)};
            assert.throws(() => import.meta.resolve("tsx/esm/api"), { code: "ERR_MODULE_NOT_FOUND" });
            const operation = defineWorkflowBlockingOperation(
              ${JSON.stringify(operationUrl)}, "runCpuBlockingFixture",
            );
            const result = await runWorkflowBlockingOperation(operation, {
              durationMs: 0, value: "external-directory-result",
            });
            console.log(JSON.stringify(result));
          `,
        ],
        { cwd, timeout: 10_000 },
      );
      expect(JSON.parse(stdout)).toMatchObject({ value: "external-directory-result" });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("preserves an existing blocking runner when adapting a repair-check context", () => {
    const runBlocking = vi.fn();
    const context = { runBlocking } as unknown as WorkflowStepContext;

    expect(withWorkflowBlockingOperation(context).runBlocking).toBe(runBlocking);
  });

  it("keeps the host event loop responsive during CPU-heavy work", async () => {
    let hostTimerFired = false;
    const timer = setTimeout(() => {
      hostTimerFired = true;
    }, 25);

    const output = await runWorkflowBlockingOperation(cpuBlockingOperation, {
      durationMs: 250,
      value: "complete",
    });

    clearTimeout(timer);
    expect(hostTimerFired).toBe(true);
    expect(output.value).toBe("complete");
    expect(output.blockedForMs).toBeGreaterThanOrEqual(225);
  });

  it("preserves worker errors with operation identity", async () => {
    const operation = defineWorkflowBlockingOperation<Record<string, never>, never>(
      fixtureModule,
      "failBlockingFixture",
    );
    await expect(runWorkflowBlockingOperation(operation, {})).rejects.toThrow(
      /failBlockingFixture.*fixture blocking operation failed/s,
    );
  });

  it("forwards worker progress into code-step heartbeats", async () => {
    const operation = defineWorkflowBlockingOperation<
      BlockingFixtureInput,
      BlockingFixtureOutput
    >(fixtureModule, "runProgressFixture");
    const reportProgress = vi.fn();
    await runWorkflowBlockingOperation(
      operation,
      { durationMs: 40, value: "progress" },
      { reportProgress },
    );
    expect(reportProgress).toHaveBeenCalledWith({
      kind: "code-heartbeat",
      label: "fixture-heartbeat",
    });
  });

  it("terminates CPU-heavy work when the owning step aborts", async () => {
    const abortController = new AbortController();
    const startedAt = Date.now();
    const execution = runWorkflowBlockingOperation(
      cpuBlockingOperation,
      { durationMs: 5_000, value: "never" },
      { signal: abortController.signal },
    );
    setTimeout(() => abortController.abort(new Error("fixture abort")), 40);

    await expect(execution).rejects.toThrow("fixture abort");
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});

describe("blocking operation process-resource ownership", () => {
  const operation = defineWorkflowBlockingOperation<{ directory: string; mode: "return" | "throw" | "block" }, string>(fixtureModule, "runOwnedResourceFixture");
  it.each(["return", "throw", "block"] as const)("drains registered resources after %s before settling", async (mode) => {
    const { existsSync } = await import("node:fs");
    const root = await mkdtemp(join(tmpdir(), "owned-blocking-"));
    const directory = join(root, "resource");
    const controller = new AbortController();
    let registered = false;
    try {
      const execution = runWorkflowBlockingOperation(operation, { directory, mode }, {
        signal: controller.signal,
        onProcessSpawn: (identity) => {
          expect(identity).toMatchObject({ kind: "resource", cleanup: { kind: "directory", path: directory } });
          expect(existsSync(directory)).toBe(false); // Durable registration precedes resource creation.
          registered = true;
        },
        reportProgress: () => { if (mode === "block") controller.abort(new Error("owner cancelled")); },
      });
      if (mode === "return") expect(await execution).toBe("resource completed");
      else await expect(execution).rejects.toThrow(mode === "block" ? "owner cancelled" : "resource operation failed");
      expect(registered).toBe(true);
      expect(existsSync(directory)).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("rejects execution before resource creation when runtime registration fails", async () => {
    const { existsSync } = await import("node:fs");
    const root = await mkdtemp(join(tmpdir(), "denied-blocking-"));
    const directory = join(root, "resource");
    try {
      await expect(runWorkflowBlockingOperation(operation, { directory, mode: "return" }, {
        onProcessSpawn: () => { throw new Error("run attempt revoked"); },
      })).rejects.toThrow("Runtime did not accept process resource ownership");
      expect(existsSync(directory)).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});


describe("blocking cleanup failure and cancellation", () => {
  const operation = defineWorkflowBlockingOperation<{
    directory: string; processIds?: number[]; container?: boolean; synchronousChildStarted?: string; reportBeforeRegistration?: boolean;
  }, string>(fixtureModule, "runCleanupFaultFixture");

  it.each(["throws", "still-running", "identity-mismatch"] as const)("retains invocation ownership after %s while cleaning independent processes", async (failure) => {
    const root = await mkdtemp(join(tmpdir(), "cleanup-processes-"));
    const directory = join(root, "auth");
    let recovered = false;
    let finished = false;
    const terminate = vi.spyOn(ProcessSupervisor, "terminateOwnedProcess").mockImplementation(async (identity) => {
      if (identity.pid === 101 && !recovered) {
        if (failure === "throws") throw new Error("process table unavailable");
        if (failure === "still-running") return { status: "still-running", escalated: true };
        return { status: "identity-mismatch", observed: { ...identity, osStartToken: "reused" }, escalated: false };
      }
      return { status: "not-running", escalated: false };
    });
    const pending = runWorkflowBlockingOperation(operation, { directory, processIds: [101, 102] }).finally(() => { finished = true; });
    try {
      await vi.waitFor(() => expect(terminate.mock.calls.some(([identity]) => identity.pid === 102)).toBe(true));
      await vi.waitFor(() => expect(existsSync(directory)).toBe(false));
      expect(finished).toBe(false);
      recovered = true;
      expect(await pending).toBe("cleanup complete");
    } finally { recovered = true; await pending; terminate.mockRestore(); await rm(root, { recursive: true, force: true }); }
  });

  it.each([false, true])("removes resources created during client termination, with final cleanup failure=%s", async (failFinalRemoval) => {
    const root = await mkdtemp(join(tmpdir(), "cleanup-late-resource-"));
    const directory = join(root, "resource");
    const cleanupResource = ProcessSupervisor.cleanupResource.bind(ProcessSupervisor);
    let removals = 0;
    let finalRemovalFailed = false;
    const cleanup = vi.spyOn(ProcessSupervisor, "cleanupResource").mockImplementation(async (resource) => {
      if (failFinalRemoval && removals === 2 && !finalRemovalFailed) {
        finalRemovalFailed = true;
        throw new Error("transient final removal failure");
      }
      await cleanupResource(resource);
      removals++;
    });
    let attempts = 0;
    const terminate = vi.spyOn(ProcessSupervisor, "terminateOwnedProcess").mockImplementation(async () => {
      attempts++;
      if (attempts === 1) throw new Error("transient client termination failure");
      if (attempts > 2) return { status: "not-running", escalated: false };
      // The external client creates its resource after early removal completes,
      // then confirms it has stopped. No producer can recreate it afterward.
      await vi.waitFor(() => expect(removals).toBeGreaterThanOrEqual(attempts));
      await mkdir(directory, { recursive: true });
      return { status: "terminated", escalated: false };
    });
    try {
      expect(await runWorkflowBlockingOperation(operation, { directory, processIds: [101] })).toBe("cleanup complete");
      expect(existsSync(directory)).toBe(false);
      expect(finalRemovalFailed).toBe(failFinalRemoval);
    } finally { terminate.mockRestore(); cleanup.mockRestore(); await rm(root, { recursive: true, force: true }); }
  });

  it("removes auth snapshots during a container outage while retaining the invocation", async () => {
    const root = await mkdtemp(join(tmpdir(), "cleanup-container-"));
    const directory = join(root, "auth");
    let finished = false;
    const launch = vi.spyOn(ProcessSupervisor.prototype, "run").mockResolvedValue({ status: "spawn-failed", attemptedAt: "now", commandHash: "cleanup",
      error: { message: "container server unavailable", code: "ECONNREFUSED" } });
    const pending = runWorkflowBlockingOperation(operation, { directory, container: true }).finally(() => { finished = true; });
    const recover = () => launch.mockResolvedValue({ status: "completed", identity: { pid: 1, processGroupId: 1, osStartToken: "fixture", observedCommandHash: "cleanup" }, exitCode: 0, signal: null,
      stdout: { text: "", totalBytes: 0, truncated: false }, stderr: { text: "", totalBytes: 0, truncated: false } });
    try {
      await vi.waitFor(() => expect(launch).toHaveBeenCalled());
      await vi.waitFor(() => expect(existsSync(directory)).toBe(false));
      expect(finished).toBe(false);
      recover();
      expect(await pending).toBe("cleanup complete");
    } finally { recover(); await pending; launch.mockRestore(); await rm(root, { recursive: true, force: true }); }
  });

  it("persists a process notification racing cancellation before draining it", async () => {
    const root = await mkdtemp(join(tmpdir(), "cleanup-registration-race-"));
    const controller = new AbortController();
    const onProcessSpawn = vi.fn();
    const terminate = vi.spyOn(ProcessSupervisor, "terminateOwnedProcess").mockResolvedValue({ status: "not-running", escalated: false });
    try {
      await expect(runWorkflowBlockingOperation(operation, {
        directory: join(root, "unused"), processIds: [101], reportBeforeRegistration: true,
      }, {
        signal: controller.signal, onProcessSpawn,
        reportProgress: () => controller.abort(new Error("owner cancelled")),
      })).rejects.toThrow("owner cancelled");
      expect(onProcessSpawn).toHaveBeenCalledWith(expect.objectContaining({ pid: 101 }));
      expect(terminate).toHaveBeenCalledWith(expect.objectContaining({ pid: 101 }), 1000);
      expect(existsSync(join(root, "unused"))).toBe(false);
    } finally { terminate.mockRestore(); await rm(root, { recursive: true, force: true }); }
  });

  it("starts resource cleanup while a synchronous child is preventing worker exit", async () => {
    const root = await mkdtemp(join(tmpdir(), "cleanup-sync-"));
    const directory = join(root, "resource");
    const started = join(root, "child-started");
    const controller = new AbortController();
    const pending = runWorkflowBlockingOperation(operation, { directory, synchronousChildStarted: started }, { signal: controller.signal });
    const observed = expect(pending).rejects.toThrow("owner deadline");
    try {
      await vi.waitFor(() => expect(existsSync(started)).toBe(true));
      const cancelledAt = Date.now();
      controller.abort(new Error("owner deadline"));
      await observed;
      expect(existsSync(directory)).toBe(false);
      expect(Date.now() - cancelledAt).toBeLessThan(1000);
    } finally { controller.abort(new Error("owner deadline")); await pending.catch(() => {}); await rm(root, { recursive: true, force: true }); }
  });
});
