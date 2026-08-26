import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import {
  localWriteEffect,
  readOnlyLocalEffect,
  type ToolEffect,
} from "#core/tools/effect.js";
import {
  deregisterTool,
  registerTool,
  type ToolResult,
} from "#core/tools/index.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";
import { runChecksPhased } from "./repair-loop-checks.js";
import {
  createRunContext,
  fingerprintToolEffectRequest,
  type RunContext,
} from "./run-context.js";
import { RunLifecycle } from "./run-lifecycle.js";
import { RunStateDatabase } from "./run-state-database.js";
import type { StoredRun } from "./run-state-types.js";
import { WorkflowRunStore } from "./run-store.js";
import type {
  WorkflowRunMetadata,
  WorkflowRunToolRunner,
  WorkflowStepContext,
} from "./run-types.js";
import type { WorkflowAgentStep, WorkflowToolStep } from "./step-types.js";
import { createStepContext } from "./steps/step-context.js";
import { executeToolStep } from "./steps/step-executor.js";
import { unexpectedWorkflowAgentHarnessRun } from "./testing/agent-harness-runner.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";

type Fixture = {
  root: string;
  runId: string;
  state: RunStateDatabase;
  run: StoredRun;
  runContext: RunContext;
  context: WorkflowStepContext;
};

const fixtures: Fixture[] = [];
const registeredTools = new Set<string>();
let fixtureSequence = 0;

const trigger: WorkflowRunTrigger = {
  event: "manual",
  schemaRef: null,
  payload: {},
};

function registerEffectTool(name: string, effect: ToolEffect): void {
  registerTool(
    {
      name,
      description: `${name} effect fixture`,
      input_schema: { type: "object", properties: {} },
    },
    async () => ({ content: "unused registry runner" }),
    "run-tool-effect-recovery-test",
    { effect },
  );
  registeredTools.add(name);
}

function createStoredRun(root: string, state: RunStateDatabase, runId: string): StoredRun {
  const scopeId = `scope-${runId}`;
  state.registerScope({
    id: scopeId,
    rootPath: root,
    createdAt: "2026-08-25T10:00:00.000Z",
  });
  const { epoch } = state.beginDaemonSession("2026-08-25T10:00:01.000Z");
  state.admitRun({
    id: runId,
    scopeId,
    workflow: "tool-effects",
    repository: "none",
    trigger,
    resources: [],
    admittedAt: "2026-08-25T10:00:02.000Z",
  });
  state.startRun(runId, epoch, "2026-08-25T10:00:03.000Z");
  return state.getRun(runId)!;
}

function fixture(runTool: WorkflowRunToolRunner): Fixture {
  fixtureSequence += 1;
  const root = mkdtempSync(join(tmpdir(), "kota-tool-effect-"));
  const runId = `run-${fixtureSequence}`;
  const state = new RunStateDatabase(join(root, ".kota", "state"));
  const run = createStoredRun(root, state, runId);
  const runRoot = join(root, ".kota", "runtime", runId);
  const workspaceDir = join(runRoot, "workspace");
  const tempDir = join(runRoot, "temp");
  const artifactDir = join(runRoot, "artifacts");
  const agentDir = join(runRoot, "agent");
  const packageCacheDir = join(tempDir, "package-cache");
  for (const path of [workspaceDir, tempDir, artifactDir, agentDir, packageCacheDir]) {
    mkdirSync(path, { recursive: true });
  }
  const runContext = createRunContext({
    runId,
    attempt: run.attempt,
    daemonEpoch: 1,
    scopeId: run.scopeId,
    scopeRoot: root,
    workflow: run.workflow,
    trigger,
    sandbox: {
      runId,
      repository: "none",
      rootDir: runRoot,
      workspaceDir,
      tempDir,
      artifactDir,
    },
    resources: {
      runId,
      attempt: run.attempt,
      daemonEpoch: 1,
      workspaceDir,
      runDir: runRoot,
      tempDir,
      artifactDir,
      agentDir,
      packageCacheDir,
      ports: { start: 45_000, end: 45_000, size: 1, values: [45_000] },
      env: {},
    },
    signal: new AbortController().signal,
    store: state,
    now: () => "2026-08-25T10:00:04.000Z",
  });
  const metadata: WorkflowRunMetadata = {
    id: runId,
    workflow: run.workflow,
    definitionPath: "tool-effects.workflow.ts",
    trigger,
    startedAt: "2026-08-25T10:00:03.000Z",
    status: "running",
    runDir: `.kota/runs/${runId}`,
    steps: [],
  };
  const bus = new EventBus();
  const context = createStepContext(metadata, trigger, undefined, {}, {}, [], {
    readRuntimeState: readEmptyTestWorkflowRuntimeState,
    workspaceRoot: workspaceDir,
    scopeRoot: root,
    bus,
    pbus: new ScopedEventBus(bus, run.scopeId),
    store: new WorkflowRunStore(root),
    runContext,
    runTool,
    runAgentHarness: unexpectedWorkflowAgentHarnessRun,
  });
  const value = { root, runId, state, run, runContext, context };
  fixtures.push(value);
  return value;
}

