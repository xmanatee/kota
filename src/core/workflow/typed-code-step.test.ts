import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { executeWorkflowRun } from "./run-executor.js";
import { WorkflowRunStore } from "./run-store.js";
import { expectArrayOutput, expectStructuredOutput, typedCodeStep, WorkflowStepOutputValidationError } from "./step-input-code.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

type SamplePayload = { value: number; tag: string };

const TRIGGER: WorkflowRunTrigger = { event: "runtime.idle", payload: {} };

function makeDefinition(steps: WorkflowDefinition["steps"]): WorkflowDefinition {
  return {
    name: "typed-code-step-test",
    enabled: true,
    recoveryCapable: false,
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    moduleRoot: "/test-module-root",
    triggers: [],
    steps,
    tags: [],
  };
}

describe("typedCodeStep runtime validation", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let bus: EventBus;
  const log = vi.fn();

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-typed-code-step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    store = new WorkflowRunStore(projectDir);
    bus = new EventBus();
    log.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("validates successful output and exposes it through output()", async () => {
    let downstreamObserved: SamplePayload | undefined;

    const sampleStep = typedCodeStep<SamplePayload>({
      id: "sample",
      type: "code",
      validate: (raw) => expectStructuredOutput<SamplePayload>(raw, ["value", "tag"]),
      run: () => ({ value: 7, tag: "ok" }),
    });

    const downstream = typedCodeStep<{ ok: true }>({
      id: "downstream",
      type: "code",
      validate: (raw) => expectStructuredOutput<{ ok: true }>(raw, ["ok"]),
      run: (ctx) => {
        downstreamObserved = sampleStep.output(ctx);
        return { ok: true } as const;
      },
    });

    const definition = makeDefinition([sampleStep, downstream]);
    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(downstreamObserved).toEqual({ value: 7, tag: "ok" });
  });

  it("fails the step with WorkflowStepOutputValidationError when run returns a bad shape", async () => {
    const sampleStep = typedCodeStep<SamplePayload>({
      id: "sample",
      type: "code",
      validate: (raw) => expectStructuredOutput<SamplePayload>(raw, ["value", "tag"]),
      // The cast is the whole point — this is what the runtime decoder is
      // catching. TypeScript trusts the annotation; the runtime does not.
      run: () => ({ tag: "missing-value" } as unknown as SamplePayload),
    });

    const definition = makeDefinition([sampleStep]);
    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    const failedStep = result.metadata.steps.find((s) => s.id === "sample");
    expect(failedStep?.status).toBe("failed");
    expect(failedStep?.error ?? "").toMatch(/Step "sample" output failed validation/);
    expect(failedStep?.error ?? "").toMatch(/missing required field "value"/);
    expect(failedStep?.error ?? "").toMatch(/\(run\)/);
  });

  it("fails downstream output() access when persisted stepOutput drifts from the contract", () => {
    const sampleStep = typedCodeStep<SamplePayload>({
      id: "sample",
      type: "code",
      validate: (raw) => expectStructuredOutput<SamplePayload>(raw, ["value", "tag"]),
      run: () => ({ value: 1, tag: "fresh" }),
    });

    // Simulate a resumed run where stepOutputs was loaded from a corrupted
    // metadata.json or a downstream consumer accessed output() before the
    // step ran. The persisted value is missing the required `value` field.
    const fakeContext = {
      stepOutputs: { sample: { tag: "stale" } },
    } as unknown as Parameters<typeof sampleStep.output>[0];

    expect(() => sampleStep.output(fakeContext)).toThrowError(
      WorkflowStepOutputValidationError,
    );
    try {
      sampleStep.output(fakeContext);
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowStepOutputValidationError);
      const e = error as WorkflowStepOutputValidationError;
      expect(e.stepId).toBe("sample");
      expect(e.source).toBe("persisted");
      expect(e.message).toContain("missing required field");
    }
  });

  it("persists the WorkflowStepOutputValidationError in metadata.json", async () => {
    const sampleStep = typedCodeStep<SamplePayload>({
      id: "sample",
      type: "code",
      validate: (raw) => expectStructuredOutput<SamplePayload>(raw, ["value", "tag"]),
      run: () => 42 as unknown as SamplePayload,
    });

    const definition = makeDefinition([sampleStep]);
    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });
    await promise;

    const runDirs = readdirSync(join(projectDir, ".kota", "runs"));
    const metadata = JSON.parse(
      readFileSync(join(projectDir, ".kota", "runs", runDirs[0], "metadata.json"), "utf-8"),
    ) as { status: string; steps: Array<{ id: string; status: string; error?: string }> };

    expect(metadata.status).toBe("failed");
    const sampleResult = metadata.steps.find((s) => s.id === "sample");
    expect(sampleResult?.status).toBe("failed");
    expect(sampleResult?.error ?? "").toMatch(/output failed validation \(run\)/);
    expect(sampleResult?.error ?? "").toContain("expected structured object");
  });

  it("expectArrayOutput validates element shapes", () => {
    const decoder = (raw: unknown) =>
      expectArrayOutput<SamplePayload>(raw, (item) =>
        expectStructuredOutput<SamplePayload>(item, ["value", "tag"]),
      );

    expect(decoder([{ value: 1, tag: "a" }, { value: 2, tag: "b" }])).toEqual([
      { value: 1, tag: "a" },
      { value: 2, tag: "b" },
    ]);

    expect(() => decoder({ not: "an-array" })).toThrowError(
      /expected array output, got object/,
    );
    expect(() => decoder([{ tag: "missing-value" }])).toThrowError(
      /missing required field "value"/,
    );
  });

  it("expectStructuredOutput rejects null, arrays, and primitives", () => {
    const decoder = (raw: unknown) =>
      expectStructuredOutput<SamplePayload>(raw, ["value", "tag"]);

    expect(() => decoder(null)).toThrowError(
      /expected structured object output, got null/,
    );
    expect(() => decoder([])).toThrowError(
      /expected structured object output, got array/,
    );
    expect(() => decoder("hi")).toThrowError(
      /expected structured object output, got string/,
    );
  });
});
