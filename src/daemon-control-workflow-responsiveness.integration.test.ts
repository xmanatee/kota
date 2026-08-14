import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Daemon } from "#core/daemon/daemon.js";
import type {
  DaemonLiveStatus,
  HealthStatus,
} from "#core/daemon/daemon-control.js";
import { resetScheduler } from "#core/daemon/scheduler.js";
import { resetEventBus } from "#core/events/event-bus.js";
import type { BlockingFixtureOutput } from "#core/workflow/testing/blocking-operation-fixture.js";
import { runCpuBlockingFixture } from "#core/workflow/testing/blocking-operation-fixture.js";
import {
  CONTROL_REQUEST_LATENCY_BOUND_MS,
  cpuBlockingOperation,
  initializeControlFixtureRepo as initializeFixtureRepo,
  readControlAddress,
  SUCCESS_RUN_ID,
  type TimedResponse,
  timedControlRequest as timedRequest,
  triggerControlWorkflow as triggerWorkflow,
  waitForRunStatus,
} from "#core/workflow/testing/daemon-control-responsiveness.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import { gatherStatus } from "#modules/daemon-ops/status-cli.js";

describe("daemon control responsiveness during workflow execution", () => {
  const roots: string[] = [];

  afterEach(() => {
    resetEventBus();
    resetScheduler();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("serves health, live status, pause, resume, and CLI status during CPU blocking work", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-control-responsive-"));
    roots.push(projectDir);
    initializeFixtureRepo(projectDir);
    const stateDir = join(projectDir, ".kota");
    mkdirSync(stateDir, { recursive: true });
    resetEventBus();
    resetScheduler();

    const daemon = new Daemon({
      projectDir,
      stateDir,
      idleIntervalMs: 10,
      pollIntervalMs: 60_000,
      workflows: [
        registerWorkflowDefinition("fixtures/control-responsive.ts", {
          name: "control-responsive",
          triggers: [{ event: "manual" }],
          steps: [
            {
              id: "blocking-operation",
              type: "code",
              timeoutMs: 5_000,
              run: (ctx) =>
                ctx.runBlocking(cpuBlockingOperation, {
                  durationMs: 1_800,
                  value: "workflow-complete",
                }),
            },
          ],
        }),
      ],
      config: { defaultAgentHarness: "claude-agent-sdk" },
    });

    const daemonRun = daemon.start();
    try {
      const address = await readControlAddress(stateDir);
      await triggerWorkflow(address, "control-responsive", SUCCESS_RUN_ID);
      await waitForRunStatus(address, SUCCESS_RUN_ID, ["running"]);

      const controlEvidence: Array<TimedResponse<object>> = [];
      for (let index = 0; index < 3; index += 1) {
        const health = await timedRequest<object>(address, "/health");
        const status = await timedRequest<DaemonLiveStatus>(address, "/status");
        const pause = await timedRequest<object>(address, "/workflow/pause", {
          method: "POST",
        });
        const paused = await timedRequest<{
          paused: boolean;
        }>(address, "/workflow/status");
        const resume = await timedRequest<object>(address, "/workflow/resume", {
          method: "POST",
        });
        const resumed = await timedRequest<{
          paused: boolean;
        }>(address, "/workflow/status");

        expect(health.status).toBe(200);
        expect(status.status).toBe(200);
        expect(status.body.running).toBe(true);
        expect(status.body.workflow.activeRuns).toHaveLength(1);
        expect(pause.status).toBe(200);
        expect(paused.body.paused).toBe(true);
        expect(resume.status).toBe(200);
        expect(resumed.body.paused).toBe(false);
        controlEvidence.push(health, status, pause, paused, resume, resumed);
      }

      const cliStartedAt = performance.now();
      const cliStatus = await gatherStatus(projectDir);
      const cliDurationMs = performance.now() - cliStartedAt;
      expect(cliStatus.daemonRunning).toBe(true);
      expect(cliStatus.controlFile.kind).toBe("fresh");

      const completed = await waitForRunStatus(address, SUCCESS_RUN_ID, [
        "success",
      ]);
      expect(completed.steps).toEqual([
        expect.objectContaining({
          id: "blocking-operation",
          status: "success",
        }),
      ]);
      const metadata = JSON.parse(
        readFileSync(
          join(stateDir, "runs", SUCCESS_RUN_ID, "metadata.json"),
          "utf8",
        ),
      ) as {
        status: string;
        steps: Array<{ output?: BlockingFixtureOutput }>;
      };
      expect(metadata.status).toBe("success");
      expect(metadata.steps[0]?.output?.value).toBe("workflow-complete");

      const health = await timedRequest<{
        components: HealthStatus;
      }>(address, "/health");
      const allLatencies = [
        ...controlEvidence.map((entry) => entry.durationMs),
        cliDurationMs,
      ];
      expect(Math.max(...allLatencies)).toBeLessThan(
        CONTROL_REQUEST_LATENCY_BOUND_MS,
      );
      expect(health.body.components.eventLoop?.maxDelayMs).toBeLessThan(
        CONTROL_REQUEST_LATENCY_BOUND_MS,
      );

      // The same fixture run inline reproduces the old architecture after the
      // candidate measurements have been captured, giving this test a tied
      // baseline without contaminating the candidate's event-loop diagnostic.
      const baselineHealthPromise = timedRequest<object>(address, "/health");
      runCpuBlockingFixture(
        { durationMs: 700, value: "inline-baseline" },
        {
          signal: new AbortController().signal,
          reportProgress: () => {},
        },
      );
      const baselineHealth = await baselineHealthPromise;
      expect(baselineHealth.status).toBe(200);
      expect(baselineHealth.durationMs).toBeGreaterThanOrEqual(
        CONTROL_REQUEST_LATENCY_BOUND_MS,
      );

      const evidence = {
        latencyBoundMs: CONTROL_REQUEST_LATENCY_BOUND_MS,
        baselineMainThreadLatencyMs: baselineHealth.durationMs,
        maxControlRequestLatencyMs: Math.max(...allLatencies),
        cliStatusLatencyMs: cliDurationMs,
        eventLoop: health.body.components.eventLoop,
        terminalRunStatus: completed.status,
        pauseResumeCycles: 3,
      };
      const evidencePath = join(
        stateDir,
        "runs",
        SUCCESS_RUN_ID,
        "control-responsiveness.json",
      );
      writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
      expect(JSON.parse(readFileSync(evidencePath, "utf8"))).toMatchObject({
        terminalRunStatus: "success",
        pauseResumeCycles: 3,
      });
      process.stdout.write(
        `[control-responsiveness-evidence] ${JSON.stringify(evidence)}\n`,
      );
    } finally {
      await daemon.stop(1_000, "programmatic", 1_000);
      await daemonRun;
    }
  });

});
