import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_BACKOFF_OPERATOR_RETRY_UNTIL,
  AgentBackoffAdmissionError,
  AgentBackoffManager,
  agentBackoffQueueUntil,
  resolveAgentOperatingState,
} from "./agent-backoff.js";
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

  it("coalesces concurrent failures into the active backoff window", () => {
    const manager = makeManager();

    const first = manager.apply({
      kind: "rate_limit",
      reason: "first concurrent quota failure",
    });
    const second = manager.apply({
      kind: "rate_limit",
      reason: "second concurrent quota failure",
    });

    expect(second.failureCount).toBe(1);
    expect(second.until).toBe(first.until);
  });

  it("aborts in-flight agent attempts and rejects later attempts", () => {
    const manager = makeManager();
    const attempt = new AbortController();
    const release = manager.registerAttempt(attempt);

    const incident = manager.apply({
      kind: "rate_limit",
      reason: "provider quota exhausted",
    });

    expect(attempt.signal.aborted).toBe(true);
    expect(attempt.signal.reason).toBeInstanceOf(AgentBackoffAdmissionError);
    expect(() => manager.registerAttempt(new AbortController())).toThrow(
      `Agent dispatch is backed off until ${incident.until}`,
    );
    release();
  });

  it("keeps output-contract incidents parked until explicit recovery", () => {
    const manager = makeManager();
    const incident = manager.apply({
      kind: "output_contract",
      reason: "two empty successful results",
    });

    vi.setSystemTime(new Date("2026-05-13T12:00:00.000Z"));

    expect(manager.getActive()).toEqual(incident);
    expect(agentBackoffQueueUntil(incident)).toBe(AGENT_BACKOFF_OPERATOR_RETRY_UNTIL);
    expect(resolveAgentOperatingState({
      runtimeId: manager.getRuntimeId(),
      backoff: incident,
      hasActiveAgentAttempt: false,
    })).toMatchObject({ state: "quality-paused" });
  });

  it("does not shorten an active backoff when another failure kind arrives", () => {
    const manager = makeManager();

    const rateLimit = manager.apply({
      kind: "rate_limit",
      reason: "quota exhausted",
    });
    const provider = manager.apply({
      kind: "provider",
      reason: "provider disconnected",
    });

    expect(provider).toEqual(rateLimit);
  });

  it("does not discard an output-contract incident behind a later quota horizon", () => {
    const manager = makeManager();
    manager.apply({
      kind: "rate_limit",
      reason: "quota reset is later than the local cap",
      retryAt: "2026-05-16T09:00:00.000Z",
    });

    const quality = manager.apply({
      kind: "output_contract",
      reason: "successful empty output",
    });

    expect(quality).toMatchObject({
      kind: "output_contract",
      reason: "successful empty output",
      retainedProviderIncident: {
        kind: "rate_limit",
        until: "2026-05-16T09:00:00.000Z",
      },
    });
    expect(manager.getActive()).toEqual(quality);

    expect(manager.apply({
      kind: "provider",
      reason: "shorter disconnect during the quality pause",
    })).toMatchObject({
      retainedProviderIncident: {
        kind: "rate_limit",
        until: "2026-05-16T09:00:00.000Z",
      },
    });

    manager.clear("after explicit operator retry");

    expect(manager.getActive()).toMatchObject({
      kind: "rate_limit",
      until: "2026-05-16T09:00:00.000Z",
    });
  });

  it("retains a provider incident reported while quality remains paused", () => {
    const manager = makeManager();
    manager.apply({ kind: "quality", reason: "unrelated edits" });

    const quality = manager.apply({
      kind: "provider",
      reason: "provider disconnected during review",
      retryAt: "2026-05-12T14:00:00.000Z",
    });

    expect(quality).toMatchObject({
      kind: "quality",
      retainedProviderIncident: {
        kind: "provider",
        until: "2026-05-12T14:00:00.000Z",
      },
    });
    manager.clear("after explicit operator retry");
    expect(manager.getActive()).toMatchObject({
      kind: "provider",
      until: "2026-05-12T14:00:00.000Z",
    });
  });

  it("reports working only while a harness attempt is registered in that scope", () => {
    const manager = makeManager();
    const attempt = new AbortController();

    const release = manager.registerAttempt(attempt, "scope-a");

    expect(manager.hasActiveAttempt("scope-a")).toBe(true);
    expect(manager.hasActiveAttempt("scope-b")).toBe(false);
    expect(resolveAgentOperatingState({
      runtimeId: manager.getRuntimeId(),
      backoff: null,
      hasActiveAgentAttempt: manager.hasActiveAttempt("scope-a"),
    }).state).toBe("working");
    release();
    expect(manager.hasActiveAttempt("scope-a")).toBe(false);
  });

  it("does not replace an explicit-retry quality pause with a provider incident", () => {
    const manager = makeManager();
    manager.apply({
      kind: "quality",
      reason: "unrelated edits",
    });

    const retained = manager.apply({
      kind: "provider",
      reason: "later disconnect",
    });
    expect(retained).toMatchObject({
      kind: "quality",
      retainedProviderIncident: { kind: "provider" },
    });
    expect(manager.apply({
      kind: "output_contract",
      reason: "later successful empty output",
    })).toEqual(retained);
    expect(manager.getActive()).toEqual(retained);
  });

  it("clears an expired stored backoff after a successful agent run", () => {
    const manager = makeManager();

    manager.apply({ kind: "provider", reason: "temporary outage" });
    vi.setSystemTime(new Date("2026-05-12T12:06:00.000Z"));
    expect(manager.getActive()).toBeNull();

    manager.clear();

    expect(scopeState.getAgentBackoff()).toBeNull();
  });

  it("does not let explicit operator retry clear an active provider horizon", () => {
    const manager = makeManager();
    manager.apply({ kind: "auth", reason: "login was unavailable" });

    expect(manager.clear("after explicit operator retry")).toBe(false);

    expect(scopeState.getAgentBackoff()).toMatchObject({
      kind: "auth",
      until: "2026-05-12T12:30:00.000Z",
    });
    expect(logs.at(-1)).toContain(
      "despite after explicit operator retry (auth)",
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

    expect(manager.getSupersededRuntime()).toMatchObject({
      runtimeId: "codex:codex",
    });
    expect(manager.getActive()).toBeNull();
    expect(scopeState.getAgentBackoff()).not.toBeNull();
    manager.clear("after runtime changed from codex:codex");
    expect(scopeState.getAgentBackoff()).toBeNull();
    expect(logs).toContain(
      "Cleared agent dispatch backoff after runtime changed from codex:codex (rate_limit)",
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

  it("defers agent work that was queued before backoff, including after restart", () => {
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
    coordinator.pauseGlobalAdmission();
    queue.enqueue(definition, definition.triggers[0]!, {
      event: "autonomy.builder.requested",
      schemaRef: null,
      payload: { idempotencyKey: "already-queued-builder" },
    });

    const backoff = manager.apply({
      kind: "rate_limit",
      reason: "provider quota exhausted",
    });
    const restored = makeQueue(manager, definition);
    restored.restorePending();

    expect(restored.getRuns()).toHaveLength(1);
    expect(restored.getRuns()[0]?.notBeforeMs).toBe(Date.parse(backoff.until));
    expect(execute).not.toHaveBeenCalled();

    expect(restored.releaseAgentRunsDeferredUntil(backoff.until)).toBe(1);
    expect(restored.getRuns()[0]?.notBeforeMs).toBe(Date.now());
  });

  it("leaves deterministic queued work eligible during a quality incident", () => {
    const agentDefinition: WorkflowDefinition = {
      name: "builder",
      enabled: true,
      moduleRoot: scopeRoot,
      repository: "none",
      tags: [],
      definitionPath: "builder.test.ts",
      triggers: [{ event: "agent.requested", cooldownMs: 0 }],
      steps: [],
    };
    const deterministicDefinition: WorkflowDefinition = {
      ...agentDefinition,
      name: "maintenance",
      definitionPath: "maintenance.test.ts",
      triggers: [{ event: "maintenance.requested", cooldownMs: 0 }],
    };
    const manager = makeManager();
    const queue = new WorkflowQueueManager({
      store,
      runState,
      coordinator,
      scopeId: "test-scope",
      scopeRoot,
      getScopeId: () => "test-scope",
      getActiveBackoff: () => manager.getActive(),
      workflowUsesAgent: (definition) => definition.name === "builder",
      getDefinitions: () => [agentDefinition, deterministicDefinition],
      log: (message) => logs.push(message),
    });
    coordinator.pauseGlobalAdmission();
    queue.enqueue(agentDefinition, agentDefinition.triggers[0]!, {
      event: "agent.requested",
      schemaRef: null,
      payload: { idempotencyKey: "agent-run" },
    });
    queue.enqueue(deterministicDefinition, deterministicDefinition.triggers[0]!, {
      event: "maintenance.requested",
      schemaRef: null,
      payload: { idempotencyKey: "maintenance-run" },
    });

    const quality = manager.apply({ kind: "quality", reason: "unrelated edits" });
    queue.deferAgentRunsUntil(agentBackoffQueueUntil(quality));

    const queued = new Map(queue.getRuns().map((run) => [run.workflowName, run]));
    expect(queued.get("builder")?.notBeforeMs).toBe(
      Date.parse(AGENT_BACKOFF_OPERATOR_RETRY_UNTIL),
    );
    expect(queued.get("maintenance")?.notBeforeMs).toBe(Date.now());
  });
});
