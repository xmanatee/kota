import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import {
  AdmissionKeyConflictError,
  type AdmittedRun,
  PublicationIntentConflictError,
  RunStateDatabase,
  StaleDaemonEpochError,
  StateValueConflictError,
} from "./run-state-database.js";
import { RUN_STATE_SCHEMA_VERSION } from "./run-state-schema.js";

const roots: string[] = [];
const stores: RunStateDatabase[] = [];
const now = "2026-08-25T10:00:00.000Z";
const later = "2026-08-25T10:01:00.000Z";
const admission = { scopeId: "scope-a", key: "event:task-a", parameterFingerprint: "fingerprint-a" };

function openStore(root: string): RunStateDatabase {
  const store = new RunStateDatabase(root);
  stores.push(store);
  return store;
}

function createStore(): RunStateDatabase {
  const root = mkdtempSync(join(tmpdir(), "kota-run-state-"));
  roots.push(root);
  const store = openStore(root);
  store.registerScope({ id: "scope-a", rootPath: join(root, "scope-a"), createdAt: now });
  return store;
}

function run(id: string, overrides: Partial<AdmittedRun> = {}): AdmittedRun {
  return {
    id, scopeId: "scope-a", workflow: "publisher", repository: "none",
    trigger: { event: "manual", schemaRef: null, payload: {} },
    resources: [], admittedAt: now, ...overrides,
  };
}

function admitAndStart(store: RunStateDatabase, runId: string, epoch: number): void {
  store.admitRun(run(runId));
  store.startRun(runId, epoch, now);
}

function completionPublication(runId: string) {
  const id = `workflow:${runId}:completed`;
  return { id, runId, scopeId: "scope-a", event: "workflow.completed", payload: { runId, publicationId: id } };
}

function stageState(store: RunStateDatabase, runId: string, expectedRevision = 0) {
  store.stageScopeStateMutation({ runId, key: "digest/window", expectedRevision, value: { completed: 4 }, stagedAt: now });
}

