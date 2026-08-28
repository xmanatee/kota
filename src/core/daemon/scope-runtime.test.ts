import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import {
  getModuleLogStore,
  resetModuleLogStore,
} from "#core/modules/module-log.js";
import { RunCoordinator } from "#core/workflow/run-coordinator.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { getApprovalQueue, resetApprovalQueue } from "./approval-queue.js";
import {
  getIdempotencyStore,
  resetIdempotencyStore,
} from "./idempotency-singleton.js";
import {
  getOwnerQuestionQueue,
  resetOwnerQuestionQueue,
} from "./owner-question-queue.js";
import { getScheduler, resetScheduler } from "./scheduler.js";
import {
  buildDirectoryScope,
  type DirectoryScope,
  ScopeRegistry,
} from "./scope-registry.js";
import {
  createScopeRuntime,
  type ScopeRuntime,
  ScopeRuntimeRegistry,
} from "./scope-runtime.js";
import { getTaskStore, resetTaskStore } from "./task-store.js";

function makeScopeRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `kota-scope-runtime-${name}-`));
  mkdirSync(join(root, ".kota"), { recursive: true });
  return root;
}

const openRunStates: RunStateDatabase[] = [];

function makeRunInfrastructure(scopes: readonly DirectoryScope[]) {
  const stateDir = mkdtempSync(join(tmpdir(), "kota-scope-runtime-run-state-"));
  const runState = new RunStateDatabase(stateDir);
  openRunStates.push(runState);
  const startedAt = new Date().toISOString();
  for (const scope of scopes) {
    runState.registerScope({
      id: scope.scopeId,
      rootPath: scope.scopeRoot,
      displayName: scope.displayName,
      createdAt: startedAt,
    });
  }
  const daemonEpoch = runState.beginDaemonSession(startedAt).epoch;
  const runtimes = new Map<string, ScopeRuntime>();
  const runCoordinator = new RunCoordinator({
    store: runState,
    daemonEpoch,
    concurrency: 4,
    execute: (run, signal) => {
      const runtime = runtimes.get(run.scopeId);
      if (!runtime) throw new Error(`Missing runtime fixture for ${run.scopeId}`);
      return runtime.workflowRuntime.executeAdmittedRun(run, signal);
    },
  });
  return {
    options: { runState, runCoordinator, daemonEpoch },
    attach(runtime: ScopeRuntime): void {
      runtimes.set(runtime.scope.scopeId, runtime);
    },
  };
}

afterEach(() => {
  for (const runState of openRunStates.splice(0)) runState.close();
});

function resetSingletons(): void {
  resetTaskStore();
  resetScheduler();
  resetModuleLogStore();
  resetApprovalQueue();
  resetIdempotencyStore();
  resetOwnerQuestionQueue();
}

