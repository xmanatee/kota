import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { RunCoordinator } from "./run-coordinator.js";
import { RunStateDatabase } from "./run-state-database.js";
import { WorkflowRuntime } from "./runtime.js";
import { createWorkflowRuntimeContext } from "./runtime-context.js";

describe("WorkflowRuntime context-backed status metadata", () => {
  let scopeRoot: string;
  let runState: RunStateDatabase;
  let runCoordinator: RunCoordinator;
  let daemonEpoch: number;

  beforeEach(() => {
    scopeRoot = join(
      tmpdir(),
      `kota-runtime-context-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(scopeRoot, { recursive: true });
    runState = new RunStateDatabase(join(scopeRoot, ".kota", "state"));
    runState.registerScope({
      id: "test-scope",
      rootPath: scopeRoot,
      createdAt: "2026-08-25T10:00:00.000Z",
    });
    daemonEpoch = runState.beginDaemonSession("2026-08-25T10:00:00.000Z").epoch;
    runCoordinator = new RunCoordinator({
      store: runState,
      daemonEpoch,
      concurrency: 3,
      execute: async () => ({ kind: "terminal", state: "succeeded" }),
    });
  });

  afterEach(() => {
    runState.close();
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("surfaces coordinator-owned concurrency and durable operational state", () => {
    const ctx = createWorkflowRuntimeContext({
      bus: new EventBus(),
      scopeRoot,
      scopeId: "test-scope",
      runState,
      runCoordinator,
      daemonEpoch,
      workflows: [],
    });

    expect(ctx.scopeRoot).toBe(scopeRoot);
    expect(ctx.runCoordinator).toBe(runCoordinator);
    expect(ctx).not.toHaveProperty("activeRuns");
    expect(ctx.wfQueue.length).toBe(0);

    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      scopeRoot,
      scopeId: "test-scope",
      runState,
      runCoordinator,
      daemonEpoch,
      workflows: [],
    });

    expect(runtime.getState()).toMatchObject({
      concurrency: 3,
      queueLength: 0,
      activeRuns: [],
      pendingRuns: [],
      workflows: {},
    });
  });
});
