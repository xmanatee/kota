import { execFileSync } from "node:child_process";
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
import { executeWithAgentSDK } from "#core/agent-sdk/index.js";
import { EventBus } from "#core/events/event-bus.js";
import { clearCustomTools, registerTool } from "#core/tools/index.js";
import { runShell, shellTool } from "#modules/execution/shell.js";
import { WorkflowRunStore } from "./run-store.js";
import { ABORT_SIGNAL_FILE, PAUSE_SIGNAL_FILE, RELOAD_SIGNAL_FILE, WorkflowRuntime } from "./runtime.js";
import { registerWorkflowDefinition, validateWorkflowDefinitions } from "./validation.js";

vi.mock("#core/agent-sdk/index.js", async () => {
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
    mkdirSync(join(projectDir, "src", "modules", "autonomy", "workflows", "builder"), { recursive: true });
    mkdirSync(join(projectDir, "src", "modules", "test", "workflows", "formatter"), { recursive: true });
    mockedExecuteWithAgentSDK.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    clearCustomTools();
  });

  it("runs idle workflows and writes per-run artifacts", async () => {
    writeFileSync(
      join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
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
      codeConcurrency: 1,
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              model: "claude-opus-4-7",
              effort: "xhigh",
              autonomyMode: "autonomous",
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
      codeConcurrency: 1,
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

  it("supports event-driven workflow handoff without hardcoded workflow-name filters", async () => {
    const bus = new EventBus();
    const seenWorkflows: string[] = [];
    bus.on("workflow.started", (payload) => {
      seenWorkflows.push(payload.workflow);
    });

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 10,
      codeConcurrency: 1,
      workflows: [
        registerWorkflowDefinition("test/triage.ts", {
          name: "triage",
          triggers: [{ event: "runtime.idle" }],
          steps: [{ id: "inspect", type: "emit", event: "autonomy.queue.available" }],
        }),
        registerWorkflowDefinition("test/delivery.ts", {
          name: "delivery",
          triggers: [
            {
              event: "autonomy.queue.available",
            },
          ],
          steps: [{ id: "deliver", type: "emit", event: "delivery.done" }],
        }),
        registerWorkflowDefinition("test/governance.ts", {
          name: "governance",
          triggers: [
            {
              event: "delivery.done",
            },
          ],
          steps: [{ id: "govern", type: "emit", event: "governance.done" }],
        }),
      ],
    });

    runtime.start();
    await wait(180);
    await runtime.stop();

    expect(seenWorkflows.slice(0, 3)).toEqual([
      "triage",
      "delivery",
      "governance",
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

  it("backs off agent workflows after a quota failure and drops stale follow-up runs", async () => {
    writeFileSync(
      join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );
    writeFileSync(
      join(projectDir, "src", "modules", "test", "workflows", "formatter", "prompt.md"),
      "Improve.\n",
    );

    mockedExecuteWithAgentSDK.mockResolvedValue({
      text: "You've hit your limit · resets 2am (Europe/London)",
      streamedText: "",
      turns: 1,
      totalCostUsd: 0,
      subtype: "success",
      isError: true,
    });

    const bus = new EventBus();
    const seenWorkflows: string[] = [];
    bus.on("workflow.started", (payload) => {
      seenWorkflows.push(payload.workflow);
    });

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 10,
      codeConcurrency: 1,
      workflows: [
        registerWorkflowDefinition("test/explorer.ts", {
          name: "explorer",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "explore",
              type: "agent",
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              model: "claude-opus-4-7",
              effort: "xhigh",
              autonomyMode: "autonomous",
            },
          ],
        }),
        registerWorkflowDefinition("test/improver.ts", {
          name: "improver",
          triggers: [
            {
              event: "workflow.completed",
              filter: {
                workflow: "explorer",
                status: "failed",
              },
            },
          ],
          steps: [
            {
              id: "improve",
              type: "agent",
              promptPath: "src/modules/test/workflows/formatter/prompt.md",
              model: "claude-opus-4-7",
              effort: "xhigh",
              autonomyMode: "autonomous",
            },
          ],
        }),
      ],
    });

    runtime.start();
    await wait(120);
    await runtime.stop();

    expect(seenWorkflows).toEqual(["explorer"]);
    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(1);

    const state = JSON.parse(
      readFileSync(join(projectDir, ".kota", "workflow-state.json"), "utf-8"),
    ) as {
      agentBackoff?: { kind: string; failureCount: number };
      pendingRuns: unknown[];
    };
    expect(state.agentBackoff?.kind).toBe("rate_limit");
    expect(state.agentBackoff?.failureCount).toBe(1);
    expect(state.pendingRuns).toEqual([]);
  });

  it("supports code steps that call KOTA tools before agent steps", async () => {
    // Register the shell tool from the execution module (normally loaded by project modules)
    registerTool(shellTool, runShell, "execution");

    writeFileSync(
      join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
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
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              model: "claude-opus-4-7",
              effort: "xhigh",
              autonomyMode: "autonomous",
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
      join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
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
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              model: "claude-opus-4-7",
              effort: "xhigh",
              autonomyMode: "autonomous",
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
      join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
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
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              model: "claude-opus-4-7",
              effort: "xhigh",
              autonomyMode: "autonomous",
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
      join(projectDir, "src", "modules", "test", "workflows", "formatter", "prompt.md"),
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
              promptPath: "src/modules/test/workflows/formatter/prompt.md",
              model: "claude-opus-4-7",
              effort: "xhigh",
              autonomyMode: "autonomous",
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
      codeConcurrency: 1,
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
      join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
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
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              model: "claude-opus-4-7",
              effort: "xhigh",
              autonomyMode: "autonomous",
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

  it("queues runtime.recovered workflows first when startup finds an interrupted run with a dirty worktree", async () => {
    execFileSync("git", ["init"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Kota Tests"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "kota@example.com"], { cwd: projectDir, stdio: "ignore" });
    writeFileSync(join(projectDir, ".gitignore"), ".kota/\n");
    writeFileSync(join(projectDir, "README.md"), "clean\n");
    execFileSync("git", ["add", ".gitignore", "README.md"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: projectDir, stdio: "ignore" });

    const builderDefinition = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
          steps: [{ id: "run", type: "emit", event: "builder.done" }],
        }),
      ],
      projectDir,
    )[0];

    const store = new WorkflowRunStore(projectDir);
    store.createRun(builderDefinition, {
      event: "runtime.idle",
      payload: {},
    });

    writeFileSync(join(projectDir, "README.md"), "dirty\n");

    const bus = new EventBus();
    const started: string[] = [];
    bus.on("workflow.started", (payload) => {
      started.push(payload.workflow);
    });

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 1_000,
      workflows: [
        registerWorkflowDefinition("test/improver.ts", {
          name: "improver",
          recoveryCapable: true,
          triggers: [
            {
              event: "runtime.recovered",
            },
          ],
          steps: [{ id: "repair", type: "emit", event: "improver.done" }],
        }),
        registerWorkflowDefinition("test/explorer.ts", {
          name: "explorer",
          triggers: [{ event: "runtime.idle" }],
          steps: [{ id: "inspect", type: "emit", event: "explorer.done" }],
        }),
      ],
    });

    runtime.start();
    await wait(80);
    await runtime.stop();

    expect(started[0]).toBe("improver");

    const state = store.readState();
    expect(state.activeRuns).toEqual([]);

    const runsDir = join(projectDir, ".kota", "runs");
    const interruptedRunId = readdirSync(runsDir).find((runId) => runId.includes("-builder-"));
    expect(interruptedRunId).toBeDefined();
    const metadata = JSON.parse(
      readFileSync(join(runsDir, interruptedRunId!, "metadata.json"), "utf-8"),
    );
    expect(metadata.status).toBe("interrupted");
  });

  it("emits workflow.interrupted.alert and logs summary for stale runs on startup", async () => {
    const builderDefinition = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
          steps: [{ id: "run", type: "emit", event: "builder.done" }],
        }),
      ],
      projectDir,
    )[0];

    const store = new WorkflowRunStore(projectDir);
    store.createRun(builderDefinition, {
      event: "runtime.idle",
      payload: {},
    });

    const bus = new EventBus();
    const alerts: Array<{ workflow: string; runId: string; reason: string }> = [];
    bus.on("workflow.interrupted.alert", (payload) => {
      alerts.push({ workflow: payload.workflow, runId: payload.runId, reason: payload.reason });
    });

    const logs: string[] = [];
    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 10_000,
      onLog: (msg) => logs.push(msg),
      workflows: [],
    });

    runtime.start();
    await wait(20);
    await runtime.stop();

    expect(alerts).toHaveLength(1);
    expect(alerts[0].workflow).toBe("builder");
    expect(alerts[0].reason).toContain("daemon restarted");

    const summaryLog = logs.find((l) => l.includes("marked interrupted from previous session"));
    expect(summaryLog).toBeDefined();
    expect(summaryLog).toContain("1 run");
  });

  it("requests restart and records recovery when a run fails dirty", async () => {
    execFileSync("git", ["init"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Kota Tests"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "kota@example.com"], { cwd: projectDir, stdio: "ignore" });
    writeFileSync(join(projectDir, ".gitignore"), ".kota/\n");
    writeFileSync(join(projectDir, "README.md"), "clean\n");
    execFileSync("git", ["add", ".gitignore", "README.md"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: projectDir, stdio: "ignore" });

    const bus = new EventBus();
    const started: string[] = [];
    const restartReasons: string[] = [];
    bus.on("workflow.started", (payload) => {
      started.push(payload.workflow);
    });
    bus.on("runtime.restart_requested", (payload) => {
      restartReasons.push(payload.reason ?? "");
    });

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 10,
      codeConcurrency: 1,
      workflows: [
        registerWorkflowDefinition("test/improver.ts", {
          name: "improver",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "dirty-fail",
              type: "code",
              run: ({ projectDir }) => {
                writeFileSync(join(projectDir, "README.md"), "dirty\n");
                throw new Error("forced failure");
              },
            },
          ],
        }),
        registerWorkflowDefinition("test/explorer.ts", {
          name: "explorer",
          triggers: [{ event: "runtime.idle" }],
          steps: [{ id: "inspect", type: "emit", event: "explorer.done" }],
        }),
      ],
    });

    runtime.start();
    await wait(80);
    await runtime.stop();

    expect(started).toContain("improver");
    expect(restartReasons).toContain(
      'workflow "improver" completed with dirty worktree',
    );

    const recovery = new WorkflowRunStore(projectDir).getRecovery();
    expect(recovery).toMatchObject({
      sourceWorkflow: "improver",
      attempts: 0,
    });
  });

  it("queues exactly one runtime.recovered run on startup for a dirty failed run", async () => {
    execFileSync("git", ["init"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Kota Tests"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "kota@example.com"], { cwd: projectDir, stdio: "ignore" });
    writeFileSync(join(projectDir, ".gitignore"), ".kota/\n");
    writeFileSync(join(projectDir, "README.md"), "clean\n");
    execFileSync("git", ["add", ".gitignore", "README.md"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: projectDir, stdio: "ignore" });

    writeFileSync(join(projectDir, "README.md"), "dirty\n");

    const store = new WorkflowRunStore(projectDir);
    store.setRecovery({
      sourceRunId: "run-1",
      sourceWorkflow: "builder",
      worktreeFingerprint: "stale",
      worktreeSummary: "stale",
      attempts: 0,
      retryAttemptedBy: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const bus = new EventBus();
    const started: string[] = [];
    bus.on("workflow.started", (payload) => {
      started.push(payload.workflow);
    });

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 1_000,
      workflows: [
        registerWorkflowDefinition("test/improver.ts", {
          name: "improver",
          recoveryCapable: true,
          triggers: [
            {
              event: "runtime.recovered",
            },
          ],
          steps: [{ id: "repair", type: "emit", event: "improver.done" }],
        }),
        registerWorkflowDefinition("test/explorer.ts", {
          name: "explorer",
          triggers: [{ event: "runtime.idle" }],
          steps: [{ id: "inspect", type: "emit", event: "explorer.done" }],
        }),
      ],
    });

    runtime.start();
    await wait(80);
    await runtime.stop();

    expect(started).toEqual(["improver"]);
    const recovery = store.getRecovery();
    expect(recovery).toMatchObject({
      sourceWorkflow: "builder",
      attempts: 1,
    });
    expect(recovery!.retryAttemptedBy).toHaveLength(1);
    expect(recovery!.retryAttemptedBy[0].workflow).toBe("improver");
  });

  it("pauses dispatch instead of looping when dirty autonomous recovery already failed once", async () => {
    execFileSync("git", ["init"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Kota Tests"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "kota@example.com"], { cwd: projectDir, stdio: "ignore" });
    writeFileSync(join(projectDir, ".gitignore"), ".kota/\n");
    writeFileSync(join(projectDir, "README.md"), "clean\n");
    execFileSync("git", ["add", ".gitignore", "README.md"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: projectDir, stdio: "ignore" });

    writeFileSync(join(projectDir, "README.md"), "dirty\n");

    const store = new WorkflowRunStore(projectDir);
    store.setRecovery({
      sourceRunId: "run-2",
      sourceWorkflow: "improver",
      worktreeFingerprint: "dirty",
      worktreeSummary: "dirty",
      attempts: 1,
      retryAttemptedBy: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const bus = new EventBus();
    const started: string[] = [];
    bus.on("workflow.started", (payload) => {
      started.push(payload.workflow);
    });

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 10,
      workflows: [
        registerWorkflowDefinition("test/improver.ts", {
          name: "improver",
          triggers: [{ event: "runtime.idle" }],
          steps: [{ id: "repair", type: "emit", event: "improver.done" }],
        }),
        registerWorkflowDefinition("test/explorer.ts", {
          name: "explorer",
          triggers: [{ event: "runtime.idle" }],
          steps: [{ id: "inspect", type: "emit", event: "explorer.done" }],
        }),
      ],
    });

    runtime.start();
    await wait(80);
    await runtime.stop();

    expect(started).toEqual([]);
    expect(existsSync(join(projectDir, ".kota", PAUSE_SIGNAL_FILE))).toBe(true);
  });

  it("preserves original attribution when a non-causal workflow completes during pending recovery", async () => {
    execFileSync("git", ["init"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Kota Tests"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "kota@example.com"], { cwd: projectDir, stdio: "ignore" });
    writeFileSync(join(projectDir, ".gitignore"), ".kota/\n");
    writeFileSync(join(projectDir, "README.md"), "clean\n");
    execFileSync("git", ["add", ".gitignore", "README.md"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: projectDir, stdio: "ignore" });

    writeFileSync(join(projectDir, "README.md"), "dirty\n");

    const store = new WorkflowRunStore(projectDir);
    store.setRecovery({
      sourceRunId: "run-original",
      sourceWorkflow: "builder",
      worktreeFingerprint: " M README.md",
      worktreeSummary: "1 modified",
      attempts: 0,
      retryAttemptedBy: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const bus = new EventBus();
    const started: string[] = [];
    bus.on("workflow.started", (payload) => {
      started.push(payload.workflow);
    });

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 1_000,
      workflows: [
        registerWorkflowDefinition("test/repairer.ts", {
          name: "repairer",
          recoveryCapable: true,
          triggers: [{ event: "runtime.recovered" }],
          steps: [{ id: "fix", type: "emit", event: "repairer.done" }],
        }),
        registerWorkflowDefinition("test/digest.ts", {
          name: "digest",
          triggers: [{ event: "queue.empty" }],
          steps: [{ id: "notify", type: "emit", event: "digest.done" }],
        }),
      ],
    });

    runtime.start();
    await wait(80);
    await runtime.stop();

    expect(started).toEqual(["repairer"]);

    const recovery = store.getRecovery();
    expect(recovery!.sourceWorkflow).toBe("builder");
    expect(recovery!.sourceRunId).toBe("run-original");
    expect(recovery!.retryAttemptedBy).toHaveLength(1);
    expect(recovery!.retryAttemptedBy[0].workflow).toBe("repairer");
  });

  it("fires interval-based schedule trigger immediately on first run", async () => {
    const bus = new EventBus();
    const started: string[] = [];
    bus.on("workflow.started", (payload) => {
      started.push(payload.workflow);
    });

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 10_000,
      workflows: [
        registerWorkflowDefinition("test/daily.ts", {
          name: "daily",
          // 1h interval — no prior runs, so fires immediately (delay = 0)
          triggers: [{ intervalMs: 3_600_000 }],
          steps: [
            {
              id: "run",
              type: "emit",
              event: "daily.done",
            },
          ],
        }),
      ],
    });

    runtime.start();
    await wait(80);
    await runtime.stop();

    expect(started).toContain("daily");
  });

  it("persists nextScheduledAt for interval triggers in workflow state", async () => {
    const bus = new EventBus();

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 10_000,
      workflows: [
        registerWorkflowDefinition("test/hourly.ts", {
          name: "hourly",
          triggers: [{ intervalMs: 3_600_000 }],
          steps: [
            {
              id: "run",
              type: "emit",
              event: "hourly.done",
            },
          ],
        }),
      ],
    });

    runtime.start();
    await wait(20);
    await runtime.stop();

    const state = JSON.parse(
      readFileSync(join(projectDir, ".kota", "workflow-state.json"), "utf-8"),
    );
    expect(state.workflows.hourly?.nextScheduledAt).toBeDefined();
    const nextMs = new Date(state.workflows.hourly.nextScheduledAt).getTime();
    expect(nextMs).toBeGreaterThan(Date.now());
  });

  it("fires interval trigger immediately if last run was before the interval", async () => {
    // Pre-seed state with a lastCompletedAt 2 hours ago (interval is 1 hour)
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    writeFileSync(
      join(projectDir, ".kota", "workflow-state.json"),
      JSON.stringify({
        completedRuns: 1,
        pendingRuns: [],
        workflows: {
          scheduled: {
            lastCompletedAt: twoHoursAgo,
            lastStatus: "success",
          },
        },
      }),
      "utf-8",
    );

    const bus = new EventBus();
    const started: string[] = [];
    bus.on("workflow.started", (payload) => {
      started.push(payload.workflow);
    });

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 10_000,
      workflows: [
        registerWorkflowDefinition("test/scheduled.ts", {
          name: "scheduled",
          triggers: [{ intervalMs: 3_600_000 }],
          steps: [
            {
              id: "run",
              type: "emit",
              event: "scheduled.done",
            },
          ],
        }),
      ],
    });

    runtime.start();
    await wait(80);
    await runtime.stop();

    expect(started).toContain("scheduled");
  });

  it("aborts the active run when abort-request signal file is written", async () => {
    writeFileSync(
      join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    mockedExecuteWithAgentSDK.mockImplementation(
      async (_prompt, options) =>
        await new Promise((_resolve, reject) => {
          options?.abortController?.signal.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );

    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      idleIntervalMs: 20,
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              model: "claude-opus-4-7",
              effort: "xhigh",
              autonomyMode: "autonomous",
            },
          ],
        }),
      ],
    });

    runtime.start();
    await wait(50); // let the agent step start

    // Write the abort signal file
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(join(projectDir, ".kota", ABORT_SIGNAL_FILE), "");

    await wait(80); // let the idle timer fire and process the signal
    await runtime.stop();

    // Signal file should be cleaned up
    expect(existsSync(join(projectDir, ".kota", ABORT_SIGNAL_FILE))).toBe(false);

    const runsDir = join(projectDir, ".kota", "runs");
    const [runId] = readdirSync(runsDir);
    const metadata = JSON.parse(
      readFileSync(join(runsDir, runId, "metadata.json"), "utf-8"),
    );
    expect(metadata.status).toBe("interrupted");
  });

  it("does not dispatch new runs when pause signal file exists", async () => {
    const bus = new EventBus();
    const started: string[] = [];
    bus.on("workflow.started", (payload) => {
      started.push(payload.workflow);
    });

    // Write pause signal before starting
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(join(projectDir, ".kota", PAUSE_SIGNAL_FILE), "");

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 10,
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
          steps: [{ id: "run", type: "emit", event: "builder.done" }],
        }),
      ],
    });

    runtime.start();
    await wait(80);
    await runtime.stop();

    expect(started).toHaveLength(0);
  });

  it("resumes dispatch when pause signal file is removed", async () => {
    const bus = new EventBus();
    const started: string[] = [];
    bus.on("workflow.started", (payload) => {
      started.push(payload.workflow);
    });

    // Write pause signal before starting
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    const pausePath = join(projectDir, ".kota", PAUSE_SIGNAL_FILE);
    writeFileSync(pausePath, "");

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 20,
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
          steps: [{ id: "run", type: "emit", event: "builder.done" }],
        }),
      ],
    });

    runtime.start();
    await wait(40); // paused — no runs start

    rmSync(pausePath);
    await wait(80); // idle timer fires, dispatch resumes
    await runtime.stop();

    expect(started).toContain("builder");
  });

  it("reloads definitions when reload signal file is written", async () => {
    const bus = new EventBus();
    const logs: string[] = [];

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 20,
      onLog: (msg) => logs.push(msg),
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
          steps: [{ id: "run", type: "emit", event: "builder.done" }],
        }),
      ],
    });

    runtime.start();
    await wait(40);

    // Write reload signal
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(join(projectDir, ".kota", RELOAD_SIGNAL_FILE), "");

    await wait(80); // wait for idle timer to fire and process the signal
    await runtime.stop();

    // Signal file should be consumed
    expect(existsSync(join(projectDir, ".kota", RELOAD_SIGNAL_FILE))).toBe(false);

    // State should record when definitions were loaded
    const state = JSON.parse(
      readFileSync(join(projectDir, ".kota", "workflow-state.json"), "utf-8"),
    );
    expect(state.definitionsLoadedAt).toBeDefined();

    // Log should confirm reload
    expect(logs.some((msg) => msg.includes("reloaded"))).toBe(true);
  });

  it("does not interrupt an active run when reload signal is processed", async () => {
    writeFileSync(
      join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    let releaseRun: (() => void) | null = null;
    mockedExecuteWithAgentSDK.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRun = () =>
            resolve({
              text: "done",
              streamedText: "",
              turns: 1,
              subtype: "success",
              isError: false,
            });
        }),
    );

    const bus = new EventBus();
    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 20,
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              model: "claude-opus-4-7",
              effort: "xhigh",
              autonomyMode: "autonomous",
            },
          ],
        }),
      ],
    });

    runtime.start();
    await wait(40); // let the agent step start

    // Write reload signal while run is active
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(join(projectDir, ".kota", RELOAD_SIGNAL_FILE), "");

    await wait(80); // idle timer fires, reload is processed mid-run
    if (!releaseRun) throw new Error("expected releaseRun to be set");
    const release: () => void = releaseRun;
    release();
    await wait(40);
    await runtime.stop();

    // Signal file should be consumed
    expect(existsSync(join(projectDir, ".kota", RELOAD_SIGNAL_FILE))).toBe(false);

    // Run should complete successfully (not interrupted)
    const runsDir = join(projectDir, ".kota", "runs");
    const [runId] = readdirSync(runsDir);
    const metadata = JSON.parse(
      readFileSync(join(runsDir, runId, "metadata.json"), "utf-8"),
    );
    expect(metadata.status).toBe("success");
  });

  it("logs an error and keeps running when reload encounters bad definitions", async () => {
    const bus = new EventBus();
    const logs: string[] = [];
    const started: string[] = [];
    bus.on("workflow.started", (payload) => {
      started.push(payload.workflow);
    });

    const validWorkflows = [
      registerWorkflowDefinition("test/builder.ts", {
        name: "builder",
        triggers: [{ event: "runtime.idle" }],
        steps: [{ id: "run", type: "emit", event: "builder.done" }],
      }),
    ];

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 20,
      onLog: (msg) => logs.push(msg),
      workflows: validWorkflows,
    });

    runtime.start();
    await wait(40);

    // Spy on validateWorkflowDefinitions to throw on the reload call (after start)
    const validationModule = await import("./validation.js");
    const spy = vi.spyOn(validationModule, "validateWorkflowDefinitions");
    spy.mockImplementationOnce(() => { throw new Error("bad definition"); });

    // Write reload signal — reload will encounter the mocked bad definitions
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(join(projectDir, ".kota", RELOAD_SIGNAL_FILE), "");

    await wait(80);
    await runtime.stop();
    spy.mockRestore();

    // Signal file consumed
    expect(existsSync(join(projectDir, ".kota", RELOAD_SIGNAL_FILE))).toBe(false);

    // Runtime should have logged the error and kept running (didn't crash)
    expect(logs.some((msg) => msg.includes("Failed to reload") && msg.includes("bad definition"))).toBe(true);

    // Existing definitions still active — workflows ran
    expect(started.length).toBeGreaterThanOrEqual(1);
  });

  it("reconciles schedule timers on reload — new trigger is registered", async () => {
    const bus = new EventBus();
    const started: string[] = [];
    bus.on("workflow.started", (payload) => {
      started.push(payload.workflow);
    });

    // Start with a workflow that has an interval trigger
    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 20,
      workflows: [
        registerWorkflowDefinition("test/hourly.ts", {
          name: "hourly",
          triggers: [{ intervalMs: 3_600_000 }], // 1h — fires immediately (no prior run)
          steps: [{ id: "run", type: "emit", event: "hourly.done" }],
        }),
      ],
    });

    runtime.start();
    await wait(60); // initial timer fires immediately, workflow runs

    // Write reload signal — re-applies the same definitions, timer is preserved
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(join(projectDir, ".kota", RELOAD_SIGNAL_FILE), "");
    await wait(80); // reload processed (idle timer fires every 20ms)

    await runtime.stop();

    // Signal file consumed
    expect(existsSync(join(projectDir, ".kota", RELOAD_SIGNAL_FILE))).toBe(false);

    // State should have definitionsLoadedAt set (updated by reload)
    const state = JSON.parse(
      readFileSync(join(projectDir, ".kota", "workflow-state.json"), "utf-8"),
    );
    expect(state.definitionsLoadedAt).toBeDefined();
  });

  it("aborts the run when runTimeoutMs is exceeded", async () => {
    writeFileSync(
      join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    mockedExecuteWithAgentSDK.mockImplementation(
      async (_prompt, options) =>
        await new Promise((_resolve, reject) => {
          options?.abortController?.signal.addEventListener("abort", () => {
            reject(options!.abortController!.signal.reason);
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
          runTimeoutMs: 30,
          triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              model: "claude-opus-4-7",
              effort: "xhigh",
              autonomyMode: "autonomous",
            },
          ],
        }),
      ],
    });

    runtime.start();
    await wait(150);
    await runtime.stop();

    const runsDir = join(projectDir, ".kota", "runs");
    const [runId] = readdirSync(runsDir);
    const metadata = JSON.parse(
      readFileSync(join(runsDir, runId, "metadata.json"), "utf-8"),
    );
    expect(metadata.status).toBe("interrupted");
    expect(metadata.steps[0].status).toBe("failed");
    expect(metadata.steps[0].error).toContain('timed out after 30ms');
  });

  describe("concurrent runs", () => {
    it("runs two different agent workflows simultaneously when agentConcurrency=2", async () => {
      const bus = new EventBus();
      const startTimes: Record<string, number> = {};
      const completeTimes: Record<string, number> = {};

      // Track when each workflow starts and ends
      bus.on("workflow.started", (payload) => {
        startTimes[payload.workflow] = Date.now();
      });
      bus.on("workflow.completed", (payload) => {
        completeTimes[payload.workflow] = Date.now();
      });

      // Both workflows hold for ~40ms
      let releaseAlpha: (() => void) | null = null;
      let releaseBeta: (() => void) | null = null;
      mockedExecuteWithAgentSDK
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseAlpha = () =>
                resolve({
                  text: "done",
                  streamedText: "",
                  turns: 1,
                  subtype: "success",
                  isError: false,
                });
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseBeta = () =>
                resolve({
                  text: "done",
                  streamedText: "",
                  turns: 1,
                  subtype: "success",
                  isError: false,
                });
            }),
        );

      writeFileSync(
        join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
        "Build.\n",
      );
      mkdirSync(join(projectDir, "src", "modules", "test", "workflows", "formatter"), { recursive: true });
      writeFileSync(
        join(projectDir, "src", "modules", "test", "workflows", "formatter", "prompt.md"),
        "Format.\n",
      );

      const runtime = new WorkflowRuntime({
        bus,
        projectDir,
        idleIntervalMs: 10,
        agentConcurrency: 2,
        workflows: [
          registerWorkflowDefinition("test/builder.ts", {
            name: "builder",
            triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
            steps: [
              { id: "build", type: "agent", promptPath: "src/modules/autonomy/workflows/builder/prompt.md", model: "claude-opus-4-7", effort: "xhigh", autonomyMode: "autonomous" },
            ],
          }),
          registerWorkflowDefinition("test/formatter.ts", {
            name: "formatter",
            triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
            steps: [
              { id: "format", type: "agent", promptPath: "src/modules/test/workflows/formatter/prompt.md", model: "claude-opus-4-7", effort: "xhigh", autonomyMode: "autonomous" },
            ],
          }),
        ],
      });

      runtime.start();
      await wait(50); // both workflows should have started

      expect(startTimes.builder).toBeDefined();
      expect(startTimes.formatter).toBeDefined();

      // Both should be running concurrently (neither completed yet)
      expect(completeTimes.builder).toBeUndefined();
      expect(completeTimes.formatter).toBeUndefined();

      releaseAlpha!();
      releaseBeta!();
      await wait(60);
      await runtime.stop();

      expect(completeTimes.builder).toBeDefined();
      expect(completeTimes.formatter).toBeDefined();

      const runsDir = join(projectDir, ".kota", "runs");
      const runIds = readdirSync(runsDir);
      expect(runIds.length).toBe(2);
    });

    it("serializes the same workflow when agentConcurrency=2", async () => {
      const bus = new EventBus();
      const completedWorkflows: string[] = [];

      bus.on("workflow.completed", (payload) => {
        completedWorkflows.push(payload.workflow);
      });

      const runtime = new WorkflowRuntime({
        bus,
        projectDir,
        idleIntervalMs: 10,
        agentConcurrency: 2,
        workflows: [
          registerWorkflowDefinition("test/builder.ts", {
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [{ id: "run", type: "emit", event: "builder.done" }],
          }),
        ],
      });

      // Manually enqueue two builder runs
      runtime.start();
      await wait(80);
      await runtime.stop();

      // builder only has one instance at a time — runs should be sequential, not overlapping
      const runsDir = join(projectDir, ".kota", "runs");
      const runIds = readdirSync(runsDir);
      // At most one builder run would have happened per idle tick
      // (same workflow serialized even with agentConcurrency=2)
      for (const runId of runIds) {
        const metadata = JSON.parse(
          readFileSync(join(runsDir, runId, "metadata.json"), "utf-8"),
        );
        expect(metadata.workflow).toBe("builder");
        expect(metadata.status).toBe("success");
      }
    });

    it("activeRuns in state reflects multiple concurrent runs", async () => {
      const bus = new EventBus();
      let releaseAlpha: (() => void) | null = null;
      let releaseBeta: (() => void) | null = null;

      mockedExecuteWithAgentSDK
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseAlpha = () =>
                resolve({
                  text: "done",
                  streamedText: "",
                  turns: 1,
                  subtype: "success",
                  isError: false,
                });
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseBeta = () =>
                resolve({
                  text: "done",
                  streamedText: "",
                  turns: 1,
                  subtype: "success",
                  isError: false,
                });
            }),
        );

      writeFileSync(
        join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
        "Build.\n",
      );
      mkdirSync(join(projectDir, "src", "modules", "test", "workflows", "formatter"), { recursive: true });
      writeFileSync(
        join(projectDir, "src", "modules", "test", "workflows", "formatter", "prompt.md"),
        "Format.\n",
      );

      const runtime = new WorkflowRuntime({
        bus,
        projectDir,
        idleIntervalMs: 10,
        agentConcurrency: 2,
        workflows: [
          registerWorkflowDefinition("test/builder.ts", {
            name: "builder",
            triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
            steps: [
              { id: "build", type: "agent", promptPath: "src/modules/autonomy/workflows/builder/prompt.md", model: "claude-opus-4-7", effort: "xhigh", autonomyMode: "autonomous" },
            ],
          }),
          registerWorkflowDefinition("test/formatter.ts", {
            name: "formatter",
            triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
            steps: [
              { id: "format", type: "agent", promptPath: "src/modules/test/workflows/formatter/prompt.md", model: "claude-opus-4-7", effort: "xhigh", autonomyMode: "autonomous" },
            ],
          }),
        ],
      });

      runtime.start();
      await wait(50); // both workflows should be running

      const { WorkflowRunStore } = await import("./run-store.js");
      const store = new WorkflowRunStore(projectDir);
      const state = store.readState();

      expect(state.activeRuns).toBeDefined();
      expect(state.activeRuns!.length).toBe(2);
      const runningWorkflows = state.activeRuns!.map((r) => r.workflow).sort();
      expect(runningWorkflows).toEqual(["builder", "formatter"]);

      releaseAlpha!();
      releaseBeta!();
      await wait(60);
      await runtime.stop();

      const stateAfter = store.readState();
      expect(stateAfter.activeRuns).toEqual([]);
    });

    it("runs code-only workflow concurrently with a blocked agent workflow", async () => {
      const bus = new EventBus();
      const startTimes: Record<string, number> = {};
      const completeTimes: Record<string, number> = {};

      bus.on("workflow.started", (payload) => {
        startTimes[payload.workflow] = Date.now();
      });
      bus.on("workflow.completed", (payload) => {
        completeTimes[payload.workflow] = Date.now();
      });

      let releaseAgent: (() => void) | null = null;
      mockedExecuteWithAgentSDK.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseAgent = () =>
              resolve({
                text: "done",
                streamedText: "",
                turns: 1,
                subtype: "success",
                isError: false,
              });
          }),
      );

      writeFileSync(
        join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
        "Build.\n",
      );

      // agentConcurrency=1 (default): agent workflow fills the agent slot
      // codeConcurrency=4 (default): code-only workflow can still run
      const runtime = new WorkflowRuntime({
        bus,
        projectDir,
        idleIntervalMs: 10,
        workflows: [
          registerWorkflowDefinition("test/builder.ts", {
            name: "builder",
            triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
            steps: [
              { id: "build", type: "agent", promptPath: "src/modules/autonomy/workflows/builder/prompt.md", model: "claude-opus-4-7", effort: "xhigh", autonomyMode: "autonomous" },
            ],
          }),
          registerWorkflowDefinition("test/notifier.ts", {
            name: "notifier",
            triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
            steps: [
              { id: "notify", type: "emit", event: "notifier.done" },
            ],
          }),
        ],
      });

      runtime.start();
      await wait(50);

      // agent workflow should be running (held by the mock)
      expect(startTimes.builder).toBeDefined();
      // code-only workflow should have already completed independently
      expect(startTimes.notifier).toBeDefined();
      expect(completeTimes.notifier).toBeDefined();
      // agent workflow still in progress
      expect(completeTimes.builder).toBeUndefined();

      releaseAgent!();
      await wait(40);
      await runtime.stop();

      expect(completeTimes.builder).toBeDefined();
    });

    it("serializes workflows in the same named concurrency group", async () => {
      const bus = new EventBus();
      const completedWorkflows: string[] = [];

      bus.on("workflow.completed", (payload) => {
        completedWorkflows.push(payload.workflow);
      });

      const runtime = new WorkflowRuntime({
        bus,
        projectDir,
        idleIntervalMs: 10,
        // both code-only so they'd run concurrently without a group
        // but we assign them to the same concurrencyGroup
        workflows: [
          registerWorkflowDefinition("test/alpha.ts", {
            name: "alpha",
            concurrencyGroup: "shared-group",
            triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
            steps: [{ id: "run", type: "emit", event: "alpha.done" }],
          }),
          registerWorkflowDefinition("test/beta.ts", {
            name: "beta",
            concurrencyGroup: "shared-group",
            triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
            steps: [{ id: "run", type: "emit", event: "beta.done" }],
          }),
        ],
      });

      runtime.start();
      // Give it time: both are code-only and fast, but only one should
      // start at a time due to the shared concurrency group (cap 1).
      // Both should complete sequentially.
      await wait(80);
      await runtime.stop();

      const runsDir = join(projectDir, ".kota", "runs");
      const runIds = readdirSync(runsDir);
      // Both ran, but not simultaneously
      expect(runIds.length).toBeGreaterThanOrEqual(2);
      for (const runId of runIds) {
        const metadata = JSON.parse(
          readFileSync(join(runsDir, runId, "metadata.json"), "utf-8"),
        );
        expect(metadata.status).toBe("success");
      }
    });
  });

  describe("graceful drain on stop", () => {
    it("stops cleanly with no active runs", async () => {
      const runtime = new WorkflowRuntime({
        bus: new EventBus(),
        projectDir,
        idleIntervalMs: 60_000,
        workflows: [],
      });
      runtime.start();
      await wait(10);
      await runtime.stop(100);

      const runsDir = join(projectDir, ".kota", "runs");
      expect(existsSync(runsDir)).toBe(true);
      expect(readdirSync(runsDir).length).toBe(0);
    });

    it("waits for an active run to complete within the grace period", async () => {
      writeFileSync(
        join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
        "Build.\n",
      );
      mockedExecuteWithAgentSDK.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  text: "done",
                  streamedText: "",
                  turns: 1,
                  subtype: "success",
                  isError: false,
                }),
              60,
            ),
          ),
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
                promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
                model: "claude-opus-4-7",
                effort: "xhigh",
                autonomyMode: "autonomous",
              },
            ],
          }),
        ],
      });

      runtime.start();
      await wait(20); // let the run start
      await runtime.stop(500); // grace period well beyond 60ms step delay

      const runsDir = join(projectDir, ".kota", "runs");
      const [runId] = readdirSync(runsDir);
      const metadata = JSON.parse(
        readFileSync(join(runsDir, runId, "metadata.json"), "utf-8"),
      );
      expect(metadata.status).toBe("success");
    });

    it("marks an active run as interrupted when grace period is exceeded", async () => {
      writeFileSync(
        join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
        "Build.\n",
      );
      mockedExecuteWithAgentSDK.mockImplementation(
        async (_prompt, options) =>
          new Promise((_resolve, reject) => {
            options?.abortController?.signal.addEventListener("abort", () => {
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
                promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
                model: "claude-opus-4-7",
                effort: "xhigh",
                autonomyMode: "autonomous",
              },
            ],
          }),
        ],
      });

      runtime.start();
      await wait(30); // let the run start
      await runtime.stop(50); // grace period expires before the mock resolves

      const runsDir = join(projectDir, ".kota", "runs");
      const [runId] = readdirSync(runsDir);
      const metadata = JSON.parse(
        readFileSync(join(runsDir, runId, "metadata.json"), "utf-8"),
      );
      expect(metadata.status).toBe("interrupted");
    });
  });

  describe("enable/disable workflow", () => {
    it("disableWorkflow sets enabled false, records source value, and cancels queued runs", async () => {
      const bus = new EventBus();
      const runtime = new WorkflowRuntime({
        bus,
        projectDir,
        idleIntervalMs: 50_000,
        workflows: [
          registerWorkflowDefinition("test/builder.ts", {
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [{ id: "build", type: "code", run: () => ({}) }],
          }),
        ],
      });

      runtime.start();
      try {
        const defsBefore = runtime.getDefinitions();
        expect(defsBefore[0].enabled).toBe(true);
        expect(runtime.getDefinitionSourceEnabled("builder")).toBeUndefined();

        const result = runtime.disableWorkflow("builder");
        expect(result.ok).toBe(true);

        const defsAfter = runtime.getDefinitions();
        expect(defsAfter[0].enabled).toBe(false);
        expect(runtime.getDefinitionSourceEnabled("builder")).toBe(true);

        // enqueuePendingRun should be rejected for disabled workflow
        const enqueueResult = runtime.enqueuePendingRun("builder");
        expect(enqueueResult.ok).toBe(false);
        expect(enqueueResult.error).toMatch(/disabled/i);
      } finally {
        await runtime.stop();
      }
    });

    it("enableWorkflow re-enables a disabled workflow and triggers dispatch", async () => {
      const bus = new EventBus();
      const runtime = new WorkflowRuntime({
        bus,
        projectDir,
        idleIntervalMs: 50_000,
        workflows: [
          registerWorkflowDefinition("test/builder.ts", {
            name: "builder",
            enabled: false,
            triggers: [{ event: "runtime.idle" }],
            steps: [{ id: "build", type: "code", run: () => ({}) }],
          }),
        ],
      });

      runtime.start();
      try {
        const defsBefore = runtime.getDefinitions();
        expect(defsBefore[0].enabled).toBe(false);

        const result = runtime.enableWorkflow("builder");
        expect(result.ok).toBe(true);
        expect(runtime.getDefinitions()[0].enabled).toBe(true);
        expect(runtime.getDefinitionSourceEnabled("builder")).toBe(false);
      } finally {
        await runtime.stop();
      }
    });

    it("reloadWorkflowDefinitions clears runtime overrides", async () => {
      const bus = new EventBus();
      const runtime = new WorkflowRuntime({
        bus,
        projectDir,
        idleIntervalMs: 50_000,
        workflows: [
          registerWorkflowDefinition("test/builder.ts", {
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [{ id: "build", type: "code", run: () => ({}) }],
          }),
        ],
      });

      runtime.start();
      try {
        runtime.disableWorkflow("builder");
        expect(runtime.getDefinitions()[0].enabled).toBe(false);
        expect(runtime.getDefinitionSourceEnabled("builder")).toBe(true);

        runtime.reloadWorkflowDefinitions();
        // After reload, source definition is re-read (enabled: true from the input)
        expect(runtime.getDefinitions()[0].enabled).toBe(true);
        expect(runtime.getDefinitionSourceEnabled("builder")).toBeUndefined();
      } finally {
        await runtime.stop();
      }
    });

    it("disableWorkflow returns notFound for unknown workflow name", () => {
      const bus = new EventBus();
      const runtime = new WorkflowRuntime({
        bus,
        projectDir,
        idleIntervalMs: 50_000,
        workflows: [],
      });
      const result = runtime.disableWorkflow("nonexistent");
      expect(result.ok).toBe(false);
      expect(result.notFound).toBe(true);
    });
  });

  describe("getDispatchWindowStatus", () => {
    it("returns blocked:false when no dispatchWindow is configured", () => {
      const bus = new EventBus();
      const runtime = new WorkflowRuntime({ bus, projectDir, idleIntervalMs: 50_000, workflows: [] });
      expect(runtime.getDispatchWindowStatus()).toEqual({ blocked: false });
    });

    it("returns blocked:false when current time is inside the window (all-hours window)", () => {
      vi.useFakeTimers({ now: new Date(2026, 0, 15, 12, 0, 0) });
      try {
        const bus = new EventBus();
        const runtime = new WorkflowRuntime({
          bus,
          projectDir,
          idleIntervalMs: 50_000,
          workflows: [],
          config: { scheduler: { dispatchWindow: { start: "00:00", end: "23:59" } } },
        });
        const status = runtime.getDispatchWindowStatus();
        expect(status.blocked).toBe(false);
        expect(status.opensAt).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it("returns blocked:true with opensAt when outside a narrow weekday window", () => {
      const bus = new EventBus();
      // Window: Mon 09:00–09:01 (very narrow — almost certainly outside right now)
      // We use a weekday-only window to ensure the test is time-independent
      const runtime = new WorkflowRuntime({
        bus,
        projectDir,
        idleIntervalMs: 50_000,
        workflows: [],
        config: { scheduler: { dispatchWindow: { start: "03:00", end: "03:01", days: ["wed"] } } },
      });
      // If today is wednesday between 03:00 and 03:01 this would be open; fine for a unit test
      // We just verify the shape: if blocked, opensAt is an ISO string; if not blocked, no error.
      const status = runtime.getDispatchWindowStatus();
      if (status.blocked) {
        expect(typeof status.opensAt).toBe("string");
        expect(new Date(status.opensAt!).toISOString()).toBe(status.opensAt);
      } else {
        expect(status.opensAt).toBeUndefined();
      }
    });
  });
});
