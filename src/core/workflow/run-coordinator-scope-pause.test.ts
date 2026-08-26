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
  for (const projectId of ["project-a", "project-b"]) {
    store.registerProject({
      id: projectId,
      rootPath: join(root, projectId),
      createdAt: "2026-08-25T10:00:00.000Z",
    });
  }
  return store;
}

function admit(
  store: RunStateDatabase,
  runId: string,
  projectId: string,
  admittedAt: string,
): void {
  store.admitRun({
    id: runId,
    projectId,
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
  projectId: string,
): WorkflowRuntime {
  return new WorkflowRuntime({
    bus: new EventBus(),
    projectDir: store.getProjectRoot(projectId)!,
    projectId,
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
    admit(store, "run-a-1", "project-a", "2026-08-25T10:00:01.000Z");
    admit(store, "run-a-2", "project-a", "2026-08-25T10:00:02.000Z");
    admit(store, "run-b", "project-b", "2026-08-25T10:00:03.000Z");

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
        if (run.projectId === "project-b") {
          bStarted.resolve();
          return bOutcome.promise;
        }
        aStarted.resolve();
        return { kind: "terminal", state: "succeeded" };
      },
    });
    const projectA = createRuntime(store, coordinator, epoch, "project-a");

    projectA.setDispatchPaused(true);
    await bStarted.promise;
    expect(coordinator.isProjectAdmissionPaused("project-a")).toBe(true);
    expect(started).toEqual(["run-b"]);

    projectA.setDispatchPaused(false);
    expect(coordinator.isProjectAdmissionPaused("project-a")).toBe(false);
    expect(started).toEqual(["run-b"]);

    bOutcome.resolve({ kind: "terminal", state: "succeeded" });
    await aStarted.promise;
    await coordinator.whenIdle();
    expect(started).toEqual(["run-b", "run-a-1", "run-a-2"]);
  });

  test("project resume cannot clear a global emergency pause", async () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admit(store, "run-a", "project-a", "2026-08-25T10:00:01.000Z");
    admit(store, "run-b", "project-b", "2026-08-25T10:00:02.000Z");
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
    const projectA = createRuntime(store, coordinator, epoch, "project-a");

    coordinator.pauseGlobalAdmission();
    projectA.setDispatchPaused(true);
    projectA.setDispatchPaused(false);
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
    admit(store, "run-a", "project-a", "2026-08-25T10:00:01.000Z");
    admit(store, "run-b", "project-b", "2026-08-25T10:00:02.000Z");
    const startedA = deferred<void>();
    const startedB = deferred<void>();
    const finishB = deferred<RunExecutionOutcome>();
    const coordinator = new RunCoordinator({
      store,
      daemonEpoch: epoch,
      concurrency: 2,
      execute: (run, signal) => {
        if (run.projectId === "project-b") {
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
    const projectA = createRuntime(store, coordinator, epoch, "project-a");

    coordinator.refill();
    await Promise.all([startedA.promise, startedB.promise]);
    await projectA.stop(1, 1_000);

    expect(coordinator.isProjectBusy("project-a")).toBe(false);
    expect(coordinator.activeRunIdsForProject("project-b")).toEqual(["run-b"]);
    expect(store.getRun("run-a")?.state).toBe("cancelled");
    expect(store.getRun("run-b")?.state).toBe("running");

    finishB.resolve({ kind: "terminal", state: "succeeded" });
    await coordinator.whenIdle();
  });
});
