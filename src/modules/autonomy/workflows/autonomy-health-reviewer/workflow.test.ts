import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { initModuleEventRegistry, resetModuleEventRegistry } from "#core/events/module-event.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { initGitTestRepository } from "#core/util/git-repository-test-support.js";
import { DEFAULT_MAX_STEP_OUTPUT_BYTES } from "#core/workflow/run-executor-step.js";
import { findRetryFromIndex } from "#core/workflow/run-executor-utils.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import { createTestWorkflowRuntime } from "#core/workflow/testing/runtime-fixture.js";
import { moduleOperationRecoveryPattern } from "#modules/autonomy/autonomy-issue-module-failure.js";
import {
  AUTONOMY_ISSUE_PROJECTION_RESOURCE,
  AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
  emptyAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import { autonomyHealthSignal, normalizeHealthSignal } from "#modules/autonomy/health-signal.js";
import repoTaskMutationWorkflow from "#modules/repo-tasks/repo-task-mutation-workflow.js";
import {
  RUNTIME_HEALTH_AUDIT_ARTIFACT,
  type RuntimeHealthAudit,
} from "../runtime-health-auditor/runtime-health-audit.js";
import { writeRuntimeHealthModuleLog } from "../runtime-health-auditor/runtime-health-audit-test-context.js";
import runtimeHealthAuditorWorkflow, {
  runtimeHealthAuditStepOutput,
} from "../runtime-health-auditor/workflow.js";
import autonomyHealthReviewerWorkflow from "./workflow.js";

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
    controlCoverageUnknownRuns: 0,
    policyPrunedEvidenceRefs: 0,
    producerMissingEvidenceRefs: 0,
    daemonEvidenceFiles: 0,
    daemonStopAttempts: 0,
    inboxEntries: 0,
    operatorRuntimeWarnings: 0,
  };
}

