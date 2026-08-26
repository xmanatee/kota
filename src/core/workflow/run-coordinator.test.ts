import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RunCoordinator, type RunExecutionOutcome } from "./run-coordinator.js";
import { RunStateDatabase } from "./run-state-database.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowQueuedRun } from "./run-types.js";
import type { WorkflowDefinition } from "./types.js";
import { WorkflowQueueManager } from "./workflow-queue.js";

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
  const root = mkdtempSync(join(tmpdir(), "kota-run-coordinator-"));
  roots.push(root);
  const store = new RunStateDatabase(root);
  stores.push(store);
  for (const id of ["scope-a", "scope-b"]) {
    store.registerScope({
      id,
      rootPath: join(root, id),
      createdAt: "2026-08-25T09:00:00.000Z",
    });
  }
  return store;
}

function admit(
  store: RunStateDatabase,
  id: string,
  scopeId: string,
  workflow: string,
  admittedAt: string,
  notBeforeAt?: string,
  resources: readonly string[] = [],
): void {
  store.admitRun({
    id,
    scopeId,
    workflow,
    repository: "none",
    trigger: { event: "test.requested", schemaRef: null, payload: { id } },
    resources,
    admittedAt,
    ...(notBeforeAt === undefined ? {} : { notBeforeAt }),
  });
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("RunCoordinator", () => {
  test("shares one limit across scopes and workflows and refills on completion", async () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admit(store, "run-a", "scope-a", "alpha", "2026-08-25T10:00:01.000Z");
    admit(store, "run-b", "scope-b", "beta", "2026-08-25T10:00:02.000Z");
    admit(store, "run-c", "scope-a", "gamma", "2026-08-25T10:00:03.000Z");

    const outcomes = new Map(
      ["run-a", "run-b", "run-c"].map((id) => [id, deferred<RunExecutionOutcome>()]),
    );
    const started = new Map(
      ["run-a", "run-b", "run-c"].map((id) => [id, deferred<void>()]),
    );
    const order: string[] = [];
    const coordinator = new RunCoordinator({
      store,
      daemonEpoch: epoch,
      concurrency: 2,
      execute: async (run) => {
        order.push(run.id);
        started.get(run.id)!.resolve();
        return outcomes.get(run.id)!.promise;
      },
    });

    expect(coordinator.refill()).toBe(2);
    await Promise.all([started.get("run-a")!.promise, started.get("run-b")!.promise]);
    expect(order).toEqual(["run-a", "run-b"]);
    expect(coordinator.activeCount).toBe(2);

    outcomes.get("run-a")!.resolve({ kind: "terminal", state: "succeeded" });
    await started.get("run-c")!.promise;
    expect(order).toEqual(["run-a", "run-b", "run-c"]);
    expect(coordinator.activeCount).toBe(2);

    outcomes.get("run-b")!.resolve({ kind: "terminal", state: "succeeded" });
    outcomes.get("run-c")!.resolve({ kind: "terminal", state: "succeeded" });
    await coordinator.whenIdle();
  });

  test("fills capacity around a resource waiter and starts it after release", async () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admit(
      store,
      "run-owner",
      "scope-a",
      "alpha",
      "2026-08-25T10:00:01.000Z",
      undefined,
      ["projection:shared"],
    );
    admit(
      store,
      "run-waiter",
      "scope-a",
      "beta",
      "2026-08-25T10:00:02.000Z",
      undefined,
      ["projection:shared"],
    );
    admit(
      store,
      "run-unrelated",
      "scope-b",
      "gamma",
      "2026-08-25T10:00:03.000Z",
      undefined,
      ["projection:other"],
    );
    const owner = deferred<RunExecutionOutcome>();
    const unrelated = deferred<RunExecutionOutcome>();
    const waiterStarted = deferred<void>();
    const order: string[] = [];
    const coordinator = new RunCoordinator({
      store,
      daemonEpoch: epoch,
      concurrency: 2,
      execute: async (run) => {
        order.push(run.id);
        if (run.id === "run-owner") return owner.promise;
        if (run.id === "run-unrelated") return unrelated.promise;
        waiterStarted.resolve();
        return { kind: "terminal", state: "succeeded" };
      },
    });

    expect(coordinator.refill()).toBe(2);
    await vi.waitFor(() => expect(order).toEqual(["run-owner", "run-unrelated"]));
    expect(store.getRun("run-waiter")?.state).toBe("queued");

    owner.resolve({ kind: "terminal", state: "succeeded" });
    await waiterStarted.promise;
    expect(order).toEqual(["run-owner", "run-unrelated", "run-waiter"]);

    unrelated.resolve({ kind: "terminal", state: "succeeded" });
    await coordinator.whenIdle();
  });

  test("drains an awaited child while global and scope admission are paused", async () => {
    const store = createStore();
    const now = "2026-08-25T10:00:03.000Z";
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admit(store, "parent", "scope-a", "parent-workflow", "2026-08-25T10:00:01.000Z");
    admit(store, "child", "scope-a", "child-workflow", "2026-08-25T10:00:02.000Z");
    let coordinator!: RunCoordinator;
    let childAttempts = 0;
    let parentObservedChild = "";
    const occupied: number[] = [];
    coordinator = new RunCoordinator({
      store,
      daemonEpoch: epoch,
      concurrency: 1,
      now: () => now,
      execute: async (run, signal) => {
        occupied.push(coordinator.occupiedCapacity);
        if (run.id === "parent") {
          coordinator.pauseGlobalAdmission();
          coordinator.pauseScopeAdmission("scope-a");
          const child = await coordinator.waitForChild(run.id, "child", signal);
          parentObservedChild = child.state;
          occupied.push(coordinator.occupiedCapacity);
          return { kind: "terminal", state: "succeeded" };
        }
        childAttempts += 1;
        return childAttempts === 1
          ? { kind: "suspended", state: "waiting", resumeAt: now }
          : { kind: "terminal", state: "succeeded" };
      },
    });

    coordinator.refill();
    await coordinator.whenIdle();

    expect(childAttempts).toBe(2);
    expect(parentObservedChild).toBe("succeeded");
    expect(Math.max(...occupied)).toBe(1);
    expect(coordinator.isGlobalAdmissionPaused()).toBe(true);
    expect(coordinator.isScopeAdmissionPaused("scope-a")).toBe(true);
    expect(store.getRun("parent")?.state).toBe("succeeded");
    expect(store.getRun("child")?.state).toBe("succeeded");
  });

  test("wakes idle capacity for appended and resumed work without double execution", async () => {
    const store = createStore();
    const now = "2026-08-25T10:00:01.000Z";
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    const scopeRoot = store.getScopeRoot("scope-a")!;
    const definition: WorkflowDefinition = {
      name: "alpha",
      enabled: true,
      moduleRoot: scopeRoot,
      repository: "none",
      tags: [],
      definitionPath: "src/core/workflow/run-coordinator.test.ts",
      triggers: [{ event: "test.requested", cooldownMs: 0 }],
      steps: [],
    };
    const queued: WorkflowQueuedRun = {
      runId: "run-appended",
      workflowName: definition.name,
      trigger: { event: "test.requested", schemaRef: null, payload: {} },
      enqueuedAtMs: Date.parse(now),
      notBeforeMs: Date.parse(now),
    };
    const executions: string[] = [];
    const coordinator = new RunCoordinator({
      store,
      daemonEpoch: epoch,
      concurrency: 1,
      now: () => now,
      execute: async (run) => {
        executions.push(run.id);
        return executions.length === 1
          ? { kind: "suspended", state: "waiting" }
          : { kind: "terminal", state: "succeeded" };
      },
    });
    const queue = new WorkflowQueueManager({
      store: new WorkflowRunStore(scopeRoot),
      runState: store,
      coordinator,
      scopeId: "scope-a",
      scopeRoot,
      getScopeId: () => "test-scope",
      getActiveBackoff: () => null,
      workflowUsesAgent: () => false,
      getDefinitions: () => [definition],
      log: () => undefined,
    });

    expect(queue.appendRun(queued)).toEqual({ status: "admitted", runId: queued.runId });
    expect(queue.appendRun(queued)).toEqual({ status: "duplicate", runId: queued.runId });
    await coordinator.whenIdle();

    expect(executions).toEqual([queued.runId]);
    expect(store.getRun("run-appended")?.state).toBe("waiting");

    queue.appendResumeRun(queued);
    queue.appendResumeRun(queued);
    await coordinator.whenIdle();

    expect(executions).toEqual([queued.runId, queued.runId]);
    expect(store.getRun("run-appended")?.state).toBe("succeeded");
  });

  test("cancels and waits for one project without disturbing another", async () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admit(store, "run-a", "scope-a", "alpha", "2026-08-25T10:00:01.000Z");
    admit(store, "run-b", "scope-b", "beta", "2026-08-25T10:00:02.000Z");
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
            () => resolve({ kind: "terminal", state: "cancelled" }),
            { once: true },
          );
        });
      },
    });

    coordinator.refill();
    await Promise.all([startedA.promise, startedB.promise]);
    expect(coordinator.activeRunIdsForScope("scope-a")).toEqual(["run-a"]);
    expect(coordinator.activeRunIdsForScope("scope-b")).toEqual(["run-b"]);

    const projectAIdle = coordinator.whenScopeIdle("scope-a");
    expect(coordinator.cancelScope("scope-a")).toBe(1);
    await projectAIdle;

    expect(coordinator.isScopeBusy("scope-a")).toBe(false);
    expect(coordinator.isScopeBusy("scope-b")).toBe(true);
    expect(store.getRun("run-a")?.state).toBe("cancelled");
    expect(store.getRun("run-b")?.state).toBe("running");

    finishB.resolve({ kind: "terminal", state: "succeeded" });
    await coordinator.whenIdle();
  });

  test("pauses only new admission and resumes queued work", async () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admit(store, "run-a", "scope-a", "alpha", "2026-08-25T10:00:01.000Z");
    admit(store, "run-b", "scope-a", "alpha", "2026-08-25T10:00:02.000Z");
    const first = deferred<RunExecutionOutcome>();
    const secondStarted = deferred<void>();
    const coordinator = new RunCoordinator({
      store,
      daemonEpoch: epoch,
      concurrency: 1,
      execute: async (run) => {
        if (run.id === "run-a") return first.promise;
        secondStarted.resolve();
        return { kind: "terminal", state: "succeeded" };
      },
    });

    coordinator.refill();
    coordinator.pauseGlobalAdmission();
    first.resolve({ kind: "terminal", state: "succeeded" });
    await coordinator.whenIdle();
    expect(store.getRun("run-b")?.state).toBe("queued");

    expect(coordinator.resumeGlobalAdmission()).toBe(1);
    await secondStarted.promise;
    await coordinator.whenIdle();
    expect(store.getRun("run-b")?.state).toBe("succeeded");
  });

  test("cancels queued and active runs without admitting replacement early", async () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admit(store, "run-a", "scope-a", "alpha", "2026-08-25T10:00:01.000Z");
    admit(store, "run-b", "scope-a", "alpha", "2026-08-25T10:00:02.000Z");
    const started = deferred<void>();
    const aborted = deferred<void>();
    const coordinator = new RunCoordinator({
      store,
      daemonEpoch: epoch,
      concurrency: 1,
      execute: async (_run, signal) =>
        new Promise((resolve) => {
          started.resolve();
          signal.addEventListener(
            "abort",
            () => {
              aborted.resolve();
              resolve({ kind: "terminal", state: "cancelled" });
            },
            { once: true },
          );
        }),
    });

    coordinator.refill();
    await started.promise;
    expect(coordinator.cancel("run-b")).toBe(true);
    expect(coordinator.cancel("run-a")).toBe(true);
    await aborted.promise;
    await coordinator.whenIdle();

    expect(store.getRun("run-a")?.state).toBe("cancelled");
    expect(store.getRun("run-b")?.state).toBe("cancelled");
    expect(coordinator.cancel("run-a")).toBe(false);
  });

  test("preserves lifecycle attention after cancellation when cleanup is not safe", async () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admit(store, "run-a", "scope-a", "alpha", "2026-08-25T10:00:01.000Z");
    const started = deferred<void>();
    const coordinator = new RunCoordinator({
      store,
      daemonEpoch: epoch,
      concurrency: 1,
      execute: async (_run, signal) =>
        new Promise((resolve) => {
          started.resolve();
          signal.addEventListener(
            "abort",
            () => resolve({
              kind: "suspended",
              state: "needs_attention",
              wait: { reason: "sandbox-cleanup-blocked" },
            }),
            { once: true },
          );
        }),
    });

    coordinator.refill();
    await started.promise;
    expect(coordinator.cancel("run-a")).toBe(true);
    await coordinator.whenIdle();

    expect(store.getRun("run-a")).toMatchObject({
      state: "needs_attention",
      wait: { reason: "sandbox-cleanup-blocked" },
    });
  });

  test("fails fast when an awaited child requires a resource held by its parent", async () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admit(
      store,
      "parent",
      "scope-a",
      "parent-workflow",
      "2026-08-25T10:00:01.000Z",
      undefined,
      ["projection:shared"],
    );
    admit(
      store,
      "child",
      "scope-a",
      "child-workflow",
      "2026-08-25T10:00:02.000Z",
      undefined,
      ["projection:shared"],
    );
    let coordinator!: RunCoordinator;
    coordinator = new RunCoordinator({
      store,
      daemonEpoch: epoch,
      concurrency: 1,
      execute: async (run, signal) => {
        if (run.id === "parent") {
          await coordinator.waitForChild(run.id, "child", signal);
        }
        return { kind: "terminal", state: "succeeded" };
      },
    });

    coordinator.refill();
    await coordinator.whenIdle();

    expect(store.getRun("parent")).toMatchObject({
      state: "failed",
      lastError: expect.stringContaining("both require resource"),
    });
    expect(store.getRun("child")?.state).toBe("succeeded");
  });

  test("applies terminal, suspension, and thrown execution outcomes", async () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admit(store, "run-a", "scope-a", "alpha", "2026-08-25T10:00:01.000Z");
    admit(store, "run-b", "scope-b", "beta", "2026-08-25T10:00:02.000Z");
    admit(store, "run-c", "scope-a", "gamma", "2026-08-25T10:00:03.000Z");
    const coordinator = new RunCoordinator({
      store,
      daemonEpoch: epoch,
      concurrency: 3,
      execute: async (run) => {
        if (run.id === "run-a") return { kind: "terminal", state: "succeeded" };
        if (run.id === "run-b") {
          return {
            kind: "suspended",
            state: "waiting",
            wait: { event: "owner.answer" },
          };
        }
        throw new Error("executor failed");
      },
    });

    coordinator.refill();
    await coordinator.whenIdle();

    expect(store.getRun("run-a")?.state).toBe("succeeded");
    expect(store.getRun("run-b")).toMatchObject({
      state: "waiting",
      wait: { event: "owner.answer" },
    });
    expect(store.getRun("run-c")?.state).toBe("failed");
  });

  test("starts delayed work only after an eligibility-triggered refill", async () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    let now = "2026-08-25T10:00:05.000Z";
    admit(
      store,
      "run-delayed",
      "scope-a",
      "alpha",
      "2026-08-25T10:00:01.000Z",
      "2026-08-25T10:01:00.000Z",
    );
    admit(store, "run-ready", "scope-b", "beta", "2026-08-25T10:00:02.000Z");
    const order: string[] = [];
    const coordinator = new RunCoordinator({
      store,
      daemonEpoch: epoch,
      concurrency: 1,
      now: () => now,
      execute: async (run) => {
        order.push(run.id);
        return { kind: "terminal", state: "succeeded" };
      },
    });

    coordinator.refill();
    await coordinator.whenIdle();
    expect(order).toEqual(["run-ready"]);
    expect(store.getRun("run-delayed")?.state).toBe("queued");

    now = "2026-08-25T10:01:00.000Z";
    coordinator.refill();
    await coordinator.whenIdle();
    expect(order).toEqual(["run-ready", "run-delayed"]);
  });

  test("executes a durable run once when coordinators race to start it", async () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admit(store, "run-a", "scope-a", "alpha", "2026-08-25T10:00:01.000Z");
    const finish = deferred<RunExecutionOutcome>();
    const execute = vi.fn(async () => finish.promise);
    const options = {
      store,
      daemonEpoch: epoch,
      concurrency: 1,
      execute,
    };
    const first = new RunCoordinator(options);
    const second = new RunCoordinator(options);

    expect(first.refill() + second.refill()).toBe(1);
    expect(execute).toHaveBeenCalledTimes(0);
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(1);

    finish.resolve({ kind: "terminal", state: "succeeded" });
    await first.whenIdle();
    await second.whenIdle();
    expect(store.getRun("run-a")?.state).toBe("succeeded");
  });

  test("retries a durable terminal publication after delivery fails", async () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admit(store, "run-a", "scope-a", "alpha", "2026-08-25T10:00:01.000Z");
    let shouldFail = true;
    const delivered: string[] = [];
    const coordinator = new RunCoordinator({
      store,
      daemonEpoch: epoch,
      concurrency: 1,
      execute: async (run) => ({
        kind: "terminal",
        state: "succeeded",
        publication: {
          id: `workflow:${run.id}:completed`,
          runId: run.id,
          scopeId: run.scopeId,
          event: "workflow.completed",
          payload: { runId: run.id },
        },
      }),
      deliverPublication: (publication) => {
        if (shouldFail) throw new Error("bus unavailable");
        delivered.push(publication.id);
      },
    });

    coordinator.refill();
    await coordinator.whenIdle();
    expect(store.getRun("run-a")?.state).toBe("succeeded");
    expect(store.listPendingPublications()).toHaveLength(1);

    shouldFail = false;
    await coordinator.drainPublications();
    expect(delivered).toEqual(["workflow:run-a:completed"]);
    expect(store.listPendingPublications()).toEqual([]);
  });

  test("delivers staged workflow events when a run terminates without an inline publication", async () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admit(store, "run-a", "scope-a", "alpha", "2026-08-25T10:00:01.000Z");
    const delivered: string[] = [];
    const coordinator = new RunCoordinator({
      store,
      daemonEpoch: epoch,
      concurrency: 1,
      execute: async (run) => {
        store.stageEmitIntent({
          runId: run.id,
          stepId: "publish-result",
          event: "result.ready",
          payload: { runId: run.id },
          stagedAt: "2026-08-25T10:00:02.000Z",
        });
        return { kind: "terminal", state: "succeeded" };
      },
      deliverPublication: (publication) => {
        delivered.push(publication.event);
      },
    });

    coordinator.refill();
    await coordinator.whenIdle();

    expect(delivered).toEqual(["result.ready"]);
    expect(store.listPendingPublications()).toEqual([]);
  });

  test("preserves publication order per run without blocking unrelated runs", async () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    for (const runId of ["run-a", "run-b"]) {
      admit(store, runId, "scope-a", "alpha", "2026-08-25T10:00:01.000Z");
      store.startRun(runId, epoch, "2026-08-25T10:00:02.000Z");
    }
    store.stageEmitIntent({
      runId: "run-a",
      stepId: "first",
      event: "first",
      payload: {},
      stagedAt: "2026-08-25T10:00:02.100Z",
    });
    store.stageEmitIntent({
      runId: "run-a",
      stepId: "second",
      event: "second",
      payload: {},
      stagedAt: "2026-08-25T10:00:02.200Z",
    });
    store.stageEmitIntent({
      runId: "run-b",
      stepId: "only",
      event: "unrelated",
      payload: {},
      stagedAt: "2026-08-25T10:00:02.300Z",
    });
    store.finishRun("run-a", epoch, "succeeded", "2026-08-25T10:00:03.000Z");
    store.finishRun("run-b", epoch, "succeeded", "2026-08-25T10:00:03.000Z");

    const attempted: string[] = [];
    const coordinator = new RunCoordinator({
      store,
      daemonEpoch: epoch,
      concurrency: 1,
      execute: async () => ({ kind: "terminal", state: "succeeded" }),
      deliverPublication: (publication) => {
        attempted.push(publication.event);
        if (publication.event === "first") throw new Error("head unavailable");
      },
    });

    await coordinator.drainPublications();

    expect(attempted).toEqual(["first", "unrelated"]);
    expect(store.listPendingPublications().map((item) => item.event)).toEqual([
      "first",
      "second",
    ]);
  });

  test("disposes active work before its run-state database can be closed", async () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admit(store, "run-a", "scope-a", "alpha", "2026-08-25T10:00:01.000Z");
    const started = deferred<void>();
    const aborted = deferred<void>();
    const coordinator = new RunCoordinator({
      store,
      daemonEpoch: epoch,
      concurrency: 1,
      execute: async (_run, signal) =>
        new Promise((resolve) => {
          started.resolve();
          signal.addEventListener(
            "abort",
            () => {
              aborted.resolve();
              resolve({ kind: "terminal", state: "cancelled" });
            },
            { once: true },
          );
        }),
    });

    coordinator.refill();
    await started.promise;
    coordinator.beginDisposal();
    expect(coordinator.refill()).toBe(0);
    await coordinator.dispose();
    await aborted.promise;

    expect(store.getRun("run-a")?.state).toBe("cancelled");
    expect(coordinator.isDisposed).toBe(true);
  });

  test("never touches run state from queued callbacks after disposal", async () => {
    vi.useFakeTimers();
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admit(
      store,
      "run-delayed",
      "scope-a",
      "alpha",
      "2026-08-25T10:00:01.000Z",
      "2026-08-25T10:01:00.000Z",
    );
    const coordinator = new RunCoordinator({
      store,
      daemonEpoch: epoch,
      concurrency: 1,
      now: () => "2026-08-25T10:00:00.000Z",
      execute: async () => ({ kind: "terminal", state: "succeeded" }),
    });

    coordinator.refill();
    coordinator.beginDisposal();
    await coordinator.dispose();
    store.close();
    stores.splice(stores.indexOf(store), 1);

    expect(coordinator.refill()).toBe(0);
    expect(coordinator.resumeGlobalAdmission()).toBe(0);
    expect(coordinator.resumeScopeAdmission("scope-a")).toBe(0);
    await expect(coordinator.drainPublications()).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
    vi.useRealTimers();
  });

  test("fails disposal within its bound when an attempt ignores cancellation", async () => {
    vi.useFakeTimers();
    try {
      const store = createStore();
      const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
      admit(store, "run-stuck", "scope-a", "alpha", "2026-08-25T10:00:01.000Z");
      const started = deferred<void>();
      const coordinator = new RunCoordinator({
        store,
        daemonEpoch: epoch,
        concurrency: 1,
        execute: async () => {
          started.resolve();
          return new Promise<RunExecutionOutcome>(() => undefined);
        },
      });

      coordinator.refill();
      await started.promise;
      const disposal = coordinator.dispose(25);
      const rejection = expect(disposal).rejects.toThrow(
        "Run coordinator disposal timed out waiting for active attempts",
      );
      await vi.advanceTimersByTimeAsync(25);
      await rejection;

      expect(coordinator.isDisposed).toBe(false);
      expect(store.getRun("run-stuck")?.state).toBe("running");
    } finally {
      vi.useRealTimers();
    }
  });
});
