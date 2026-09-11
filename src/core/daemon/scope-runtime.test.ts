import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { ModuleLogStore } from "#core/modules/module-log.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { readOnlyLocalEffect } from "#core/tools/effect.js";
import { runModuleFactory } from "#core/tools/module-factory/index.js";
import { executeToolCalls, type ToolCallExecutionOptions } from "#core/tools/tool-runner.js";
import { RunCoordinator } from "#core/workflow/run-coordinator.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { ScopeRuntimeStateStore } from "#core/workflow/scope-runtime-state.js";
import { StandaloneRunHost } from "#core/workflow/standalone-run-host.js";
import { getApprovalQueue, resetApprovalQueue } from "./approval-queue.js";
import {
  getIdempotencyStore,
  resetIdempotencyStore,
} from "./idempotency-singleton.js";
import {
  getOwnerQuestionQueue,
  resetOwnerQuestionQueue,
} from "./owner-question-queue.js";
import { DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE } from "./runtime-scope-provider.js";
import {
  buildDirectoryScope,
  type DirectoryScope,
  deriveDirectoryScopeId,
  ScopeRegistry,
} from "./scope-registry.js";
import {
  createScopeRuntime,
  type ScopeRuntime,
  ScopeRuntimeRegistry,
} from "./scope-runtime.js";
import { getTaskStore, resetTaskStore } from "./task-store.js";

// Log ownership does not depend on host socket availability. Keep allocation
// and lifecycle real while controlling only the external listener probe.
vi.mock("#core/workflow/run-resources.js", async (original) => {
  const actual = await original<typeof import("#core/workflow/run-resources.js")>();
  return {
    ...actual,
    RunResourceAllocator: class extends actual.RunResourceAllocator {
      constructor(store: RunStateDatabase, options: import("#core/workflow/run-resources.js").RunResourceAllocatorOptions) {
        super(store, { ...options, isPortAvailable: async () => true });
      }
    },
  };
});

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

