import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import {
  commitFixtureFiles,
  makeDaemon,
  mockedExecuteWithAgentSDK,
  projectDir,
  stateDir,
  wait,
} from "./daemon-test-support.integration.js";

describe("Daemon failure and lifecycle", () => {
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

    const daemonState = JSON.parse(
      readFileSync(join(stateDir, "daemon-state.json"), "utf-8"),
    );
    const workflowState = JSON.parse(
      readFileSync(join(stateDir, "workflow-state.json"), "utf-8"),
    );
    expect(workflowState.completedRuns).toBeGreaterThanOrEqual(1);
    expect(daemonState.completedRuns).toBeUndefined();
    expect(daemonState.lastCompletedWorkflow).toBeUndefined();
  });

  it("can be started again after stop", async () => {
    writeFileSync(
      join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );
    commitFixtureFiles(projectDir);
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

});
