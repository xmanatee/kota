import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentBackoffManager } from "./agent-backoff.js";
import { RunCoordinator, type RunExecutor } from "./run-coordinator.js";
import { RunStateDatabase } from "./run-state-database.js";
import { WorkflowRunStore } from "./run-store.js";
import { ScopeRuntimeStateStore } from "./scope-runtime-state.js";
import type { WorkflowDefinition } from "./types.js";
import { WorkflowQueueManager } from "./workflow-queue.js";

describe("AgentBackoffManager", () => {
  let scopeRoot: string;
  let store: WorkflowRunStore;
  let runState: RunStateDatabase;
  let scopeState: ScopeRuntimeStateStore;
  let coordinator: RunCoordinator;
  let execute: ReturnType<typeof vi.fn<RunExecutor>>;
  let logs: string[];

  function makeManager(): AgentBackoffManager {
    return new AgentBackoffManager(
      scopeState,
      (message) => logs.push(message),
      "codex:codex",
    );
  }

  function makeQueue(
    manager: AgentBackoffManager,
    definition: WorkflowDefinition,
  ): WorkflowQueueManager {
    return new WorkflowQueueManager({
      store,
      runState,
      coordinator,
      scopeId: "test-scope",
      scopeRoot,
      getScopeId: () => "test-scope",
      getActiveBackoff: () => manager.getActive(),
      workflowUsesAgent: () => true,
      getDefinitions: () => [definition],
      log: (message) => logs.push(message),
    });
  }

  beforeEach(() => {
    scopeRoot = mkdtempSync(join(tmpdir(), "kota-agent-backoff-"));
    store = new WorkflowRunStore(scopeRoot);
    runState = new RunStateDatabase(join(scopeRoot, ".kota", "state"));
    runState.registerScope({
      id: "test-scope",
      rootPath: scopeRoot,
      createdAt: "2026-05-12T12:00:00.000Z",
    });
    scopeState = new ScopeRuntimeStateStore(runState, "test-scope");
    const { epoch } = runState.beginDaemonSession("2026-05-12T12:00:00.000Z");
    execute = vi.fn<RunExecutor>(async () => ({
      kind: "terminal",
      state: "succeeded",
    }));
    coordinator = new RunCoordinator({
      store: runState,
      daemonEpoch: epoch,
      concurrency: 1,
      execute,
    });
    logs = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    runState.close();
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("escalates repeated same-kind failures even after the prior backoff expired", () => {
    const manager = makeManager();

    manager.apply({ kind: "auth", reason: "first auth failure" });
    const first = scopeState.getAgentBackoff();
    expect(first?.failureCount).toBe(1);

    vi.setSystemTime(new Date("2026-05-12T12:31:00.000Z"));
    expect(manager.getActive()).toBeNull();

    manager.apply({ kind: "auth", reason: "second auth failure" });
    const second = scopeState.getAgentBackoff();
    expect(second?.failureCount).toBe(2);
    expect(second?.until).toBe("2026-05-12T13:31:00.000Z");
  });

  it("clears an expired stored backoff after a successful agent run", () => {
    const manager = makeManager();

    manager.apply({ kind: "provider", reason: "temporary outage" });
    vi.setSystemTime(new Date("2026-05-12T12:06:00.000Z"));
    expect(manager.getActive()).toBeNull();

    manager.clear();

    expect(scopeState.getAgentBackoff()).toBeNull();
  });

  it("records an explicit operator retry reason when clearing backoff", () => {
    const manager = makeManager();
    manager.apply({ kind: "auth", reason: "login was unavailable" });

    manager.clear("after explicit operator retry");

    expect(scopeState.getAgentBackoff()).toBeNull();
    expect(logs).toContain(
      "Cleared agent dispatch backoff after explicit operator retry (auth)",
    );
  });

  it("clears backoff owned by a different agent runtime", () => {
    scopeState.setAgentBackoff({
      runtimeId: "codex:codex",
      kind: "rate_limit",
      failureCount: 1,
      until: "2026-05-16T09:00:00.000Z",
      updatedAt: "2026-05-12T11:00:00.000Z",
      reason: "Codex usage limit",
    });
    const manager = new AgentBackoffManager(
      scopeState,
      (message) => logs.push(message),
      "gemini-cli:gemini-cli",
    );

    expect(manager.getActive()).toBeNull();
    expect(scopeState.getAgentBackoff()).toBeNull();
    expect(logs).toContain(
      "Cleared agent dispatch backoff from runtime codex:codex; active runtime is gemini-cli:gemini-cli",
    );
  });

  it("honors a provider retry timestamp beyond the local backoff cap", () => {
    const manager = makeManager();

    manager.apply({
      kind: "rate_limit",
      reason: "usage limit",
      retryAt: "2026-05-16T09:00:00.000Z",
    });

    expect(scopeState.getAgentBackoff()?.until).toBe("2026-05-16T09:00:00.000Z");
  });

  it("ignores an expired provider retry timestamp", () => {
    const manager = makeManager();

    manager.apply({
      kind: "rate_limit",
      reason: "usage limit",
      retryAt: "2026-05-12T11:00:00.000Z",
    });

    expect(scopeState.getAgentBackoff()?.until).toBe("2026-05-12T12:30:00.000Z");
  });

  it("gates agent dispatch without deleting durable queued work", async () => {
    const definition: WorkflowDefinition = {
      name: "builder",
      enabled: true,
      moduleRoot: scopeRoot,
      repository: "none",
      tags: [],
      definitionPath: "builder.test.ts",
      triggers: [{ event: "autonomy.builder.requested", cooldownMs: 0 }],
      steps: [],
    };
    const manager = makeManager();
    const queue = makeQueue(manager, definition);
    manager.apply({ kind: "provider", reason: "provider disconnected" });
    queue.enqueue(definition, definition.triggers[0]!, {
      event: "autonomy.builder.requested",
      schemaRef: null,
      payload: { idempotencyKey: "preserved-builder-run" },
    });

    expect(queue.length).toBe(1);
    expect(queue.getRuns()[0]!.notBeforeMs).toBeGreaterThan(Date.now());
    expect(execute).not.toHaveBeenCalled();

    const restored = makeQueue(manager, definition);
    restored.restorePending();
    expect(restored.length).toBe(1);
    const queuedRunId = restored.getRuns()[0]?.runId;
    if (!queuedRunId) throw new Error("expected durable queued run id");

    const backoffUntil = scopeState.getAgentBackoff()?.until;
    if (!backoffUntil) throw new Error("expected active backoff");
    manager.clear();
    vi.setSystemTime(new Date(backoffUntil));
    coordinator.refill();
    await coordinator.whenIdle();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(runState.getRun(queuedRunId)?.state).toBe("succeeded");
  });
});
