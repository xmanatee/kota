import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { RunCoordinator } from "#core/workflow/run-coordinator.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { ScopeRegistry } from "./scope-registry.js";
import { ScopeRuntimeRegistry } from "./scope-runtime.js";
import { ScopeRuntimeHost } from "./scope-runtime-host.js";

const openRunStates: RunStateDatabase[] = [];

function createTestRuntimeRegistry(
  registry: ScopeRegistry,
  bus: EventBus,
  stateDir: string,
): ScopeRuntimeRegistry {
  const runState = new RunStateDatabase(join(stateDir, "run-state"));
  openRunStates.push(runState);
  const startedAt = new Date().toISOString();
  for (const scope of registry.list()) {
    runState.registerScope({
      id: scope.scopeId,
      rootPath: scope.scopeRoot,
      displayName: scope.displayName,
      createdAt: startedAt,
    });
  }
  const daemonEpoch = runState.beginDaemonSession(startedAt).epoch;
  let runtimes!: ScopeRuntimeRegistry;
  const runCoordinator = new RunCoordinator({
    store: runState,
    daemonEpoch,
    concurrency: 4,
    execute: (run, signal) =>
      runtimes.get(run.scopeId).workflowRuntime.executeAdmittedRun(run, signal),
  });
  runtimes = ScopeRuntimeRegistry.create({
    registry,
    bus,
    onLog: () => {},
    runState,
    runCoordinator,
    daemonEpoch,
  });
  return runtimes;
}

afterEach(() => {
  for (const runState of openRunStates.splice(0)) runState.close();
});

describe("ScopeRuntimeHost", () => {
  it("owns each runtime subscription and schedule connection exactly once", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-scope-runtime-host-"));
    const scopeRoot = mkdtempSync(join(root, "project-"));
    const stateDir = mkdtempSync(join(root, "state-"));
    const bus = new EventBus();
    const registry = new ScopeRegistry({ stateDir, scopes: [{ scopeRoot }] });
    const runtimes = createTestRuntimeRegistry(registry, bus, stateDir);
    const runtime = runtimes.getDefault();
    runtime.scheduler.addEventTrigger("host fixture", "test.scope-runtime-host");
    let scheduleFireCount = 0;
    const host = new ScopeRuntimeHost({
      bus,
      pollIntervalMs: 60_000,
      onDueItems: (_runtime, items) => {
        scheduleFireCount += items.length;
      },
    });

    await host.startInitial(runtimes);
    await host.startInitial(runtimes);
    await expect(host.start(runtime)).rejects.toThrow(/already hosted/);
    bus.emit("test.scope-runtime-host", {});
    expect(scheduleFireCount).toBe(1);
    expect(host.hostedCount()).toBe(1);

    await host.stop(runtime, 0);
    await host.stop(runtime, 0);
    bus.emit("test.scope-runtime-host", {});
    expect(scheduleFireCount).toBe(1);
    expect(host.hostedCount()).toBe(0);
    await host.stopAll(runtimes, 0);
    rmSync(root, { recursive: true, force: true });
  });

  it("force-detaches uncommitted runtime resources when workflow stop fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-scope-runtime-abort-"));
    const scopeRoot = mkdtempSync(join(root, "project-"));
    const stateDir = mkdtempSync(join(root, "state-"));
    const bus = new EventBus();
    const registry = new ScopeRegistry({ stateDir, scopes: [{ scopeRoot }] });
    const runtimes = createTestRuntimeRegistry(registry, bus, stateDir);
    const runtime = runtimes.getDefault();
    runtime.scheduler.addEventTrigger("abort fixture", "test.scope-runtime-abort");
    let scheduleFireCount = 0;
    const host = new ScopeRuntimeHost({
      bus,
      pollIntervalMs: 60_000,
      onDueItems: (_runtime, items) => {
        scheduleFireCount += items.length;
      },
    });
    await host.startInitial(runtimes);
    vi.spyOn(runtime.workflowRuntime, "stop").mockRejectedValueOnce(
      new Error("workflow stop failed"),
    );

    await expect(host.abortUncommitted(runtime, 0)).rejects.toThrow(
      "workflow stop failed",
    );
    bus.emit("test.scope-runtime-abort", {});

    expect(host.isHosted(runtime.scope.scopeId)).toBe(false);
    expect(host.hostedCount()).toBe(0);
    expect(scheduleFireCount).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("fires event schedules only in the scope that emitted the event", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-scope-schedule-isolation-"));
    const scopeA = mkdtempSync(join(root, "scope-a-"));
    const scopeB = mkdtempSync(join(root, "scope-b-"));
    const stateDir = mkdtempSync(join(root, "state-"));
    const bus = new EventBus();
    const registry = new ScopeRegistry({
      stateDir,
      scopes: [{ scopeRoot: scopeA }, { scopeRoot: scopeB }],
    });
    const runtimes = createTestRuntimeRegistry(registry, bus, stateDir);
    const [runtimeA, runtimeB] = runtimes.list();
    runtimeA!.scheduler.addEventTrigger("scope A fixture", "test.scope-schedule");
    runtimeB!.scheduler.addEventTrigger("scope B fixture", "test.scope-schedule");
    const firedIn: string[] = [];
    const host = new ScopeRuntimeHost({
      bus,
      pollIntervalMs: 60_000,
      onDueItems: (runtime) => firedIn.push(runtime.scope.scopeId),
    });

    await host.startInitial(runtimes);
    runtimeA!.pbus.emitDynamic("test.scope-schedule", {});

    expect(firedIn).toEqual([runtimeA!.scope.scopeId]);
    expect(runtimeA!.scheduler.pending()).toHaveLength(0);
    expect(runtimeB!.scheduler.pending()).toHaveLength(1);

    await host.stopAll(runtimes, 0);
    rmSync(root, { recursive: true, force: true });
  });
});