function step(id: string, tool: string, input: Record<string, unknown>): WorkflowToolStep {
  return { id, type: "tool", tool, input };
}

afterEach(() => {
  for (const name of registeredTools) deregisterTool(name);
  registeredTools.clear();
  for (const value of fixtures.splice(0)) {
    value.state.close();
    rmSync(value.root, { recursive: true, force: true });
  }
});

describe("declarative workflow tool effects", () => {
  it("executes read effects on every replay without journaling them", async () => {
    const tool = `effect_read_${fixtureSequence + 1}`;
    registerEffectTool(tool, readOnlyLocalEffect());
    const runTool = vi.fn(async (): Promise<ToolResult> => ({ content: "fresh" }));
    const value = fixture(runTool);
    const workflowStep = step("read", tool, { query: "status" });

    expect(await executeToolStep(workflowStep, value.context)).toEqual({ content: "fresh" });
    expect(await executeToolStep(workflowStep, value.context)).toEqual({ content: "fresh" });

    expect(runTool).toHaveBeenCalledTimes(2);
    expect(value.state.getExternalEffect(`${value.runId}:tool-step:read`)).toBeNull();
  });

  it("reuses the durable JSON result of a completed non-idempotent write", async () => {
    const tool = `effect_write_${fixtureSequence + 1}`;
    registerEffectTool(tool, localWriteEffect());
    const result: ToolResult = {
      content: "created",
      structuredContent: { id: 42 },
      _meta: { source: "fixture" },
    };
    const runTool = vi.fn(async () => result);
    const value = fixture(runTool);
    const workflowStep = step("create", tool, { name: "artifact" });

    expect(await executeToolStep(workflowStep, value.context)).toEqual(result);
    expect(await executeToolStep(workflowStep, value.context)).toEqual(result);

    expect(runTool).toHaveBeenCalledOnce();
    expect(value.state.getExternalEffect(`${value.runId}:tool-step:create`)).toMatchObject({
      state: "completed",
      result,
    });
  });

  it("executes provider-idempotent writes normally without journaling them", async () => {
    const tool = `effect_idempotent_write_${fixtureSequence + 1}`;
    registerEffectTool(tool, localWriteEffect({ idempotent: true }));
    const runTool = vi.fn(async (): Promise<ToolResult> => ({ content: "upserted" }));
    const value = fixture(runTool);
    const workflowStep = step("upsert", tool, { name: "artifact" });

    await executeToolStep(workflowStep, value.context);
    await executeToolStep(workflowStep, value.context);

    expect(runTool).toHaveBeenCalledTimes(2);
    expect(value.state.getExternalEffect(`${value.runId}:tool-step:upsert`)).toBeNull();
  });

  it.each(["prepared", "unknown"] as const)(
    "treats a %s write as ambiguous without re-executing it",
    async (state) => {
      const tool = `effect_ambiguous_${state}_${fixtureSequence + 1}`;
      registerEffectTool(tool, localWriteEffect());
      const runTool = vi.fn(async (): Promise<ToolResult> => ({ content: "duplicated" }));
      const value = fixture(runTool);
      const input = { alpha: 1, nested: { beta: true } };
      const workflowStep = step("publish", tool, input);
      const effectKey = `${value.runId}:tool-step:publish`;
      value.state.prepareExternalEffect({
        key: effectKey,
        runId: value.runId,
        requestFingerprint: fingerprintToolEffectRequest(tool, input),
        preparedAt: "2026-08-25T10:00:05.000Z",
      });
      if (state === "unknown") value.state.markExternalEffectUnknown(effectKey, value.runId);

      await expect(executeToolStep(workflowStep, value.context)).rejects.toEqual(
        expect.objectContaining({
          name: "AmbiguousExternalEffectError",
          effectKey,
        }),
      );
      expect(runTool).not.toHaveBeenCalled();
    },
  );

  it("rejects the same effect identity when its canonical request changes", async () => {
    const tool = `effect_changed_${fixtureSequence + 1}`;
    registerEffectTool(tool, localWriteEffect());
    const runTool = vi.fn(async (): Promise<ToolResult> => ({ content: "created" }));
    const value = fixture(runTool);

    await executeToolStep(step("create", tool, { a: 1, b: { c: 2 } }), value.context);
    await executeToolStep(step("create", tool, { b: { c: 2 }, a: 1 }), value.context);
    await expect(
      executeToolStep(step("create", tool, { b: { c: 3 }, a: 1 }), value.context),
    ).rejects.toThrow(/reused with a different request/);

    expect(runTool).toHaveBeenCalledOnce();
  });

  it("maps an ambiguous declarative write to needs_attention at the run boundary", async () => {
    const tool = `effect_attention_${fixtureSequence + 1}`;
    registerEffectTool(tool, localWriteEffect());
    const runTool = vi.fn(async (): Promise<ToolResult> => ({ content: "duplicated" }));
    const value = fixture(runTool);
    const input = { publication: "release" };
    const effectKey = `${value.runId}:tool-step:publish`;
    value.state.prepareExternalEffect({
      key: effectKey,
      runId: value.runId,
      requestFingerprint: fingerprintToolEffectRequest(tool, input),
      preparedAt: "2026-08-25T10:00:05.000Z",
    });
    const lifecycle = new RunLifecycle({
      store: value.state,
      daemonEpoch: 1,
      executeWorkflow: async (runContext) => {
        const metadata: WorkflowRunMetadata = {
          id: value.runId,
          workflow: value.run.workflow,
          definitionPath: "tool-effects.workflow.ts",
          trigger,
          startedAt: "2026-08-25T10:00:03.000Z",
          status: "running",
          runDir: `.kota/runs/${value.runId}`,
          steps: [],
        };
        const bus = new EventBus();
        const context = createStepContext(metadata, trigger, undefined, {}, {}, [], {
          readRuntimeState: readEmptyTestWorkflowRuntimeState,
          workspaceRoot: runContext.sandbox.workspaceDir,
          scopeRoot: value.root,
          bus,
          pbus: new ScopedEventBus(bus, value.run.scopeId),
          store: new WorkflowRunStore(value.root),
          runContext,
          runTool,
          runAgentHarness: unexpectedWorkflowAgentHarnessRun,
        });
        await executeToolStep(step("publish", tool, input), context);
        return { kind: "completed" };
      },
      validate: async () => ({ status: "passed", evidence: [] }),
      continueIntegration: async () => undefined,
    });

    await expect(
      lifecycle.execute(value.state.getRun(value.runId)!, new AbortController().signal),
    ).resolves.toMatchObject({
      kind: "suspended",
      state: "needs_attention",
      wait: { reason: "external-effect-ambiguous", evidence: [effectKey] },
    });
    expect(runTool).not.toHaveBeenCalled();
  });

  it("allows read-only repair checks and rejects mutating repair checks before execution", async () => {
    const readTool = `effect_repair_read_${fixtureSequence + 1}`;
    const writeTool = `effect_repair_write_${fixtureSequence + 1}`;
    registerEffectTool(readTool, readOnlyLocalEffect());
    registerEffectTool(writeTool, localWriteEffect());
    const runTool = vi.fn(async (): Promise<ToolResult> => ({ content: "verified" }));
    const value = fixture(runTool);
    const parentStep = { id: "repair-owner", type: "agent" } as WorkflowAgentStep;

    await expect(
      runChecksPhased(
        [{ id: "read-check", type: "tool", tool: readTool }],
        value.context,
        parentStep,
      ),
    ).resolves.toEqual({ failures: [], warnings: [] });
    const mutation = await runChecksPhased(
      [{ id: "write-check", type: "tool", tool: writeTool }],
      value.context,
      parentStep,
    );

    expect(mutation.failures).toEqual([
      expect.objectContaining({
        id: "write-check",
        output: expect.stringContaining("must resolve to a read-only tool effect"),
      }),
    ]);
    expect(runTool).toHaveBeenCalledOnce();
  });
});
