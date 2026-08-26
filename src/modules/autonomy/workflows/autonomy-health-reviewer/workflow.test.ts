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
import type { DurableEffectValue } from "#core/workflow/run-context.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import {
  AUTONOMY_ISSUE_PROJECTION_RESOURCE,
  emptyAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import { autonomyHealthSignal } from "#modules/autonomy/health-signal.js";
import repoTaskMutationWorkflow from "#modules/repo-tasks/repo-task-mutation-workflow.js";
import {
  RUNTIME_HEALTH_AUDIT_ARTIFACT,
  type RuntimeHealthAudit,
} from "../runtime-health-auditor/runtime-health-audit.js";
import runtimeHealthAuditorWorkflow, {
  runtimeHealthAuditStepOutput,
} from "../runtime-health-auditor/workflow.js";
import autonomyHealthReviewerWorkflow from "./workflow.js";
import { planAutonomyHealthReviewActionsInWorker } from "./action-operations.js";

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

  it("keeps health inspection read-only and delegates task writes", () => {
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
    const runtimeAudit = runtimeHealthAuditorWorkflow.triggers.find(
      (trigger) => trigger.event === "autonomy.runtime-health.audit.scheduled",
    );

    expect(autonomyHealthReviewerWorkflow.repository).toBe("read");
    expect(runtimeHealthAuditorWorkflow.repository).toBe("none");
    expect(repoTaskMutationWorkflow.repository).toBe("write");
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

  it("commits the issue transition and follow-up effects in the reviewer run", async () => {
    const projection = emptyAutonomyIssueProjection();
    let staged: DurableEffectValue | null = null;
    const result = await new WorkflowTestHarness(autonomyHealthReviewerWorkflow, {
      projectDir,
      trigger: {
        event: autonomyHealthSignal.name,
        payload: {
          scopeId: "scope-test",
          projectId: "scope-test",
          observation: "present",
          source: { kind: "workflow", id: "builder", workflow: "builder" },
          severity: "critical",
          labels: ["runtime", "workflow-failure"],
          labelsKey: "runtime,workflow-failure",
          summary: "Builder failed and the DLQ retained the run.",
          evidenceRefs: [{
            kind: "dead-letter",
            ref: ".kota/dead-letter-queue/items.json#dlq-1",
          }],
          actionability: "local-code",
          dedupeKey: "workflow:builder:failure:fixture",
          observationCount: 1,
          signalId: "health-fixture",
          createdAt: "2026-08-26T12:00:00.000Z",
        },
      },
      contextOverrides: {
        state: {
          read: <T extends DurableEffectValue>() => ({
            revision: 0,
            value: projection as unknown as T,
          }),
          compareAndSet: (_key, _revision, value) => {
            staged = value;
          },
        },
        runBlocking: async (_operation, input) =>
          planAutonomyHealthReviewActionsInWorker(input as never) as never,
      },
    }).run();

    expect(autonomyHealthReviewerWorkflow.resources?.({
      projectDir,
      stateDir: join(projectDir, ".kota"),
      workflowName: autonomyHealthReviewerWorkflow.name,
      trigger: {
        event: autonomyHealthSignal.name,
        schemaRef: null,
        payload: {},
      },
    })).toEqual([AUTONOMY_ISSUE_PROJECTION_RESOURCE]);
    expect(result.status).toBe("success");
    expect(staged).toMatchObject({
      issues: [expect.objectContaining({ status: "needs-decision" })],
    });
    expect(result.emitted.map((event) => event.event)).toEqual([
      "autonomy.issue-projection.materialization.requested",
      "autonomy.issue.decision-requested",
      "workflow.attention.digest",
    ]);
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
    const harness = new WorkflowTestHarness(runtimeHealthAuditorWorkflow, {
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
    expect(result.steps["verify-runtime-audit-artifact"].status).toBe("success");
    expect(result.steps["publish-runtime-health-signals"].output).toEqual({
      published: output.signals.length,
    });
  });
});
