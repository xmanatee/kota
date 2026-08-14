import { describe, expect, it, vi } from "vitest";
import {
  defineWorkflowBlockingOperation,
  runWorkflowBlockingOperation,
} from "./blocking-operation.js";
import { withWorkflowBlockingOperation } from "./blocking-operation-context.js";
import type { WorkflowStepContext } from "./run-types.js";
import type {
  BlockingFixtureInput,
  BlockingFixtureOutput,
} from "./testing/blocking-operation-fixture.js";

const fixtureModule = new URL(
  "./testing/blocking-operation-fixture.js",
  import.meta.url,
).href;

const cpuBlockingOperation = defineWorkflowBlockingOperation<
  BlockingFixtureInput,
  BlockingFixtureOutput
>(fixtureModule, "runCpuBlockingFixture");

describe("workflow blocking operation boundary", () => {
  it("preserves an existing blocking runner when adapting a repair-check context", () => {
    const runBlocking = vi.fn();
    const context = { runBlocking } as unknown as WorkflowStepContext;

    expect(withWorkflowBlockingOperation(context).runBlocking).toBe(runBlocking);
  });

  it("keeps the host event loop responsive during CPU-heavy work", async () => {
    let hostTimerFired = false;
    const timer = setTimeout(() => {
      hostTimerFired = true;
    }, 25);

    const output = await runWorkflowBlockingOperation(cpuBlockingOperation, {
      durationMs: 250,
      value: "complete",
    });

    clearTimeout(timer);
    expect(hostTimerFired).toBe(true);
    expect(output.value).toBe("complete");
    expect(output.blockedForMs).toBeGreaterThanOrEqual(225);
  });

  it("preserves worker errors with operation identity", async () => {
    const operation = defineWorkflowBlockingOperation<Record<string, never>, never>(
      fixtureModule,
      "failBlockingFixture",
    );
    await expect(runWorkflowBlockingOperation(operation, {})).rejects.toThrow(
      /failBlockingFixture.*fixture blocking operation failed/s,
    );
  });

  it("forwards worker progress into code-step heartbeats", async () => {
    const operation = defineWorkflowBlockingOperation<
      BlockingFixtureInput,
      BlockingFixtureOutput
    >(fixtureModule, "runProgressFixture");
    const reportProgress = vi.fn();
    await runWorkflowBlockingOperation(
      operation,
      { durationMs: 40, value: "progress" },
      { reportProgress },
    );
    expect(reportProgress).toHaveBeenCalledWith({
      kind: "code-heartbeat",
      label: "fixture-heartbeat",
    });
  });

  it("terminates CPU-heavy work when the owning step aborts", async () => {
    const abortController = new AbortController();
    const startedAt = Date.now();
    const execution = runWorkflowBlockingOperation(
      cpuBlockingOperation,
      { durationMs: 5_000, value: "never" },
      { signal: abortController.signal },
    );
    setTimeout(() => abortController.abort(new Error("fixture abort")), 40);

    await expect(execution).rejects.toThrow("fixture abort");
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
