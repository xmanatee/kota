import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { RunCoordinator } from "./run-coordinator.js";
import { WorkflowRunMetadataAuthorityError } from "./run-metadata.js";
import { RunStateDatabase } from "./run-state-database.js";
import { WorkflowRunStore } from "./run-store.js";
import { WorkflowRuntime } from "./runtime.js";
import { createWorkflowRuntimeContext } from "./runtime-context.js";
import type { WorkflowDefinition } from "./types.js";

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

  it("keeps admission paused when startup finds missing active-run metadata", () => {
    const runId = "2026-09-02T00-00-00-000Z-builder-active";
    const startedAt = "2026-09-02T00:00:00.000Z";
    runState.admitRun({
      id: runId,
      scopeId: "test-scope",
      workflow: "builder",
      repository: "write",
      trigger: { event: "test", schemaRef: null, payload: {} },
      resources: [],
      admittedAt: startedAt,
    });
    runState.startRun(runId, daemonEpoch, startedAt);

    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      scopeRoot,
      scopeId: "test-scope",
      runState,
      runCoordinator,
      daemonEpoch,
      workflows: [],
    });

    expect(() => runtime.start()).toThrow(WorkflowRunMetadataAuthorityError);
    expect(runCoordinator.isScopeAdmissionPaused("test-scope")).toBe(true);
    expect(runState.getRun(runId)?.state).toBe("running");
  });

  it("keeps admission paused when a terminal publication has lost its metadata", () => {
    const runId = "2026-09-02T00-00-00-000Z-builder-publication";
    const startedAt = "2026-09-02T00:00:00.000Z";
    runState.admitRun({
      id: runId,
      scopeId: "test-scope",
      workflow: "builder",
      repository: "write",
      trigger: { event: "test", schemaRef: null, payload: {} },
      resources: [],
      admittedAt: startedAt,
    });
    runState.startRun(runId, daemonEpoch, startedAt);
    runState.finishRun(
      runId,
      daemonEpoch,
      "succeeded",
      "2026-09-02T00:01:00.000Z",
      undefined,
      {
        id: `workflow:${runId}:completed`,
        runId,
        scopeId: "test-scope",
        event: "workflow.completed",
        payload: { runId },
      },
    );

    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      scopeRoot,
      scopeId: "test-scope",
      runState,
      runCoordinator,
      daemonEpoch,
      workflows: [],
    });

    expect(() => runtime.start()).toThrow(WorkflowRunMetadataAuthorityError);
    expect(runCoordinator.isScopeAdmissionPaused("test-scope")).toBe(true);
    expect(runState.listPendingPublications()).toHaveLength(1);
  });

  it("fails closed when terminal execution has no authority metadata", async () => {
    const runId = "2026-09-02T00-00-00-000Z-missing-metadata";
    const startedAt = "2026-09-02T00:00:00.000Z";
    runState.admitRun({
      id: runId,
      scopeId: "test-scope",
      workflow: "missing-workflow",
      repository: "none",
      trigger: { event: "test", schemaRef: null, payload: {} },
      resources: [],
      admittedAt: startedAt,
    });
    runState.startRun(runId, daemonEpoch, startedAt);
    const run = runState.getRun(runId)!;
    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      scopeRoot,
      scopeId: "test-scope",
      runState,
      runCoordinator,
      daemonEpoch,
      workflows: [],
    });

    await expect(
      runtime.executeAdmittedRun(run, new AbortController().signal),
    ).rejects.toThrow(WorkflowRunMetadataAuthorityError);
    expect(runState.getRun(runId)?.state).toBe("running");
  });

  it("finalizes terminal evidence before the durable run transition", () => {
    const runId = "2026-09-02T00-00-00-000Z-terminal-handoff";
    const startedAt = "2026-09-02T00:00:00.000Z";
    const trigger = { event: "test", schemaRef: null, payload: {} };
    const definition: WorkflowDefinition = {
      name: "terminal-handoff",
      description: "test",
      enabled: true,
      repository: "none",
      tags: [],
      definitionPath: "src/core/workflow/runtime-context.test.ts",
      moduleRoot: scopeRoot,
      triggers: [{ event: "test", cooldownMs: 0 }],
      steps: [{ id: "noop", type: "code", run: () => undefined }],
    };
    runState.admitRun({
      id: runId,
      scopeId: "test-scope",
      workflow: definition.name,
      repository: "none",
      trigger,
      resources: [],
      admittedAt: startedAt,
    });
    runState.startRun(runId, daemonEpoch, startedAt);

    const runStore = new WorkflowRunStore(scopeRoot, {
      authorityCriticalRunIds: () => new Set([runId]),
      operationallyActiveRunIds: () => new Set([runId]),
    });
    runStore.createRun(definition, trigger, runId).finish({
      status: "success",
      durationMs: 1_000,
    });
    const run = runState.getRun(runId)!;
    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      scopeRoot,
      scopeId: "test-scope",
      runState,
      runCoordinator,
      runStore,
      daemonEpoch,
      workflows: [definition],
    });
    runtime.reloadWorkflowDefinitions();

    const outcome = runtime.finalizeTerminalOutcome(run, {
      kind: "terminal",
      state: "succeeded",
    });

    expect(outcome.resultStatus).toBe("success");
    expect(runStore.getRun(runId, {
      authorityCritical: true,
      operationallyActive: false,
    }).status).toBe(
      "success",
    );
    expect(runState.getRun(runId)?.state).toBe("running");

    runState.finishRun(
      runId,
      daemonEpoch,
      outcome.state,
      "2026-09-02T00:01:00.000Z",
      outcome.error,
      outcome.publication,
      outcome.resultStatus,
    );
    expect(runState.getRun(runId)?.state).toBe("succeeded");
  });
});
