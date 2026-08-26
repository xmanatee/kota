import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BusEnvelope } from "#core/events/event-bus.js";
import { EventBus } from "#core/events/event-bus.js";
import {
  defineDaemonWideModuleEvent,
  initModuleEventRegistry,
  resetModuleEventRegistry,
} from "#core/events/module-event.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { EMITTED_EVENTS_LOG_FILENAME } from "../run-event-evidence.js";
import { WorkflowRunStore } from "../run-store.js";
import type { WorkflowRunMetadata } from "../run-types.js";
import { unexpectedWorkflowAgentHarnessRun } from "../testing/agent-harness-runner.js";
import { createTestTransactionalRunState } from "../testing/run-context-fixture.js";
import type { WorkflowRunTrigger } from "../trigger-types.js";
import { createStepContext } from "./step-context.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";

function tempProject(): string {
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
  it.skipIf(process.platform === "win32")(
    "registers command processes with the run-owned registry",
    async () => {
      const projectDir = tempProject();
      try {
        const bus = new EventBus();
        const pbus = new ProjectScopedEventBus(bus, "scope-a");
        const store = new WorkflowRunStore(projectDir);
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
            projectDir,
            scopeDir: projectDir,
            bus,
            pbus,
            store,
            runContext: {
              sandbox: { repository: "read" },
              signal: new AbortController().signal,
              processes: { register },
              effects: { execute: (input) => input.execute() },
              publications: { stageEmit: () => {} },
              state: createTestTransactionalRunState(),
            },
            runAgentHarness: unexpectedWorkflowAgentHarnessRun,
          },
        );

        const result = await context.runCommand({
          command: process.execPath,
          args: ["-e", "process.stdout.write('registered')"],
        });

        expect(result.stdout.text).toBe("registered");
        expect(register).toHaveBeenCalledOnce();
        expect(register).toHaveBeenCalledWith(result.identity);
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
      }
    },
  );

  it("stages every writer code-step event until integration succeeds", () => {
    const projectDir = tempProject();
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
      const pbus = new ProjectScopedEventBus(bus, "scope-a");
      const store = new WorkflowRunStore(projectDir);
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
          projectDir,
          scopeDir: projectDir,
          bus,
          pbus,
          store,
          currentStepId: "mutate",
          runContext: {
            sandbox: { repository: "write" },
            signal: new AbortController().signal,
            processes: { register: () => undefined },
            effects: { execute: (input) => input.execute() },
            publications: { stageEmit },
            state: createTestTransactionalRunState(),
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
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("separates the canonical project root from the workflow workspace", async () => {
    const projectDir = tempProject();
    try {
      const workspaceDir = join(projectDir, ".worktrees", "run-1");
      mkdirSync(workspaceDir, { recursive: true });
      const bus = new EventBus();
      const pbus = new ProjectScopedEventBus(bus, "scope-a");
      const store = new WorkflowRunStore(projectDir);
      const runTool = vi.fn(async () => ({ content: "ok" }));
      const authorityConfigPath = join(projectDir, "operator", "config.json");

      const context = createStepContext(
        makeMetadata(),
        trigger,
        undefined,
        {},
        {},
        [],
        {
          readRuntimeState: readEmptyTestWorkflowRuntimeState,
          projectDir: workspaceDir,
          scopeDir: projectDir,
          bus,
          pbus,
          store,
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

      expect(runTool).toHaveBeenCalledWith(
        "composition.workspace",
        { action: "list" },
        {
          authorityConfigPath,
          projectDir,
          cwd: workspaceDir,
          sessionId: "workflow-session",
          stepId: "build",
          scopeId: "scope-a",
          projectId: "scope-a",
          workflow: {
            workflowName: "repo-ai-checks",
            runId: "run-1",
            stepId: "build",
            spanId: "run-1:build",
            scopeId: "scope-a",
            projectId: "scope-a",
          },
        },
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("emits registered daemon-wide dynamic events without injecting scope fields", () => {
    const projectDir = tempProject();
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
      const pbus = new ProjectScopedEventBus(bus, "scope-a");
      const store = new WorkflowRunStore(projectDir);
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
          projectDir,
          scopeDir: projectDir,
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
        projectDir,
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
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
