import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { PRESET_ENV_VAR } from "#core/model/preset.js";
import { WorkflowRuntime } from "#core/workflow/runtime.js";
import { executeWithAgentSDK } from "#modules/claude-agent-harness/executor.js";
import {
  loadAutonomyWorkflowDefinitions,
  seedAutonomousLoopFixture,
  wait,
  waitForCompletedWorkflows,
} from "./autonomous-loop.integration-test-helpers.js";

vi.mock("#modules/claude-agent-harness/executor.js", async () => {
  const actual = await vi.importActual("../claude-agent-harness/executor.js");
  return { ...actual, executeWithAgentSDK: vi.fn() };
});

import "#modules/claude-agent-harness/index.js";

const mockedExecuteWithAgentSDK = vi.mocked(executeWithAgentSDK);

describe("autonomous workflow handoff integration", () => {
  let projectDir: string;
  let savedPreset: string | undefined;

  beforeEach(() => {
    savedPreset = process.env[PRESET_ENV_VAR];
    process.env[PRESET_ENV_VAR] = "claude";
    projectDir = join(
      tmpdir(),
      `kota-integ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    seedAutonomousLoopFixture(projectDir);
    mockedExecuteWithAgentSDK.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    if (savedPreset === undefined) delete process.env[PRESET_ENV_VAR];
    else process.env[PRESET_ENV_VAR] = savedPreset;
  });

  it(
    "drives inbox-sorter → builder without completion-wide improver fan-out",
    { timeout: 90_000 },
    async () => {
      mockedExecuteWithAgentSDK
        .mockResolvedValueOnce({
          text: "Inbox sorted",
          streamedText: "",
          turns: 1,
          totalCostUsd: 0.01,
          isError: false,
        } as never)
        .mockResolvedValueOnce({
          text: JSON.stringify({
            decision: "pass",
            summary: "Inbox sorter artifacts are consistent.",
            citedArtifacts: [],
            findings: [],
          }),
          streamedText: "",
          turns: 1,
          totalCostUsd: 0.01,
          subtype: "success",
          isError: false,
        } as never)
        .mockResolvedValue({
          text: "Agent step hit max turns",
          streamedText: "",
          turns: 40,
          totalCostUsd: 0.3,
          subtype: "error_max_turns",
          isError: true,
        } as never);

      const bus = new EventBus();
      const completedRuns: Array<{
        workflow: string;
        status: string;
        triggerEvent: string;
      }> = [];
      bus.on("workflow.completed", (payload) => {
        completedRuns.push({
          workflow: payload.workflow as string,
          status: payload.status as string,
          triggerEvent: payload.triggerEvent as string,
        });
      });

      const workflows = (await loadAutonomyWorkflowDefinitions()).filter(
        (workflow) =>
          ["dispatcher", "inbox-sorter", "builder", "improver"].includes(
            workflow.name,
          ),
      );
      const { setBuilderPortAvailabilityCheckerForTest } = await import(
        "./workflows/builder/runtime-resource-ports.js"
      );
      const restorePortAvailability = setBuilderPortAvailabilityCheckerForTest(
        async () => true,
      );
      const runtime = new WorkflowRuntime({
        config: {
          defaultAgentHarness: "claude-agent-sdk",
          defaultPreset: "claude",
        },
        bus,
        projectDir,
        idleIntervalMs: 10,
        workflows,
      });

      runtime.start();
      try {
        await waitForCompletedWorkflows(
          completedRuns,
          ["inbox-sorter", "builder"],
          70_000,
        );
        await wait(100);
      } finally {
        restorePortAvailability();
        await runtime.stop();
      }

      expect(completedRuns.find((run) => run.workflow === "inbox-sorter"))
        .toMatchObject({ status: "success" });
      expect(completedRuns.find((run) => run.workflow === "builder"))
        .toMatchObject({ triggerEvent: "autonomy.queue.available" });

      const runsDir = join(projectDir, ".kota", "runs");
      expect(existsSync(runsDir)).toBe(true);
      const runIds = readdirSync(runsDir);
      const builderRunDir = runIds.find((id) => {
        const metadata = JSON.parse(
          readFileSync(join(runsDir, id, "metadata.json"), "utf-8"),
        );
        return metadata.workflow === "builder";
      });
      expect(builderRunDir).toBeDefined();
      const readBuilderStep = (name: string) => JSON.parse(
        readFileSync(join(runsDir, builderRunDir!, "steps", `${name}.json`), "utf-8"),
      );
      expect(readBuilderStep("inspect-ready-queue").output).toMatchObject({
        counts: { ready: 4, backlog: 8 },
        inboxCount: 1,
      });
      expect(readBuilderStep("build")).toMatchObject({
        status: "failed",
        error: expect.stringContaining("max turns"),
      });
      expect(
        existsSync(join(runsDir, builderRunDir!, "steps", "commit.json")),
      ).toBe(false);
      expect(completedRuns.some((run) => run.workflow === "improver")).toBe(false);
    },
  );
});
