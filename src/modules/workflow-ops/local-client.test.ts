import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import {
  ABORT_SIGNAL_FILE,
  RELOAD_SIGNAL_FILE,
} from "#core/workflow/runtime.js";
import {
  ScopeRuntimeStateStore,
} from "#core/workflow/scope-runtime-state.js";
import {
  buildLocalWorkflowHandler as buildHandler,
  makeWorkflowOpsScopeRoot,
} from "./local-client-test-helpers.js";

describe("workflow-ops localClient — daemon-down behavior", () => {
  let scopeRoot: string;

  beforeEach(() => {
    scopeRoot = makeWorkflowOpsScopeRoot();
    const runState = new RunStateDatabase(join(scopeRoot, ".kota"));
    runState.registerScope({
      id: deriveDirectoryScopeId(scopeRoot),
      rootPath: scopeRoot,
      createdAt: "2026-08-26T00:00:00.000Z",
    });
    runState.close();
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("pause persists canonical state and is idempotent", async () => {
    const handler = buildHandler(scopeRoot);
    const first = await handler.pause();
    expect(first).toEqual({ paused: true, already: false });
    const database = RunStateDatabase.openReadOnly(join(scopeRoot, ".kota"));
    expect(
      new ScopeRuntimeStateStore(database, deriveDirectoryScopeId(scopeRoot))
        .getDispatchPaused(),
    ).toBe(true);
    database.close();
    const second = await handler.pause();
    expect(second).toEqual({ paused: true, already: true });
  });

  it("resume clears canonical state and is idempotent", async () => {
    const handler = buildHandler(scopeRoot);
    await handler.pause();
    const first = await handler.resume();
    expect(first).toEqual({ paused: false, already: false });
    const database = RunStateDatabase.openReadOnly(join(scopeRoot, ".kota"));
    expect(
      new ScopeRuntimeStateStore(database, deriveDirectoryScopeId(scopeRoot))
        .getDispatchPaused(),
    ).toBe(false);
    database.close();
    const second = await handler.resume();
    expect(second).toEqual({ paused: false, already: true });
  });

  it("clears agent backoff only for an explicit retry", async () => {
    const runState = new RunStateDatabase(join(scopeRoot, ".kota"));
    const scopeId = deriveDirectoryScopeId(scopeRoot);
    runState.registerScope({
      id: scopeId,
      rootPath: scopeRoot,
      createdAt: new Date().toISOString(),
    });
    const state = new ScopeRuntimeStateStore(runState, scopeId);
    state.setAgentBackoff({
      runtimeId: "antigravity-cli:antigravity-cli",
      kind: "auth",
      failureCount: 1,
      until: "2026-08-04T15:00:00.000Z",
      updatedAt: "2026-08-04T14:00:00.000Z",
      reason: "login was unavailable",
    });

    const handler = buildHandler(scopeRoot);
    await expect(handler.resume()).resolves.toEqual({
      paused: false,
      already: true,
    });
    expect(state.getAgentBackoff()).not.toBeNull();

    await expect(handler.resume({ retryAgent: true })).resolves.toEqual({
      paused: false,
      already: true,
      agentBackoffCleared: true,
    });
    expect(state.getAgentBackoff()).toBeNull();
    runState.close();
  });

  it("abort with no active runs writes no signal and reports zero", async () => {
    const handler = buildHandler(scopeRoot);
    const result = await handler.abort();
    expect(result).toEqual({ status: "signaled", runs: [] });
    expect(existsSync(join(scopeRoot, ".kota", ABORT_SIGNAL_FILE))).toBe(false);
  });

  it("abort with active runs writes the signal and lists them", async () => {
    const runState = new RunStateDatabase(join(scopeRoot, ".kota"));
    try {
      const scopeId = deriveDirectoryScopeId(scopeRoot);
      runState.registerScope({
        id: scopeId,
        rootPath: scopeRoot,
        createdAt: "2026-04-25T00:00:00.000Z",
      });
      const { epoch } = runState.beginDaemonSession("2026-04-25T00:00:00.000Z");
      for (const [id, workflow, startedAt] of [
        ["run-1", "builder", "2026-04-25T00:00:00.000Z"],
        ["run-2", "improver", "2026-04-25T00:00:01.000Z"],
      ] as const) {
        runState.admitRun({
          id,
          scopeId,
          workflow,
          repository: "read",
          trigger: { event: "manual", schemaRef: null, payload: {} },
          resources: [],
          admittedAt: startedAt,
        });
        runState.startRun(id, epoch, startedAt);
      }

      const handler = buildHandler(scopeRoot);
      const result = await handler.abort();
      expect(result.status).toBe("signaled");
      if (result.status !== "signaled") throw new Error("unreachable");
      expect(result.runs).toEqual([
        { runId: "run-1", workflow: "builder" },
        { runId: "run-2", workflow: "improver" },
      ]);
      expect(existsSync(join(scopeRoot, ".kota", ABORT_SIGNAL_FILE))).toBe(true);
    } finally {
      runState.close();
    }
  });

  it("reload writes the signal file", async () => {
    const handler = buildHandler(scopeRoot);
    const result = await handler.reload();
    expect(result).toEqual({ status: "signaled" });
    expect(existsSync(join(scopeRoot, ".kota", RELOAD_SIGNAL_FILE))).toBe(true);
  });

  it("status reflects durable pause and the pending abort signal", async () => {
    const handler = buildHandler(scopeRoot);
    let snapshot = await handler.status();
    expect(snapshot.paused).toBe(false);
    expect(snapshot.pendingAbort).toBe(false);
    expect(snapshot.activeRuns).toEqual([]);
    expect(snapshot.pendingRuns).toEqual([]);
    expect(snapshot.queueLength).toBe(0);
    expect(snapshot.concurrency).toBe(4);

    const database = RunStateDatabase.openExisting(join(scopeRoot, ".kota"));
    new ScopeRuntimeStateStore(database, deriveDirectoryScopeId(scopeRoot))
      .setDispatchPaused(true);
    database.close();
    writeFileSync(join(scopeRoot, ".kota", ABORT_SIGNAL_FILE), "");
    snapshot = await handler.status();
    expect(snapshot.paused).toBe(true);
    expect(snapshot.pendingAbort).toBe(true);
  });

  it("enable / disable / cancelRun / abortRun surface daemon_required", async () => {
    const handler = buildHandler(scopeRoot);
    expect(await handler.enable("builder")).toEqual({ ok: false, reason: "daemon_required" });
    expect(await handler.disable("builder")).toEqual({ ok: false, reason: "daemon_required" });
    expect(await handler.cancelRun("run-1")).toEqual({ ok: false, reason: "daemon_required" });
    expect(await handler.abortRun("run-1")).toEqual({ ok: false, reason: "daemon_required" });
    expect(typeof handler.trial).toBe("function");
    expect(typeof handler.explain).toBe("function");
  });

  it("getRun returns artifact metadata projected onto the redacted WorkflowRunDetail", async () => {
    const store = new WorkflowRunStore(scopeRoot);
    mkdirSync(join(store.runsDir, "2026-04-25T20-00-00-000Z-builder-aaa111"), {
      recursive: true,
    });
    const metadata = {
      id: "2026-04-25T20-00-00-000Z-builder-aaa111",
      workflow: "builder",
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      trigger: {
        event: "manual",
        schemaRef: null,
        payload: {
          source: "test",
          accessToken: "raw-token",
          nested: { authorization: "Bearer raw-auth" },
        },
      },
      startedAt: "2026-04-25T20:00:00.000Z",
      completedAt: "2026-04-25T20:00:01.000Z",
      durationMs: 1000,
      usage: {
        tokens: { state: "complete", inputTokens: 100, outputTokens: 20 },
        cost: { state: "complete", usd: 0.012 },
      },
      status: "failed",
      runDir: ".kota/runs/2026-04-25T20-00-00-000Z-builder-aaa111",
      steps: [
        {
          id: "build",
          type: "agent",
          status: "failed",
          startedAt: "2026-04-25T20:00:00.000Z",
          completedAt: "2026-04-25T20:00:01.000Z",
          durationMs: 800,
          usage: {
            tokens: { state: "complete", inputTokens: 100, outputTokens: 20 },
            cost: { state: "complete", usd: 0.012 },
          },
          error: "failed with token=step-token",
        },
      ],
      warnings: [{ type: "output-schema-mismatch", message: "email owner@example.test" }],
    };
    writeFileSync(
      join(store.runsDir, "2026-04-25T20-00-00-000Z-builder-aaa111", "metadata.json"),
      JSON.stringify(metadata),
    );
    const handler = buildHandler(scopeRoot);
    const result = await handler.getRun(
      "2026-04-25T20-00-00-000Z-builder-aaa111",
    );
    expect(result.found).toBe(true);
    if (!result.found) throw new Error("unreachable");
    expect(result.run.id).toBe("2026-04-25T20-00-00-000Z-builder-aaa111");
    expect(result.run.workflow).toBe("builder");
    expect(result.run.status).toBe("failed");
    expect(result.run.triggerEvent).toBe("manual");
    expect(result.run.triggerPayload).toEqual({
      source: "test",
      accessToken: "[redacted]",
      nested: { authorization: "[redacted]" },
    });
    expect(result.run.warnings).toEqual([
      { type: "output-schema-mismatch", message: "email [redacted]" },
    ]);
    expect(result.run.steps).toHaveLength(1);
    expect(result.run.steps[0]).toMatchObject({
      id: "build",
      type: "agent",
      status: "failed",
      durationMs: 800,
      usage: {
        tokens: { state: "complete", inputTokens: 100, outputTokens: 20 },
        cost: { state: "complete", usd: 0.012 },
      },
      error: "failed with token=[redacted]",
    });
    expect(JSON.stringify(result.run)).not.toContain("raw-token");
    expect(JSON.stringify(result.run)).not.toContain("raw-auth");
    expect(JSON.stringify(result.run)).not.toContain("step-token");
    expect(JSON.stringify(result.run)).not.toContain("owner@example.test");
  });

  it("getRun returns { found: false } for an unknown run id", async () => {
    const handler = buildHandler(scopeRoot);
    const result = await handler.getRun(
      "2026-04-25T00-00-00-000Z-builder-zzz999",
    );
    expect(result.found).toBe(false);
  });

});
