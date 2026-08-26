import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { registerSessionEnvironmentResource } from "#core/tools/session-environment.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";
import type { RunContext } from "./run-context.js";
import { executeWorkflowRun } from "./run-executor.js";
import { WorkflowRunStore } from "./run-store.js";
import { createTestTransactionalRunState } from "./testing/run-context-fixture.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

function makeRunContext(
  workspaceRoot: string,
  trigger: RunContext["trigger"],
  runId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  workspaceDir = workspaceRoot,
): RunContext {
  return {
    run: { id: runId, attempt: 1, daemonEpoch: 1 },
    scope: { id: "test-scope", root: workspaceRoot },
    workflow: "test",
    trigger,
    sandbox: {
      runId,
      repository: "none",
      rootDir: workspaceRoot,
      workspaceDir,
      tempDir: workspaceRoot,
      artifactDir: workspaceRoot,
    },
    resources: {
      runId,
      attempt: 1,
      daemonEpoch: 1,
      workspaceDir,
      runDir: workspaceRoot,
      tempDir: workspaceRoot,
      artifactDir: workspaceRoot,
      agentDir: workspaceRoot,
      packageCacheDir: workspaceRoot,
      ports: { start: 41_000, end: 41_000, size: 1, values: [41_000] },
      env: {},
    },
    signal: new AbortController().signal,
    processes: { register: vi.fn() },
    effects: { execute: (effect) => effect.execute() },
    publications: { stageEmit: vi.fn() },
    state: createTestTransactionalRunState(),
  };
}



const TRIGGER: WorkflowRunTrigger = {
  event: "runtime.idle",
  schemaRef: null,
  payload: {},
};

function makeDefinition(overrides: Partial<WorkflowDefinition>): WorkflowDefinition {
  return {
    name: "tool-session-test",
    enabled: true,
    repository: "none",
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    moduleRoot: "/test-module-root",
    triggers: [],
    tags: [],
    steps: [],
    ...overrides,
  };
}

describe("workflow direct-tool session isolation", () => {
  let workspaceRoot: string;
  let store: WorkflowRunStore;
  let bus: EventBus;
  const log = vi.fn();

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-workflow-tool-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(workspaceRoot, { recursive: true });
    store = new WorkflowRunStore(workspaceRoot);
    bus = new EventBus();
    log.mockReset();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("isolates and tears down sessions for parallel children", async () => {
    await expectConcurrentSessionCleanup({
      definition: makeDefinition({
        steps: [
          {
            id: "fanout",
            type: "parallel",
            steps: ["first", "second"].map((id) => ({
              id,
              type: "code" as const,
              run: async (context) => context.runTool("capture", { id }),
            })),
          },
        ],
      }),
      identityField: "id",
      firstIdentity: "first",
      secondIdentity: "second",
    });
  });

  it("isolates and tears down sessions for concurrent foreach items", async () => {
    await expectConcurrentSessionCleanup({
      definition: makeDefinition({
        steps: [
          {
            id: "loop",
            type: "foreach",
            maxConcurrency: 2,
            items: [1, 2],
            as: "item",
            steps: [
              {
                id: "inner-code",
                type: "code",
                run: async (context) =>
                  context.runTool("capture", { item: String(context.foreach?.item) }),
              },
            ],
          },
        ],
      }),
      identityField: "item",
      firstIdentity: "1",
      secondIdentity: "2",
    });
  });

  async function expectConcurrentSessionCleanup(args: {
    definition: WorkflowDefinition;
    identityField: string;
    firstIdentity: string;
    secondIdentity: string;
  }): Promise<void> {
    const sessionIds: string[] = [];
    const cleanups = new Map<string, ReturnType<typeof vi.fn>>();
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let markFirstCleaned!: () => void;
    const firstCleaned = new Promise<void>((resolve) => {
      markFirstCleaned = resolve;
    });

    const { promise: runPromise } = executeWorkflowRun(args.definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext: makeRunContext(workspaceRoot, TRIGGER),
      bus,
      store,
      log,
      runTool: async (_name, input, context) => {
        if (context?.sessionId === undefined) {
          throw new Error("nested tool context requires a session");
        }
        const identity = String(input[args.identityField]);
        sessionIds.push(context.sessionId);
        const cleanup = vi.fn(() => {
          if (identity === args.firstIdentity) markFirstCleaned();
        });
        cleanups.set(identity, cleanup);
        registerSessionEnvironmentResource(context, cleanup);
        if (identity === args.secondIdentity) await secondGate;
        return { content: "ok" };
      },
    });

    await firstCleaned;
    expect(cleanups.get(args.firstIdentity)).toHaveBeenCalledOnce();
    expect(cleanups.get(args.secondIdentity)?.mock.calls.length ?? 0).toBe(0);
    releaseSecond();
    const result = await runPromise;

    expect(result.metadata.status).toBe("success");
    expect(sessionIds).toHaveLength(2);
    expect(new Set(sessionIds).size).toBe(2);
    expect(cleanups.size).toBe(2);
    for (const cleanup of cleanups.values()) expect(cleanup).toHaveBeenCalledOnce();
  }
});
