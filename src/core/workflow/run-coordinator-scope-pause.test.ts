import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { RunCoordinator, type RunExecutionOutcome } from "./run-coordinator.js";
import { RunStateDatabase } from "./run-state-database.js";
import { WorkflowRuntime } from "./runtime.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const roots: string[] = [];
const stores: RunStateDatabase[] = [];

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function createStore(): RunStateDatabase {
  const root = mkdtempSync(join(tmpdir(), "kota-run-scope-pause-"));
  roots.push(root);
  const store = new RunStateDatabase(root);
  stores.push(store);
  for (const scopeId of ["scope-a", "scope-b"]) {
    store.registerScope({
      id: scopeId,
      rootPath: join(root, scopeId),
      createdAt: "2026-08-25T10:00:00.000Z",
    });
  }
  return store;
}

function admit(
  store: RunStateDatabase,
  runId: string,
  scopeId: string,
  admittedAt: string,
): void {
  store.admitRun({
    id: runId,
    scopeId,
    workflow: "test-workflow",
    repository: "none",
    trigger: { event: "test.requested", schemaRef: null, payload: { runId } },
    resources: [],
    admittedAt,
  });
}

function createRuntime(
  store: RunStateDatabase,
  coordinator: RunCoordinator,
  daemonEpoch: number,
  scopeId: string,
): WorkflowRuntime {
  return new WorkflowRuntime({
    bus: new EventBus(),
    scopeRoot: store.getScopeRoot(scopeId)!,
    scopeId,
    runState: store,
    runCoordinator: coordinator,
    daemonEpoch,
    workflows: [],
  });
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("RunCoordinator scope admission pause", () => {
  test("skips a paused project without leaving capacity idle", async () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admit(store, "run-a-1", "scope-a", "2026-08-25T10:00:01.000Z");
    admit(store, "run-a-2", "scope-a", "2026-08-25T10:00:02.000Z");
    admit(store, "run-b", "scope-b", "2026-08-25T10:00:03.000Z");

    const bOutcome = deferred<RunExecutionOutcome>();
    const bStarted = deferred<void>();
    const aStarted = deferred<void>();
    const started: string[] = [];
    const coordinator = new RunCoordinator({
      store,
      daemonEpoch: epoch,
      concurrency: 1,
      execute: async (run) => {
        started.push(run.id);
        if (run.scopeId === "scope-b") {
          bStarted.resolve();
          return bOutcome.promise;
        }
        aStarted.resolve();
        return { kind: "terminal", state: "succeeded" };
      },
    });
    const scopeA = createRuntime(store, coordinator, epoch, "scope-a");

    scopeA.setDispatchPaused(true);
    await bStarted.promise;
    expect(coordinator.isScopeAdmissionPaused("scope-a")).toBe(true);
    expect(started).toEqual(["run-b"]);

    scopeA.setDispatchPaused(false);
    expect(coordinator.isScopeAdmissionPaused("scope-a")).toBe(false);
    expect(started).toEqual(["run-b"]);

    bOutcome.resolve({ kind: "terminal", state: "succeeded" });
    await aStarted.promise;
    await coordinator.whenIdle();
    expect(started).toEqual(["run-b", "run-a-1", "run-a-2"]);
  });

  test("project resume cannot clear a global emergency pause", async () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admit(store, "run-a", "scope-a", "2026-08-25T10:00:01.000Z");
    admit(store, "run-b", "scope-b", "2026-08-25T10:00:02.000Z");
    const started: string[] = [];
    const coordinator = new RunCoordinator({
      store,
      daemonEpoch: epoch,
      concurrency: 2,
      execute: async (run) => {
        started.push(run.id);
        return { kind: "terminal", state: "succeeded" };
      },
    });
    const scopeA = createRuntime(store, coordinator, epoch, "scope-a");

    coordinator.pauseGlobalAdmission();
    scopeA.setDispatchPaused(true);
    scopeA.setDispatchPaused(false);
    expect(coordinator.isGlobalAdmissionPaused()).toBe(true);
    expect(coordinator.refill()).toBe(0);
    expect(started).toEqual([]);

    expect(coordinator.resumeGlobalAdmission()).toBe(2);
    await coordinator.whenIdle();
    expect(started).toEqual(["run-a", "run-b"]);
  });

  test("runtime stop cancels and waits only for its project", async () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admit(store, "run-a", "scope-a", "2026-08-25T10:00:01.000Z");
    admit(store, "run-b", "scope-b", "2026-08-25T10:00:02.000Z");
    const startedA = deferred<void>();
    const startedB = deferred<void>();
    const finishB = deferred<RunExecutionOutcome>();
    const coordinator = new RunCoordinator({
      store,
      daemonEpoch: epoch,
      concurrency: 2,
      execute: (run, signal) => {
        if (run.scopeId === "scope-b") {
          startedB.resolve();
          return finishB.promise;
        }
        startedA.resolve();
        return new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => resolve({ kind: "terminal", state: "succeeded" }),
            { once: true },
          );
        });
      },
    });
    const scopeA = createRuntime(store, coordinator, epoch, "scope-a");

    coordinator.refill();
    await Promise.all([startedA.promise, startedB.promise]);
    await scopeA.stop(1, 1_000);

    expect(coordinator.isScopeBusy("scope-a")).toBe(false);
    expect(coordinator.activeRunIdsForScope("scope-b")).toEqual(["run-b"]);
    expect(store.getRun("run-a")?.state).toBe("cancelled");
    expect(store.getRun("run-b")?.state).toBe("running");

    finishB.resolve({ kind: "terminal", state: "succeeded" });
    await coordinator.whenIdle();
  });
});