describe("autonomy-health-reviewer workflow", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "kota-health-reviewer-workflow-"));
    initGitTestRepository(workspaceRoot);
  });

  afterEach(() => {
    resetModuleEventRegistry();
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("admits informational recovery without admitting ordinary informational observations", async () => {
    initModuleEventRegistry().register("autonomy", autonomyHealthSignal);
    const bus = new EventBus();
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const pbus = new ScopedEventBus(bus, scopeId);
    const fixture = createTestWorkflowRuntime({
      bus, pbus, scopeRoot: workspaceRoot, scopeId, idleIntervalMs: 60_000,
      workflows: [{ ...autonomyHealthReviewerWorkflow, definitionPath: "health-reviewer-test", moduleRoot: process.cwd() }],
    });
    const observedAt = "2026-09-16T10:00:00.000Z";
    const recovery = normalizeHealthSignal({
      ...moduleOperationRecoveryPattern("telegram", "poll-loop"),
      observation: "cleared", createdAt: observedAt, observationCount: 1,
      evidenceRefs: [{ kind: "event", ref: "module.operation.recovered:telegram:poll-loop",
        moduleOperation: { operation: "poll-loop", observedAt, observation: "cleared" } }],
    });
    fixture.runtime.start();
    fixture.runtime.setDispatchPaused(true);
    try {
      pbus.emit(autonomyHealthSignal, normalizeHealthSignal({
        ...recovery, signalId: "health-info", observation: "present",
        source: { kind: "workflow", id: "builder" }, dedupeKey: "workflow:builder:info",
        evidenceRefs: [{ kind: "event", ref: "ordinary-info" }],
      }));
      expect(fixture.runtime.getState().pendingRuns).toHaveLength(0);
      pbus.emit(autonomyHealthSignal, recovery);
      const queued = fixture.runtime.getState().pendingRuns;
      expect(queued).toHaveLength(1);
      const state = createTestTransactionalRunState(join(workspaceRoot, ".kota", "test-state"));
      const result = await new WorkflowScenarioDriver(autonomyHealthReviewerWorkflow, {
        workspaceRoot, trigger: queued[0]!.trigger, ports: { state },
      }).run();
      expect(result.status, result.error).toBe("success");
      expect(state.read(AUTONOMY_ISSUE_PROJECTION_STATE_KEY).value).toMatchObject({
        issues: [], moduleRecoveries: [{ module: "telegram", operation: "poll-loop", observedAt }],
      });
      expect(result.emitted).toEqual([]);
    } finally {
      await fixture.stop();
    }
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
      groupBy: ["scopeId", "dedupeKey"],
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
    const state = createTestTransactionalRunState(join(workspaceRoot, ".kota", "test-state"));
    state.compareAndSet(AUTONOMY_ISSUE_PROJECTION_STATE_KEY, 0, projection);
    const result = await new WorkflowScenarioDriver(autonomyHealthReviewerWorkflow, {
      workspaceRoot,
      trigger: {
        event: autonomyHealthSignal.name,
        payload: {
          scopeId: "scope-test",
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
      ports: { state },
    }).run();

    expect(autonomyHealthReviewerWorkflow.resources?.({
      scopeRoot: workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"),
      workflowName: autonomyHealthReviewerWorkflow.name,
      trigger: {
        event: autonomyHealthSignal.name,
        schemaRef: null,
        payload: {},
      },
    })).toEqual([AUTONOMY_ISSUE_PROJECTION_RESOURCE]);
    expect(result.status, result.error).toBe("success");
    expect(state.read(AUTONOMY_ISSUE_PROJECTION_STATE_KEY).value).toMatchObject({
      issues: [expect.objectContaining({ status: "needs-decision" })],
    });
    expect(result.emitted.map((event) => event.event)).toEqual([
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
      workspaceRoot,
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
      signalCount: 0,
      patternCount: 0,
      evidenceGapCount: 5000,
    });
    expect(output).not.toHaveProperty("signals");
    expect(output).not.toHaveProperty("patterns");
    expect(output).not.toHaveProperty("evidenceGaps");
  });

  it("publishes all oversized runtime audit signals through the retained artifact", async () => {
    const observedAt = new Date(Date.now() - 1000).toISOString();
    for (const module of ["fixture-a", "fixture-b"]) {
      writeRuntimeHealthModuleLog(workspaceRoot, module, Array.from({ length: 500 }, (_, index) =>
        JSON.stringify({
          ts: observedAt,
          level: "warn",
          message: `fetch failed: ${index} ${"provider temporarily unavailable ".repeat(10)}`,
          data: { operation: "poll-loop" },
        }),
      ));
    }
    const harness = new WorkflowScenarioDriver(runtimeHealthAuditorWorkflow, {
      workspaceRoot,
      trigger: {
        event: "autonomy.runtime-health.audit.scheduled",
        payload: { scheduledAt: "2026-06-22T21:05:00.000Z" },
      },
    });

    const result = await harness.run();
    const output = result.steps["build-runtime-audit"].output as ReturnType<
      typeof runtimeHealthAuditStepOutput
    >;

    expect(result.status, result.error).toBe("success");
    expect(output).not.toHaveProperty("audit");
    expect(output).not.toHaveProperty("signals");
    expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThan(DEFAULT_MAX_STEP_OUTPUT_BYTES);
    expect(output.artifactPath.startsWith(
      `${join(workspaceRoot, ".kota", "runs")}${sep}`,
    )).toBe(true);
    expect(basename(output.artifactPath)).toBe(RUNTIME_HEALTH_AUDIT_ARTIFACT);
    expect(existsSync(output.artifactPath)).toBe(true);
    const artifact = JSON.parse(
      readFileSync(output.artifactPath, "utf-8"),
    ) as RuntimeHealthAudit;
    expect(Buffer.byteLength(JSON.stringify(artifact.signals))).toBeGreaterThan(DEFAULT_MAX_STEP_OUTPUT_BYTES);
    expect(artifact.signals).toHaveLength(2);
    expect(artifact.signals.map((signal) => signal.evidenceRefs.length)).toEqual([500, 500]);
    expect(output.signalCount).toBe(artifact.signals.length);
    expect(result.emitted.filter((entry) => entry.event === autonomyHealthSignal.name)
      .map(({ payload: { scopeId: _scopeId, ...signal } }) => signal)).toEqual(artifact.signals);
    expect(result.steps["publish-runtime-health-signals"].output).toEqual({
      published: artifact.signals.length,
    });
  });

  it("rebuilds the audit when retrying a retained successful-but-truncated step", () => {
    const timing = {
      startedAt: "2026-09-15T20:40:31.150Z",
      completedAt: "2026-09-15T20:40:41.088Z",
      durationMs: 9938,
    };
    expect(findRetryFromIndex([
      {
        ...timing,
        id: "build-runtime-audit",
        type: "code",
        status: "success",
        output: { truncated: true, originalBytes: 266279, message: "Step output truncated" },
      },
      {
        ...timing,
        id: "verify-runtime-audit-artifact",
        type: "code",
        status: "failed",
        error: 'Step "build-runtime-audit" output failed validation (persisted): missing required field "signals"',
      },
    ], runtimeHealthAuditorWorkflow.steps)).toBe(0);
  });
});
