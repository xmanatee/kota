import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEventBus } from "#core/events/event-bus.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import { executeWithAgentSDK } from "#modules/claude-agent-harness/executor.js";
import { Daemon, type DaemonConfig, RESTART_EXIT_CODE } from "./daemon.js";
import { getScheduler, initScheduler, resetScheduler } from "./scheduler.js";

vi.mock("#modules/claude-agent-harness/executor.js", async () => {
  const actual = await vi.importActual("../../modules/claude-agent-harness/executor.js");
  return {
    ...actual,
    executeWithAgentSDK: vi.fn(),
  };
});

vi.mock("./task-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./task-store.js")>();
  return { ...actual, initTaskStore: vi.fn() };
});

import "#modules/claude-agent-harness/index.js";

const mockedExecuteWithAgentSDK = vi.mocked(executeWithAgentSDK);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Daemon", () => {
  let projectDir: string;
  let stateDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-daemon-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    stateDir = join(projectDir, ".kota");
    mkdirSync(join(projectDir, "src", "modules", "autonomy", "workflows", "builder"), { recursive: true });
    resetEventBus();
    resetScheduler();
    mockedExecuteWithAgentSDK.mockReset();
  });

  afterEach(() => {
    resetEventBus();
    resetScheduler();
    rmSync(projectDir, { recursive: true, force: true });
  });

  function makeDaemon(overrides: Partial<DaemonConfig> = {}): Daemon {
    return new Daemon({
      projectDir,
      model: "claude-sonnet-4-6",
      verbose: false,
      idleIntervalMs: 1000,
      pollIntervalMs: 60_000,
      stateDir,
      config: { defaultAgentHarness: "claude-agent-sdk" },
      ...overrides,
    });
  }

  it("constructs without errors", () => {
    const daemon = makeDaemon();
    expect(daemon.isRunning()).toBe(false);
    expect(daemon.hasActiveWorkflow()).toBe(false);
  });

  it("exports RESTART_EXIT_CODE as 75", () => {
    expect(RESTART_EXIT_CODE).toBe(75);
  });

  it("starts and stops cleanly", async () => {
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

    const daemon = makeDaemon({
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
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
    const startPromise = daemon.start();
    await wait(60);

    expect(daemon.isRunning()).toBe(true);
    await daemon.stop();
    await startPromise;
    expect(daemon.isRunning()).toBe(false);
  });

  it("records completed autonomous runs in daemon state", async () => {
    writeFileSync(
      join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );
    mockedExecuteWithAgentSDK.mockResolvedValue({
      text: "done",
      streamedText: "",
      sessionId: "sess-1",
      turns: 2,
      subtype: "success",
      isError: false,
    });

    const daemon = makeDaemon({
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
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
    const startPromise = daemon.start();
    await wait(80);

    const state = daemon.getState();
    expect(state.completedRuns).toBeGreaterThanOrEqual(1);
    expect(state.lastCompletedWorkflow).toBe("builder");
    expect(state.lastCompletedStatus).toBe("success");

    await daemon.stop();
    await startPromise;
  });

  it("handles scheduled notification items when they fire", async () => {
    initScheduler(projectDir, stateDir);
    const scheduler = getScheduler();
    scheduler.add("Test reminder", new Date(Date.now() - 1000));

    const daemon = makeDaemon({ pollIntervalMs: 100, workflows: [] });
    const startPromise = daemon.start();
    await wait(300);

    await daemon.stop();
    await startPromise;

    const fired = scheduler.list().filter((item) => item.status === "fired");
    expect(fired.length).toBeGreaterThanOrEqual(1);
  });

  it("saves daemon state in the project-local state dir", async () => {
    const daemon = makeDaemon({ workflows: [] });
    const startPromise = daemon.start();
    await daemon.stop();
    await startPromise;

    const statePath = join(stateDir, "daemon-state.json");
    expect(existsSync(statePath)).toBe(true);
  });

  it("stays running while idle until explicitly stopped", async () => {
    const daemon = makeDaemon({ workflows: [] });
    let resolved = false;
    const startPromise = daemon.start().then(() => {
      resolved = true;
    });

    await wait(150);

    expect(daemon.isRunning()).toBe(true);
    expect(resolved).toBe(false);

    await daemon.stop();
    await startPromise;
    expect(resolved).toBe(true);
  });

  it("fails fast on corrupted daemon state files", () => {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "daemon-state.json"), "not json", "utf-8");

    expect(() => makeDaemon({ workflows: [] })).toThrow(/daemon-state\.json/);
  });

  it("fails before publishing control state when workflow definitions are invalid", async () => {
    writeFileSync(
      join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );
    const daemon = makeDaemon({
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              model: "claude-opus-4-7",
              effort: "xhigh",
              autonomyMode: "autonomous",
              harness: "missing-harness",
            },
          ],
        }),
      ],
    });

    await expect(daemon.start()).rejects.toThrow('Unknown agent harness "missing-harness"');
    expect(existsSync(join(stateDir, "daemon-control.json"))).toBe(false);
    expect(daemon.isRunning()).toBe(false);
  });

  it("removes signal handlers on stop", async () => {
    const initialSigintCount = process.listenerCount("SIGINT");
    const initialSigtermCount = process.listenerCount("SIGTERM");

    const daemon = makeDaemon({ workflows: [] });
    const startPromise = daemon.start();

    expect(process.listenerCount("SIGINT")).toBe(initialSigintCount + 1);
    expect(process.listenerCount("SIGTERM")).toBe(initialSigtermCount + 1);

    await daemon.stop();
    await startPromise;

    expect(process.listenerCount("SIGINT")).toBe(initialSigintCount);
    expect(process.listenerCount("SIGTERM")).toBe(initialSigtermCount);
  });

  it("aborts active workflow runs immediately on foreground interrupt", async () => {
    writeFileSync(
      join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );
    const captured: { signal?: AbortSignal } = {};
    mockedExecuteWithAgentSDK.mockImplementation(
      async (_prompt, options) =>
        new Promise((_resolve, reject) => {
          captured.signal = options?.abortController?.signal;
          captured.signal?.addEventListener("abort", () => {
            reject(captured.signal?.reason ?? new Error("aborted"));
          });
        }),
    );

    const daemon = makeDaemon({
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
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

    const startPromise = daemon.start();
    await wait(80);
    expect(captured.signal).toBeDefined();

    process.emit("SIGINT", "SIGINT");
    await startPromise;

    expect(captured.signal?.aborted).toBe(true);
    expect(daemon.isRunning()).toBe(false);
  });

  it("persists completed run state to disk", async () => {
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

    const daemon = makeDaemon({
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
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
    const startPromise = daemon.start();
    await wait(80);
    await daemon.stop();
    await startPromise;

    const state = JSON.parse(
      readFileSync(join(stateDir, "daemon-state.json"), "utf-8"),
    );
    expect(state.completedRuns).toBeGreaterThanOrEqual(1);
    expect(state.lastCompletedWorkflow).toBe("builder");
  });

  it("can be started again after stop", async () => {
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

    const daemon = makeDaemon({
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
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
    const firstStart = daemon.start();
    await wait(50);
    await daemon.stop();
    await firstStart;

    const secondStart = daemon.start();
    await wait(50);
    await daemon.stop();
    await secondStart;

    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(2);
  });

  it("records failed workflow status without requesting restart", async () => {
    writeFileSync(
      join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );
    mockedExecuteWithAgentSDK.mockResolvedValue({
      text: "",
      streamedText: "",
      turns: 1,
      subtype: "error_max_turns",
      isError: true,
    });

    const daemon = makeDaemon({
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
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

    const previousExitCode = process.exitCode;
    try {
      const startPromise = daemon.start();
      await wait(120);

      const state = daemon.getState();
      expect(state.lastCompletedStatus).toBe("failed");
      expect(state.lastCompletedWorkflow).toBe("builder");
      expect(state.completedRuns).toBeGreaterThanOrEqual(1);
      expect(process.exitCode).not.toBe(RESTART_EXIT_CODE);
      expect(daemon.isRunning()).toBe(true);

      await daemon.stop();
      await startPromise;
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("recovers queued follow-up workflows after restart-triggering builds", async () => {
    const previousExitCode = process.exitCode;
    const workflows = [
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

    try {
      const firstDaemon = makeDaemon({
        workflows,
        idleIntervalMs: 50,
      });
      await firstDaemon.start();

      expect(process.exitCode).toBe(RESTART_EXIT_CODE);

      const secondDaemon = makeDaemon({
        workflows,
        idleIntervalMs: 50,
      });
      const secondStart = secondDaemon.start();
      await wait(200);

      expect(secondDaemon.getState().lastCompletedWorkflow).toBe("improver");

      await secondDaemon.stop();
      await secondStart;
    } finally {
      process.exitCode = previousExitCode;
    }
  });
});
