import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectRuntimeRegistry } from "./project-runtime.js";
import { ScopeRegistry } from "./scope-registry.js";
import { ScopeRuntimeHost } from "./scope-runtime-host.js";

describe("ScopeRuntimeHost", () => {
  it("owns each runtime subscription and schedule connection exactly once", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-scope-runtime-host-"));
    const projectDir = mkdtempSync(join(root, "project-"));
    const stateDir = mkdtempSync(join(root, "state-"));
    const bus = new EventBus();
    const registry = new ScopeRegistry({ stateDir, projects: [{ projectDir }] });
    const runtimes = ProjectRuntimeRegistry.create({ registry, bus, onLog: () => {} });
    const runtime = runtimes.getDefault();
    runtime.scheduler.addEventTrigger("host fixture", "test.scope-runtime-host");
    let scheduleFireCount = 0;
    let failureAlertCount = 0;
    bus.on("workflow.failure.alert", () => {
      failureAlertCount += 1;
    });
    const host = new ScopeRuntimeHost({
      bus,
      pollIntervalMs: 60_000,
      onDueItems: (_runtime, items) => {
        scheduleFireCount += items.length;
      },
      onLog: () => {},
    });

    await host.startInitial(runtimes);
    await host.startInitial(runtimes);
    await expect(host.start(runtime)).rejects.toThrow(/already hosted/);
    bus.emit("test.scope-runtime-host", {});
    runtime.pbus.emit("workflow.completed", {
      workflow: "fixture",
      runId: "run-fixture",
      status: "failed",
      triggerEvent: "manual",
      durationMs: 1,
      definitionPath: "fixture/workflow.ts",
      runDir: ".kota/runs/run-fixture",
      tags: [],
    });
    expect(scheduleFireCount).toBe(1);
    expect(failureAlertCount).toBe(1);
    expect(host.hostedCount()).toBe(1);

    await host.stop(runtime, 0);
    await host.stop(runtime, 0);
    bus.emit("test.scope-runtime-host", {});
    runtime.pbus.emit("workflow.completed", {
      workflow: "fixture",
      runId: "run-after-stop",
      status: "failed",
      triggerEvent: "manual",
      durationMs: 1,
      definitionPath: "fixture/workflow.ts",
      runDir: ".kota/runs/run-after-stop",
      tags: [],
    });
    expect(scheduleFireCount).toBe(1);
    expect(failureAlertCount).toBe(1);
    expect(host.hostedCount()).toBe(0);
    await host.stopAll(runtimes, 0);
    rmSync(root, { recursive: true, force: true });
  });

  it("force-detaches uncommitted runtime resources when workflow stop fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-scope-runtime-abort-"));
    const projectDir = mkdtempSync(join(root, "project-"));
    const stateDir = mkdtempSync(join(root, "state-"));
    const bus = new EventBus();
    const registry = new ScopeRegistry({ stateDir, projects: [{ projectDir }] });
    const runtimes = ProjectRuntimeRegistry.create({ registry, bus, onLog: () => {} });
    const runtime = runtimes.getDefault();
    runtime.scheduler.addEventTrigger("abort fixture", "test.scope-runtime-abort");
    let scheduleFireCount = 0;
    const host = new ScopeRuntimeHost({
      bus,
      pollIntervalMs: 60_000,
      onDueItems: (_runtime, items) => {
        scheduleFireCount += items.length;
      },
      onLog: () => {},
    });
    await host.startInitial(runtimes);
    vi.spyOn(runtime.workflowRuntime, "stop").mockRejectedValueOnce(
      new Error("workflow stop failed"),
    );

    await expect(host.abortUncommitted(runtime, 0)).rejects.toThrow(
      "workflow stop failed",
    );
    bus.emit("test.scope-runtime-abort", {});

    expect(host.isHosted(runtime.project.projectId)).toBe(false);
    expect(host.hostedCount()).toBe(0);
    expect(scheduleFireCount).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("fires event schedules only in the scope that emitted the event", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-scope-schedule-isolation-"));
    const projectA = mkdtempSync(join(root, "project-a-"));
    const projectB = mkdtempSync(join(root, "project-b-"));
    const stateDir = mkdtempSync(join(root, "state-"));
    const bus = new EventBus();
    const registry = new ScopeRegistry({
      stateDir,
      projects: [{ projectDir: projectA }, { projectDir: projectB }],
    });
    const runtimes = ProjectRuntimeRegistry.create({ registry, bus, onLog: () => {} });
    const [runtimeA, runtimeB] = runtimes.list();
    runtimeA!.scheduler.addEventTrigger("scope A fixture", "test.scope-schedule");
    runtimeB!.scheduler.addEventTrigger("scope B fixture", "test.scope-schedule");
    const firedIn: string[] = [];
    const host = new ScopeRuntimeHost({
      bus,
      pollIntervalMs: 60_000,
      onDueItems: (runtime) => firedIn.push(runtime.project.projectId),
      onLog: () => {},
    });

    await host.startInitial(runtimes);
    runtimeA!.pbus.emitDynamic("test.scope-schedule", {});

    expect(firedIn).toEqual([runtimeA!.project.projectId]);
    expect(runtimeA!.scheduler.pending()).toHaveLength(0);
    expect(runtimeB!.scheduler.pending()).toHaveLength(1);

    await host.stopAll(runtimes, 0);
    rmSync(root, { recursive: true, force: true });
  });
});
