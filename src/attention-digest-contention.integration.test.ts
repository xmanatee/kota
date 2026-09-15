import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it, vi } from "vitest";
import { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { type BusEvents, EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import * as blocking from "#core/workflow/blocking-operation.js";
import { RunCoordinator } from "#core/workflow/run-coordinator.js";
import { RunResourceAllocator } from "#core/workflow/run-resources.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { WorkflowRuntime } from "#core/workflow/runtime.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import { ATTENTION_DIGEST_STATE_KEY } from "#modules/autonomy/workflows/attention-digest/step.js";
import attentionDigestWorkflow from "#modules/autonomy/workflows/attention-digest/workflow.js";

it("retires legacy counters without losing admitted digest serialization", () => {
  const root = mkdtempSync(join(tmpdir(), "kota-digest-migration-"));
  let store = new RunStateDatabase(root);
  const now = new Date().toISOString();
  const legacyKey = "attention-digest/counter";
  try {
    store.registerScope({ id: "scope-a", rootPath: root, createdAt: now });
    const { epoch } = store.beginDaemonSession(now);
    store.compareAndSetScopeStateValue({
      scopeId: "scope-a", key: legacyKey, expectedRevision: 0,
      value: { count: 219 }, updatedAt: now,
    });
    const admit = (id: string, resource: string) => store.admitRun({
      id, scopeId: "scope-a", workflow: "attention-digest", repository: "read",
      trigger: { event: "manual", schemaRef: null, payload: {} },
      resources: [resource], admittedAt: now,
    });
    admit("legacy", legacyKey);
    store.startRun("legacy", epoch, now);
    admit("queued", legacyKey);
    store.stageScopeStateMutation({
      runId: "legacy", key: legacyKey, expectedRevision: 1,
      value: { count: 220 }, stagedAt: now,
    });
    store.close();
    // Only this disposable fixture represents the pre-migration database.
    const previous = new Database(join(root, "kota.sqlite"));
    previous.pragma("user_version = 7");
    previous.close();
    store = new RunStateDatabase(root);
    expect(store.readScopeStateValue("scope-a", legacyKey).value).toBeNull();
    expect(store.getRun("legacy")?.resources).toEqual([ATTENTION_DIGEST_STATE_KEY]);
    expect(store.getRun("queued")?.resources).toEqual([ATTENTION_DIGEST_STATE_KEY]);
    admit("current", ATTENTION_DIGEST_STATE_KEY);
    expect(store.startRun("current", epoch, now)).toBeNull();
    store.finishRun("legacy", epoch, "succeeded", now);
    expect(store.readScopeStateValue("scope-a", legacyKey).value).toBeNull();
    expect(store.startRun("queued", epoch, now)).not.toBeNull();
    expect(store.startRun("current", epoch, now)).toBeNull();
    store.finishRun("queued", epoch, "succeeded", now);
    expect(store.startRun("current", epoch, now)).not.toBeNull();
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// The shipped resource binding must protect observation through publication,
// while restart and failed publication must not lose or repeat changed alerts.
it("serializes changed attention per scope and preserves it through failure and restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "kota-digest-contention-"));
  const bus = new EventBus();
  let store = new RunStateDatabase(join(root, "state"));
  const runtimes = new Map<string, WorkflowRuntime>();
  const deadLetters = new DeadLetterQueueStore(join(root, "dead-letters"));
  const digests: BusEvents["workflow.attention.digest"][] = [];
  bus.on("workflow.attention.digest", (payload) => digests.push(payload));
  const scopes = ["a", "b"].map((name) => {
    const scopeRoot = join(root, name);
    mkdirSync(scopeRoot);
    writeFileSync(join(scopeRoot, ".gitignore"), ".kota/\n");
    const git = (args: string[]) =>
      execFileSync("git", args, { cwd: scopeRoot, stdio: "ignore" });
    git(["init", "--quiet"]);
    git(["add", ".gitignore"]);
    git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", "fixture"]);
    const scopeId = deriveDirectoryScopeId(scopeRoot);
    store.registerScope({ id: scopeId, rootPath: scopeRoot, createdAt: new Date().toISOString() });
    return { scopeRoot, scopeId, pbus: new ScopedEventBus(bus, scopeId) };
  });
  // No network service is used by this scenario; control the OS port probe.
  const createAllocator = () => new RunResourceAllocator(store, {
    portStart: 30_000, portEnd: 49_999, portRangeSize: 20,
    isPortAvailable: async () => true,
  });
  let allocator = createAllocator();
  const allocate = RunResourceAllocator.prototype.allocate;
  const allocatorSpy = vi.spyOn(RunResourceAllocator.prototype, "allocate")
    .mockImplementation((...args) => allocate.apply(allocator, args));
  const start = () => {
    const epoch = store.beginDaemonSession(new Date().toISOString()).epoch;
    const coordinator = new RunCoordinator({
      store, daemonEpoch: epoch, concurrency: 4,
      execute: (run, signal) => runtimes.get(run.scopeId)!.executeAdmittedRun(run, signal),
      deliverPublication: (publication) => runtimes.get(publication.scopeId)!.deliverPublication(publication),
    });
    for (const { scopeRoot, scopeId, pbus } of scopes) {
      const runtime = new WorkflowRuntime({
        bus, pbus, scopeRoot, scopeId, runState: store, runCoordinator: coordinator,
        daemonEpoch: epoch, deadLetterQueue: deadLetters, idleIntervalMs: 60_000,
        workflows: [registerWorkflowDefinition("attention-digest/workflow.ts", attentionDigestWorkflow)],
      });
      runtimes.set(scopeId, runtime);
      runtime.start();
    }
    return coordinator;
  };
  let coordinator = start();
  const stop = async () => {
    for (const runtime of runtimes.values()) await runtime.stop(0);
    await coordinator.dispose();
    runtimes.clear();
  };
  const [first, other] = scopes;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let pending = false;
  const runBlocking = blocking.runWorkflowBlockingOperation;
  const spy = vi.spyOn(blocking, "runWorkflowBlockingOperation")
    .mockImplementation(async (operation, input, options) => {
      if (!pending) {
        pending = true;
        await gate;
      }
      return runBlocking(operation, input, options);
    });
  const completed = (pbus: ScopedEventBus, runId: string) =>
    pbus.emit("workflow.completed", {
      workflow: "builder", runId, status: "success", triggerEvent: "manual",
      durationMs: 1, definitionPath: "builder/workflow.ts",
      runDir: `.kota/runs/${runId}`, tags: ["monitored"],
    });
  const snapshot = (scopeId: string) => store.readScopeStateValue(scopeId, ATTENTION_DIGEST_STATE_KEY);
  const emptyQueue = [{ label: "Empty task queue", detail: "Builder has no open task to pick up." }];
  const observe = async (runId: string) => {
    completed(first.pbus, runId);
    await coordinator.whenIdle();
  };
  try {
    completed(first.pbus, "first");
    await vi.waitFor(() => expect(pending).toBe(true), { timeout: 10_000 });
    expect(snapshot(first.scopeId)).toEqual({ revision: 0, value: null });
    expect(digests).toEqual([]);
    completed(first.pbus, "overlap");
    completed(other.pbus, "independent");
    await vi.waitFor(() => expect(store.listRuns(other.scopeId).map((run) => run.state)).toEqual(["succeeded"]), { timeout: 15_000 });
    expect(snapshot(other.scopeId)).toEqual({ revision: 1, value: emptyQueue });
    expect(store.listRuns(first.scopeId).map((run) => run.state).sort()).toEqual(["queued", "running"]);
    expect(snapshot(first.scopeId)).toEqual({ revision: 0, value: null });
    expect(digests).toEqual([expect.objectContaining({ scopeId: other.scopeId, items: emptyQueue })]);
    release();
    await coordinator.whenIdle();
    expect(store.listRuns(first.scopeId).map((run) => run.state)).toEqual(["succeeded", "succeeded"]);
    expect(snapshot(first.scopeId)).toEqual({ revision: 1, value: emptyQueue });
    expect(digests).toHaveLength(2);
    expect(digests[1]).toMatchObject({
      scopeId: first.scopeId, items: emptyQueue,
      text: "Attention digest (1 item):\n• *Empty task queue*: Builder has no open task to pick up.",
    });
    expect(deadLetters.list()).toEqual([]);

    const tasksDir = join(first.scopeRoot, "data", "tasks");
    mkdirSync(tasksDir, { recursive: true });
    for (const id of ["task-blocked-a", "task-blocked-b"]) {
      writeFileSync(join(tasksDir, `${id}.md`), `---\nstatus: blocked\npriority: p2\n---\n\n# ${id}\n`);
    }
    const stageEmit = store.stageEmitIntent.bind(store);
    const failPublication = vi.spyOn(store, "stageEmitIntent").mockImplementationOnce((input) => {
      stageEmit(input);
      throw new Error("Injected publication failure after staging");
    });
    await observe("failed-publication");
    failPublication.mockRestore();
    expect(store.listRuns(first.scopeId).find((run) => run.state === "failed")?.lastError)
      .toContain("Injected publication failure after staging");
    expect(snapshot(first.scopeId)).toEqual({ revision: 1, value: emptyQueue });
    expect(digests).toHaveLength(2);

    await stop();
    store.close();
    store = new RunStateDatabase(join(root, "state"));
    allocator = createAllocator();
    coordinator = start();
    await observe("retry-after-restart");
    expect(digests).toHaveLength(3);
    expect(digests[2].items).toEqual([{ label: "Blocked tasks", detail: "2 blocked tasks" }]);
    expect(snapshot(first.scopeId).revision).toBe(2);
    await observe("unchanged");
    expect(digests).toHaveLength(3);
    expect(snapshot(first.scopeId).revision).toBe(2);

    for (const id of ["task-blocked-a", "task-blocked-b"]) rmSync(join(tasksDir, `${id}.md`));
    writeFileSync(join(tasksDir, "task-open.md"), "---\nstatus: open\npriority: p2\n---\n\n# Open\n");
    await observe("cleared");
    expect(snapshot(first.scopeId)).toEqual({ revision: 3, value: [] });
    await observe("still-clear");
    expect(snapshot(first.scopeId)).toEqual({ revision: 3, value: [] });
    expect(digests).toHaveLength(3);
    rmSync(join(tasksDir, "task-open.md"));
    await observe("recurred");
    expect(digests).toHaveLength(4);
    expect(digests[3].items).toEqual(emptyQueue);
    expect(snapshot(first.scopeId)).toEqual({ revision: 4, value: emptyQueue });
    expect(snapshot(other.scopeId)).toEqual({ revision: 1, value: emptyQueue });
  } finally {
    release();
    await stop();
    spy.mockRestore();
    allocatorSpy.mockRestore();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
