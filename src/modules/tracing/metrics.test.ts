import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  type MetricData,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowMetricsEmitter } from "./metrics.js";

const METER_NAME = "kota-workflow";
const PROJECT_ID = "project-tracing-test";
const DEFINITION_PATH = ".kota/workflows/test.yaml";

function makeTmpDir(): string {
  return join(tmpdir(), `kota-metrics-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

async function collectMetrics(
  provider: MeterProvider,
  exporter: InMemoryMetricExporter,
): Promise<MetricData[]> {
  await provider.forceFlush();
  return exporter.getMetrics().flatMap((rm) =>
    rm.scopeMetrics.flatMap((sm) => sm.metrics),
  );
}

function findMetric(metrics: MetricData[], name: string): MetricData | undefined {
  return metrics.find((m) => m.descriptor.name === name);
}

function attrsMatch(
  attrs: Record<string, unknown>,
  expected: Record<string, string>,
): boolean {
  return Object.entries(expected).every(([k, v]) => attrs[k] === v);
}

describe("WorkflowMetricsEmitter", () => {
  let provider: MeterProvider;
  let exporter: InMemoryMetricExporter;
  let projectDir: string;

  beforeEach(() => {
    exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60_000,
    });
    provider = new MeterProvider({
      resource: resourceFromAttributes({ "service.name": "kota-test" }),
      readers: [reader],
    });
    projectDir = makeTmpDir();
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
  });

  it("records run counter and duration histogram on workflow completion", async () => {
    const emitter = new WorkflowMetricsEmitter(provider.getMeter(METER_NAME), projectDir);

    emitter.onWorkflowCompleted({
      workflow: "builder",
      runId: "run-1",
      status: "success",
      triggerEvent: "autonomy.queue.available",
      durationMs: 4200,
      definitionPath: "x",
      runDir: ".kota/runs/run-1",
      tags: [],
    });

    const metrics = await collectMetrics(provider, exporter);
    const runs = findMetric(metrics, "kota.workflow.runs");
    expect(runs).toBeDefined();
    expect(runs!.dataPointType).toBe(DataPointType.SUM);
    const runPoint = runs!.dataPoints.find((p) =>
      attrsMatch(p.attributes, {
        "workflow.name": "builder",
        "workflow.status": "success",
      }),
    );
    expect(runPoint?.value).toBe(1);

    const duration = findMetric(metrics, "kota.workflow.run.duration");
    expect(duration).toBeDefined();
    expect(duration!.dataPointType).toBe(DataPointType.HISTOGRAM);
    const durationPoint = duration!.dataPoints[0] as unknown as {
      value: { count: number; sum: number };
    };
    expect(durationPoint.value.count).toBe(1);
    expect(durationPoint.value.sum).toBe(4200);
  });

  it("records failure class counter when the run reports a classified failure", async () => {
    const emitter = new WorkflowMetricsEmitter(provider.getMeter(METER_NAME), projectDir);

    emitter.onWorkflowCompleted({
      workflow: "explorer",
      runId: "run-2",
      status: "failed",
      triggerEvent: "runtime.idle",
      durationMs: 1500,
      definitionPath: "x",
      runDir: ".kota/runs/run-2",
      tags: [],
      failureKind: "rate_limit",
    });

    const metrics = await collectMetrics(provider, exporter);
    const fail = findMetric(metrics, "kota.workflow.failure_class");
    expect(fail).toBeDefined();
    const point = fail!.dataPoints.find((p) =>
      attrsMatch(p.attributes, {
        "workflow.name": "explorer",
        "workflow.failure_kind": "rate_limit",
      }),
    );
    expect(point?.value).toBe(1);
  });

  it("records complete step usage and duration for step completion", async () => {
    const emitter = new WorkflowMetricsEmitter(provider.getMeter(METER_NAME), projectDir);

    emitter.onStepCompleted({
      scopeId: PROJECT_ID,
      workflow: "builder",
      runId: "run-3",
      stepId: "build",
      stepType: "agent",
      status: "success",
      durationMs: 9000,
      usage: {
        tokens: { state: "complete", inputTokens: 1200, outputTokens: 300 },
        cost: { state: "complete", usd: 0.25 },
      },
      runDir: ".kota/runs/run-3",
      definitionPath: DEFINITION_PATH,
    });

    const metrics = await collectMetrics(provider, exporter);
    const cost = findMetric(metrics, "kota.workflow.step.cost");
    const duration = findMetric(metrics, "kota.workflow.step.duration");
    const tokens = findMetric(metrics, "kota.workflow.agent.tokens");
    expect(cost).toBeDefined();
    expect(duration).toBeDefined();
    expect(tokens).toBeDefined();
    const costPoint = cost!.dataPoints[0] as unknown as {
      value: { count: number; sum: number };
    };
    expect(costPoint.value.count).toBe(1);
    expect(costPoint.value.sum).toBeCloseTo(0.25);
    const durationPoint = duration!.dataPoints[0] as unknown as {
      value: { count: number; sum: number };
    };
    expect(durationPoint.value.count).toBe(1);
    expect(durationPoint.value.sum).toBe(9000);
    const inputPoint = tokens!.dataPoints.find((p) =>
      attrsMatch(p.attributes, { "token.direction": "input" }),
    );
    const outputPoint = tokens!.dataPoints.find((p) =>
      attrsMatch(p.attributes, { "token.direction": "output" }),
    );
    expect(inputPoint?.value).toBe(1200);
    expect(outputPoint?.value).toBe(300);
  });

  it("records measured tokens when step cost is unavailable", async () => {
    const emitter = new WorkflowMetricsEmitter(provider.getMeter(METER_NAME), projectDir);

    emitter.onStepCompleted({
      scopeId: PROJECT_ID,
      workflow: "builder",
      runId: "run-unavailable",
      stepId: "build",
      stepType: "agent",
      status: "success",
      durationMs: 500,
      usage: {
        tokens: { state: "complete", inputTokens: 700, outputTokens: 80 },
        cost: { state: "unavailable", reason: "provider-does-not-report" },
      },
      runDir: ".kota/runs/run-unavailable",
      definitionPath: DEFINITION_PATH,
    });

    const metrics = await collectMetrics(provider, exporter);
    expect(findMetric(metrics, "kota.workflow.step.cost")).toBeUndefined();
    const tokens = findMetric(metrics, "kota.workflow.agent.tokens");
    expect(tokens).toBeDefined();
    expect(
      tokens!.dataPoints.find((p) =>
        attrsMatch(p.attributes, { "token.direction": "input" }),
      )?.value,
    ).toBe(700);
    expect(
      tokens!.dataPoints.find((p) =>
        attrsMatch(p.attributes, { "token.direction": "output" }),
      )?.value,
    ).toBe(80);
  });

  it("omits cost and token metrics when step usage is unknown", async () => {
    const emitter = new WorkflowMetricsEmitter(provider.getMeter(METER_NAME), projectDir);

    emitter.onStepCompleted({
      scopeId: PROJECT_ID,
      workflow: "builder",
      runId: "run-unknown",
      stepId: "build",
      stepType: "agent",
      status: "success",
      durationMs: 500,
      usage: {
        tokens: { state: "unknown" },
        cost: { state: "unknown" },
      },
      runDir: ".kota/runs/run-unknown",
      definitionPath: DEFINITION_PATH,
    });

    const metrics = await collectMetrics(provider, exporter);
    expect(findMetric(metrics, "kota.workflow.step.cost")).toBeUndefined();
    expect(findMetric(metrics, "kota.workflow.agent.tokens")).toBeUndefined();
    expect(findMetric(metrics, "kota.workflow.step.duration")).toBeDefined();
  });

  it("records repair-loop hits from the step output file", async () => {
    const runDir = ".kota/runs/run-4";
    const stepsDir = join(projectDir, runDir, "steps");
    mkdirSync(stepsDir, { recursive: true });
    writeFileSync(
      join(stepsDir, "build.json"),
      JSON.stringify({
        id: "build",
        type: "agent",
        status: "success",
        output: {
          repairIterations: [
            {
              attempt: 1,
              failures: [
                { id: "typecheck", severity: "error" },
                { id: "lint", severity: "error" },
              ],
            },
            {
              attempt: 2,
              failures: [{ id: "lint", severity: "error" }],
            },
          ],
        },
      }),
    );

    const emitter = new WorkflowMetricsEmitter(provider.getMeter(METER_NAME), projectDir);
    emitter.onStepCompleted({
      scopeId: PROJECT_ID,
      workflow: "builder",
      runId: "run-4",
      stepId: "build",
      stepType: "agent",
      status: "success",
      durationMs: 12_000,
      runDir,
      definitionPath: DEFINITION_PATH,
    });

    const metrics = await collectMetrics(provider, exporter);
    const repairs = findMetric(metrics, "kota.workflow.repair_loop.hits");
    expect(repairs).toBeDefined();
    const lintPoint = repairs!.dataPoints.find((p) =>
      attrsMatch(p.attributes, {
        "workflow.name": "builder",
        "workflow.step.id": "build",
        "repair.check_id": "lint",
      }),
    );
    const typecheckPoint = repairs!.dataPoints.find((p) =>
      attrsMatch(p.attributes, {
        "workflow.name": "builder",
        "workflow.step.id": "build",
        "repair.check_id": "typecheck",
      }),
    );
    expect(lintPoint?.value).toBe(2);
    expect(typecheckPoint?.value).toBe(1);

  });

  it("ignores repair-loop enrichment when the step output file is missing", async () => {
    const emitter = new WorkflowMetricsEmitter(provider.getMeter(METER_NAME), projectDir);
    emitter.onStepCompleted({
      scopeId: PROJECT_ID,
      workflow: "builder",
      runId: "run-5",
      stepId: "missing",
      stepType: "agent",
      status: "success",
      durationMs: 50,
      runDir: ".kota/runs/run-5",
      definitionPath: DEFINITION_PATH,
    });

    const metrics = await collectMetrics(provider, exporter);
    const repairs = findMetric(metrics, "kota.workflow.repair_loop.hits");
    expect(repairs).toBeUndefined();
  });

  it("ignores scalar repair-iteration summaries", async () => {
    const runDir = ".kota/runs/run-scalar-repairs";
    const stepsDir = join(projectDir, runDir, "steps");
    mkdirSync(stepsDir, { recursive: true });
    writeFileSync(
      join(stepsDir, "build.json"),
      JSON.stringify({
        id: "build",
        type: "agent",
        status: "success",
        output: {
          repairIterations: 2,
        },
      }),
    );

    const emitter = new WorkflowMetricsEmitter(provider.getMeter(METER_NAME), projectDir);
    emitter.onStepCompleted({
      scopeId: PROJECT_ID,
      workflow: "builder",
      runId: "run-scalar-repairs",
      stepId: "build",
      stepType: "agent",
      status: "success",
      durationMs: 100,
      runDir,
      definitionPath: DEFINITION_PATH,
    });

    const metrics = await collectMetrics(provider, exporter);
    const repairs = findMetric(metrics, "kota.workflow.repair_loop.hits");
    expect(repairs).toBeUndefined();
  });

  it("reports enrichment errors for unparseable step output files", async () => {
    const runDir = ".kota/runs/run-broken";
    const stepsDir = join(projectDir, runDir, "steps");
    mkdirSync(stepsDir, { recursive: true });
    writeFileSync(join(stepsDir, "build.json"), "{ not json");

    const errors: Array<{ msg: string; err: unknown }> = [];
    const emitter = new WorkflowMetricsEmitter(
      provider.getMeter(METER_NAME),
      projectDir,
      (msg, err) => {
        errors.push({ msg, err });
      },
    );
    emitter.onStepCompleted({
      scopeId: PROJECT_ID,
      workflow: "builder",
      runId: "run-broken",
      stepId: "build",
      stepType: "agent",
      status: "success",
      durationMs: 100,
      runDir,
      definitionPath: DEFINITION_PATH,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].msg).toContain("build.json");
  });

  it("tags run and step metrics with autonomy_mode when present", async () => {
    const emitter = new WorkflowMetricsEmitter(provider.getMeter(METER_NAME), projectDir);

    emitter.onWorkflowCompleted({
      workflow: "builder",
      runId: "run-auto",
      status: "success",
      triggerEvent: "autonomy.queue.available",
      durationMs: 1000,
      definitionPath: "x",
      runDir: ".kota/runs/run-auto",
      tags: [],
      autonomyMode: "autonomous",
    });
    emitter.onStepCompleted({
      scopeId: PROJECT_ID,
      workflow: "builder",
      runId: "run-auto",
      stepId: "build",
      stepType: "agent",
      status: "success",
      durationMs: 500,
      runDir: ".kota/runs/run-auto",
      definitionPath: DEFINITION_PATH,
      autonomyMode: "autonomous",
    });

    const metrics = await collectMetrics(provider, exporter);
    const runs = findMetric(metrics, "kota.workflow.runs");
    const runPoint = runs!.dataPoints.find((p) =>
      attrsMatch(p.attributes, {
        "workflow.name": "builder",
        "workflow.status": "success",
        autonomy_mode: "autonomous",
      }),
    );
    expect(runPoint?.value).toBe(1);

    const stepDuration = findMetric(metrics, "kota.workflow.step.duration");
    const stepPoint = stepDuration!.dataPoints.find((p) =>
      attrsMatch(p.attributes, {
        "workflow.name": "builder",
        "workflow.step.id": "build",
        autonomy_mode: "autonomous",
      }),
    );
    expect(stepPoint).toBeDefined();
  });

  it("records a transition data point on session autonomy change", async () => {
    const emitter = new WorkflowMetricsEmitter(provider.getMeter(METER_NAME), projectDir);

    emitter.onSessionAutonomyChanged({
      sessionId: "sess-1",
      from: "autonomous",
      to: "supervised",
    });
    emitter.onSessionAutonomyChanged({
      sessionId: "sess-1",
      from: "supervised",
      to: "autonomous",
    });

    const metrics = await collectMetrics(provider, exporter);
    const transitions = findMetric(metrics, "kota.workflow.session_autonomy_transitions");
    expect(transitions).toBeDefined();
    expect(transitions!.dataPointType).toBe(DataPointType.SUM);

    const downgrade = transitions!.dataPoints.find((p) =>
      attrsMatch(p.attributes, {
        "autonomy.from": "autonomous",
        "autonomy.to": "supervised",
      }),
    );
    const upgrade = transitions!.dataPoints.find((p) =>
      attrsMatch(p.attributes, {
        "autonomy.from": "supervised",
        "autonomy.to": "autonomous",
      }),
    );
    expect(downgrade?.value).toBe(1);
    expect(upgrade?.value).toBe(1);
  });

  it("records daemon config reload attempts with reload attributes", async () => {
    const emitter = new WorkflowMetricsEmitter(provider.getMeter(METER_NAME), projectDir);

    emitter.onDaemonConfigReload({
      timestamp: "2026-01-01T00:00:00.000Z",
      scope: "daemon",
      outcome: "success",
      reloadKind: "full",
      fullReload: true,
      changedModules: ["git", "github", "filesystem"],
      workflowCount: 9,
      sessionGuardrails: { refreshed: 0, unchanged: 0, nonRefreshable: [] },
    });

    const metrics = await collectMetrics(provider, exporter);
    const reloads = findMetric(metrics, "kota.daemon.config_reload.attempts");
    expect(reloads).toBeDefined();
    expect(reloads!.dataPointType).toBe(DataPointType.SUM);
    const point = reloads!.dataPoints.find((p) =>
      attrsMatch(p.attributes, {
        "daemon.config_reload.scope": "daemon",
        "daemon.config_reload.outcome": "success",
        "daemon.config_reload.reload_kind": "full",
      }),
    );
    expect(point?.value).toBe(1);
    expect(point?.attributes["daemon.config_reload.full_reload"]).toBe(true);
    expect(point?.attributes["daemon.config_reload.changed_module_count"]).toBe(3);
    expect(point?.attributes["daemon.config_reload.workflow_count"]).toBe(9);
  });
});