describe("createScopeRuntime", () => {
  beforeEach(resetSingletons);
  afterEach(resetSingletons);

  it("constructs the full per-scope bundle with scope-owned paths", async () => {
    const scopeRoot = makeScopeRoot("solo");
    const scope = buildDirectoryScope({ scopeRoot });
    const bus = new EventBus();
    const runInfrastructure = makeRunInfrastructure([scope]);

    const bundle = createScopeRuntime({
      scope,
      bus,
      onLog: () => {},
      installSingletons: false,
      ...runInfrastructure.options,
    });
    runInfrastructure.attach(bundle);

    expect(bundle.scope.scopeId).toBe(scope.scopeId);
    expect(bundle.runStore.rootDir).toBe(join(scope.scopeRoot, ".kota"));
    expect(bundle.runStore.runsDir).toBe(join(scope.scopeRoot, ".kota", "runs"));
    expect(bundle.pushTokenStorePath).toBe(
      join(scope.scopeRoot, ".kota", "push-tokens.json"),
    );

    bundle.taskStore.add("first task");
    expect(bundle.taskStore.list()).toHaveLength(1);

    bundle.scheduler.add("ping", new Date(Date.now() + 60_000));
    expect(bundle.scheduler.pending()).toHaveLength(1);
    bundle.scheduler.stopTimer();
    bundle.scheduler.disconnectBus();

    bundle.approvalQueue.enqueue("Bash", { cmd: "ls" }, "moderate", "test");
    expect(bundle.approvalQueue.list("pending")).toHaveLength(1);

    bundle.deadLetterQueue.record({
      type: "workflow-dispatch",
      scopeId: scope.scopeId,
      owningModule: "workflow-runtime",
      sourceEventIds: [],
      affectedWorkflowNames: ["fixture"],
      failure: {
        reason: "fixture failure",
        lastErrorClass: "execution",
      },
      source: {
        kind: "workflow-dispatch",
        workflowName: "fixture",
        triggerEvent: "manual",
        triggerSchemaRef: null,
      },
      redrive: {
        kind: "none",
        reason: "fixture",
      },
      redactedProjection: { workflow: "fixture" },
    });
    expect(bundle.deadLetterQueue.list()).toHaveLength(1);

    bundle.idempotencyStore.record({
      scopeId: scope.scopeId,
      operation: "event-ingestion",
      key: "manual:test",
      parameterFingerprint: "fp",
      result: { runId: "run-1" },
    });
    expect(bundle.idempotencyStore.list()).toHaveLength(1);

    bundle.ownerQuestionQueue.enqueue({
      context: "ctx",
      question: "q?",
      reason: "reason",
      source: "src",
      answerBehavior: "record-only",
      origin: { kind: "manual", source: "src" },
    });
    expect(bundle.ownerQuestionQueue.list("pending")).toHaveLength(1);

    bundle.moduleLogStore.append("test-module", "info", "hello");
    expect(bundle.moduleLogStore.tail("test-module")).toHaveLength(1);

    expect(bundle.notificationGate).toBeNull();

    await bundle.workflowRuntime.stop();
  });

  it("only the default-scope bundle installs the process singletons", async () => {
    const scopeA = buildDirectoryScope({ scopeRoot: makeScopeRoot("a") });
    const scopeB = buildDirectoryScope({ scopeRoot: makeScopeRoot("b") });
    const bus = new EventBus();
    const runInfrastructure = makeRunInfrastructure([scopeA, scopeB]);

    const bundleA = createScopeRuntime({
      scope: scopeA,
      bus,
      onLog: () => {},
      installSingletons: true,
      ...runInfrastructure.options,
    });
    runInfrastructure.attach(bundleA);
    const bundleB = createScopeRuntime({
      scope: scopeB,
      bus,
      onLog: () => {},
      installSingletons: false,
      ...runInfrastructure.options,
    });
    runInfrastructure.attach(bundleB);

    expect(getTaskStore()).toBe(bundleA.taskStore);
    expect(getScheduler()).toBe(bundleA.scheduler);
    expect(getModuleLogStore()).toBe(bundleA.moduleLogStore);
    expect(getApprovalQueue()).toBe(bundleA.approvalQueue);
    expect(getIdempotencyStore()).toBe(bundleA.idempotencyStore);
    expect(getOwnerQuestionQueue()).toBe(bundleA.ownerQuestionQueue);

    expect(bundleB.taskStore).not.toBe(bundleA.taskStore);
    expect(bundleB.scheduler).not.toBe(bundleA.scheduler);

    bundleA.scheduler.stopTimer();
    bundleA.scheduler.disconnectBus();
    bundleB.scheduler.stopTimer();
    bundleB.scheduler.disconnectBus();
    await bundleA.workflowRuntime.stop();
    await bundleB.workflowRuntime.stop();
  });
});

