import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeWithAgentSDK } from "../agent-sdk/index.js";
import { EventBus } from "../event-bus.js";
import { WorkflowRuntime } from "./runtime.js";
import { registerWorkflowDefinition } from "./validation.js";

vi.mock("../agent-sdk/index.js", async () => {
  const actual = await vi.importActual("../agent-sdk/index.js");
  return {
    ...actual,
    executeWithAgentSDK: vi.fn(),
  };
});

const mockedExecuteWithAgentSDK = vi.mocked(executeWithAgentSDK);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("WorkflowRuntime", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, "src", "workflows", "builder"), { recursive: true });
    mkdirSync(join(projectDir, "src", "workflows", "formatter"), { recursive: true });
    mockedExecuteWithAgentSDK.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("runs idle workflows and writes per-run artifacts", async () => {
    writeFileSync(
      join(projectDir, "src", "workflows", "builder", "prompt.md"),
      "Build something useful.\n",
    );

    mockedExecuteWithAgentSDK.mockResolvedValue({
      text: "done",
      streamedText: "",
      sessionId: "sess-1",
      turns: 2,
      totalCostUsd: 0.1,
      subtype: "success",
      isError: false,
    });

    const bus = new EventBus();
    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 10,
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/workflows/builder/prompt.md",
            },
          ],
        }),
      ],
    });

    runtime.start();
    await wait(60);
    await runtime.stop();

    const runsDir = join(projectDir, ".kota", "runs");
    expect(existsSync(runsDir)).toBe(true);
    const runIds = readdirSync(runsDir);
    expect(runIds.length).toBe(1);

    const metadata = JSON.parse(
      readFileSync(join(runsDir, runIds[0], "metadata.json"), "utf-8"),
    );
    expect(metadata.workflow).toBe("builder");
    expect(metadata.status).toBe("success");
    expect(metadata.steps).toHaveLength(1);
    expect(existsSync(join(runsDir, runIds[0], "workflow.json"))).toBe(true);
  });

  it("queues event-triggered follow-up workflows after builder completion", async () => {
    const bus = new EventBus();
    const seenWorkflows: string[] = [];
    bus.on("workflow.started", (payload) => {
      seenWorkflows.push(payload.workflow);
    });

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 1000,
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "notify",
              type: "emit",
              event: "builder.done",
              payload: { source: "builder" },
            },
          ],
        }),
        registerWorkflowDefinition("test/improver.ts", {
          name: "improver",
          triggers: [
            {
              event: "workflow.completed",
              filter: {
                workflow: "builder",
                status: "success",
              },
            },
          ],
          steps: [
            {
              id: "notify",
              type: "emit",
              event: "improver.done",
              payload: { source: "improver" },
            },
          ],
        }),
      ],
    });

    runtime.start();
    await wait(150);
    await runtime.stop();

    expect(seenWorkflows.slice(0, 2)).toEqual(["builder", "improver"]);

    const runsDir = join(projectDir, ".kota", "runs");
    const runIds = readdirSync(runsDir);
    expect(runIds.length).toBe(2);
  });

  it("supports an explorer -> builder -> improver pipeline", async () => {
    const bus = new EventBus();
    const seenWorkflows: string[] = [];
    bus.on("workflow.started", (payload) => {
      seenWorkflows.push(payload.workflow);
    });

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 10,
      workflows: [
        registerWorkflowDefinition("test/explorer.ts", {
          name: "explorer",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "inspect",
              type: "code",
              run: () => ({ readyCount: 1 }),
            },
          ],
        }),
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [
            {
              event: "workflow.completed",
              filter: {
                workflow: "explorer",
                status: "success",
              },
            },
          ],
          steps: [
            {
              id: "build",
              type: "emit",
              event: "builder.done",
            },
          ],
        }),
        registerWorkflowDefinition("test/improver.ts", {
          name: "improver",
          triggers: [
            {
              event: "workflow.completed",
              filter: {
                workflow: "builder",
                status: ["success", "failed"],
              },
            },
          ],
          steps: [
            {
              id: "improve",
              type: "emit",
              event: "improver.done",
            },
          ],
        }),
      ],
    });

    runtime.start();
    await wait(180);
    await runtime.stop();

    expect(seenWorkflows.slice(0, 3)).toEqual([
      "explorer",
      "builder",
      "improver",
    ]);
  });

  it("queues improver after failed builder completions but ignores interruptions", async () => {
    const bus = new EventBus();
    const seenWorkflows: string[] = [];
    bus.on("workflow.started", (payload) => {
      seenWorkflows.push(payload.workflow);
    });

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 1000,
      workflows: [
        registerWorkflowDefinition("test/improver.ts", {
          name: "improver",
          triggers: [
            {
              event: "workflow.completed",
              filter: {
                workflow: "builder",
                status: ["success", "failed"],
              },
            },
          ],
          steps: [
            {
              id: "notify",
              type: "emit",
              event: "improver.done",
              payload: { source: "improver" },
            },
          ],
        }),
      ],
    });

    runtime.start();
    bus.emit("workflow.completed", {
      workflow: "builder",
      runId: "run-failed",
      status: "failed",
      triggerEvent: "runtime.idle",
      durationMs: 10,
      definitionPath: "test/builder.ts",
      runDir: ".kota/runs/run-failed",
    });
    bus.emit("workflow.completed", {
      workflow: "builder",
      runId: "run-interrupted",
      status: "interrupted",
      triggerEvent: "runtime.idle",
      durationMs: 10,
      definitionPath: "test/builder.ts",
      runDir: ".kota/runs/run-interrupted",
    });

    await wait(120);
    await runtime.stop();

    expect(seenWorkflows).toEqual(["improver"]);
  });

  it("supports code steps that call KOTA tools before agent steps", async () => {
    writeFileSync(
      join(projectDir, "src", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    mockedExecuteWithAgentSDK.mockResolvedValue({
      text: "done",
      streamedText: "",
      turns: 1,
      subtype: "success",
      isError: false,
    });

    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      idleIntervalMs: 10,
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
          steps: [
            {
              id: "prep",
              type: "code",
              run: async ({ runTool }) => {
                const result = await runTool("shell", {
                  command: "printf ready",
                });
                return { note: result.content.trim() };
              },
            },
            {
              id: "build",
              type: "agent",
              promptPath: "src/workflows/builder/prompt.md",
            },
          ],
        }),
      ],
    });

    runtime.start();
    await wait(80);
    await runtime.stop();

    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(1);

    const runsDir = join(projectDir, ".kota", "runs");
    const [runId] = readdirSync(runsDir);
    const prepStep = JSON.parse(
      readFileSync(join(runsDir, runId, "steps", "prep.json"), "utf-8"),
    );
    expect(prepStep.output.note).toContain("ready");
  });

  it("uses structured runtime logging instead of streaming raw agent text", async () => {
    writeFileSync(
      join(projectDir, "src", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    mockedExecuteWithAgentSDK.mockResolvedValue({
      text: 'Let me fix this.',
      streamedText: 'Let me fix this.',
      turns: 2,
      totalCostUsd: 0.12,
      subtype: "success",
      isError: false,
    });

    const logs: string[] = [];
    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      idleIntervalMs: 10,
      onLog: (message) => logs.push(message),
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/workflows/builder/prompt.md",
            },
          ],
        }),
      ],
    });

    runtime.start();
    await wait(80);
    await runtime.stop();

    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(1);
    expect(mockedExecuteWithAgentSDK.mock.calls[0]?.[2]).toBeDefined();
    expect(logs).toContain(
      'Starting step "build" (agent) in workflow "builder"',
    );
    expect(
      logs.some((message) =>
        message.includes(
          'Completed step "build" (agent) in workflow "builder" [',
        ),
      ),
    ).toBe(true);
    expect(logs.some((message) => message.includes("Let me fix this."))).toBe(false);
  });

  it("fails the workflow when an agent step returns an error subtype", async () => {
    writeFileSync(
      join(projectDir, "src", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    mockedExecuteWithAgentSDK.mockResolvedValue({
      text: "Ran out of turns",
      streamedText: "Ran out of turns",
      turns: 40,
      totalCostUsd: 0.3,
      subtype: "error_max_turns",
      isError: true,
    });

    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      idleIntervalMs: 10,
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/workflows/builder/prompt.md",
            },
            {
              id: "verify-typecheck",
              type: "tool",
              tool: "shell",
              input: {
                command: "printf should-not-run",
                stream_output: false,
              },
            },
          ],
        }),
      ],
    });

    runtime.start();
    await wait(80);
    await runtime.stop();

    const runsDir = join(projectDir, ".kota", "runs");
    const [runId] = readdirSync(runsDir);
    const metadata = JSON.parse(
      readFileSync(join(runsDir, runId, "metadata.json"), "utf-8"),
    );
    expect(metadata.status).toBe("failed");
    expect(metadata.steps).toHaveLength(1);
    expect(metadata.steps[0].status).toBe("failed");
    expect(metadata.steps[0].id).toBe("build");
    expect(metadata.steps[0].error).toContain("error_max_turns");

    expect(
      existsSync(join(runsDir, runId, "steps", "verify-typecheck.json")),
    ).toBe(false);
  });

  it("coalesces a rerun when the same workflow is retriggered mid-run", async () => {
    writeFileSync(
      join(projectDir, "src", "workflows", "formatter", "prompt.md"),
      "Handle changes.\n",
    );

    let releaseFirstRun: (() => void) | null = null;
    mockedExecuteWithAgentSDK
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirstRun = () =>
              resolve({
                text: "first",
                streamedText: "",
                turns: 1,
                subtype: "success",
                isError: false,
              });
          }),
      )
      .mockResolvedValueOnce({
        text: "second",
        streamedText: "",
        turns: 1,
        subtype: "success",
        isError: false,
      });

    const bus = new EventBus();
    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 1000,
      workflows: [
        registerWorkflowDefinition("test/formatter.ts", {
          name: "formatter",
          triggers: [{ event: "file.changed" }],
          steps: [
            {
              id: "run",
              type: "agent",
              promptPath: "src/workflows/formatter/prompt.md",
            },
          ],
        }),
      ],
    });

    runtime.start();
    bus.emit("file.changed", {
      watchId: "watch-1",
      path: "src/a.ts",
      changes: [{ path: "src/a.ts", type: "change" }],
    });
    await wait(20);

    bus.emit("file.changed", {
      watchId: "watch-1",
      path: "src/b.ts",
      changes: [{ path: "src/b.ts", type: "change" }],
    });

    expect(releaseFirstRun).not.toBeNull();
    if (!releaseFirstRun) {
      throw new Error("expected first run release function");
    }
    const release: () => void = releaseFirstRun;
    release();
    await wait(120);
    await runtime.stop();

    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(2);
    expect(mockedExecuteWithAgentSDK.mock.calls[1]?.[0]).toContain('"path": "src/b.ts"');
  });

  it("recovers queued follow-up workflows across restart boundaries", async () => {
    const definitions = [
      registerWorkflowDefinition("test/builder.ts", {
        name: "builder",
        triggers: [
          {
            event: "runtime.idle",
            cooldownMs: 30_000,
          },
        ],
        steps: [
          {
            id: "verify",
            type: "code",
            run: () => "ok",
          },
          {
            id: "request-restart",
            type: "restart",
            requires: ["verify"],
            reason: "builder requested restart",
          },
        ],
      }),
      registerWorkflowDefinition("test/improver.ts", {
        name: "improver",
        triggers: [
          {
            event: "workflow.completed",
            filter: {
              workflow: "builder",
              status: "success",
            },
          },
        ],
        steps: [
          {
            id: "improve",
            type: "emit",
            event: "improver.finished",
          },
        ],
      }),
    ];

    const firstBus = new EventBus();
    const firstRuntime = new WorkflowRuntime({
      bus: firstBus,
      projectDir,
      idleIntervalMs: 1000,
      workflows: definitions,
    });

    firstBus.on("runtime.restart_requested", () => {
      firstRuntime.setDispatchPaused(true);
    });

    firstRuntime.start();
    await wait(120);
    await firstRuntime.stop();

    const persistedState = JSON.parse(
      readFileSync(join(projectDir, ".kota", "workflow-state.json"), "utf-8"),
    );
    expect(persistedState.pendingRuns).toHaveLength(1);
    expect(persistedState.pendingRuns[0].workflowName).toBe("improver");

    const secondBus = new EventBus();
    const started: string[] = [];
    secondBus.on("workflow.started", (payload) => {
      started.push(payload.workflow);
    });

    const secondRuntime = new WorkflowRuntime({
      bus: secondBus,
      projectDir,
      idleIntervalMs: 1000,
      workflows: definitions,
    });

    secondRuntime.start();
    await wait(120);
    await secondRuntime.stop();

    expect(started[0]).toBe("improver");
  });

  it("fails fast on corrupted workflow state files", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "workflow-state.json"),
      "not json",
      "utf-8",
    );

    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      workflows: [],
    });

    expect(() => runtime.start()).toThrow(/workflow-state\.json/);
  });

  it("fails restart steps when required verification steps were skipped", async () => {
    const bus = new EventBus();
    const restartEvents: Array<Record<string, unknown>> = [];
    bus.on("runtime.restart_requested", (payload) => {
      restartEvents.push(payload);
    });

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 10,
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
          steps: [
            {
              id: "verify",
              type: "code",
              when: () => false,
              run: () => "ok",
            },
            {
              id: "request-restart",
              type: "restart",
              requires: ["verify"],
              reason: "safe to restart",
            },
          ],
        }),
      ],
    });

    runtime.start();
    await wait(80);
    await runtime.stop();

    expect(restartEvents).toHaveLength(0);

    const runsDir = join(projectDir, ".kota", "runs");
    const [runId] = readdirSync(runsDir);
    const metadata = JSON.parse(
      readFileSync(join(runsDir, runId, "metadata.json"), "utf-8"),
    );
    expect(metadata.status).toBe("failed");

    const errorText = readFileSync(join(runsDir, runId, "error.txt"), "utf-8");
    expect(errorText).toContain("requires successful verification steps: verify");
  });

  it("interrupts an active agent step when the runtime stops", async () => {
    writeFileSync(
      join(projectDir, "src", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    let abortSignal: AbortSignal | null = null;
    mockedExecuteWithAgentSDK.mockImplementation(
      async (_prompt, options) =>
        await new Promise((_resolve, reject) => {
          abortSignal = options?.abortController?.signal ?? null;
          abortSignal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );

    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      idleIntervalMs: 10,
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/workflows/builder/prompt.md",
            },
          ],
        }),
      ],
    });

    runtime.start();
    await wait(40);
    await runtime.stop(50);

    expect(abortSignal).not.toBeNull();
    if (!abortSignal) {
      throw new Error("expected abort signal");
    }
    const signal: AbortSignal = abortSignal;
    expect(signal.aborted).toBe(true);

    const runsDir = join(projectDir, ".kota", "runs");
    const [runId] = readdirSync(runsDir);
    const metadata = JSON.parse(
      readFileSync(join(runsDir, runId, "metadata.json"), "utf-8"),
    );
    expect(metadata.status).toBe("interrupted");
    expect(metadata.steps[0].status).toBe("failed");
  });
});
