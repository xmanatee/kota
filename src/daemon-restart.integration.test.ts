import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RESTART_EXIT_CODE } from "#core/daemon/index.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import {
  makeDaemon,
  mockedExecuteWithAgentSDK,
  projectDir,
  wait,
} from "./daemon-test-support.integration.js";

describe("Daemon restart recovery", () => {
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

      const state = daemon.getDashboardSnapshot();
      expect(state.lastCompletedStatus).toBe("failed");
      expect(state.lastCompletedWorkflow).toBe("builder");
      expect(daemon.getDashboardSnapshot().completedRuns).toBeGreaterThanOrEqual(1);
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
      const restartExit = vi.fn();
      const firstDaemon = makeDaemon({
        workflows,
        idleIntervalMs: 50,
        restartExit,
      });
      await firstDaemon.start();

      expect(restartExit).toHaveBeenCalledWith(RESTART_EXIT_CODE);
      expect(process.exitCode).toBe(previousExitCode);

      const secondDaemon = makeDaemon({
        workflows,
        idleIntervalMs: 50,
      });
      const secondStart = secondDaemon.start();
      await wait(200);

      expect(secondDaemon.getDashboardSnapshot().lastCompletedWorkflow).toBe("improver");

      await secondDaemon.stop();
      await secondStart;
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("rejects start when restart handoff fails instead of swallowing the failed exit", async () => {
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
    ];

    try {
      const restartExit = vi.fn(() => {
        throw new Error("restart exit unavailable");
      });
      const daemon = makeDaemon({
        workflows,
        idleIntervalMs: 50,
        restartExit,
      });

      await expect(daemon.start()).rejects.toThrow("restart exit unavailable");
      expect(restartExit).toHaveBeenCalledWith(RESTART_EXIT_CODE);
      expect(daemon.isRunning()).toBe(false);
      expect(process.exitCode).toBe(previousExitCode);
    } finally {
      process.exitCode = previousExitCode;
    }
  });
});
