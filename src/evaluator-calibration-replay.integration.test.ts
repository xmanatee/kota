import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { createTestScopeRuntime } from "#modules/autonomy/autonomy-runtime.test-helpers.js";
import { autonomyHealthSignal } from "#modules/autonomy/health-signal.js";
import evaluatorCalibrationMonitor from "#modules/autonomy/workflows/evaluator-calibration-monitor/workflow.js";

// Socket availability is an external port; allocation and run execution stay real.
vi.mock("node:net", () => ({
  createServer: () => {
    const server = {
      unref: () => server,
      once: () => server,
      listen: (_options: unknown, listening: () => void) => {
        listening();
        return server;
      },
      close: (closed: () => void) => {
        closed();
        return server;
      },
    };
    return server;
  },
}));

// Retained trigger from dlq-2297db84-7eab-44c6-b75c-e2509dc8b2cb in the
// host diagnostics export captured 2026-09-08T10:03:04.344Z. Only scopeId is
// rebound to the isolated runtime; the worker must obtain paths from its host.
// Regression sensitivity: restoring the producer's pre-9dff3f22f call shape
// (stateDir only) against the authority-aware worker makes this same event fail
// at evaluate-calibration with `The "paths[0]" argument must be of type string.
// Received undefined` and creates a workflow-dispatch dead letter. That commit
// added scopeRoot forwarding alongside authority-aware aggregation. This test
// protects their integration; it does not infer the historical daemon version.
const capturedCompletion = {
  workflow: "builder",
  runId: "2026-09-02T01-15-20-500Z-builder-cxxt7f",
  status: "success",
  triggerEvent: "autonomy.queue.available",
  durationMs: 3227641,
  definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
  runDir: ".kota/runs/2026-09-02T01-15-20-500Z-builder-cxxt7f",
  tags: ["monitored"],
  autonomyMode: "autonomous",
  publicationId: "workflow:2026-09-02T01-15-20-500Z-builder-cxxt7f:completed",
} as const;

it("replays a captured builder completion through calibration dispatch without a dead letter", async () => {
  const scopeRoot = mkdtempSync(join(tmpdir(), "calibration-replay-"));
  const scopeId = deriveDirectoryScopeId(scopeRoot);
  const bus = new EventBus();
  const completed: Array<{ status: string; runDir: string }> = [];
  const signals: string[] = [];
  const logs: string[] = [];
  bus.on("workflow.completed", (event) => {
    if (event.workflow === evaluatorCalibrationMonitor.name) completed.push(event);
  });
  bus.on("evaluator-calibration.regression.detected", () => signals.push("regression"));
  bus.on(autonomyHealthSignal, () => signals.push("health"));
  const fixture = createTestScopeRuntime({
    scope: { scopeRoot, scopeId, displayName: "Calibration replay" },
    bus,
    installSingletons: false,
    onLog: (message) => logs.push(message),
    workflows: [{
      ...evaluatorCalibrationMonitor,
      moduleRoot: process.cwd(),
      definitionPath: "src/modules/autonomy/workflows/evaluator-calibration-monitor/workflow.ts",
    }],
  });
  const { workflowRuntime: runtime, pbus, deadLetterQueue } = fixture;
  runtime.start();
  try {
    pbus.emit("workflow.completed", { ...capturedCompletion, tags: [...capturedCompletion.tags] });
    await expect.poll(() => completed.length, { timeout: 10_000 }).toBe(1);
    expect(completed[0]?.status).toBe("success");
    const observation = JSON.parse(readFileSync(join(
      scopeRoot,
      completed[0]!.runDir,
      "evaluator-calibration-observation.json",
    ), "utf8"));
    expect(observation).toMatchObject({
      sourceRunId: capturedCompletion.runId,
      status: "insufficient-sample",
      driftKinds: [],
      aggregate: { totalRuns: 0 },
    });
    expect(signals).toEqual([]);
    expect(deadLetterQueue.list()).toEqual([]);
    expect(fixture.runState.listRuns(scopeId)).toEqual([
      expect.objectContaining({ workflow: evaluatorCalibrationMonitor.name, state: "succeeded" }),
    ]);
  } catch (error) {
    throw new Error(JSON.stringify({ logs, runs: fixture.runState.listRuns(scopeId), deadLetters: deadLetterQueue.list() }), { cause: error });
  } finally {
    await runtime.stop();
    fixture.runState.close();
    bus.clear();
    rmSync(scopeRoot, { recursive: true, force: true });
  }
});
