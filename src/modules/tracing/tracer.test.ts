import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildModelLookup, WorkflowTracer } from "./tracer.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kota-tracer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("WorkflowTracer", () => {
  let exporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;
  let projectDir: string;

  beforeEach(() => {
    trace.disable();
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      resource: resourceFromAttributes({ "service.name": "kota-test" }),
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
    projectDir = makeTmpDir();
  });

  afterEach(async () => {
    await provider.shutdown();
    trace.disable();
  });

  it("creates a root span for a workflow run", () => {
    const tracer = new WorkflowTracer(projectDir, new Map());
    tracer.onWorkflowStarted({
      workflow: "builder",
      runId: "run-1",
      triggerEvent: "autonomy.queue.available",
      runDir: ".kota/runs/run-1",
      startedAt: new Date().toISOString(),
    });
    tracer.onWorkflowCompleted({
      workflow: "builder",
      runId: "run-1",
      status: "success",
      durationMs: 5000,
      triggerEvent: "autonomy.queue.available",
      tags: [],
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.name).toBe("workflow.run");
    expect(span.attributes["workflow.name"]).toBe("builder");
    expect(span.attributes["workflow.run_id"]).toBe("run-1");
    expect(span.attributes["workflow.trigger_event"]).toBe("autonomy.queue.available");
    expect(span.attributes["workflow.status"]).toBe("success");
    expect(span.attributes["workflow.duration_ms"]).toBe(5000);
    expect(span.status.code).toBe(SpanStatusCode.OK);
  });

  it("creates correctly nested child spans for steps", () => {
    const tracer = new WorkflowTracer(projectDir, new Map());
    const now = new Date();

    tracer.onWorkflowStarted({
      workflow: "builder",
      runId: "run-2",
      triggerEvent: "test",
      runDir: ".kota/runs/run-2",
      startedAt: now.toISOString(),
    });
    tracer.onStepStarted({
      workflow: "builder",
      runId: "run-2",
      stepId: "step-a",
      stepType: "code",
      startedAt: now.toISOString(),
    });
    tracer.onStepCompleted({
      workflow: "builder",
      runId: "run-2",
      stepId: "step-a",
      stepType: "code",
      status: "success",
      durationMs: 100,
      runDir: ".kota/runs/run-2",
    });
    tracer.onStepStarted({
      workflow: "builder",
      runId: "run-2",
      stepId: "step-b",
      stepType: "agent",
      startedAt: now.toISOString(),
    });
    tracer.onStepCompleted({
      workflow: "builder",
      runId: "run-2",
      stepId: "step-b",
      stepType: "agent",
      status: "success",
      durationMs: 3000,
      costUsd: 0.42,
      runDir: ".kota/runs/run-2",
    });
    tracer.onWorkflowCompleted({
      workflow: "builder",
      runId: "run-2",
      status: "success",
      durationMs: 3200,
      triggerEvent: "test",
      tags: ["autonomy"],
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(3);

    const stepA = spans.find((s) => s.name === "step.code");
    const stepB = spans.find((s) => s.name === "step.agent");
    const root = spans.find((s) => s.name === "workflow.run");

    expect(stepA).toBeDefined();
    expect(stepB).toBeDefined();
    expect(root).toBeDefined();

    expect(stepA!.parentSpanContext?.spanId).toBe(root!.spanContext().spanId);
    expect(stepB!.parentSpanContext?.spanId).toBe(root!.spanContext().spanId);

    expect(stepB!.attributes["workflow.step.cost_usd"]).toBe(0.42);
    expect(root!.attributes["workflow.tags"]).toBe("autonomy");
  });

  it("sets ERROR status on failed workflows", () => {
    const tracer = new WorkflowTracer(projectDir, new Map());
    tracer.onWorkflowStarted({
      workflow: "test-wf",
      runId: "run-fail",
      triggerEvent: "test",
      runDir: ".kota/runs/run-fail",
      startedAt: new Date().toISOString(),
    });
    tracer.onWorkflowCompleted({
      workflow: "test-wf",
      runId: "run-fail",
      status: "failed",
      durationMs: 100,
      triggerEvent: "test",
      tags: [],
    });

    const spans = exporter.getFinishedSpans();
    expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
  });

  it("sets ERROR status on failed steps", () => {
    const tracer = new WorkflowTracer(projectDir, new Map());
    tracer.onWorkflowStarted({
      workflow: "test-wf",
      runId: "run-sf",
      triggerEvent: "test",
      runDir: ".kota/runs/run-sf",
      startedAt: new Date().toISOString(),
    });
    tracer.onStepStarted({
      workflow: "test-wf",
      runId: "run-sf",
      stepId: "bad-step",
      stepType: "tool",
      startedAt: new Date().toISOString(),
    });
    tracer.onStepCompleted({
      workflow: "test-wf",
      runId: "run-sf",
      stepId: "bad-step",
      stepType: "tool",
      status: "failed",
      durationMs: 50,
      runDir: ".kota/runs/run-sf",
    });
    tracer.onWorkflowCompleted({
      workflow: "test-wf",
      runId: "run-sf",
      status: "failed",
      durationMs: 60,
      triggerEvent: "test",
      tags: [],
    });

    const spans = exporter.getFinishedSpans();
    const stepSpan = spans.find((s) => s.name === "step.tool");
    expect(stepSpan!.status.code).toBe(SpanStatusCode.ERROR);
  });

  it("tags workflow and step spans with autonomy_mode when payload carries it", () => {
    const tracer = new WorkflowTracer(projectDir, new Map());
    tracer.onWorkflowStarted({
      workflow: "builder",
      runId: "run-am",
      triggerEvent: "autonomy.queue.available",
      runDir: ".kota/runs/run-am",
      startedAt: new Date().toISOString(),
      autonomyMode: "autonomous",
    });
    tracer.onStepStarted({
      workflow: "builder",
      runId: "run-am",
      stepId: "build",
      stepType: "agent",
      startedAt: new Date().toISOString(),
      autonomyMode: "autonomous",
    });
    tracer.onStepCompleted({
      workflow: "builder",
      runId: "run-am",
      stepId: "build",
      stepType: "agent",
      status: "success",
      durationMs: 1000,
      runDir: ".kota/runs/run-am",
      autonomyMode: "supervised",
    });
    tracer.onWorkflowCompleted({
      workflow: "builder",
      runId: "run-am",
      status: "success",
      durationMs: 1100,
      triggerEvent: "autonomy.queue.available",
      tags: [],
      autonomyMode: "autonomous",
    });

    const spans = exporter.getFinishedSpans();
    const root = spans.find((s) => s.name === "workflow.run");
    const stepSpan = spans.find((s) => s.name === "step.agent");
    expect(root!.attributes.autonomy_mode).toBe("autonomous");
    // Step span reflects the mode that was effective at completion (the
    // payload's autonomy_mode), which may differ from onStepStarted when the
    // operator changes mid-run.
    expect(stepSpan!.attributes.autonomy_mode).toBe("supervised");
  });

  it("omits autonomy_mode attribute when the payload does not carry it", () => {
    const tracer = new WorkflowTracer(projectDir, new Map());
    tracer.onWorkflowStarted({
      workflow: "builder",
      runId: "run-no-am",
      triggerEvent: "test",
      runDir: ".kota/runs/run-no-am",
      startedAt: new Date().toISOString(),
    });
    tracer.onStepStarted({
      workflow: "builder",
      runId: "run-no-am",
      stepId: "s",
      stepType: "code",
      startedAt: new Date().toISOString(),
    });
    tracer.onStepCompleted({
      workflow: "builder",
      runId: "run-no-am",
      stepId: "s",
      stepType: "code",
      status: "success",
      durationMs: 1,
      runDir: ".kota/runs/run-no-am",
    });
    tracer.onWorkflowCompleted({
      workflow: "builder",
      runId: "run-no-am",
      status: "success",
      durationMs: 2,
      triggerEvent: "test",
      tags: [],
    });

    const spans = exporter.getFinishedSpans();
    const root = spans.find((s) => s.name === "workflow.run");
    const stepSpan = spans.find((s) => s.name === "step.code");
    expect(root!.attributes.autonomy_mode).toBeUndefined();
    expect(stepSpan!.attributes.autonomy_mode).toBeUndefined();
  });

  it("includes model attribute from lookup for agent steps", () => {
    const modelLookup = new Map([["builder:build", "claude-sonnet-4-6"]]);
    const tracer = new WorkflowTracer(projectDir, modelLookup);

    tracer.onWorkflowStarted({
      workflow: "builder",
      runId: "run-m",
      triggerEvent: "test",
      runDir: ".kota/runs/run-m",
      startedAt: new Date().toISOString(),
    });
    tracer.onStepStarted({
      workflow: "builder",
      runId: "run-m",
      stepId: "build",
      stepType: "agent",
      startedAt: new Date().toISOString(),
    });
    tracer.onStepCompleted({
      workflow: "builder",
      runId: "run-m",
      stepId: "build",
      stepType: "agent",
      status: "success",
      durationMs: 1000,
      runDir: ".kota/runs/run-m",
    });
    tracer.onWorkflowCompleted({
      workflow: "builder",
      runId: "run-m",
      status: "success",
      durationMs: 1100,
      triggerEvent: "test",
      tags: [],
    });

    const spans = exporter.getFinishedSpans();
    const agentSpan = spans.find((s) => s.name === "step.agent");
    expect(agentSpan!.attributes["workflow.step.model"]).toBe("claude-sonnet-4-6");
  });

  it("reads turns from agent step result file", () => {
    const runDir = ".kota/runs/run-t";
    const stepsDir = join(projectDir, runDir, "steps");
    mkdirSync(stepsDir, { recursive: true });
    writeFileSync(
      join(stepsDir, "build.json"),
      JSON.stringify({
        id: "build",
        type: "agent",
        status: "success",
        output: { turns: 12, totalCostUsd: 0.85, inputTokens: 15000, outputTokens: 3200, content: "done" },
      }),
    );

    const tracer = new WorkflowTracer(projectDir, new Map());
    tracer.onWorkflowStarted({
      workflow: "builder",
      runId: "run-t",
      triggerEvent: "test",
      runDir,
      startedAt: new Date().toISOString(),
    });
    tracer.onStepStarted({
      workflow: "builder",
      runId: "run-t",
      stepId: "build",
      stepType: "agent",
      startedAt: new Date().toISOString(),
    });
    tracer.onStepCompleted({
      workflow: "builder",
      runId: "run-t",
      stepId: "build",
      stepType: "agent",
      status: "success",
      durationMs: 2000,
      runDir,
    });
    tracer.onWorkflowCompleted({
      workflow: "builder",
      runId: "run-t",
      status: "success",
      durationMs: 2100,
      triggerEvent: "test",
      tags: [],
    });

    const spans = exporter.getFinishedSpans();
    const agentSpan = spans.find((s) => s.name === "step.agent");
    expect(agentSpan!.attributes["workflow.step.turns"]).toBe(12);
    expect(agentSpan!.attributes["workflow.step.total_cost_usd"]).toBe(0.85);
    expect(agentSpan!.attributes["workflow.step.input_tokens"]).toBe(15000);
    expect(agentSpan!.attributes["workflow.step.output_tokens"]).toBe(3200);
  });

  it("handles missing step result file gracefully", () => {
    const tracer = new WorkflowTracer(projectDir, new Map());
    tracer.onWorkflowStarted({
      workflow: "builder",
      runId: "run-miss",
      triggerEvent: "test",
      runDir: ".kota/runs/run-miss",
      startedAt: new Date().toISOString(),
    });
    tracer.onStepStarted({
      workflow: "builder",
      runId: "run-miss",
      stepId: "build",
      stepType: "agent",
      startedAt: new Date().toISOString(),
    });
    tracer.onStepCompleted({
      workflow: "builder",
      runId: "run-miss",
      stepId: "build",
      stepType: "agent",
      status: "success",
      durationMs: 1000,
      runDir: ".kota/runs/run-miss",
    });
    tracer.onWorkflowCompleted({
      workflow: "builder",
      runId: "run-miss",
      status: "success",
      durationMs: 1100,
      triggerEvent: "test",
      tags: [],
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(2);
    const agentSpan = spans.find((s) => s.name === "step.agent");
    expect(agentSpan!.attributes["workflow.step.turns"]).toBeUndefined();
  });

  it("reports enrichment errors for unparseable step result files", () => {
    const runDir = ".kota/runs/run-broken";
    const absRunDir = join(projectDir, runDir, "steps");
    mkdirSync(absRunDir, { recursive: true });
    writeFileSync(join(absRunDir, "build.json"), "{ not json");

    const errors: Array<{ msg: string; err: unknown }> = [];
    const tracer = new WorkflowTracer(projectDir, new Map(), (msg, err) => {
      errors.push({ msg, err });
    });
    tracer.onWorkflowStarted({
      workflow: "builder",
      runId: "run-broken",
      triggerEvent: "test",
      runDir,
      startedAt: new Date().toISOString(),
    });
    tracer.onStepStarted({
      workflow: "builder",
      runId: "run-broken",
      stepId: "build",
      stepType: "agent",
      startedAt: new Date().toISOString(),
    });
    tracer.onStepCompleted({
      workflow: "builder",
      runId: "run-broken",
      stepId: "build",
      stepType: "agent",
      status: "success",
      durationMs: 1000,
      runDir,
    });
    tracer.onWorkflowCompleted({
      workflow: "builder",
      runId: "run-broken",
      status: "success",
      durationMs: 1100,
      triggerEvent: "test",
      tags: [],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].msg).toContain("build.json");
    expect(errors[0].err).toBeInstanceOf(SyntaxError);
  });
});

describe("buildModelLookup", () => {
  it("maps workflow:stepId to model", () => {
    const workflows = [
      {
        name: "builder",
        steps: [
          { id: "check", type: "code" },
          { id: "build", type: "agent", model: "claude-sonnet-4-6", effort: "xhigh" },
        ],
      },
    ];
    const lookup = buildModelLookup(workflows);
    expect(lookup.get("builder:build")).toBe("claude-sonnet-4-6");
    expect(lookup.has("builder:check")).toBe(false);
  });

  it("applies agentModels override", () => {
    const workflows = [
      {
        name: "builder",
        steps: [
          { id: "build", type: "agent", model: "claude-sonnet-4-6",
              effort: "xhigh", agentName: "builder-agent" },
        ],
      },
    ];
    const lookup = buildModelLookup(workflows, { "builder-agent": "claude-opus-4-7" });
    expect(lookup.get("builder:build")).toBe("claude-opus-4-7");
  });
});

describe("no-op behavior", () => {
  it("does not fail when no OTel provider is registered", async () => {
    const tracer = new WorkflowTracer("/tmp/test", new Map());
    tracer.onWorkflowStarted({
      workflow: "test",
      runId: "noop-1",
      triggerEvent: "test",
      runDir: ".kota/runs/noop-1",
      startedAt: new Date().toISOString(),
    });
    tracer.onStepStarted({
      workflow: "test",
      runId: "noop-1",
      stepId: "s1",
      stepType: "code",
      startedAt: new Date().toISOString(),
    });
    tracer.onStepCompleted({
      workflow: "test",
      runId: "noop-1",
      stepId: "s1",
      stepType: "code",
      status: "success",
      durationMs: 10,
      runDir: ".kota/runs/noop-1",
    });
    tracer.onWorkflowCompleted({
      workflow: "test",
      runId: "noop-1",
      status: "success",
      durationMs: 20,
      triggerEvent: "test",
      tags: [],
    });
  });
});
