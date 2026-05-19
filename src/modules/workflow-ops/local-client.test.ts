import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import {
  ABORT_SIGNAL_FILE,
  PAUSE_SIGNAL_FILE,
  RELOAD_SIGNAL_FILE,
} from "#core/workflow/runtime.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import type { WorkflowClient } from "./client.js";
import workflowOpsModule from "./index.js";

function makeProjectDir(): string {
  const dir = join(
    tmpdir(),
    `kota-wf-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".kota"), { recursive: true });
  return realpathSync(dir);
}

function buildHandler(
  projectDir: string,
  overrides?: Partial<ModuleContext>,
): WorkflowClient {
  const ctx = { cwd: projectDir, ...(overrides ?? {}) } as unknown as ModuleContext;
  const handlers = workflowOpsModule.localClient!(ctx);
  if (!handlers.workflow) throw new Error("workflow handler missing");
  return handlers.workflow;
}

describe("workflow-ops localClient — daemon-down behavior", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("pause writes the signal file and is idempotent", async () => {
    const handler = buildHandler(projectDir);
    const first = await handler.pause();
    expect(first).toEqual({ paused: true, already: false });
    expect(existsSync(join(projectDir, ".kota", PAUSE_SIGNAL_FILE))).toBe(true);
    const second = await handler.pause();
    expect(second).toEqual({ paused: true, already: true });
  });

  it("resume removes the signal file and is idempotent", async () => {
    const handler = buildHandler(projectDir);
    await handler.pause();
    const first = await handler.resume();
    expect(first).toEqual({ paused: false, already: false });
    expect(existsSync(join(projectDir, ".kota", PAUSE_SIGNAL_FILE))).toBe(false);
    const second = await handler.resume();
    expect(second).toEqual({ paused: false, already: true });
  });

  it("abort with no active runs writes no signal and reports zero", async () => {
    const handler = buildHandler(projectDir);
    const result = await handler.abort();
    expect(result).toEqual({ status: "signaled", runs: [] });
    expect(existsSync(join(projectDir, ".kota", ABORT_SIGNAL_FILE))).toBe(false);
  });

  it("abort with active runs writes the signal and lists them", async () => {
    const store = new WorkflowRunStore(projectDir);
    const state = store.readState();
    state.activeRuns = [
      { runId: "run-1", workflow: "builder", startedAt: "2026-04-25T00:00:00Z" },
      { runId: "run-2", workflow: "improver", startedAt: "2026-04-25T00:00:01Z" },
    ];
    writeFileSync(
      join(projectDir, ".kota", "workflow-state.json"),
      JSON.stringify(state),
    );
    const handler = buildHandler(projectDir);
    const result = await handler.abort();
    expect(result.status).toBe("signaled");
    if (result.status !== "signaled") throw new Error("unreachable");
    expect(result.runs).toEqual([
      { runId: "run-1", workflow: "builder" },
      { runId: "run-2", workflow: "improver" },
    ]);
    expect(existsSync(join(projectDir, ".kota", ABORT_SIGNAL_FILE))).toBe(true);
  });

  it("reload writes the signal file", async () => {
    const handler = buildHandler(projectDir);
    const result = await handler.reload();
    expect(result).toEqual({ status: "signaled" });
    expect(existsSync(join(projectDir, ".kota", RELOAD_SIGNAL_FILE))).toBe(true);
  });

  it("status reflects paused and pendingAbort signal files", async () => {
    const handler = buildHandler(projectDir);
    let snapshot = await handler.status();
    expect(snapshot.paused).toBe(false);
    expect(snapshot.pendingAbort).toBe(false);
    expect(snapshot.activeRuns).toEqual([]);
    expect(snapshot.pendingRuns).toEqual([]);
    expect(snapshot.queueLength).toBe(0);
    expect(snapshot.agentConcurrency).toBe(1);
    expect(snapshot.codeConcurrency).toBe(4);

    writeFileSync(join(projectDir, ".kota", PAUSE_SIGNAL_FILE), "");
    writeFileSync(join(projectDir, ".kota", ABORT_SIGNAL_FILE), "");
    snapshot = await handler.status();
    expect(snapshot.paused).toBe(true);
    expect(snapshot.pendingAbort).toBe(true);
  });

  it("enable / disable / cancelRun / abortRun surface daemon_required", async () => {
    const handler = buildHandler(projectDir);
    expect(await handler.enable("builder")).toEqual({ ok: false, reason: "daemon_required" });
    expect(await handler.disable("builder")).toEqual({ ok: false, reason: "daemon_required" });
    expect(await handler.cancelRun("run-1")).toEqual({ ok: false, reason: "daemon_required" });
    expect(await handler.abortRun("run-1")).toEqual({ ok: false, reason: "daemon_required" });
    expect(typeof handler.trial).toBe("function");
  });

  it("getRun returns the artifact metadata projected onto WorkflowRunDetail", async () => {
    const store = new WorkflowRunStore(projectDir);
    mkdirSync(join(store.runsDir, "2026-04-25T20-00-00-000Z-builder-aaa111"), {
      recursive: true,
    });
    const metadata = {
      id: "2026-04-25T20-00-00-000Z-builder-aaa111",
      workflow: "builder",
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      trigger: { event: "manual", payload: { source: "test" } },
      startedAt: "2026-04-25T20:00:00.000Z",
      completedAt: "2026-04-25T20:00:01.000Z",
      durationMs: 1000,
      totalCostUsd: 0.012,
      status: "success",
      runDir: ".kota/runs/2026-04-25T20-00-00-000Z-builder-aaa111",
      steps: [
        {
          id: "build",
          type: "agent",
          status: "success",
          startedAt: "2026-04-25T20:00:00.000Z",
          completedAt: "2026-04-25T20:00:01.000Z",
          durationMs: 800,
          costUsd: 0.012,
        },
      ],
    };
    writeFileSync(
      join(store.runsDir, "2026-04-25T20-00-00-000Z-builder-aaa111", "metadata.json"),
      JSON.stringify(metadata),
    );
    const handler = buildHandler(projectDir);
    const result = await handler.getRun(
      "2026-04-25T20-00-00-000Z-builder-aaa111",
    );
    expect(result.found).toBe(true);
    if (!result.found) throw new Error("unreachable");
    expect(result.run.id).toBe("2026-04-25T20-00-00-000Z-builder-aaa111");
    expect(result.run.workflow).toBe("builder");
    expect(result.run.status).toBe("success");
    expect(result.run.triggerEvent).toBe("manual");
    expect(result.run.triggerPayload).toEqual({ source: "test" });
    expect(result.run.steps).toHaveLength(1);
    expect(result.run.steps[0]).toMatchObject({
      id: "build",
      type: "agent",
      status: "success",
      durationMs: 800,
      costUsd: 0.012,
    });
  });

  it("getRun returns { found: false } for an unknown run id", async () => {
    const handler = buildHandler(projectDir);
    const result = await handler.getRun(
      "2026-04-25T00-00-00-000Z-builder-zzz999",
    );
    expect(result.found).toBe(false);
  });

  it("listDefinitions resolves through ctx.resolveAgentDef-friendly definitions source", async () => {
    const definition = {
      name: "demo-watch",
      enabled: true,
      definitionPath: "ignored",
      triggers: [{ watch: ["**/*.md"], debounceMs: 750, cooldownMs: 0 }],
      steps: [
        {
          id: "noop",
          type: "code",
          run: () => undefined,
        },
      ],
    } as unknown as RegisteredWorkflowDefinitionInput;
    const handler = buildHandler(projectDir, {
      resolveAgentDef: vi.fn(),
      resolveSkillsPrompt: vi.fn(),
      config: { defaultAgentHarness: "thin" } as ModuleContext["config"],
      // The local listDefinitions handler reads from
      // `getValidatedWorkflowDefinitions(ctx)`, which iterates
      // ctx.getContributedWorkflows. Stub the contributors list.
      getContributedWorkflows: () => [definition],
    } as unknown as Partial<ModuleContext>);
    const result = await handler.listDefinitions();
    expect(result.source).toBe("static");
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0]).toMatchObject({
      name: "demo-watch",
      enabled: true,
      stepCount: 1,
    });
    expect(result.definitions[0]?.triggers).toEqual([
      { type: "watch", patterns: ["**/*.md"], debounceMs: 750 },
    ]);
  });

  it("triggerByName appends a pending run with the supplied event/runId", async () => {
    const handler = buildHandler(projectDir);
    const result = await handler.triggerByName("builder", {
      event: "workflow.replay",
      runId: "2026-04-25T21-00-00-000Z-builder-bbb222",
      payload: { replayOf: "2026-04-25T20-00-00-000Z-builder-aaa111" },
      tags: ["smoke"],
      notBeforeMs: 100,
    });
    expect(result).toEqual({
      ok: true,
      path: "queue",
      queued: "builder",
      runId: "2026-04-25T21-00-00-000Z-builder-bbb222",
    });
    const store = new WorkflowRunStore(projectDir);
    const state = store.readState();
    expect(state.pendingRuns).toHaveLength(1);
    const pending = state.pendingRuns[0]!;
    expect(pending.runId).toBe("2026-04-25T21-00-00-000Z-builder-bbb222");
    expect(pending.workflowName).toBe("builder");
    expect(pending.notBeforeMs).toBe(100);
    const trigger = pending.trigger as WorkflowRunTrigger;
    expect(trigger.event).toBe("workflow.replay");
    expect(trigger.payload).toMatchObject({
      replayOf: "2026-04-25T20-00-00-000Z-builder-aaa111",
      tags: ["smoke"],
    });
  });

  it("triggerByName surfaces already_queued when a run is already pending", async () => {
    const handler = buildHandler(projectDir);
    const first = await handler.triggerByName("builder", { payload: {} });
    expect(first.ok).toBe(true);
    const second = await handler.triggerByName("builder", { payload: {} });
    expect(second).toEqual({ ok: false, reason: "already_queued" });
  });
});
