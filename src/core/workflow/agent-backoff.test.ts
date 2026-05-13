import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentBackoffManager } from "./agent-backoff.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowQueuedRun } from "./run-types.js";
import type { WorkflowDefinition } from "./types.js";

describe("AgentBackoffManager", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let queue: WorkflowQueuedRun[];
  let logs: string[];

  function makeManager(): AgentBackoffManager {
    const definitions: WorkflowDefinition[] = [
      {
        name: "agent-workflow",
        enabled: true,
        moduleRoot: projectDir,
        recoveryCapable: false,
        tags: [],
        definitionPath: "agent-workflow.test.ts",
        triggers: [],
        steps: [],
      },
    ];
    return new AgentBackoffManager(
      store,
      () => queue,
      (next) => {
        queue = next;
      },
      () => {},
      () => definitions,
      (definition) => definition.name === "agent-workflow",
      (message) => logs.push(message),
    );
  }

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-agent-backoff-"));
    store = new WorkflowRunStore(projectDir);
    queue = [];
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
});