describe("ScopeRuntimeRegistry — scoped ownership and controls", () => {
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

    expect(a.workflowRuntime.pauseAgentForQuality("scope quality incident")).toBe(true);
    expect(a.workflowRuntime.getState().agentBackoff).toMatchObject({
      kind: "quality",
      reason: "scope quality incident",
    });
    expect(b.workflowRuntime.getState().agentBackoff).toBeUndefined();
    expect(new ScopeRuntimeStateStore(
      runInfrastructure.options.runState,
      a.scope.scopeId,
    ).getAgentBackoff()).toMatchObject({ kind: "quality" });
    expect(new ScopeRuntimeStateStore(
      runInfrastructure.options.runState,
      b.scope.scopeId,
    ).getAgentBackoff()).toBeNull();
    expect(a.workflowRuntime.clearAgentBackoff("after scope operator retry")).toBe(true);
    expect(a.workflowRuntime.getState().agentBackoff).toBeUndefined();
    expect(new ScopeRuntimeStateStore(
      runInfrastructure.options.runState,
      a.scope.scopeId,
    ).getAgentBackoff()).toBeNull();

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

// Detects cross-scope disclosure through the public log caller, including live
// runtime retirement and canonical scope versus isolated execution directories.
describe("module log runtime ownership", () => {
  it("keeps interleaved module contexts and queries bound through default changes and retirement", async () => {
    const dirA = makeScopeRoot("logs-a");
    const dirB = makeScopeRoot("logs-b");
    const worktree = makeScopeRoot("logs-worktree");
    const registry = new ScopeRegistry({
      stateDir: makeScopeRoot("logs-state"),
      scopes: [{ scopeRoot: dirA }, { scopeRoot: dirB }],
    });
    const bus = new EventBus();
    const infrastructure = makeRunInfrastructure(registry.list());
    const runtimes = ScopeRuntimeRegistry.create({ registry, bus, onLog: () => {}, ...infrastructure.options });
    const [a, b] = runtimes.list();
    if (!a || !b) throw new Error("Expected two runtimes");
    const loader = new ModuleLoader({}); // Daemon-wide activation has no project scope.
    loader.setCwd(dirA);
    loader.setBus(bus);
    const providers = loader.getProviderRegistry();
    providers.register(DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE, "log-host", {
      resolve: (scopeId) => {
        try { return { ok: true, runtime: runtimes.get(scopeId) }; }
        catch { return { ok: false, scopeId }; }
      },
    });
    const resolveRuntimeScope: NonNullable<ToolCallExecutionOptions["resolveRuntimeScope"]> = (scopeId) =>
      providers.get(DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE)?.resolve(scopeId) ?? { ok: false, scopeId };
    const options = (runtime: ScopeRuntime): ToolCallExecutionOptions => ({
      resultLimit: 10000, verbose: false, autonomyMode: "autonomous",
      scopeId: runtime.scope.scopeId, scopeRoot: runtime.scope.scopeRoot,
      cwd: worktree, resolveRuntimeScope,
    });
    let ctxA!: ModuleRuntimeContext;
    let ctxB!: ModuleRuntimeContext;
    try {
      await loader.load({ name: "log-a", onLoad(ctx) { ctxA = ctx; ctx.log.info("scope-less activation"); } });
      await loader.load({ name: "log-b", onLoad(ctx) { ctxB = ctx; } });
      await loader.load({
        name: "log-caller",
        tools: [{
          tool: { name: "scope_log_probe", description: "Exercise scoped module logs", input_schema: {
            type: "object", properties: { message: { type: "string" }, name: { type: "string" } },
          } },
          effect: readOnlyLocalEffect(),
          runner: async (input, context) => {
            await Promise.resolve();
            const ctx = context?.scopeId === a.scope.scopeId ? ctxA : ctxB;
            if (typeof input.message === "string") ctx.log.info(input.message);
            if (input.message === "operation") {
              ctx.log.operationFailed?.(b.scope.scopeId, "probe", "explicit B failure");
              ctx.log.operationRecovered?.(b.scope.scopeId, "probe", "explicit B recovery");
            }
            return runModuleFactory({ action: "logs", name: input.name }, context);
          },
        }],
      });
      const call = async (runtime: ScopeRuntime, message?: string, name?: string) => {
        const [result] = await executeToolCalls([{
          type: "tool_use", id: "probe", name: "scope_log_probe", input: { ...(message !== undefined ? { message } : {}), ...(name !== undefined ? { name } : {}) },
        }], options(runtime));
        if (!result) throw new Error("Missing tool response");
        return result;
      };
      const [firstA, firstB] = await Promise.all([call(a, "A sentinel", "log-a"), call(b, "B sentinel", "log-b")]);
      expect(firstA.is_error).not.toBe(true);
      expect(firstA.content).toContain("A sentinel");
      expect(firstA.content).not.toContain("B sentinel");
      expect(firstB.content).toContain("B sentinel");
      expect(firstB.content).not.toContain("A sentinel");
      expect((await call(a)).content).toContain("log-a:");
      expect((await call(a)).content).not.toContain("log-b:");
      expect((await call(b)).content).toContain("log-b:");
      expect((await call(b)).content).not.toContain("log-a:");
      await call(a, "operation");
      expect(a.moduleLogStore.query().map((entry) => entry.msg)).not.toContain("explicit B failure");
      expect(b.moduleLogStore.tail("log-a").map((entry) => entry.msg)).toEqual(["explicit B failure", "explicit B recovery"]);
      expect(a.moduleLogStore.query().map((entry) => entry.msg)).not.toContain("scope-less activation");
      expect(new ModuleLogStore(worktree).modules()).toEqual([]);

      runtimes.setDefaultScopeId(b.scope.scopeId);
      expect((await call(a, "A after default switch")).content).toContain("A after default switch");
      const retired = runtimes.remove(a.scope.scopeId);
      retired.scheduler.stopTimer();
      retired.scheduler.disconnectBus();
      await retired.workflowRuntime.stop();
      expect((await call(b, "B survives")).content).toContain("B survives");
      expect(await call(a, "retired write")).toMatchObject({ is_error: true, content: expect.stringContaining("unavailable") });
      expect(a.moduleLogStore.query().map((entry) => entry.msg)).not.toContain("retired write");
      expect(await runModuleFactory({ action: "logs" }, { ...options(b), scopeRoot: dirA })).toMatchObject({ is_error: true });
      expect(await runModuleFactory({ action: "logs" }, { ...options(b), scopeId: "unknown" })).toMatchObject({ is_error: true });
      expect(await runModuleFactory({ action: "logs" }, { cwd: dirA })).toMatchObject({ is_error: true });
      expect(await runModuleFactory({ action: "logs" }, { scopeRoot: join(worktree, "missing") })).toMatchObject({ is_error: true, content: expect.stringContaining("unavailable") });
      providers.unregisterOwner("log-host");
      expect(await call(b, "withdrawn write")).toMatchObject({ is_error: true, content: expect.stringContaining("unavailable") });
      expect(b.moduleLogStore.query().map((entry) => entry.msg)).not.toContain("withdrawn write");
    } finally {
      await loader.unloadAll();
      for (const runtime of [a, b]) {
        runtime.scheduler.stopTimer();
        runtime.scheduler.disconnectBus();
        await runtime.workflowRuntime.stop();
      }
      resetSingletons();
    }
  });

  it("keeps workflow log queries on the live runtime selector after scope retirement", async () => {
    const dirA = makeScopeRoot("workflow-logs-a");
    const dirB = makeScopeRoot("workflow-logs-b");
    const registry = new ScopeRegistry({
      stateDir: makeScopeRoot("workflow-logs-state"),
      scopes: [{ scopeRoot: dirA }, { scopeRoot: dirB }],
    });
    const infrastructure = makeRunInfrastructure(registry.list());
    const runtimes = ScopeRuntimeRegistry.create({
      registry, bus: new EventBus(), onLog: () => {}, ...infrastructure.options,
      workflows: [{
        name: "query-module-logs", enabled: true, repository: "none",
        moduleRoot: dirA, definitionPath: "test/query-module-logs.ts", triggers: [{ webhook: true }],
        steps: [{ id: "query", type: "code", run: async (ctx) => {
          const before = await ctx.runTool("module_factory", { action: "logs", name: "workflow-probe" });
          runtimes.remove(ctx.scopeId);
          const after = await ctx.runTool("module_factory", { action: "logs", name: "workflow-probe" });
          return { before, after };
        } }],
      }],
    });
    const [a, b] = runtimes.list();
    if (!a || !b) throw new Error("Expected two runtimes");
    infrastructure.attach(a);
    infrastructure.attach(b);
    a.moduleLogStore.append("workflow-probe", "info", "workflow A sentinel");
    b.moduleLogStore.append("workflow-probe", "info", "workflow B sentinel");
    runtimes.setDefaultScopeId(b.scope.scopeId);
    try {
      a.workflowRuntime.start();
      const result = await a.workflowRuntime.execute({
        workflow: "query-module-logs", scopeId: a.scope.scopeId, event: "manual", payload: {},
      });
      expect(result, result.ok ? undefined : result.error).toMatchObject({ ok: true, output: {
        before: { content: expect.stringContaining("workflow A sentinel") },
        after: { is_error: true, content: expect.stringContaining("unavailable") },
      } });
      if (result.ok) expect(JSON.stringify(result.output)).not.toContain("workflow B sentinel");
    } finally {
      for (const runtime of [a, b]) {
        runtime.scheduler.stopTimer();
        runtime.scheduler.disconnectBus();
        await runtime.workflowRuntime.stop();
      }
      resetSingletons();
    }
  });

  it.each(["unregister", "clear"] as const)("rejects logging after silent host ownership withdrawal via %s", async (withdrawal) => {
    const canonical = makeScopeRoot("silent-host");
    const worktree = makeScopeRoot("silent-worktree");
    const loader = new ModuleLoader({}, false, { scopeRoot: canonical });
    loader.setCwd(worktree);
    loader.setBus(new EventBus());
    let context!: ModuleRuntimeContext;
    let host: StandaloneRunHost | undefined;
    try {
      await loader.load({ name: "silent-probe", onLoad(ctx) { context = ctx; } });
      // Production standalone commands load modules before constructing the host.
      // No log call occurs while the provider is present.
      host = new StandaloneRunHost({
        stateDir: join(canonical, ".kota"),
        scope: buildDirectoryScope({ scopeRoot: canonical }),
        workflows: [],
        providerRegistry: loader.getProviderRegistry(),
      });
      host.scopeRuntime.moduleLogStore.append("silent-probe", "info", "existing log");
      if (withdrawal === "clear") host.providerRegistry.clear();
      else host.providerRegistry.unregisterOwner("standalone-run-host");
      context.log.info("WITHDRAWN_WRITE_SENTINEL");
      context.log.operationFailed?.(host.scopeRuntime.scope.scopeId, "probe", "WITHDRAWN_OPERATION_SENTINEL");
      expect(new ModuleLogStore(canonical).query().map((entry) => entry.msg)).toEqual(["existing log"]);
      expect(new ModuleLogStore(worktree).modules()).toEqual([]);
    } finally {
      await host?.close();
      await loader.unloadAll();
    }
  });

  it("uses an explicit canonical activation root for standalone worktree hosts", async () => {
    const canonical = makeScopeRoot("standalone-logs");
    const requested = makeScopeRoot("standalone-request");
    const worktree = makeScopeRoot("standalone-worktree");
    const loader = new ModuleLoader({}, false, { scopeRoot: canonical });
    loader.setCwd(worktree);
    loader.setBus(new EventBus());
    try {
      await loader.load({
        name: "activation-probe",
        onLoad(ctx) { ctx.log.info("canonical activation"); },
        tools: (ctx) => [{
          tool: { name: "standalone_log_probe", description: "Exercise standalone operation scope", input_schema: { type: "object", properties: {} } },
          effect: readOnlyLocalEffect(),
          runner: async (_input, context) => {
            ctx.log.operationFailed?.(deriveDirectoryScopeId(requested), "probe", "request operation");
            return runModuleFactory({ action: "logs", name: "activation-probe" }, context);
          },
        }],
      });
      const result = await runModuleFactory({ action: "logs", name: "activation-probe" }, { cwd: worktree, scopeRoot: canonical });
      expect(result.is_error).not.toBe(true);
      expect(result.content).toContain("canonical activation");
      const [requestResult] = await executeToolCalls([
        { type: "tool_use", id: "standalone-probe", name: "standalone_log_probe", input: {} },
      ], {
        resultLimit: 10000, verbose: false, autonomyMode: "autonomous",
        scopeId: deriveDirectoryScopeId(requested), scopeRoot: requested, cwd: worktree,
      });
      expect(requestResult?.is_error).not.toBe(true);
      expect(requestResult?.content).toContain("request operation");
      expect(requestResult?.content).not.toContain("canonical activation");
      expect(new ModuleLogStore(canonical).query().map((entry) => entry.msg)).toEqual(["canonical activation"]);
      expect(new ModuleLogStore(worktree).modules()).toEqual([]);
    } finally { await loader.unloadAll(); }
  });
});
