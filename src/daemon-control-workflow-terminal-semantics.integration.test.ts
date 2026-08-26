import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Daemon } from "#core/daemon/daemon.js";
import { resetScheduler } from "#core/daemon/scheduler.js";
import { resetEventBus } from "#core/events/event-bus.js";
import type { RecoveringFixtureOutput } from "#core/workflow/testing/blocking-operation-fixture.js";
import {
  CONTROL_REQUEST_LATENCY_BOUND_MS,
  cpuBlockingOperation,
  failingOperation,
  initializeControlFixtureRepo,
  readControlAddress,
  recoveringOperation,
  timedControlRequest,
  triggerControlWorkflow,
  waitForRunStatus,
} from "#core/workflow/testing/daemon-control-responsiveness.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";

describe("blocking workflow operation terminal semantics", () => {
  const roots: string[] = [];

  afterEach(() => {
    resetEventBus();
    resetScheduler();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("records failure, transient recovery, and operator abort in run metadata", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-control-terminal-"));
    roots.push(projectDir);
    initializeControlFixtureRepo(projectDir);
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
        registerWorkflowDefinition("fixtures/control-failure.ts", {
          repository: "read",
          name: "control-failure",
          triggers: [{ event: "manual" }],
          steps: [{
            id: "fail-in-worker",
            type: "code",
            run: (ctx) => ctx.runBlocking(failingOperation, {}),
          }],
        }),
        registerWorkflowDefinition("fixtures/control-abort.ts", {
          repository: "read",
          name: "control-abort",
          triggers: [{ event: "manual" }],
          steps: [{
            id: "abort-in-worker",
            type: "code",
            timeoutMs: 10_000,
            run: (ctx) => ctx.runBlocking(cpuBlockingOperation, {
              durationMs: 5_000,
              value: "should-not-complete",
            }),
          }],
        }),
        registerWorkflowDefinition("fixtures/control-recovery.ts", {
          repository: "read",
          name: "control-recovery",
          triggers: [{ event: "manual" }],
          steps: [{
            id: "recover-in-worker",
            type: "code",
            run: (ctx) =>
              ctx.runBlocking(recoveringOperation, {
                markerPath: join(stateDir, "blocking-recovery-marker.txt"),
              }),
          }],
        }),
      ],
      config: { defaultAgentHarness: "claude-agent-sdk" },
    });

    const daemonRun = daemon.start();
    try {
      const address = await readControlAddress(stateDir);
      const failureRunId = "2026-08-13T12-00-01-000Z-control-failure-fixture";
      await triggerControlWorkflow(address, "control-failure", failureRunId);
      const failed = await waitForRunStatus(address, failureRunId, ["failed"]);
      expect(failed.steps[0]).toMatchObject({
        id: "fail-in-worker",
        status: "failed",
      });
      expect(failed.steps[0]?.error).toContain("fixture blocking operation failed");

      const failedRecoveryRunId =
        "2026-08-13T12-00-01-500Z-control-recovery-fixture";
      await triggerControlWorkflow(
        address,
        "control-recovery",
        failedRecoveryRunId,
      );
      const transientFailure = await waitForRunStatus(
        address,
        failedRecoveryRunId,
        ["failed"],
      );
      expect(transientFailure.steps[0]).toMatchObject({
        id: "recover-in-worker",
        status: "failed",
      });
      expect(transientFailure.steps[0]?.error).toContain(
        "fixture transient blocking operation failure",
      );

      const recoveryRunId =
        "2026-08-13T12-00-01-750Z-control-recovery-retry-fixture";
      await triggerControlWorkflow(address, "control-recovery", recoveryRunId, {
        retryOf: failedRecoveryRunId,
      });
      const recovered = await waitForRunStatus(address, recoveryRunId, [
        "success",
      ]);
      expect(recovered.retryOf).toBe(failedRecoveryRunId);
      expect(recovered.steps[0]).toMatchObject({
        id: "recover-in-worker",
        status: "success",
      });
      const recoveredMetadata = JSON.parse(readFileSync(
        join(stateDir, "runs", recoveryRunId, "metadata.json"),
        "utf8",
      )) as {
        retryOf?: string;
        trigger: { payload: { retryOf?: string } };
        steps: Array<{ output?: RecoveringFixtureOutput }>;
      };
      expect(recoveredMetadata.retryOf).toBe(failedRecoveryRunId);
      expect(recoveredMetadata.trigger.payload.retryOf).toBe(
        failedRecoveryRunId,
      );
      expect(recoveredMetadata.steps[0]?.output).toEqual({
        recovered: true,
        attempts: 2,
      });

      const abortRunId = "2026-08-13T12-00-02-000Z-control-abort-fixture";
      await triggerControlWorkflow(address, "control-abort", abortRunId);
      await waitForRunStatus(address, abortRunId, ["running"]);
      const abortResponse = await timedControlRequest<{ ok: boolean }>(
        address,
        `/workflow/runs/${abortRunId}/abort`,
        { method: "POST" },
      );
      expect(abortResponse.status).toBe(200);
      expect(abortResponse.durationMs).toBeLessThan(
        CONTROL_REQUEST_LATENCY_BOUND_MS,
      );
      const interrupted = await waitForRunStatus(address, abortRunId, [
        "interrupted",
      ]);
      expect(interrupted.steps[0]).toMatchObject({
        id: "abort-in-worker",
        status: "failed",
      });
      expect(interrupted.steps[0]?.error).toMatch(/abort|interrupted/i);
    } finally {
      await daemon.stop(1_000, "programmatic", 1_000);
      await daemonRun;
    }
  });
});
