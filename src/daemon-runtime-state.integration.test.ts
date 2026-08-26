import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/index.js";
import { Scheduler } from "#core/daemon/index.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import {
  makeDaemon,
  mockedExecuteWithAgentSDK,
  scopeRoot,
  stateDir,
  wait,
} from "./daemon-test-support.integration.js";

describe("Daemon runtime state", () => {
  it("records completed autonomous runs in daemon state", async () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );
    mockedExecuteWithAgentSDK.mockResolvedValue({
      text: "done",
      streamedText: "",
      sessionId: "sess-1",
      turns: 2,
      usage: UNKNOWN_AGENT_USAGE,
      subtype: "success",
      isError: false,
    });

    const daemon = makeDaemon({
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          repository: "read",
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
    await daemon.whenReady();
    const deadline = Date.now() + 5_000;
    while (daemon.getDashboardSnapshot().completedRuns < 1 && Date.now() < deadline) {
      await wait(20);
    }

    const state = daemon.getDashboardSnapshot();
    expect(state.completedRuns).toBeGreaterThanOrEqual(1);
    expect(state.lastCompletedWorkflow).toBe("builder");
    expect(state.lastCompletedStatus).toBe("success");

    await daemon.stop();
    await startPromise;
  });

  it("handles scheduled notification items when they fire", async () => {
    const daemon = makeDaemon({ pollIntervalMs: 100, workflows: [] });
    // Write through a second scheduler instance to prove the hosted runtime
    // observes the same persisted scope schedule.
    const scheduler = new Scheduler(scopeRoot, stateDir);
    scheduler.add("Test reminder", new Date(Date.now() - 1000));

    const startPromise = daemon.start();
    await wait(300);

    await daemon.stop();
    await startPromise;

    const fired = new Scheduler(scopeRoot, stateDir)
      .list()
      .filter((item) => item.status === "fired");
    expect(fired.length).toBeGreaterThanOrEqual(1);
  });

  it("saves daemon state in the scope-local state directory", async () => {
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

});
