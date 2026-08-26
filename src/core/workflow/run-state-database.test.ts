import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import {
  AdmissionKeyConflictError,
  PublicationIntentConflictError,
  RunStateDatabase,
  StaleDaemonEpochError,
  StateValueConflictError,
} from "./run-state-database.js";

const roots: string[] = [];

function createStore(): RunStateDatabase {
  const root = mkdtempSync(join(tmpdir(), "kota-run-state-"));
  roots.push(root);
  const store = new RunStateDatabase(root);
  store.registerScope({
    id: "scope-a",
    rootPath: join(root, "scope-a"),
    createdAt: "2026-08-25T09:00:00.000Z",
  });
  return store;
}

function admitAndStart(
  store: RunStateDatabase,
  runId: string,
  epoch: number,
): void {
  store.admitRun({
    id: runId,
    scopeId: "scope-a",
    workflow: "publisher",
    repository: "none",
    trigger: { event: "manual", schemaRef: null, payload: {} },
    resources: [],
    admittedAt: "2026-08-25T10:00:01.000Z",
  });
  store.startRun(runId, epoch, "2026-08-25T10:00:02.000Z");
}

function completionPublication(runId: string) {
  const id = `workflow:${runId}:completed`;
  return {
    id,
    runId,
    scopeId: "scope-a",
    event: "workflow.completed",
    payload: { runId, publicationId: id },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("RunStateDatabase", () => {
  test("derives workflow summaries from durable run outcomes", () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    store.admitRun({
      id: "run-a",
      scopeId: "scope-a",
      workflow: "reviewer",
      repository: "none",
      trigger: { event: "manual", schemaRef: null, payload: {} },
      resources: [],
      admittedAt: "2026-08-25T10:00:01.000Z",
    });
    store.startRun("run-a", epoch, "2026-08-25T10:00:02.000Z");
    store.finishRun(
      "run-a",
      epoch,
      "succeeded",
      "2026-08-25T10:00:03.000Z",
      undefined,
      undefined,
      "completed-with-warnings",
    );

    expect(store.readWorkflowSummary("scope-a")).toEqual({
      completedRuns: 1,
      workflows: {
        reviewer: {
          lastStarted: {
            runId: "run-a",
            startedAt: "2026-08-25T10:00:02.000Z",
          },
          lastCompletion: {
            runId: "run-a",
            startedAt: "2026-08-25T10:00:02.000Z",
            completedAt: "2026-08-25T10:00:03.000Z",
            status: "completed-with-warnings",
          },
        },
      },
    });
  });

  test("updates runtime-owned scope state with revision checks", () => {
    const store = createStore();

    store.compareAndSetScopeStateValue({
      scopeId: "scope-a",
      key: "runtime/agent-backoff",
      expectedRevision: 0,
      value: { kind: "provider" },
      updatedAt: "2026-08-25T10:00:00.000Z",
    });

    expect(
      store.readScopeStateValue("scope-a", "runtime/agent-backoff"),
    ).toEqual({ revision: 1, value: { kind: "provider" } });
    expect(() =>
      store.compareAndSetScopeStateValue({
        scopeId: "scope-a",
        key: "runtime/agent-backoff",
        expectedRevision: 0,
        value: null,
        updatedAt: "2026-08-25T10:00:01.000Z",
      }),
    ).toThrow(StateValueConflictError);
  });

  test("rejects databases created by a newer schema", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-run-state-future-"));
    roots.push(root);
    const future = new Database(join(root, "kota.sqlite"));
    future.pragma("user_version = 999");
    future.close();

    expect(() => new RunStateDatabase(root)).toThrow(/schema version 999/);
  });

  test("refuses to migrate through an offline database handle", () => {
    const store = createStore();
    const stateDir = dirname(store.path);
    store.close();
    const raw = new Database(join(stateDir, "kota.sqlite"));
    raw.pragma("user_version = 2");
    raw.close();

    expect(() => RunStateDatabase.openReadOnly(stateDir)).toThrow(
      /requires daemon-owned migration/i,
    );
    const unchanged = new Database(join(stateDir, "kota.sqlite"), { readonly: true });
    expect(unchanged.pragma("user_version", { simple: true })).toBe(2);
    unchanged.close();
  });

  test("rejects every terminal transition without a result status", () => {
    const store = createStore();
    store.admitRun({
      id: "run-terminal-invariant",
      scopeId: "scope-a",
      workflow: "builder",
      repository: "write",
      trigger: { event: "manual", schemaRef: null, payload: {} },
      resources: [],
      admittedAt: "2026-08-25T10:00:00.000Z",
    });
    const raw = new Database(store.path);

    expect(() =>
      raw.prepare(
        "UPDATE runs SET state = 'cancelled', finished_at = ? WHERE id = ?",
      ).run("2026-08-25T10:01:00.000Z", "run-terminal-invariant")
    ).toThrow(/terminal workflow runs require result_status/i);

    raw.close();
    store.close();
  });

  test("persists contending admissions and acquires all resources only at start", () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T09:59:59.000Z");

    const admitted = store.admitRun({
      id: "run-a",
      scopeId: "scope-a",
      workflow: "builder",
      repository: "write",
      trigger: { event: "task.ready", schemaRef: null, payload: { taskId: "task-a" } },
      resources: ["task:task-a"],
      admission: {
        scopeId: "scope-a",
        key: "event:task-a",
        parameterFingerprint: "fingerprint-a",
      },
      admittedAt: "2026-08-25T10:00:00.000Z",
    });

    expect(admitted).toEqual({ status: "admitted", runId: "run-a" });

    expect(store.getRun("run-a")).toMatchObject({
      id: "run-a",
      state: "queued",
      resources: ["task:task-a"],
    });
    expect(
      store.admitRun({
        id: "run-b",
        scopeId: "scope-a",
        workflow: "builder",
        repository: "write",
        trigger: { event: "task.ready", schemaRef: null, payload: { taskId: "task-a" } },
        resources: ["task:task-a"],
        admission: {
          scopeId: "scope-a",
          key: "event:task-b",
          parameterFingerprint: "fingerprint-b",
        },
        admittedAt: "2026-08-25T10:00:01.000Z",
      }),
    ).toEqual({ status: "admitted", runId: "run-b" });
    expect(store.getRun("run-b")).toMatchObject({
      state: "queued",
      resources: ["task:task-a"],
    });

    expect(
      store.admitRun({
        id: "run-duplicate",
        scopeId: "scope-a",
        workflow: "builder",
        repository: "write",
        trigger: { event: "task.ready", schemaRef: null, payload: { taskId: "task-a" } },
        resources: ["task:task-a"],
        admission: {
          scopeId: "scope-a",
          key: "event:task-a",
          parameterFingerprint: "fingerprint-a",
        },
        admittedAt: "2026-08-25T10:00:02.000Z",
      }),
    ).toEqual({ status: "duplicate", runId: "run-a" });
    expect(store.getRun("run-duplicate")).toBeNull();
    expect(() =>
      store.admitRun({
        id: "run-conflict",
        scopeId: "scope-a",
        workflow: "builder",
        repository: "write",
        trigger: { event: "task.ready", schemaRef: null, payload: { taskId: "task-a" } },
        resources: [],
        admission: {
          scopeId: "scope-a",
          key: "event:task-a",
          parameterFingerprint: "different-fingerprint",
        },
        admittedAt: "2026-08-25T10:00:03.000Z",
      }),
    ).toThrow(AdmissionKeyConflictError);

    expect(store.startRun("run-a", epoch, "2026-08-25T10:00:04.000Z")).toBe(1);
    expect(store.startRun("run-b", epoch, "2026-08-25T10:00:04.000Z")).toBeNull();
    expect(store.getRun("run-b")?.state).toBe("queued");

    store.finishRun("run-a", epoch, "succeeded", "2026-08-25T10:00:05.000Z");
    expect(store.startRun("run-b", epoch, "2026-08-25T10:00:06.000Z")).toBe(1);
    expect(store.getRun("run-b")?.state).toBe("running");
  });

  test.each(["failed", "cancelled"] as const)(
    "redelivers an unchanged %s admission as a fresh run",
    (terminalState) => {
      const store = createStore();
      const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
      const contract = {
        scopeId: "scope-a",
        key: "event:task-a",
        parameterFingerprint: "fingerprint-a",
      };
      store.admitRun({
        id: "run-a",
        scopeId: "scope-a",
        workflow: "builder",
        repository: "write",
        trigger: { event: "task.ready", schemaRef: null, payload: { taskId: "task-a" } },
        resources: ["task:task-a"],
        admission: contract,
        admittedAt: "2026-08-25T10:00:01.000Z",
      });
      store.startRun("run-a", epoch, "2026-08-25T10:00:02.000Z");
      store.finishRun(
        "run-a",
        epoch,
        terminalState,
        "2026-08-25T10:00:03.000Z",
      );

      expect(
        store.admitRun({
          id: "run-b",
          scopeId: "scope-a",
          workflow: "builder",
          repository: "write",
          trigger: { event: "task.ready", schemaRef: null, payload: { taskId: "task-a" } },
          resources: ["task:task-a"],
          admission: contract,
          admittedAt: "2026-08-25T10:00:04.000Z",
        }),
      ).toEqual({ status: "admitted", runId: "run-b" });
      expect(
        store.admitRun({
          id: "run-c",
          scopeId: "scope-a",
          workflow: "builder",
          repository: "write",
          trigger: { event: "task.ready", schemaRef: null, payload: { taskId: "task-a" } },
          resources: ["task:task-a"],
          admission: contract,
          admittedAt: "2026-08-25T10:00:05.000Z",
        }),
      ).toEqual({ status: "duplicate", runId: "run-b" });
      expect(store.getRun("run-a")?.state).toBe(terminalState);
      expect(store.getRun("run-b")).toMatchObject({
        state: "queued",
        resources: ["task:task-a"],
      });
      expect(store.getRun("run-c")).toBeNull();
    },
  );

  test.each(["running", "waiting", "needs_attention", "integrating", "succeeded"] as const)(
    "keeps an admission mapped to its %s run",
    (state) => {
      const store = createStore();
      const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
      const contract = {
        scopeId: "scope-a",
        key: "event:task-a",
        parameterFingerprint: "fingerprint-a",
      };
      store.admitRun({
        id: "run-a",
        scopeId: "scope-a",
        workflow: "builder",
        repository: "write",
        trigger: { event: "task.ready", schemaRef: null, payload: { taskId: "task-a" } },
        resources: [],
        admission: contract,
        admittedAt: "2026-08-25T10:00:01.000Z",
      });
      store.startRun("run-a", epoch, "2026-08-25T10:00:02.000Z");
      if (state === "waiting" || state === "needs_attention") {
        store.suspendRun({
          runId: "run-a",
          epoch,
          state,
          suspendedAt: "2026-08-25T10:00:03.000Z",
        });
      } else if (state === "integrating") {
        store.beginIntegration("run-a", epoch, { phase: "publication" });
      } else if (state === "succeeded") {
        store.finishRun("run-a", epoch, state, "2026-08-25T10:00:03.000Z");
      }

      expect(
        store.admitRun({
          id: "run-b",
          scopeId: "scope-a",
          workflow: "builder",
          repository: "write",
          trigger: { event: "task.ready", schemaRef: null, payload: { taskId: "task-a" } },
          resources: [],
          admission: contract,
          admittedAt: "2026-08-25T10:00:04.000Z",
        }),
      ).toEqual({ status: "duplicate", runId: "run-a" });
      expect(store.getRun("run-b")).toBeNull();
    },
  );

  test("keeps terminal redelivery queued while its logical resource is owned", () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    const contract = {
      scopeId: "scope-a",
      key: "event:task-a",
      parameterFingerprint: "fingerprint-a",
    };
    store.admitRun({
      id: "run-a",
      scopeId: "scope-a",
      workflow: "builder",
      repository: "write",
      trigger: { event: "task.ready", schemaRef: null, payload: { taskId: "task-a" } },
      resources: ["task:task-a"],
      admission: contract,
      admittedAt: "2026-08-25T10:00:01.000Z",
    });
    store.startRun("run-a", epoch, "2026-08-25T10:00:02.000Z");
    store.finishRun("run-a", epoch, "failed", "2026-08-25T10:00:03.000Z");
    store.admitRun({
      id: "run-blocker",
      scopeId: "scope-a",
      workflow: "operator",
      repository: "write",
      trigger: { event: "manual", schemaRef: null, payload: {} },
      resources: ["task:task-a"],
      admittedAt: "2026-08-25T10:00:04.000Z",
    });
    store.startRun("run-blocker", epoch, "2026-08-25T10:00:04.500Z");

    expect(
      store.admitRun({
        id: "run-retry",
        scopeId: "scope-a",
        workflow: "builder",
        repository: "write",
        trigger: { event: "task.ready", schemaRef: null, payload: { taskId: "task-a" } },
        resources: ["task:task-a"],
        admission: contract,
        admittedAt: "2026-08-25T10:00:05.000Z",
      }),
    ).toEqual({ status: "admitted", runId: "run-retry" });
    expect(store.startRun("run-retry", epoch, "2026-08-25T10:00:06.000Z")).toBeNull();
    expect(store.getRun("run-retry")?.state).toBe("queued");

    store.finishRun("run-blocker", epoch, "succeeded", "2026-08-25T10:00:07.000Z");
    expect(store.startRun("run-retry", epoch, "2026-08-25T10:00:08.000Z")).toBe(1);
  });

  test("preserves a resource waiter across restart", () => {
    const store = createStore();
    const stateDir = dirname(store.path);
    const first = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    for (const [index, runId] of ["run-owner", "run-waiter"].entries()) {
      store.admitRun({
        id: runId,
        scopeId: "scope-a",
        workflow: "publisher",
        repository: "none",
        trigger: { event: "manual", schemaRef: null, payload: { runId } },
        resources: ["projection:shared"],
        admittedAt: `2026-08-25T10:00:0${index + 1}.000Z`,
      });
    }
    expect(store.startRun("run-owner", first.epoch, "2026-08-25T10:00:03.000Z")).toBe(1);
    store.close();

    const reopened = new RunStateDatabase(stateDir);
    try {
      const second = reopened.beginDaemonSession("2026-08-25T10:01:00.000Z");
      expect(reopened.getRun("run-waiter")).toMatchObject({
        state: "queued",
        resources: ["projection:shared"],
      });
      expect(
        reopened.listDispatchableRuns({
          now: "2026-08-25T10:01:01.000Z",
          limit: 2,
          excludedScopeIds: [],
        }),
      ).toEqual([]);

      expect(reopened.cancelQueuedRun("run-owner", "2026-08-25T10:01:02.000Z")).toBe(true);
      expect(reopened.getRun("run-owner")).toMatchObject({
        state: "cancelled",
        resultStatus: "interrupted",
      });
      expect(
        reopened.startRun("run-waiter", second.epoch, "2026-08-25T10:01:03.000Z"),
      ).toBe(1);
    } finally {
      reopened.close();
    }
  });

  test("fences a superseded daemon until process recovery is acknowledged", () => {
    const store = createStore();
    const firstSession = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    store.admitRun({
      id: "run-a",
      scopeId: "scope-a",
      workflow: "builder",
      repository: "write",
      trigger: { event: "task.ready", schemaRef: null, payload: { taskId: "task-a" } },
      resources: ["task:task-a"],
      admittedAt: "2026-08-25T10:00:01.000Z",
    });
    store.startRun("run-a", firstSession.epoch, "2026-08-25T10:00:02.000Z");
    const processes = [
      { pid: 101, processGroupId: 101, osStartToken: "start-a", observedCommandHash: "hash-a" },
      { pid: 102, processGroupId: 102, osStartToken: "start-b", observedCommandHash: "hash-b" },
    ];
    for (const [index, identity] of processes.entries()) {
      store.registerAttemptProcess({
        runId: "run-a",
        epoch: firstSession.epoch,
        processKey: `${identity.pid}:${identity.osStartToken}`,
        identity,
        registeredAt: `2026-08-25T10:00:0${index + 3}.000Z`,
      });
    }

    const secondSession = store.beginDaemonSession("2026-08-25T10:01:00.000Z");

    expect(secondSession).toEqual({
      epoch: 2,
      recovered: [{ runId: "run-a", previousEpoch: 1, processes }],
    });
    expect(store.getRun("run-a")).toMatchObject({
      state: "needs_attention",
      resources: ["task:task-a"],
    });
    expect(() =>
      store.finishRun(
        "run-a",
        firstSession.epoch,
        "succeeded",
        "2026-08-25T10:01:01.000Z",
      ),
    ).toThrow(StaleDaemonEpochError);
    store.completeRestartRecovery(
      "run-a",
      secondSession.epoch,
      "2026-08-25T10:01:02.000Z",
    );
    expect(store.getRun("run-a")?.state).toBe("queued");
    expect(store.getRun("run-a")?.processes).toEqual([]);
  });

  test("releases ownership only after a terminal transition", () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    store.admitRun({
      id: "run-a",
      scopeId: "scope-a",
      workflow: "builder",
      repository: "write",
      trigger: { event: "task.ready", schemaRef: null, payload: { taskId: "task-a" } },
      resources: ["task:task-a"],
      admittedAt: "2026-08-25T10:00:01.000Z",
    });
    store.startRun("run-a", epoch, "2026-08-25T10:00:02.000Z");
    store.finishRun(
      "run-a",
      epoch,
      "succeeded",
      "2026-08-25T10:00:03.000Z",
    );

    expect(store.getRun("run-a")).toMatchObject({
      state: "succeeded",
      resources: [],
    });
    expect(() =>
      store.admitRun({
        id: "run-b",
        scopeId: "scope-a",
        workflow: "builder",
        repository: "write",
        trigger: { event: "task.ready", schemaRef: null, payload: { taskId: "task-a" } },
        resources: ["task:task-a"],
        admittedAt: "2026-08-25T10:00:04.000Z",
      }),
    ).not.toThrow();
  });

  test("rejects a lost-update race before either run can overwrite shared state", () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admitAndStart(store, "run-a", epoch);
    admitAndStart(store, "run-b", epoch);
    const first = store.readScopeStateValue<{ count: number }>(
      "scope-a",
      "attention/counter",
    );
    const second = store.readScopeStateValue<{ count: number }>(
      "scope-a",
      "attention/counter",
    );

    store.stageScopeStateMutation({
      runId: "run-a",
      key: "attention/counter",
      expectedRevision: first.revision,
      value: { count: 1 },
      stagedAt: "2026-08-25T10:00:03.000Z",
    });
    expect(() =>
      store.stageScopeStateMutation({
        runId: "run-b",
        key: "attention/counter",
        expectedRevision: second.revision,
        value: { count: 1 },
        stagedAt: "2026-08-25T10:00:04.000Z",
      }),
    ).toThrow(StateValueConflictError);

    store.finishRun(
      "run-a",
      epoch,
      "succeeded",
      "2026-08-25T10:00:05.000Z",
    );
    store.finishRun(
      "run-b",
      epoch,
      "failed",
      "2026-08-25T10:00:06.000Z",
    );
    expect(
      store.readScopeStateValue("scope-a", "attention/counter"),
    ).toEqual({ revision: 1, value: { count: 1 } });
  });

  test("commits staged state with publications on success and discards both on failure", () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admitAndStart(store, "run-a", epoch);
    store.stageScopeStateMutation({
      runId: "run-a",
      key: "digest/window",
      expectedRevision: 0,
      value: { completed: 4 },
      stagedAt: "2026-08-25T10:00:03.000Z",
    });
    store.stageEmitIntent({
      runId: "run-a",
      stepId: "digest",
      event: "digest.ready",
      payload: { completed: 4 },
      stagedAt: "2026-08-25T10:00:03.000Z",
    });
    expect(store.readScopeStateValue("scope-a", "digest/window")).toEqual({
      revision: 0,
      value: null,
    });
    expect(store.listPendingPublications()).toEqual([]);

    store.finishRun(
      "run-a",
      epoch,
      "succeeded",
      "2026-08-25T10:00:04.000Z",
    );
    expect(store.readScopeStateValue("scope-a", "digest/window")).toEqual({
      revision: 1,
      value: { completed: 4 },
    });
    expect(store.listPendingPublications()).toEqual([
      expect.objectContaining({ event: "digest.ready", payload: { completed: 4 } }),
    ]);

    admitAndStart(store, "run-b", epoch);
    store.stageScopeStateMutation({
      runId: "run-b",
      key: "digest/window",
      expectedRevision: 1,
      value: { completed: 5 },
      stagedAt: "2026-08-25T10:00:05.000Z",
    });
    store.stageEmitIntent({
      runId: "run-b",
      stepId: "digest",
      event: "digest.ready",
      payload: { completed: 5 },
      stagedAt: "2026-08-25T10:00:05.000Z",
    });
    store.finishRun(
      "run-b",
      epoch,
      "failed",
      "2026-08-25T10:00:06.000Z",
    );

    expect(store.readScopeStateValue("scope-a", "digest/window")).toEqual({
      revision: 1,
      value: { completed: 4 },
    });
    expect(store.listPendingPublications()).toHaveLength(1);
  });

  test("rolls back state and terminal status when a publication cannot commit", () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admitAndStart(store, "run-a", epoch);
    store.finishRun(
      "run-a",
      epoch,
      "succeeded",
      "2026-08-25T10:00:03.000Z",
      undefined,
      {
        ...completionPublication("run-a"),
        id: "shared-publication",
      },
    );

    admitAndStart(store, "run-b", epoch);
    store.stageScopeStateMutation({
      runId: "run-b",
      key: "digest/window",
      expectedRevision: 0,
      value: { completed: 1 },
      stagedAt: "2026-08-25T10:00:04.000Z",
    });

    expect(() =>
      store.finishRun(
        "run-b",
        epoch,
        "succeeded",
        "2026-08-25T10:00:05.000Z",
        undefined,
        {
          ...completionPublication("run-b"),
          id: "shared-publication",
        },
      ),
    ).toThrow();
    expect(store.getRun("run-b")?.state).toBe("running");
    expect(store.readScopeStateValue("scope-a", "digest/window")).toEqual({
      revision: 0,
      value: null,
    });
    expect(store.listPendingPublications()).toHaveLength(1);
  });

  test("commits a publication with terminal state and acknowledges delivery", () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    store.admitRun({
      id: "run-a",
      scopeId: "scope-a",
      workflow: "builder",
      repository: "write",
      trigger: { event: "task.ready", schemaRef: null, payload: { taskId: "task-a" } },
      resources: ["task:task-a"],
      admittedAt: "2026-08-25T10:00:01.000Z",
    });
    store.startRun("run-a", epoch, "2026-08-25T10:00:02.000Z");

    store.finishRun(
      "run-a",
      epoch,
      "succeeded",
      "2026-08-25T10:00:03.000Z",
      undefined,
      {
        id: "workflow:run-a:completed",
        runId: "run-a",
        scopeId: "scope-a",
        event: "workflow.completed",
        payload: { runId: "run-a", publicationId: "workflow:run-a:completed" },
      },
    );

    expect(store.listPendingPublications()).toEqual([
      expect.objectContaining({
        id: "workflow:run-a:completed",
        runId: "run-a",
        createdAt: "2026-08-25T10:00:03.000Z",
      }),
    ]);
    expect(
      store.markPublicationDelivered(
        "workflow:run-a:completed",
        "2026-08-25T10:00:04.000Z",
      ),
    ).toBe(true);
    expect(store.listPendingPublications()).toEqual([]);
  });

  test("keeps staged emit intents invisible and accepts an identical replay", () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admitAndStart(store, "run-a", epoch);

    store.stageEmitIntent({
      runId: "run-a",
      stepId: "announce",
      event: "work.announced",
      payload: { nested: { ready: true }, count: 2 },
      stagedAt: "2026-08-25T10:00:03.000Z",
    });
    store.stageEmitIntent({
      runId: "run-a",
      stepId: "announce",
      event: "work.announced",
      payload: { count: 2, nested: { ready: true } },
      stagedAt: "2026-08-25T10:00:04.000Z",
    });

    expect(store.listPendingPublications()).toEqual([]);
  });

  test("rejects a changed emit intent replay under the same run and step", () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admitAndStart(store, "run-a", epoch);
    store.stageEmitIntent({
      runId: "run-a",
      stepId: "announce",
      event: "work.announced",
      payload: { revision: 1 },
      stagedAt: "2026-08-25T10:00:03.000Z",
    });

    expect(() =>
      store.stageEmitIntent({
        runId: "run-a",
        stepId: "announce",
        event: "work.announced",
        payload: { revision: 2 },
        stagedAt: "2026-08-25T10:00:04.000Z",
      }),
    ).toThrow(PublicationIntentConflictError);
  });

  test("activates multiple staged events in step order before workflow completion", () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admitAndStart(store, "run-a", epoch);
    store.stageEmitIntent({
      runId: "run-a",
      stepId: "second-in-name-only",
      event: "work.first",
      payload: { order: 1 },
      stagedAt: "2026-08-25T10:00:03.000Z",
    });
    store.stageEmitIntent({
      runId: "run-a",
      stepId: "first-in-name-only",
      event: "work.second",
      payload: { order: 2 },
      stagedAt: "2026-08-25T10:00:04.000Z",
    });

    store.finishRun(
      "run-a",
      epoch,
      "succeeded",
      "2026-08-25T10:00:05.000Z",
      undefined,
      completionPublication("run-a"),
    );

    expect(store.listPendingPublications()).toEqual([
      expect.objectContaining({
        id: "workflow:run-a:emit:second-in-name-only",
        event: "work.first",
        payload: { order: 1 },
      }),
      expect.objectContaining({
        id: "workflow:run-a:emit:first-in-name-only",
        event: "work.second",
        payload: { order: 2 },
      }),
      expect.objectContaining({
        id: "workflow:run-a:completed",
        event: "workflow.completed",
      }),
    ]);
  });

  test.each(["failed", "cancelled"] as const)(
    "discards staged emits and state when a run is %s",
    (terminalState) => {
      const store = createStore();
      const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
      admitAndStart(store, `run-${terminalState}`, epoch);
      store.stageScopeStateMutation({
        runId: `run-${terminalState}`,
        key: "digest/window",
        expectedRevision: 0,
        value: { terminalState },
        stagedAt: "2026-08-25T10:00:03.000Z",
      });
      store.stageEmitIntent({
        runId: `run-${terminalState}`,
        stepId: "announce",
        event: "work.announced",
        payload: { terminalState },
        stagedAt: "2026-08-25T10:00:03.000Z",
      });

      store.finishRun(
        `run-${terminalState}`,
        epoch,
        terminalState,
        "2026-08-25T10:00:04.000Z",
        undefined,
        completionPublication(`run-${terminalState}`),
      );

      expect(store.listPendingPublications()).toEqual([
        expect.objectContaining({
          id: `workflow:run-${terminalState}:completed`,
          event: "workflow.completed",
        }),
      ]);
      expect(store.readScopeStateValue("scope-a", "digest/window")).toEqual({
        revision: 0,
        value: null,
      });
    },
  );

  test("migrates the legacy one-publication-per-run table idempotently", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-run-state-legacy-publications-"));
    roots.push(root);
    const legacy = new Database(join(root, "kota.sqlite"));
    legacy.exec(`
      CREATE TABLE run_publications (
        publication_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE,
        scope_id TEXT NOT NULL,
        event_name TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        delivered_at TEXT
      );
    `);
    legacy.close();

    let store = new RunStateDatabase(root);
    store.close();
    store = new RunStateDatabase(root);
    store.registerScope({
      id: "scope-a",
      rootPath: join(root, "scope-a"),
      createdAt: "2026-08-25T10:00:00.000Z",
    });
    const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admitAndStart(store, "run-a", epoch);
    for (const [stepId, event] of [["one", "work.one"], ["two", "work.two"]] as const) {
      store.stageEmitIntent({
        runId: "run-a",
        stepId,
        event,
        payload: { stepId },
        stagedAt: "2026-08-25T10:00:03.000Z",
      });
    }
    store.finishRun(
      "run-a",
      epoch,
      "succeeded",
      "2026-08-25T10:00:04.000Z",
      undefined,
      completionPublication("run-a"),
    );

    expect(store.listPendingPublications().map((publication) => publication.event)).toEqual([
      "work.one",
      "work.two",
      "workflow.completed",
    ]);
    store.close();
  });

  test("keeps run resources but releases attempt resources after a restart", () => {
    const store = createStore();
    const first = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    store.admitRun({
      id: "run-a",
      scopeId: "scope-a",
      workflow: "builder",
      repository: "write",
      trigger: { event: "task.ready", schemaRef: null, payload: { taskId: "task-a" } },
      resources: ["task:task-a"],
      admittedAt: "2026-08-25T10:00:01.000Z",
    });
    store.startRun("run-a", first.epoch, "2026-08-25T10:00:02.000Z");
    expect(
      store.tryAcquireResource({
        runId: "run-a",
        resourceKey: "repo:default:integration",
        lifetime: "attempt",
        epoch: first.epoch,
        acquiredAt: "2026-08-25T10:00:03.000Z",
      }),
    ).toBe(true);

    const second = store.beginDaemonSession("2026-08-25T10:01:00.000Z");

    expect(store.getRun("run-a")?.resources).toEqual([
      "repo:default:integration",
      "task:task-a",
    ]);
    store.completeRestartRecovery(
      "run-a",
      second.epoch,
      "2026-08-25T10:01:01.000Z",
    );
    expect(store.getRun("run-a")?.resources).toEqual(["task:task-a"]);
  });

  test("acquires dynamic resources only for the current active run attempt", () => {
    const store = createStore();
    const first = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    store.admitRun({
      id: "run-a",
      scopeId: "scope-a",
      workflow: "builder",
      repository: "write",
      trigger: { event: "task.ready", schemaRef: null, payload: { taskId: "task-a" } },
      resources: [],
      admittedAt: "2026-08-25T10:00:01.000Z",
    });
    expect(() =>
      store.tryAcquireResource({
        runId: "run-a",
        resourceKey: "runtime:queued",
        lifetime: "run",
        epoch: first.epoch,
        acquiredAt: "2026-08-25T10:00:02.000Z",
      }),
    ).toThrow('Run "run-a" is not active in daemon epoch 1');

    store.startRun("run-a", first.epoch, "2026-08-25T10:00:03.000Z");
    expect(
      store.tryAcquireResource({
        runId: "run-a",
        resourceKey: "runtime:running",
        lifetime: "attempt",
        epoch: first.epoch,
        acquiredAt: "2026-08-25T10:00:04.000Z",
      }),
    ).toBe(true);
    store.suspendRun({
      runId: "run-a",
      epoch: first.epoch,
      state: "waiting",
      suspendedAt: "2026-08-25T10:00:05.000Z",
    });
    expect(() =>
      store.tryAcquireResource({
        runId: "run-a",
        resourceKey: "runtime:waiting",
        lifetime: "run",
        epoch: first.epoch,
        acquiredAt: "2026-08-25T10:00:06.000Z",
      }),
    ).toThrow('Run "run-a" is not active in daemon epoch 1');
    store.resumeRun("run-a", "2026-08-25T10:00:07.000Z");
    store.startRun("run-a", first.epoch, "2026-08-25T10:00:08.000Z");
    store.beginIntegration("run-a", first.epoch, { phase: "publication" });
    expect(
      store.tryAcquireResource({
        runId: "run-a",
        resourceKey: "runtime:integrating",
        lifetime: "attempt",
        epoch: first.epoch,
        acquiredAt: "2026-08-25T10:00:09.000Z",
      }),
    ).toBe(true);
    store.finishRun("run-a", first.epoch, "failed", "2026-08-25T10:00:10.000Z");
    expect(() =>
      store.tryAcquireResource({
        runId: "run-a",
        resourceKey: "runtime:terminal",
        lifetime: "run",
        epoch: first.epoch,
        acquiredAt: "2026-08-25T10:00:11.000Z",
      }),
    ).toThrow('Run "run-a" is not active in daemon epoch 1');
    expect(store.getRun("run-a")?.resources).toEqual([]);
  });

  test("rejects dynamic resource acquisition from a superseded daemon attempt", () => {
    const store = createStore();
    const first = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admitAndStart(store, "run-a", first.epoch);
    const second = store.beginDaemonSession("2026-08-25T10:01:00.000Z");

    expect(() =>
      store.tryAcquireResource({
        runId: "run-a",
        resourceKey: "runtime:stale",
        lifetime: "attempt",
        epoch: first.epoch,
        acquiredAt: "2026-08-25T10:01:01.000Z",
      }),
    ).toThrow(StaleDaemonEpochError);
    expect(() =>
      store.tryAcquireResource({
        runId: "run-a",
        resourceKey: "runtime:recovering",
        lifetime: "attempt",
        epoch: second.epoch,
        acquiredAt: "2026-08-25T10:01:02.000Z",
      }),
    ).toThrow('Run "run-a" is not active in daemon epoch 2');
  });
});
