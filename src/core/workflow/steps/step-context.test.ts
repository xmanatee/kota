import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AgentHarness, UNKNOWN_AGENT_USAGE } from "#core/agent-harness/index.js";
import type { BusEnvelope } from "#core/events/event-bus.js";
import { EventBus } from "#core/events/event-bus.js";
import { EventJournal } from "#core/events/event-journal.js";
import {
  defineDaemonWideModuleEvent,
  initModuleEventRegistry,
  resetModuleEventRegistry,
} from "#core/events/module-event.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { deregisterTool, registerTool } from "#core/tools/index.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";
import { EMITTED_EVENTS_LOG_FILENAME } from "../run-event-evidence.js";
import { WorkflowRunStore } from "../run-store.js";
import type { WorkflowRunMetadata, WorkflowRunToolRunner } from "../run-types.js";
import { unexpectedWorkflowAgentHarnessRun } from "../testing/agent-harness-runner.js";
import { createTestTransactionalRunState } from "../testing/run-context-fixture.js";
import type { WorkflowRunTrigger } from "../trigger-types.js";
import { createStepContext } from "./step-context.js";
import { createWorkflowAgentHarnessRunner } from "./workflow-agent-harness-runner.js";

function tempScope(): string {
  const dir = join(
    tmpdir(),
    `kota-step-context-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeMetadata(): WorkflowRunMetadata {
  return {
    id: "run-1",
    workflow: "repo-ai-checks",
    definitionPath: "workflow.ts",
    trigger: { event: "manual", schemaRef: null, payload: {} },
    startedAt: "2026-06-04T00:00:00.000Z",
    status: "running",
    runDir: ".kota/runs/run-1",
    steps: [],
  };
}

const trigger: WorkflowRunTrigger = {
  event: "manual",
  schemaRef: null,
  payload: {},
};

afterEach(() => {
  resetModuleEventRegistry();
});

describe("createStepContext", () => {
  it.each(["registered", "injected"])("returns tool failures while preserving fatal errors and cancellation with the %s runner", async (runnerKind) => {
    const workspaceRoot = tempScope();
    const toolName = "step_context_failure_fixture";
    const failure = { content: "Source unavailable", is_error: true };
    const cancelled = new AbortController();
    const runTool = vi.fn<WorkflowRunToolRunner>(async (_name, _input, context) => {
      if (context?.signal?.aborted) throw context.signal.reason;
      return failure;
    });
    registerTool({ name: toolName, description: "Failure fixture", input_schema: { type: "object", properties: {} } },
      (input, context) => runTool(toolName, input, context ? { ...context, stepId: "inspect" } : undefined));
    try {
      const bus = new EventBus();
      const context = createStepContext(makeMetadata(), trigger, undefined, {}, {}, [], {
        readRuntimeState: readEmptyTestWorkflowRuntimeState,
        workspaceRoot, scopeRoot: workspaceRoot, bus, pbus: new ScopedEventBus(bus, "scope-a"),
        store: new WorkflowRunStore(workspaceRoot),
        runAgentHarness: unexpectedWorkflowAgentHarnessRun,
        ...(runnerKind === "injected" ? { runTool } : {}),
      });
      await expect(context.runTool(toolName, {})).resolves.toEqual(failure);
      if (runnerKind === "injected") {
        const fatal = new Error("Runtime effect store unavailable");
        runTool.mockRejectedValueOnce(fatal);
        await expect(context.runTool(toolName, {})).rejects.toBe(fatal);
      }
      const reason = new Error("Workflow cancelled");
      runTool.mockImplementationOnce(async (_name, _input, callContext) => {
        cancelled.abort(reason);
        expect(callContext?.signal?.aborted).toBe(true);
        return failure;
      });
      await expect(context.runTool(toolName, {}, { stepId: "inspect", signal: cancelled.signal })).rejects.toBe(reason);
      runTool.mockClear();
      await expect(context.runTool(toolName, {}, { stepId: "inspect", signal: cancelled.signal })).rejects.toBe(reason);
      expect(runTool).not.toHaveBeenCalled();
    } finally {
      deregisterTool(toolName);
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "registers command processes with the run-owned registry",
    async () => {
      const workspaceRoot = tempScope();
      try {
        const bus = new EventBus();
        const pbus = new ScopedEventBus(bus, "scope-a");
        const store = new WorkflowRunStore(workspaceRoot);
        const register = vi.fn();

        const context = createStepContext(
          makeMetadata(),
          trigger,
          undefined,
          {},
          {},
          [],
          {
            readRuntimeState: readEmptyTestWorkflowRuntimeState,
            workspaceRoot,
            scopeRoot: workspaceRoot,
            bus,
            pbus,
            store,
            runContext: {
              runtimeStateDir: join(workspaceRoot, "daemon-state"),
              sandbox: { repository: "read" },
              signal: new AbortController().signal,
              processes: { register },
              effects: { execute: (input) => input.execute() },
              publications: { stageEmit: () => {} },
              state: createTestTransactionalRunState(join(workspaceRoot, ".kota", "test-state")),
            },
            runAgentHarness: unexpectedWorkflowAgentHarnessRun,
          },
        );

        expect(context.runtimeStateDir).toBe(join(workspaceRoot, "daemon-state"));
        expect(context.stateDir).toBe(store.rootDir);
        const result = await context.runCommand({
          command: process.execPath,
          args: ["-e", "process.stdout.write('registered')"],
        });

        expect(result.stdout.text).toBe("registered");
        expect(register).toHaveBeenCalledOnce();
        expect(register).toHaveBeenCalledWith(result.identity);
      } finally {
        rmSync(workspaceRoot, { recursive: true, force: true });
      }
    },
  );

  it("stages every writer code-step event until integration succeeds", () => {
    const workspaceRoot = tempScope();
    try {
      const event = defineDaemonWideModuleEvent<{ value: number }>(
        "step-context.writer.completed",
        ["value"],
        {
          payloadSchema: {
            type: "object",
            properties: { value: { type: "number" } },
            additionalProperties: false,
          },
        },
      );
      initModuleEventRegistry().register("step-context-test", event);
      const bus = new EventBus();
      const pbus = new ScopedEventBus(bus, "scope-a");
      const store = new WorkflowRunStore(workspaceRoot);
      const stageEmit = vi.fn();
      const observed = vi.fn();
      bus.on("*", observed);

      const context = createStepContext(
        makeMetadata(),
        trigger,
        undefined,
        {},
        {},
        [],
        {
          readRuntimeState: readEmptyTestWorkflowRuntimeState,
          workspaceRoot,
          scopeRoot: workspaceRoot,
          bus,
          pbus,
          store,
          currentStepId: "mutate",
          runContext: {
            runtimeStateDir: store.rootDir,
            sandbox: { repository: "write" },
            signal: new AbortController().signal,
            processes: { register: () => undefined },
            effects: { execute: (input) => input.execute() },
            publications: { stageEmit },
            state: createTestTransactionalRunState(join(workspaceRoot, ".kota", "test-state")),
          },
          runAgentHarness: unexpectedWorkflowAgentHarnessRun,
        },
      );

      context.emit(event.name, { value: 1 });
      context.emit(event.name, { value: 2 });

      expect(observed).not.toHaveBeenCalled();
      expect(stageEmit.mock.calls).toEqual([
        ["mutate:emit:0", event.name, { value: 1 }],
        ["mutate:emit:1", event.name, { value: 2 }],
      ]);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("separates the canonical scope root from the workflow workspace", async () => {
    const workspaceRoot = tempScope();
    try {
      const workspaceDir = join(workspaceRoot, ".worktrees", "run-1");
      mkdirSync(workspaceDir, { recursive: true });
      const bus = new EventBus();
      const pbus = new ScopedEventBus(bus, "scope-a");
      const store = new WorkflowRunStore(workspaceRoot);
      const eventJournal = new EventJournal(
        join(workspaceRoot, "daemon-state", "events"),
      );
      const runTool = vi.fn(async () => ({ content: "ok" }));
      const authorityConfigPath = join(workspaceRoot, "operator", "config.json");

      const context = createStepContext(
        makeMetadata(),
        trigger,
        undefined,
        {},
        {},
        [],
        {
          readRuntimeState: readEmptyTestWorkflowRuntimeState,
          workspaceRoot: workspaceDir,
          scopeRoot: workspaceRoot,
          bus,
          pbus,
          store,
          eventJournal,
          runTool,
          authorityConfigPath,
          runAgentHarness: unexpectedWorkflowAgentHarnessRun,
          currentStepId: "build",
        },
      );

      await context.runTool(
        "composition.workspace",
        { action: "list" },
        { stepId: "build", sessionId: "workflow-session" },
      );

      expect(context.stateDir).toBe(store.rootDir);
      expect(context.runtimeStateDir).toBe(store.rootDir);

      expect(runTool).toHaveBeenCalledWith(
        "composition.workspace",
        { action: "list" },
        {
          authorityConfigPath,
          scopeRoot: workspaceRoot,
          cwd: workspaceDir,
          signal: expect.any(AbortSignal),
          sessionId: "workflow-session",
          stepId: "build",
          scopeId: "scope-a",
          workflow: {
            workflowName: "repo-ai-checks",
            runId: "run-1",
            stepId: "build",
            spanId: "run-1:build",
            scopeId: "scope-a",
          },
        },
      );
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("emits registered daemon-wide dynamic events without injecting scope fields", () => {
    const workspaceRoot = tempScope();
    try {
      const event = defineDaemonWideModuleEvent<{ repo: string }>(
        "step-context.daemon.completed",
        ["repo"],
        {
          payloadSchema: {
            type: "object",
            properties: { repo: { type: "string" } },
            additionalProperties: false,
          },
        },
      );
      initModuleEventRegistry().register("step-context-test", event);

      const bus = new EventBus();
      const pbus = new ScopedEventBus(bus, "scope-a");
      const store = new WorkflowRunStore(workspaceRoot);
      const wildcard = vi.fn();
      bus.on("*", wildcard);

      const context = createStepContext(
        makeMetadata(),
        trigger,
        undefined,
        {},
        {},
        [],
        {
          readRuntimeState: readEmptyTestWorkflowRuntimeState,
          workspaceRoot,
          scopeRoot: workspaceRoot,
          bus,
          pbus,
          store,
          runAgentHarness: unexpectedWorkflowAgentHarnessRun,
        },
      );

      context.emit(event.name, { repo: "owner/repo" });

      expect(wildcard).toHaveBeenCalledWith({
        type: event.name,
        schemaRef: { name: event.name, version: 1 },
        payload: { repo: "owner/repo" },
      } satisfies BusEnvelope);
      const logPath = join(
        workspaceRoot,
        ".kota/runs/run-1",
        EMITTED_EVENTS_LOG_FILENAME,
      );
      const logged = JSON.parse(readFileSync(logPath, "utf8").trim()) as {
        event: string;
        schemaRef: BusEnvelope["schemaRef"];
        payload: Record<string, unknown>;
      };
      expect(logged.event).toBe(event.name);
      expect(logged.schemaRef).toEqual({ name: event.name, version: 1 });
      expect(logged.payload).toEqual({ repo: "owner/repo" });
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

it("restores nested judge identity after context replacement while separating runs and roles", async () => {
  const root = tempScope();
  const received: Array<string | undefined> = [];
  const harness: AgentHarness = {
    name: "judge-session-port", description: "Controlled provider identity port",
    supportedHookKinds: [], supportsMultiTurn: true, toolControl: "kota",
    emitsAgentMessageStream: false, askOwnerToolName: null,
    async run(options) {
      received.push(options.resumeSessionId);
      const sessionId = options.resumeSessionId ?? `provider-${received.length}`;
      options.onSessionId?.(sessionId);
      if (received.length === 1) throw new Error("provider interrupted before result");
      return { text: "reviewed", streamedText: "", turns: 1, usage: UNKNOWN_AGENT_USAGE, isError: false, sessionId };
    },
  };
  const context = (id = "run-1", step = "critic") => {
    const bus = new EventBus();
    return createStepContext({ ...makeMetadata(), id, runDir: `.kota/runs/${id}` }, trigger, undefined, {}, {}, [], {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      workspaceRoot: root, scopeRoot: root, bus, pbus: new ScopedEventBus(bus, "scope-a"),
      store: new WorkflowRunStore(root), currentStepId: step,
      runAgentHarness: createWorkflowAgentHarnessRunner(),
    });
  };
  try {
    const options = { cwd: root, prompt: "review this work", effort: "high" as const };
    await expect(context().runAgentHarness(harness, options)).rejects.toThrow("provider interrupted");
    await context().runAgentHarness(harness, options);
    await context("other-run").runAgentHarness(harness, options);
    await context("run-1", "independent-critic").runAgentHarness(harness, options);
    expect(received).toEqual([undefined, "provider-1", undefined, undefined]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