describe("ScopeRuntimeRegistry — independence across scopes", () => {
  beforeEach(resetSingletons);
  afterEach(resetSingletons);

  it("two configured scopes produce independent file paths and in-memory state", async () => {
    const dirA = makeScopeRoot("twin-a");
    const dirB = makeScopeRoot("twin-b");
    const stateDir = mkdtempSync(join(tmpdir(), "kota-scope-runtime-state-"));

    const registry = new ScopeRegistry({
      stateDir,
      scopes: [{ scopeRoot: dirA }, { scopeRoot: dirB }],
    });
    const bus = new EventBus();
    const runInfrastructure = makeRunInfrastructure(registry.list());

    const runtimes = ScopeRuntimeRegistry.create({
      registry,
      bus,
      onLog: () => {},
      ...runInfrastructure.options,
    });
    for (const runtime of runtimes.list()) runInfrastructure.attach(runtime);

    const a = runtimes.get(registry.list()[0]!.scopeId);
    const b = runtimes.get(registry.list()[1]!.scopeId);

    expect(a.scope.scopeRoot).toBe(registry.list()[0]!.scopeRoot);
    expect(b.scope.scopeRoot).toBe(registry.list()[1]!.scopeRoot);
    expect(a.runStore).not.toBe(b.runStore);
    expect(a.taskStore).not.toBe(b.taskStore);
    expect(a.scheduler).not.toBe(b.scheduler);
    expect(a.approvalQueue).not.toBe(b.approvalQueue);
    expect(a.deadLetterQueue).not.toBe(b.deadLetterQueue);
    expect(a.idempotencyStore).not.toBe(b.idempotencyStore);
    expect(a.ownerQuestionQueue).not.toBe(b.ownerQuestionQueue);
    expect(a.moduleLogStore).not.toBe(b.moduleLogStore);
    expect(a.workflowRuntime).not.toBe(b.workflowRuntime);

    a.taskStore.add("alpha");
    b.taskStore.add("beta one");
    b.taskStore.add("beta two");
    expect(a.taskStore.list().map((t) => t.task)).toEqual(["alpha"]);
    expect(b.taskStore.list().map((t) => t.task)).toEqual([
      "beta one",
      "beta two",
    ]);

    a.approvalQueue.enqueue("Bash", { cmd: "ls" }, "moderate", "a");
    b.approvalQueue.enqueue("Bash", { cmd: "ls" }, "moderate", "b1");
    b.approvalQueue.enqueue("Bash", { cmd: "ls" }, "moderate", "b2");
    expect(a.approvalQueue.count("pending")).toBe(1);
    expect(b.approvalQueue.count("pending")).toBe(2);

    expect(existsSync(join(dirA, ".kota", "approvals"))).toBe(true);
    expect(existsSync(join(dirB, ".kota", "approvals"))).toBe(true);
    expect(readdirSync(join(dirA, ".kota", "approvals")).length).toBe(1);
    expect(readdirSync(join(dirB, ".kota", "approvals")).length).toBe(2);

    a.deadLetterQueue.record({
      type: "workflow-dispatch",
      scopeId: a.scope.scopeId,
      owningModule: "workflow-runtime",
      sourceEventIds: [],
      affectedWorkflowNames: ["alpha"],
      failure: {
        reason: "alpha failure",
        lastErrorClass: "execution",
      },
      source: {
        kind: "workflow-dispatch",
        workflowName: "alpha",
        triggerEvent: "manual",
        triggerSchemaRef: null,
      },
      redrive: { kind: "none", reason: "fixture" },
      redactedProjection: { workflow: "alpha" },
    });
    b.deadLetterQueue.record({
      type: "workflow-dispatch",
      scopeId: b.scope.scopeId,
      owningModule: "workflow-runtime",
      sourceEventIds: [],
      affectedWorkflowNames: ["beta"],
      failure: {
        reason: "beta failure",
        lastErrorClass: "execution",
      },
      source: {
        kind: "workflow-dispatch",
        workflowName: "beta",
        triggerEvent: "manual",
        triggerSchemaRef: null,
      },
      redrive: { kind: "none", reason: "fixture" },
      redactedProjection: { workflow: "beta" },
    });
    expect(a.deadLetterQueue.list().map((item) => item.affectedWorkflowNames[0])).toEqual(["alpha"]);
    expect(b.deadLetterQueue.list().map((item) => item.affectedWorkflowNames[0])).toEqual(["beta"]);

    a.idempotencyStore.record({
      scopeId: a.scope.scopeId,
      operation: "event-ingestion",
      key: "signal:shared",
      parameterFingerprint: "a",
      result: { accepted: true },
    });
    b.idempotencyStore.record({
      scopeId: b.scope.scopeId,
      operation: "event-ingestion",
      key: "signal:shared",
      parameterFingerprint: "b",
      result: { accepted: true },
    });
    expect(a.idempotencyStore.list()).toHaveLength(1);
    expect(b.idempotencyStore.list()).toHaveLength(1);
    expect(existsSync(join(dirA, ".kota", "idempotency"))).toBe(true);
    expect(existsSync(join(dirB, ".kota", "idempotency"))).toBe(true);

    a.moduleLogStore.append("mod", "info", "alpha-log");
    b.moduleLogStore.append("mod", "info", "beta-log");
    const aLog = readFileSync(
      join(dirA, ".kota", "modules", "mod", "logs.jsonl"),
      "utf-8",
    );
    const bLog = readFileSync(
      join(dirB, ".kota", "modules", "mod", "logs.jsonl"),
      "utf-8",
    );
    expect(aLog).toContain("alpha-log");
    expect(aLog).not.toContain("beta-log");
    expect(bLog).toContain("beta-log");
    expect(bLog).not.toContain("alpha-log");

    expect(statSync(a.pushTokenStorePath.replace(/push-tokens\.json$/, ""))
      .isDirectory()).toBe(true);
    expect(a.pushTokenStorePath).not.toBe(b.pushTokenStorePath);

    a.scheduler.stopTimer();
    a.scheduler.disconnectBus();
    b.scheduler.stopTimer();
    b.scheduler.disconnectBus();
    await a.workflowRuntime.stop();
    await b.workflowRuntime.stop();
  });

  it("getScopeRuntime throws on an unknown scopeId", () => {
    const dir = makeScopeRoot("solo-lookup");
    const stateDir = mkdtempSync(join(tmpdir(), "kota-scope-runtime-state-"));
    const registry = new ScopeRegistry({
      stateDir,
      scopes: [{ scopeRoot: dir }],
    });
    const bus = new EventBus();
    const runInfrastructure = makeRunInfrastructure(registry.list());
    const runtimes = ScopeRuntimeRegistry.create({
      registry,
      bus,
      onLog: () => {},
      ...runInfrastructure.options,
    });
    for (const runtime of runtimes.list()) runInfrastructure.attach(runtime);
    expect(() => runtimes.get("not-a-real-id")).toThrow(/no runtime/i);
    runtimes.getDefault().scheduler.stopTimer();
    runtimes.getDefault().scheduler.disconnectBus();
    return runtimes.getDefault().workflowRuntime.stop();
  });
});
