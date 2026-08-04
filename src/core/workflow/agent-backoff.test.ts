import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import { AgentBackoffManager } from "./agent-backoff.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowDefinition } from "./types.js";
import { WorkflowQueueManager } from "./workflow-queue.js";

describe("AgentBackoffManager", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let logs: string[];

  function makeManager(): AgentBackoffManager {
    return new AgentBackoffManager(
      store,
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
      idempotencyStore: new IdempotencyStore(
        join(projectDir, ".kota", "idempotency"),
        "test-scope",
      ),
      getScopeId: () => "test-scope",
      getActiveBackoff: () => manager.getActive(),
      workflowUsesAgent: () => true,
      isActiveRun: () => false,
      getDefinitions: () => [definition],
      log: (message) => logs.push(message),
    });
  }

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-agent-backoff-"));
    store = new WorkflowRunStore(projectDir);
    logs = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("escalates repeated same-kind failures even after the prior backoff expired", () => {
    const manager = makeManager();

    manager.apply({ kind: "auth", reason: "first auth failure" });
    const first = store.readState().agentBackoff;
    expect(first?.failureCount).toBe(1);

    vi.setSystemTime(new Date("2026-05-12T12:31:00.000Z"));
    expect(manager.getActive()).toBeNull();

    manager.apply({ kind: "auth", reason: "second auth failure" });
    const second = store.readState().agentBackoff;
    expect(second?.failureCount).toBe(2);
    expect(second?.until).toBe("2026-05-12T13:31:00.000Z");
  });

  it("clears an expired stored backoff after a successful agent run", () => {
    const manager = makeManager();

    manager.apply({ kind: "provider", reason: "temporary outage" });
    vi.setSystemTime(new Date("2026-05-12T12:06:00.000Z"));
    expect(manager.getActive()).toBeNull();

    manager.clear();

    expect(store.readState().agentBackoff).toBeUndefined();
  });

  it("clears backoff owned by a different agent runtime", () => {
    store.setAgentBackoff({
      runtimeId: "codex:codex",
      kind: "rate_limit",
      failureCount: 1,
      until: "2026-05-16T09:00:00.000Z",
      updatedAt: "2026-05-12T11:00:00.000Z",
      reason: "Codex usage limit",
    });
    const manager = new AgentBackoffManager(
      store,
      (message) => logs.push(message),
      "gemini-cli:gemini-cli",
    );

    expect(manager.getActive()).toBeNull();
    expect(store.readState().agentBackoff).toBeUndefined();
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

    expect(store.readState().agentBackoff?.until).toBe("2026-05-16T09:00:00.000Z");
  });

  it("ignores an expired provider retry timestamp", () => {
    const manager = makeManager();

    manager.apply({
      kind: "rate_limit",
      reason: "usage limit",
      retryAt: "2026-05-12T11:00:00.000Z",
    });

    expect(store.readState().agentBackoff?.until).toBe("2026-05-12T12:30:00.000Z");
  });

  it("gates agent dispatch without deleting queued recovery work", () => {
    const definition: WorkflowDefinition = {
      name: "builder",
      enabled: true,
      moduleRoot: projectDir,
      recoveryCapable: true,
      tags: [],
      definitionPath: "builder.test.ts",
      triggers: [{ event: "autonomy.builder.recovery.requested", cooldownMs: 0 }],
      steps: [],
    };
    const manager = makeManager();
    const queue = makeQueue(manager, definition);
    queue.enqueue(definition, definition.triggers[0]!, {
      event: "autonomy.builder.recovery.requested",
      schemaRef: null,
      payload: { idempotencyKey: "preserved-builder-run" },
    });

    manager.apply({ kind: "provider", reason: "provider disconnected" });

    expect(queue.length).toBe(1);
    expect(queue.pick()).toBeNull();

    const restored = makeQueue(manager, definition);
    restored.restorePending();
    expect(restored.length).toBe(1);

    manager.clear();
    expect(restored.pick()?.workflowName).toBe("builder");
  });
});
