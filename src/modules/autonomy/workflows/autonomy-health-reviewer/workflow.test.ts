import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MAX_STEP_OUTPUT_BYTES } from "#core/workflow/run-executor-step.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import { autonomyHealthSignal } from "#modules/autonomy/health-signal.js";
import {
  RUNTIME_HEALTH_AUDIT_ARTIFACT,
  type RuntimeHealthAudit,
} from "./runtime-health-audit.js";
import autonomyHealthReviewerWorkflow, {
  runtimeHealthAuditStepOutput,
} from "./workflow.js";

function emptyInspected(): RuntimeHealthAudit["inspected"] {
  return {
    moduleLogFiles: 0,
    moduleLogLines: 0,
    deadLetterItems: 0,
    staleOpenDeadLetterItems: 0,
    recentRuns: 0,
    interruptedRuns: 0,
    controlCoverageArtifacts: 0,
    controlCoverageGapRuns: 0,
    policyPrunedEvidenceRefs: 0,
    producerMissingEvidenceRefs: 0,
    daemonEvidenceFiles: 0,
    daemonStopAttempts: 0,
    inboxEntries: 0,
    operatorRuntimeWarnings: 0,
  };
}

describe("autonomy-health-reviewer workflow", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-health-reviewer-workflow-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("reviews health signals and audits persisted runtime evidence on a cadence", () => {
    const critical = autonomyHealthReviewerWorkflow.triggers.find(
      (trigger) =>
        trigger.event === autonomyHealthSignal.name &&
        trigger.filter?.severity === "critical",
    );
    const batched = autonomyHealthReviewerWorkflow.triggers.find(
      (trigger) =>
        trigger.event === autonomyHealthSignal.name &&
        trigger.batch !== undefined,
    );
    const runtimeAudit = autonomyHealthReviewerWorkflow.triggers.find(
      (trigger) => trigger.event === "autonomy.runtime-health.audit.scheduled",
    );

    expect(critical?.batch).toBeUndefined();
    expect(batched?.filter).toEqual({ severity: ["warning", "error"] });
    expect(batched?.batch).toMatchObject({
      maxCount: 5,
      groupBy: ["scopeId", "labelsKey"],
      maxBufferSize: 20,
      overflow: "flush-oldest",
    });
    expect(runtimeAudit).toMatchObject({
      intervalMs: 6 * 60 * 60 * 1000,
      cooldownMs: 60 * 60 * 1000,
    });
  });

  it("keeps runtime audit step output below the workflow output cap", () => {
    const audit: RuntimeHealthAudit = {
      generatedAt: "2026-06-22T21:05:00.000Z",
      windowStart: "2026-06-15T21:05:00.000Z",
      inspected: {
        ...emptyInspected(),
        producerMissingEvidenceRefs: 5000,
      },
      evidenceGaps: Array.from({ length: 5000 }, (_, index) => ({
        kind: "producer-missing",
        reasonCode: "producer-missing",
        ref: `.kota/runs/run-${index}/control-monitor-coverage.json`,
        summary:
          `workflow success at 2026-06-22T21:05:00.000Z: ` +
          `control-monitor-coverage.json was not produced for run ${index}`,
      })),
      patterns: [],
      signals: [],
    };
    const artifactPath = join(
      projectDir,
      ".kota",
      "runs",
      "harness",
      RUNTIME_HEALTH_AUDIT_ARTIFACT,
    );

    const fullBytes = Buffer.byteLength(JSON.stringify({ audit }), "utf-8");
    const output = runtimeHealthAuditStepOutput(audit, artifactPath);
    const outputBytes = Buffer.byteLength(JSON.stringify(output), "utf-8");

    expect(fullBytes).toBeGreaterThan(DEFAULT_MAX_STEP_OUTPUT_BYTES);
    expect(outputBytes).toBeLessThan(DEFAULT_MAX_STEP_OUTPUT_BYTES);
    expect(output).toMatchObject({
      artifactPath,
      patternCount: 0,
      evidenceGapCount: 5000,
    });
    expect(output).not.toHaveProperty("patterns");
    expect(output).not.toHaveProperty("evidenceGaps");
  });

  it("writes the full runtime audit artifact before review uses compact output", async () => {
    const harness = new WorkflowTestHarness(autonomyHealthReviewerWorkflow, {
      projectDir,
      trigger: {
        event: "autonomy.runtime-health.audit.scheduled",
        payload: { scheduledAt: "2026-06-22T21:05:00.000Z" },
      },
    });

    const result = await harness.run();
    const output = result.steps["build-runtime-audit"].output as ReturnType<
      typeof runtimeHealthAuditStepOutput
    >;

    expect(result.status).toBe("success");
    expect(output).not.toHaveProperty("audit");
    expect(output.artifactPath).toBe(
      join(projectDir, ".kota", "runs", "harness", RUNTIME_HEALTH_AUDIT_ARTIFACT),
    );
    expect(existsSync(output.artifactPath)).toBe(true);
    const artifact = JSON.parse(
      readFileSync(output.artifactPath, "utf-8"),
    ) as RuntimeHealthAudit;
    expect(artifact.signals).toEqual(output.signals);
    expect(result.steps["write-runtime-audit-artifact"].status).toBe("success");
  });
});
