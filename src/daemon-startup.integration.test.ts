import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RESTART_EXIT_CODE } from "#core/daemon/index.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import {
  makeDaemon,
  mockedExecuteWithAgentSDK,
  scopeRoot,
  wait,
} from "./daemon-test-support.integration.js";

describe("Daemon startup and channels", () => {
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
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );
    mockedExecuteWithAgentSDK.mockResolvedValue({
      text: "done",
      streamedText: "",
      turns: 1,
      subtype: "success",
      isError: false,
    });
    const unloadModules = vi.fn(async () => {});

    const daemon = makeDaemon({
      unloadModules,
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
    await wait(60);

    expect(daemon.isRunning()).toBe(true);
    await daemon.stop();
    await startPromise;
    expect(daemon.isRunning()).toBe(false);
    expect(unloadModules).toHaveBeenCalledTimes(1);
  });

  it("records each contributed channel's startup posture", async () => {
    const daemon = makeDaemon({
      workflows: [],
      channels: [
        {
          name: "ch-started",
          create() {
            return {
              status: "started",
              adapter: {
                async start() {},
                stop() {},
                listScopeSessionIds: () => [],
              },
            };
          },
        },
        {
          name: "ch-disabled",
          create() {
            return { status: "disabled", reason: "operator turned it off" };
          },
        },
        {
          name: "ch-unavailable",
          description: "missing creds",
          create() {
            return {
              status: "unavailable",
              reason: "secret SOME_TOKEN is not set",
            };
          },
        },
        {
          name: "ch-failed-create",
          create() {
            throw new Error("create blew up");
          },
        },
        {
          name: "ch-failed-start",
          create() {
            return {
              status: "started",
              adapter: {
                async start() {
                  throw new Error("start blew up");
                },
                stop() {},
                listScopeSessionIds: () => [],
              },
            };
          },
        },
        {
          name: "ch-failed-result",
          create() {
            return { status: "failed", error: "deps unavailable" };
          },
        },
      ],
    });

    const startPromise = daemon.start();
    await wait(60);

    const statuses = daemon.getChannelStatuses();
    const byName = new Map(statuses.map((s) => [s.name, s]));

    expect(byName.get("ch-started")).toMatchObject({ status: "started" });
    expect(byName.get("ch-disabled")).toMatchObject({
      status: "disabled",
      reason: "operator turned it off",
    });
    expect(byName.get("ch-unavailable")).toMatchObject({
      status: "unavailable",
      reason: "secret SOME_TOKEN is not set",
      description: "missing creds",
    });
    expect(byName.get("ch-failed-create")).toMatchObject({
      status: "failed",
      error: "create blew up",
    });
    expect(byName.get("ch-failed-start")).toMatchObject({
      status: "failed",
      error: "start blew up",
    });
    expect(byName.get("ch-failed-result")).toMatchObject({
      status: "failed",
      error: "deps unavailable",
    });
    // Daemon stays up despite failed channels: optional channels degrade cleanly.
    expect(daemon.isRunning()).toBe(true);

    await daemon.stop();
    await startPromise;
    // Posture clears on shutdown.
    expect(daemon.getChannelStatuses()).toHaveLength(0);
  });

});