function stageEvent(store: RunStateDatabase, runId: string, stepId = "digest") {
  store.stageEmitIntent({ runId, stepId, event: "digest.ready", payload: { completed: 4 }, stagedAt: now });
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("RunStateDatabase", () => {
  test("migrates and owns non-writer execution receipts without changing writer recovery", () => {
    const initial = createStore();
    const stateDir = dirname(initial.path);
    const { epoch } = initial.beginDaemonSession("2026-08-25T10:00:00.000Z");
    admitAndStart(initial, "completed-reader", epoch);
    initial.admitRun({
      id: "writer", scopeId: "scope-a", workflow: "writer", repository: "write",
      trigger: { event: "manual", schemaRef: null, payload: {} },
      resources: [], admittedAt: "2026-08-25T10:00:01.000Z",
    });
    initial.startRun("writer", epoch, "2026-08-25T10:00:02.000Z");
    initial.close();
    const previous = new Database(join(stateDir, "kota.sqlite"));
    previous.exec("ALTER TABLE runs DROP COLUMN execution_completed_at");
    previous.pragma("user_version = 6");
    previous.close();
    expect(() => RunStateDatabase.openExisting(stateDir)).toThrow(/requires daemon-owned migration/);

    const store = new RunStateDatabase(stateDir);
    try {
      expect(store.getRun("completed-reader")?.executionCompletedAt).toBeUndefined();
      const completedAt = "2026-08-25T10:00:03.000Z";
      expect(() => store.completeNonWriterExecution("completed-reader", epoch - 1, completedAt))
        .toThrow(StaleDaemonEpochError);
      expect(() => store.completeNonWriterExecution("writer", epoch, completedAt))
        .toThrow(/not an active non-writer/);
      store.completeNonWriterExecution("completed-reader", epoch, completedAt);
      store.completeNonWriterExecution("completed-reader", epoch, "2026-08-25T10:00:04.000Z");
      expect(store.getRun("completed-reader")?.executionCompletedAt).toBe(completedAt);
      expect(store.getRun("writer")?.executionCompletedAt).toBeUndefined();
      store.suspendRun({
        runId: "completed-reader", epoch, state: "needs_attention",
        suspendedAt: "2026-08-25T10:00:05.000Z",
      });
      expect(() => store.completeNonWriterExecution("completed-reader", epoch, completedAt))
        .toThrow(/not an active non-writer/);
      store.resumeRun("completed-reader", "2026-08-25T10:00:06.000Z");
      expect(store.getRun("completed-reader")).toMatchObject({
        state: "queued", executionCompletedAt: completedAt,
      });
    } finally {
      store.close();
    }
  });

  test.each(["succeeded", "needs_attention", "waiting", "backoff"] as const)("preserves a yielded resource and resumes when its priority blocker becomes %s", (disposition) => {
    let store = createStore();
    let { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
    store.admitRun({
      id: "run-yielded",
      scopeId: "scope-a",
      workflow: "builder",
      repository: "write",
      trigger: { event: "task.ready", schemaRef: null, payload: {} },
      resources: ["task:current"],
      admittedAt: "2026-08-25T10:00:01.000Z",
    });
    store.startRun("run-yielded", epoch, "2026-08-25T10:00:02.000Z");
    const sandbox = {
      runId: "run-yielded",
      repository: "write" as const,
      rootDir: "/runtime/run-yielded",
      workspaceDir: "/runtime/run-yielded/workspace",
      tempDir: "/runtime/run-yielded/tmp",
      artifactDir: "/runtime/run-yielded/artifacts",
      baseCommit: "a".repeat(40),
      branch: "kota/run-yielded",
      targetBranch: "main",
    };
    store.setSandbox("run-yielded", epoch, sandbox);
    store.stageEmitIntent({
      runId: "run-yielded",
      stepId: "result",
      event: "work.result",
      payload: { lineage: "run-yielded" },
      stagedAt: "2026-08-25T10:00:02.500Z",
    });
    store.suspendRun({
      runId: "run-yielded",
      epoch,
      state: "waiting",
      suspendedAt: "2026-08-25T10:00:03.000Z",
      wait: {
        kind: "continuation",
        decision: "preserve-yield",
        decidedAt: "2026-08-25T10:00:03.000Z",
        blockerResources: ["task:urgent"],
      },
    });

    expect(store.getRun("run-yielded")).toMatchObject({
      state: "waiting",
      resources: ["task:current"],
      attempt: 1,
      sandbox,
    });

    store.admitRun(run("successor", { resources: ["task:current"] }));
    store.admitRun(run("run-urgent", { resources: ["task:urgent"] }));
    const stateDir = dirname(store.path);
    store.close();
    store = openStore(stateDir);
    epoch = store.beginDaemonSession("2026-08-25T10:00:03.100Z").epoch;
    expect(store.getRun("run-yielded")).toMatchObject({ state: "waiting", sandbox });
    expect(store.listDispatchableRuns({ now: later, limit: 10, excludedScopeIds: [] }).map((run) => run.id)).toEqual(["run-urgent"]);
    expect(store.resumeSatisfiedContinuationRuns(later)).toEqual([]);
    expect(store.getRun("successor")).toMatchObject({ state: "queued", attempt: 0 });

    store.registerScope({ id: "scope-b", rootPath: "/scope-b", createdAt: later });
    store.admitRun(run("other-scope", { scopeId: "scope-b", resources: ["task:current"] }));
    expect(store.startRun("other-scope", epoch, later)).toBe(1);
    store.finishRun("other-scope", epoch, "succeeded", later);

    store.startRun("run-urgent", epoch, "2026-08-25T10:00:04.000Z");
    expect(
      store.resumeSatisfiedContinuationRuns("2026-08-25T10:00:04.500Z"),
    ).toEqual([]);

    if (disposition === "succeeded") {
      store.finishRun("run-urgent", epoch, "succeeded", "2026-08-25T10:00:05.000Z");
    } else if (disposition === "backoff") {
      store.deferRun({ runId: "run-urgent", epoch, deferredAt: "2026-08-25T10:00:05.000Z",
        resumeAt: "2026-08-26T10:00:00.000Z" });
    } else {
      store.admitRun(run("urgent-contender", { resources: ["task:urgent"] }));
      store.suspendRun({ runId: "run-urgent", epoch, state: disposition,
        wait: { reason: "external-prerequisite" }, suspendedAt: "2026-08-25T10:00:05.000Z" });
    }
    expect(
      store.resumeSatisfiedContinuationRuns("2026-08-25T10:00:06.000Z"),
    ).toEqual(["run-yielded"]);
    expect(store.getRun("run-yielded")).toMatchObject({
      state: "queued",
      resources: ["task:current"],
      attempt: 1,
      wait: {
        kind: "continuation",
        decision: "preserve-yield",
        blockerResources: ["task:urgent"],
      },
    });
    expect(
      store.startRun("run-yielded", epoch, "2026-08-25T10:00:07.000Z"),
    ).toBe(2);
    expect(store.getRun("run-yielded")?.sandbox).toEqual(sandbox);
    store.stageEmitIntent({
      runId: "run-yielded",
      stepId: "result",
      event: "work.result",
      payload: { lineage: "run-yielded" },
      stagedAt: "2026-08-25T10:00:07.500Z",
    });
    store.finishRun(
      "run-yielded",
      epoch,
      "succeeded",
      "2026-08-25T10:00:08.000Z",
    );
    expect(store.getRun("run-yielded")?.resources).toEqual([]);
    expect(store.startRun("successor", epoch, "2026-08-25T10:00:09.000Z")).toBe(1);
    expect(store.listPendingPublications()).toEqual([
      expect.objectContaining({
        runId: "run-yielded",
        event: "work.result",
        payload: { lineage: "run-yielded" },
      }),
    ]);
  });

  test("derives workflow summaries from durable run outcomes", () => {
    let store = createStore();
    const root = dirname(store.path);
    const { epoch } = store.beginDaemonSession(now);
    admitAndStart(store, "run-a", epoch);
    store.finishRun("run-a", epoch, "succeeded", later, undefined, undefined, "completed-with-warnings");
    store.close();
    store = openStore(root);
    expect(store.readWorkflowSummary("scope-a")).toEqual({
      completedRuns: 1,
      workflows: { publisher: {
        lastStarted: { runId: "run-a", startedAt: now },
        lastCompletion: { runId: "run-a", startedAt: now, completedAt: later, status: "completed-with-warnings" },
      } },
    });
  });

  test("selects scoped run references before materialization and distinguishes identity from trigger linkage", () => {
    const store = createStore();
    store.registerScope({ id: "scope-b", rootPath: "/scope-b", createdAt: "2026-09-10T00:00:00Z" });
    try {
      for (const [id, scopeId, payload] of [
        ["builder-abcdef", "scope-a", { taskId: "task-target" }],
        ["probe-ghijkl", "scope-a", { refs: ["task-target"] }],
        ["report-mnopqr", "scope-a", { reason: "abcdef", mode: "manual" }],
        ["foreign-abcdef", "scope-b", { taskId: "task-target" }],
      ] as const) store.admitRun({ id, scopeId, workflow: "probe", repository: "none", resources: [],
        trigger: { event: "manual", schemaRef: null, payload }, admittedAt: "2026-09-10T00:00:00Z" });
      expect(store.listRunIds("scope-a", undefined, { references: ["abcdef"] })).toEqual(["builder-abcdef"]);
      expect(store.listRunIds("scope-a", undefined, { references: ["manual"], triggerReferences: ["task-target"] }))
        .toEqual(["builder-abcdef", "probe-ghijkl"]);
      expect(store.listRunIds("scope-a", undefined, { references: [] })).toEqual([]);
      expect(store.listRunIds("scope-a", undefined, { references: ["manual"], triggerReferences: ["task-target"], workflow: "other" })).toEqual([]);
    } finally { store.close(); }
  });

  test.each(["scope", "daemon"] as const)("rejects stale %s state revisions across connections", (owner) => {
    const store = createStore();
    const peer = openStore(dirname(store.path));
    const input = { scopeId: "scope-a", key: "runtime/watermark", expectedRevision: 0, value: { count: 1 }, updatedAt: now };
    const write = (db: RunStateDatabase, expectedRevision: number) => owner === "scope"
      ? db.compareAndSetScopeStateValue({ ...input, expectedRevision })
      : db.compareAndSetDaemonStateValue({ ...input, expectedRevision });
    const read = () => owner === "scope"
      ? peer.readScopeStateValue(input.scopeId, input.key)
      : peer.readDaemonStateValue(input.key);
    write(store, 0);
    expect(read()).toEqual({ revision: 1, value: input.value });
    expect(() => write(peer, 0)).toThrow(StateValueConflictError);
    expect(read()).toEqual({ revision: 1, value: input.value });
    write(peer, 1);
    expect(read().revision).toBe(2);
  });

  test("migrates a legacy daemon incident back to each registered scope", () => {
    const store = createStore();
    const stateDir = dirname(store.path);
    store.registerScope({
      id: "scope-b",
      rootPath: join(stateDir, "scope-b"),
      createdAt: "2026-08-25T09:00:00.000Z",
    });
    const older = {
      runtimeId: "agy:antigravity-cli",
      kind: "provider",
      failureCount: 1,
      until: "2026-08-25T11:00:00.000Z",
      updatedAt: "2026-08-25T10:00:00.000Z",
      reason: "older provider incident",
    };
    const latest = {
      ...older,
      kind: "quality",
      until: "2026-08-25T16:00:00.000Z",
      updatedAt: "2026-08-25T10:05:00.000Z",
      reason: "latest legacy incident",
    };
    store.compareAndSetScopeStateValue({
      scopeId: "scope-a",
      key: "runtime/agent-backoff",
      expectedRevision: 0,
      value: older,
      updatedAt: older.updatedAt,
    });
    store.compareAndSetScopeStateValue({
      scopeId: "scope-b",
      key: "runtime/agent-backoff",
      expectedRevision: 0,
      value: latest,
      updatedAt: latest.updatedAt,
    });
    store.close();

    const legacy = new Database(join(stateDir, "kota.sqlite"));
    legacy.exec("DROP TABLE daemon_state_values; PRAGMA user_version = 4;");
    legacy.close();

    const migrated = openStore(stateDir);
    expect(migrated.readDaemonStateValue("runtime/agent-backoff").value)
      .toBeNull();
    expect(migrated.readScopeStateValue("scope-a", "runtime/agent-backoff").value)
      .toEqual(latest);
    expect(migrated.readScopeStateValue("scope-b", "runtime/agent-backoff").value)
      .toEqual(latest);
    migrated.close();
  });

  test("rejects databases created by a newer schema", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-run-state-future-"));
    roots.push(root);
    const future = new Database(join(root, "kota.sqlite"));
    future.pragma("user_version = 999");
    future.close();

    expect(() => new RunStateDatabase(root)).toThrow(/schema version 999/);
  });

  test("repairs the retired project identity without losing durable run state", () => {
    const store = createStore();
    store.compareAndSetScopeStateValue({
      scopeId: "scope-a",
      key: "runtime/backoff",
      expectedRevision: 0,
      value: { provider: "agy" },
      updatedAt: "2026-08-25T10:00:00.000Z",
    });
    store.admitRun({
      id: "run-legacy",
      scopeId: "scope-a",
      workflow: "builder",
      repository: "write",
      trigger: { event: "task.ready", schemaRef: null, payload: {} },
      resources: ["task:legacy"],
      admittedAt: "2026-08-25T10:00:01.000Z",
    });
    const path = store.path;
    store.close();

    const legacy = new Database(path);
    legacy.exec(`
      ALTER TABLE scopes RENAME TO projects;
      ALTER TABLE runs RENAME COLUMN scope_id TO project_id;
      ALTER TABLE run_publications RENAME COLUMN scope_id TO project_id;
      ALTER TABLE run_emit_intents RENAME COLUMN scope_id TO project_id;
      ALTER TABLE scope_state_values RENAME TO project_state_values;
      ALTER TABLE project_state_values RENAME COLUMN scope_id TO project_id;
      ALTER TABLE run_state_mutations RENAME COLUMN scope_id TO project_id;
      UPDATE run_resources
      SET resource_key = 'project:' || substr(resource_key, length('scope:') + 1);
      UPDATE run_resource_requests
      SET resource_key = 'project:' || substr(resource_key, length('scope:') + 1);
      CREATE TABLE scopes (
        id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL UNIQUE,
        display_name TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE scope_state_values (
        scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
        state_key TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope_id, state_key)
      );
      INSERT INTO scopes (id, root_path, display_name, created_at)
      SELECT id, root_path, display_name, created_at FROM projects;
      PRAGMA user_version = 3;
    `);
    legacy.close();

    const migrated = openStore(dirname(path));
    expect(migrated.getRun("run-legacy")).toMatchObject({
      scopeId: "scope-a",
      resources: ["task:legacy"],
    });
    expect(migrated.readScopeStateValue("scope-a", "runtime/backoff")).toEqual({
      revision: 1,
      value: { provider: "agy" },
    });
    migrated.close();

    const verified = new Database(path, { readonly: true });
    expect(verified.pragma("user_version", { simple: true })).toBe(RUN_STATE_SCHEMA_VERSION);
    const legacyObjects = verified.prepare(`
      SELECT name FROM sqlite_master
      WHERE name IN ('projects', 'project_state_values')
        OR sql LIKE '%project_id%'
    `).all();
    expect(legacyObjects).toEqual([]);
    expect(
      verified.prepare("SELECT resource_key FROM run_resource_requests").pluck().all(),
    ).toEqual(["scope:scope-a:task:legacy"]);
    verified.close();
    const reader = RunStateDatabase.openReadOnly(dirname(path));
    stores.push(reader);
    expect(reader.getRun("run-legacy")?.resources).toEqual(["task:legacy"]);
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

  test.each(["succeeded", "failed", "cancelled"])("SQLite rejects a %s transition without a result", (state) => {
    const store = createStore();
    store.admitRun(run("run-a"));
    const raw = new Database(store.path);
    try {
      expect(() => raw.prepare("UPDATE runs SET state = ?, finished_at = ? WHERE id = ?")
        .run(state, now, "run-a")).toThrow(/terminal workflow runs require result_status/i);
      expect(store.getRun("run-a")?.state).toBe("queued");
    } finally { raw.close(); }
  });

  test("deduplicates admissions and acquires contended resources only when starting", () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession(now);
    const contract = { admission, repository: "write" as const, resources: ["task:task-a"] };
    expect(store.admitRun(run("run-a", contract))).toEqual({ status: "admitted", runId: "run-a" });
    expect(store.admitRun(run("run-b", { ...contract, admission: { ...admission, key: "event:task-b" } })))
      .toEqual({ status: "admitted", runId: "run-b" });
    expect(store.admitRun(run("duplicate", contract))).toEqual({ status: "duplicate", runId: "run-a" });
    expect(store.getRun("duplicate")).toBeNull();
    expect(() => store.admitRun(run("conflict", { ...contract, admission: { ...admission, parameterFingerprint: "changed" } })))
      .toThrow(AdmissionKeyConflictError);
    expect(store.getRun("conflict")).toBeNull();
    for (const id of ["run-a", "run-b"]) expect(store.getRun(id)).toMatchObject({ state: "queued", resources: contract.resources });
    expect(store.startRun("run-a", epoch, now)).toBe(1);
    expect(store.startRun("run-b", epoch, now)).toBeNull();
    expect(store.getRun("run-b")?.state).toBe("queued");
    store.finishRun("run-a", epoch, "succeeded", later);
    expect(store.getRun("run-a")).toMatchObject({ state: "succeeded", resources: [] });
    expect(store.startRun("run-b", epoch, later)).toBe(1);
  });

  test.each(["failed", "cancelled"] as const)("redelivers a %s admission without bypassing resource ownership", (state) => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession(now);
    const contract = { admission, repository: "write" as const, resources: ["task:task-a"] };
    store.admitRun(run("run-a", contract));
    store.startRun("run-a", epoch, now);
    store.finishRun("run-a", epoch, state, now);
    store.admitRun(run("blocker", { resources: contract.resources }));
    store.startRun("blocker", epoch, now);
    expect(store.admitRun(run("retry", contract))).toEqual({ status: "admitted", runId: "retry" });
    expect(store.admitRun(run("duplicate", contract))).toEqual({ status: "duplicate", runId: "retry" });
    expect(store.getRun("duplicate")).toBeNull();
    expect(store.getRun("run-a")?.state).toBe(state);
    expect(store.getRun("retry")).toMatchObject({ state: "queued", resources: contract.resources });
    expect(store.startRun("retry", epoch, now)).toBeNull();
    store.finishRun("blocker", epoch, "succeeded", later);
    expect(store.startRun("retry", epoch, later)).toBe(1);
  });

  test.each(["running", "waiting", "needs_attention", "integrating", "succeeded"] as const)(
    "keeps an admission mapped to its %s run", (state) => {
      const store = createStore();
      const { epoch } = store.beginDaemonSession(now);
      store.admitRun(run("run-a", { repository: "write", admission }));
      store.startRun("run-a", epoch, now);
      if (state === "waiting" || state === "needs_attention") store.suspendRun({ runId: "run-a", epoch, state, suspendedAt: now });
      else if (state === "integrating") store.beginIntegration("run-a", epoch, { phase: "publication" });
      else if (state === "succeeded") store.finishRun("run-a", epoch, state, now);
      expect(store.admitRun(run("run-b", { repository: "write", admission }))).toEqual({ status: "duplicate", runId: "run-a" });
      expect(store.getRun("run-b")).toBeNull();
    },
  );

  test("defers attempts while preserving run ownership and the dispatch deadline", () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession(now);
    store.admitRun(run("run-a", { resources: ["task:task-a"] }));
    store.startRun("run-a", epoch, now);
    expect(store.tryAcquireResource({ runId: "run-a", resourceKey: "runtime:attempt", lifetime: "attempt", epoch, acquiredAt: now })).toBe(true);
    store.deferRun({ runId: "run-a", epoch, deferredAt: now, resumeAt: later });
    expect(store.getRun("run-a")).toMatchObject({ state: "queued", notBeforeAt: later, resources: ["task:task-a"], processes: [] });
    expect(store.listDispatchableRuns({ now, limit: 2, excludedScopeIds: [] })).toEqual([]);
    expect(store.listDispatchableRuns({ now: later, limit: 2, excludedScopeIds: [] }).map((r) => r.id)).toEqual(["run-a"]);
  });

  test("preserves a resource waiter across restart", () => {
    let store = createStore();
    const root = dirname(store.path);
    const first = store.beginDaemonSession(now);
    for (const id of ["owner", "waiter"]) store.admitRun(run(id, { resources: ["projection:shared"] }));
    expect(store.startRun("owner", first.epoch, now)).toBe(1);
    store.close();
    store = openStore(root);
    const second = store.beginDaemonSession(later);
    expect(store.getRun("waiter")).toMatchObject({ state: "queued", resources: ["projection:shared"] });
    expect(store.listDispatchableRuns({ now: later, limit: 2, excludedScopeIds: [] })).toEqual([]);
    expect(store.cancelQueuedRun("owner", later)).toBe(true);
    expect(store.getRun("owner")).toMatchObject({ state: "cancelled", resultStatus: "interrupted" });
    expect(store.startRun("waiter", second.epoch, later)).toBe(1);
  });

  test("fences stale attempts and retains resources until process recovery is acknowledged", () => {
    let store = createStore();
    const root = dirname(store.path);
    const first = store.beginDaemonSession(now);
    store.admitRun(run("run-a", { resources: ["task:task-a"] }));
    store.startRun("run-a", first.epoch, now);
    const processes = [
      { pid: 101, processGroupId: 101, osStartToken: "start-a", observedCommandHash: "hash-a" },
      { pid: 102, processGroupId: 102, osStartToken: "start-b", observedCommandHash: "hash-b" },
    ];
    for (const identity of processes) store.registerAttemptProcess({
      runId: "run-a", epoch: first.epoch, processKey: `${identity.pid}:${identity.osStartToken}`, identity, registeredAt: now,
    });
    const resource = { runId: "run-a", resourceKey: "repo:integration", lifetime: "attempt" as const, acquiredAt: now };
    expect(store.tryAcquireResource({ ...resource, epoch: first.epoch })).toBe(true);
    store.close();
    store = openStore(root);
    const second = store.beginDaemonSession(later);
    expect(second).toEqual({ epoch: first.epoch + 1, recovered: [{ runId: "run-a", previousEpoch: first.epoch, processes }] });
    expect(store.getRun("run-a")).toMatchObject({ state: "needs_attention", resources: ["repo:integration", "task:task-a"] });
    expect(() => store.finishRun("run-a", first.epoch, "succeeded", later)).toThrow(StaleDaemonEpochError);
    expect(() => store.tryAcquireResource({ ...resource, epoch: first.epoch })).toThrow(StaleDaemonEpochError);
    expect(() => store.tryAcquireResource({ ...resource, epoch: second.epoch })).toThrow(/not active/);
    store.completeRestartRecovery("run-a", second.epoch, later);
    expect(store.getRun("run-a")).toMatchObject({ state: "queued", resources: ["task:task-a"], processes: [] });
    store.admitRun(run("competitor", { resources: ["task:task-a"] }));
    expect(store.startRun("competitor", second.epoch, later)).toBeNull();
    expect(store.startRun("run-a", second.epoch, later)).not.toBeNull();
    store.finishRun("run-a", second.epoch, "succeeded", later);
    expect(store.startRun("competitor", second.epoch, later)).not.toBeNull();
  });

  test("acquires dynamic resources only for the current active attempt", () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession(now);
    store.admitRun(run("run-a", { repository: "write" }));
    const acquire = () => store.tryAcquireResource({ runId: "run-a", resourceKey: "runtime:attempt", lifetime: "attempt", epoch, acquiredAt: now });
    expect(acquire).toThrow(/not active/);
    store.startRun("run-a", epoch, now);
    expect(acquire()).toBe(true);
    store.suspendRun({ runId: "run-a", epoch, state: "waiting", suspendedAt: now });
    expect(acquire).toThrow(/not active/);
    store.resumeRun("run-a", now);
    store.startRun("run-a", epoch, now);
    store.beginIntegration("run-a", epoch, { phase: "publication" });
    expect(acquire()).toBe(true);
    store.finishRun("run-a", epoch, "failed", later);
    expect(acquire).toThrow(/not active/);
    expect(store.getRun("run-a")?.resources).toEqual([]);
  });

  test("rejects a competing staged mutation across database connections", () => {
    const store = createStore();
    const peer = openStore(dirname(store.path));
    const { epoch } = store.beginDaemonSession(now);
    for (const id of ["run-a", "run-b"]) admitAndStart(store, id, epoch);
    stageState(store, "run-a");
    expect(() => stageState(peer, "run-b")).toThrow(StateValueConflictError);
    store.finishRun("run-a", epoch, "succeeded", now);
    peer.finishRun("run-b", epoch, "failed", later);
    expect(peer.readScopeStateValue("scope-a", "digest/window")).toEqual({ revision: 1, value: { completed: 4 } });
  });

  test.each(["succeeded", "failed", "cancelled"] as const)("atomically settles staged state and events for %s", (state) => {
    let store = createStore();
    const root = dirname(store.path);
    const { epoch } = store.beginDaemonSession(now);
    admitAndStart(store, "run-a", epoch);
    const previous = { revision: 1, value: { completed: 3 } };
    store.compareAndSetScopeStateValue({ scopeId: "scope-a", key: "digest/window", expectedRevision: 0, value: previous.value, updatedAt: now });
    stageState(store, "run-a", previous.revision);
    stageEvent(store, "run-a");
    expect(store.readScopeStateValue("scope-a", "digest/window")).toEqual(previous);
    expect(store.listPendingPublications()).toEqual([]);
    store.finishRun("run-a", epoch, state, later, undefined, completionPublication("run-a"));
    store.close();
    store = openStore(root);
    expect(store.getRun("run-a")?.state).toBe(state);
    expect(store.readScopeStateValue("scope-a", "digest/window")).toEqual(state === "succeeded"
      ? { revision: 2, value: { completed: 4 } } : previous);
    expect(store.listPendingPublications().map(({ event, payload }) => ({ event, payload }))).toEqual([
      ...(state === "succeeded" ? [{ event: "digest.ready", payload: { completed: 4 } }] : []),
      { event: "workflow.completed", payload: completionPublication("run-a").payload },
    ]);
  });

  test("rolls back finalization, state and terminal status when a publication cannot commit", () => {
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
    const finalize = (value: number) => () => {
      store.stageScopeStateMutation({
        runId: "run-b", key: "finalized", expectedRevision: 0, value,
        stagedAt: "2026-08-25T10:00:05.000Z",
      });
      store.stageEmitIntent({
        runId: "run-b", stepId: "finalize", event: "owner.completed", payload: { value },
        stagedAt: "2026-08-25T10:00:05.000Z",
      });
    };

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
        undefined,
        finalize(1),
      ),
    ).toThrow();
    expect(store.getRun("run-b")?.state).toBe("running");
    expect(store.readScopeStateValue("scope-a", "digest/window")).toEqual({
      revision: 0,
      value: null,
    });
    expect(store.listPendingPublications()).toHaveLength(1);
    expect(store.readScopeStateValue("scope-a", "finalized")).toEqual({ revision: 0, value: null });

    store.finishRun(
      "run-b", epoch, "succeeded", "2026-08-25T10:00:06.000Z",
      undefined, completionPublication("run-b"), undefined, finalize(2),
    );
    expect(store.getRun("run-b")?.state).toBe("succeeded");
    expect(store.readScopeStateValue("scope-a", "digest/window")).toEqual({ revision: 1, value: { completed: 1 } });
    expect(store.readScopeStateValue("scope-a", "finalized")).toEqual({ revision: 1, value: 2 });
    expect(store.listPendingPublications().filter((entry) => entry.runId === "run-b")).toEqual([
      expect.objectContaining({ event: "owner.completed", payload: { value: 2 } }),
      expect.objectContaining({ event: "workflow.completed" }),
    ]);
  });

  test("retains undelivered publications across restart and prunes only after acknowledgement", () => {
    let store = createStore();
    const root = dirname(store.path);
    const { epoch } = store.beginDaemonSession(now);
    admitAndStart(store, "run-a", epoch);
    store.finishRun("run-a", epoch, "succeeded", now, undefined, completionPublication("run-a"));
    store.close();
    store = openStore(root);
    expect(store.listPendingPublications()).toEqual([expect.objectContaining({
      id: "workflow:run-a:completed", runId: "run-a", createdAt: now,
    })]);
    const prune = () => store.pruneTerminalRuns({ finishedBefore: later });
    expect(prune()).toEqual({ count: 0, runIds: [] });
    expect(store.getRun("run-a")?.state).toBe("succeeded");
    expect(store.markPublicationDelivered("workflow:run-a:completed", later)).toBe(true);
    expect(store.listPendingPublications()).toEqual([]);
    expect(prune()).toEqual({ count: 1, runIds: ["run-a"] });
  });

  test("deduplicates semantic emit replay and rejects changes to the same intent", () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession(now);
    admitAndStart(store, "run-a", epoch);
    const intent = { runId: "run-a", stepId: "announce", event: "work.announced", payload: { nested: { ready: true }, count: 2 }, stagedAt: now };
    store.stageEmitIntent(intent);
    store.stageEmitIntent({ ...intent, payload: { count: 2, nested: { ready: true } }, stagedAt: later });
    expect(store.listPendingPublications()).toEqual([]);
    expect(() => store.stageEmitIntent({ ...intent, payload: { ...intent.payload, count: 3 } })).toThrow(PublicationIntentConflictError);
    expect(() => store.stageEmitIntent({ ...intent, event: "different.event" })).toThrow(PublicationIntentConflictError);
    store.finishRun("run-a", epoch, "succeeded", later);
    expect(store.listPendingPublications()).toEqual([expect.objectContaining({ event: intent.event, payload: intent.payload })]);
  });

  test("publishes staged events in execution order before completion", () => {
    const store = createStore();
    const { epoch } = store.beginDaemonSession(now);
    admitAndStart(store, "run-a", epoch);
    for (const [stepId, event] of [["z-first", "work.first"], ["a-second", "work.second"]]) {
      store.stageEmitIntent({ runId: "run-a", stepId, event, payload: { stepId }, stagedAt: now });
    }
    store.finishRun("run-a", epoch, "succeeded", later, undefined, completionPublication("run-a"));
    expect(store.listPendingPublications().map(({ id, event, payload }) => ({ id, event, payload }))).toEqual([
      { id: "workflow:run-a:emit:z-first", event: "work.first", payload: { stepId: "z-first" } },
      { id: "workflow:run-a:emit:a-second", event: "work.second", payload: { stepId: "a-second" } },
      { id: "workflow:run-a:completed", event: "workflow.completed", payload: completionPublication("run-a").payload },
    ]);
  });

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

    let store = openStore(root);
    store.close();
    store = openStore(root);
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

});
