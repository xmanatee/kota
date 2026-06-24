import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyAutonomyHealthReviewActions,
  buildAutonomyHealthReviewFromSignals,
} from "./health-review.js";
import { collectRuntimeHealthAudit } from "./runtime-health-audit.js";

const NOW = "2026-06-19T12:00:00.000Z";

type StepSeed = {
  id: string;
  type: "approval" | "await-event" | "code";
  status: "success" | "failed" | "skipped";
  event?: string;
};

function readyTaskPath(projectDir: string, taskId: string): string {
  return join(projectDir, "data", "tasks", "ready", `${taskId}.md`);
}

describe("runtime health audit control coverage gaps", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-runtime-health-control-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function reviewAndApply(audit: ReturnType<typeof collectRuntimeHealthAudit>) {
    const review = buildAutonomyHealthReviewFromSignals({
      signals: audit.signals,
      generatedAt: NOW,
      sourceEventName: "autonomy.runtime-health.audit",
      reason: "test",
    });
    return applyAutonomyHealthReviewActions({
      projectDir,
      runId: "runtime-health-test",
      review,
      nowIso: NOW,
    });
  }

  function writeRunWithCoverage(id: string, startedAt: string): void {
    const runDir = join(projectDir, ".kota", "runs", id);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify({
        id,
        workflow: "builder",
        status: "success",
        startedAt,
        completedAt: startedAt,
        durationMs: 1000,
        runDir: `.kota/runs/${id}`,
        steps: [],
      }),
      "utf-8",
    );
    writeFileSync(
      join(runDir, "control-monitor-coverage.json"),
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: startedAt,
        artifactPath: `.kota/runs/${id}/control-monitor-coverage.json`,
        run: {
          id,
          workflow: "builder",
          triggerEvent: "autonomy.queue.available",
          status: "success",
          startedAt,
          completedAt: startedAt,
          headSha: "abc123",
        },
        monitoredSurfaceCounts: {
          agentSteps: 1,
          toolCalls: 1,
          externalPayloadIngests: 1,
          approvalRequests: 0,
          ownerQuestionWaits: 0,
          daemonHostControlDenials: 0,
          runtimeProbes: 0,
          postRunReviewLinks: 0,
        },
        summary: {
          numerator: 3,
          denominator: 4,
          gapCount: 1,
          unsupportedCount: 0,
          pendingCount: 0,
          blockedCount: 0,
          warnedCount: 0,
        },
        families: [],
        gaps: [
          {
            id: "injection-defense:external-payload-unscreened:1",
            family: "injection-defense",
            severity: "error",
            reason: "external-payload-unscreened",
            subject: "1 external payload(s)",
            evidenceRefs: [`.kota/runs/${id}/metadata.json`],
          },
        ],
        asyncReviewResponseMs: {
          observations: 0,
          min: null,
          max: null,
          average: null,
        },
      }),
      "utf-8",
    );
  }

  function stepResult(step: StepSeed, startedAt: string) {
    return {
      id: step.id,
      type: step.type,
      status: step.status,
      startedAt,
      completedAt: startedAt,
      durationMs: 10,
      ...(step.status === "skipped"
        ? { skipReason: { kind: "when-predicate" } }
        : {}),
    };
  }

  function writeRunWithApprovalOwnerGateGap(args: {
    id: string;
    startedAt: string;
    step: StepSeed;
    evidenceRefs?: string[];
    stepArtifact?: StepSeed;
  }): void {
    const { id, startedAt, step } = args;
    const runDir = join(projectDir, ".kota", "runs", id);
    const stepsDir = join(runDir, "steps");
    mkdirSync(stepsDir, { recursive: true });
    const stepArtifact = args.stepArtifact ?? step;
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify({
        id,
        workflow: "github-mention-intake",
        status: "success",
        startedAt,
        completedAt: startedAt,
        durationMs: 1000,
        runDir: `.kota/runs/${id}`,
        steps: [stepResult(step, startedAt)],
      }),
      "utf-8",
    );
    writeFileSync(
      join(runDir, "workflow.json"),
      JSON.stringify({
        steps: [
          {
            id: step.id,
            type: step.type,
            ...(step.event ? { event: step.event } : {}),
          },
        ],
      }),
      "utf-8",
    );
    writeFileSync(
      join(stepsDir, `${stepArtifact.id}.json`),
      JSON.stringify(stepResult(stepArtifact, startedAt)),
      "utf-8",
    );
    writeFileSync(
      join(runDir, "control-monitor-coverage.json"),
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: startedAt,
        artifactPath: `.kota/runs/${id}/control-monitor-coverage.json`,
        run: {
          id,
          workflow: "github-mention-intake",
          triggerEvent: "runtime.recovered",
          status: "success",
          startedAt,
          completedAt: startedAt,
          headSha: "stale-before-skipped-gate-fix",
        },
        monitoredSurfaceCounts: {
          agentSteps: 0,
          toolCalls: 0,
          externalPayloadIngests: 0,
          approvalRequests: 1,
          ownerQuestionWaits: 0,
          daemonHostControlDenials: 0,
          runtimeProbes: 0,
          postRunReviewLinks: 0,
        },
        summary: {
          numerator: 0,
          denominator: 1,
          gapCount: 1,
          unsupportedCount: 0,
          pendingCount: 0,
          blockedCount: 1,
          warnedCount: 0,
        },
        families: [],
        gaps: [
          {
            id: "approval-owner-gates:approval-or-owner-gate-unresolved:1",
            family: "approval-owner-gates",
            severity: "warning",
            reason: "approval-or-owner-gate-unresolved",
            subject: step.id,
            evidenceRefs: args.evidenceRefs ?? [
              `.kota/runs/${id}/steps/${step.id}.json`,
            ],
          },
        ],
        asyncReviewResponseMs: {
          observations: 0,
          min: null,
          max: null,
          average: null,
        },
      }),
      "utf-8",
    );
  }

  function writeRunWithSkippedApprovalGateGap(id: string, startedAt: string): void {
    writeRunWithApprovalOwnerGateGap({
      id,
      startedAt,
      step: { id: "approve-comment", type: "approval", status: "skipped" },
    });
  }

  function writeRunWithSkippedOwnerWaitGateGap(id: string, startedAt: string): void {
    writeRunWithApprovalOwnerGateGap({
      id,
      startedAt,
      step: {
        id: "wait-owner",
        type: "await-event",
        status: "skipped",
        event: "owner.question.resolved",
      },
    });
  }

  function expectApprovalOwnerGatePattern(
    audit: ReturnType<typeof collectRuntimeHealthAudit>,
  ): void {
    expect(audit.patterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dedupeKey:
            "control-coverage:approval-owner-gates:approval-or-owner-gate-unresolved",
          observationCount: 2,
        }),
      ]),
    );
  }

  it("creates one local repair task for recurring control coverage gaps", () => {
    writeRunWithCoverage("control-gap-a", "2026-06-19T10:00:00.000Z");
    writeRunWithCoverage("control-gap-b", "2026-06-19T11:00:00.000Z");

    const audit = collectRuntimeHealthAudit({
      projectDir,
      options: { nowIso: NOW, interruptedRunMinCount: 2 },
    });

    expect(audit.inspected.controlCoverageArtifacts).toBe(2);
    expect(audit.inspected.controlCoverageGapRuns).toBe(2);
    expect(audit.patterns).toEqual([
      expect.objectContaining({
        dedupeKey:
          "control-coverage:injection-defense:external-payload-unscreened",
        category: "local-code",
        actionability: "local-code",
        observationCount: 2,
      }),
    ]);

    const actions = reviewAndApply(audit);
    const taskId =
      "task-health-control-coverage-injection-defense-external-payload-unscreened";
    const taskPath = readyTaskPath(projectDir, taskId);

    expect(actions.createdTaskIds).toEqual([taskId]);
    expect(existsSync(taskPath)).toBe(true);
    const task = readFileSync(taskPath, "utf-8");
    expect(task).toContain(".kota/runs/control-gap-a/control-monitor-coverage.json");
    expect(task).toContain("external-payload-unscreened");
  });

  it("ignores stale skipped approval gate gaps from historical coverage artifacts", () => {
    writeRunWithSkippedApprovalGateGap(
      "stale-skipped-approval-a",
      "2026-06-19T10:00:00.000Z",
    );
    writeRunWithSkippedApprovalGateGap(
      "stale-skipped-approval-b",
      "2026-06-19T11:00:00.000Z",
    );

    const audit = collectRuntimeHealthAudit({
      projectDir,
      options: { nowIso: NOW, interruptedRunMinCount: 2 },
    });

    expect(audit.inspected.controlCoverageArtifacts).toBe(2);
    expect(audit.inspected.controlCoverageGapRuns).toBe(0);
    expect(audit.patterns).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dedupeKey:
            "control-coverage:approval-owner-gates:approval-or-owner-gate-unresolved",
        }),
      ]),
    );
  });

  it("ignores stale skipped owner-wait gate gaps from historical coverage artifacts", () => {
    writeRunWithSkippedOwnerWaitGateGap(
      "stale-skipped-owner-wait-a",
      "2026-06-19T10:00:00.000Z",
    );
    writeRunWithSkippedOwnerWaitGateGap(
      "stale-skipped-owner-wait-b",
      "2026-06-19T11:00:00.000Z",
    );

    const audit = collectRuntimeHealthAudit({
      projectDir,
      options: { nowIso: NOW, interruptedRunMinCount: 2 },
    });

    expect(audit.inspected.controlCoverageArtifacts).toBe(2);
    expect(audit.inspected.controlCoverageGapRuns).toBe(0);
    expect(audit.patterns).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dedupeKey:
            "control-coverage:approval-owner-gates:approval-or-owner-gate-unresolved",
        }),
      ]),
    );
  });

  it("does not suppress approval gate gaps with escaping step evidence refs", () => {
    for (const [id, startedAt] of [
      ["escaping-step-ref-a", "2026-06-19T10:00:00.000Z"],
      ["escaping-step-ref-b", "2026-06-19T11:00:00.000Z"],
    ] as const) {
      writeRunWithApprovalOwnerGateGap({
        id,
        startedAt,
        step: { id: "approve-comment", type: "approval", status: "skipped" },
        evidenceRefs: [`.kota/runs/${id}/steps/../../forged-${id}.json`],
      });
      writeFileSync(
        join(projectDir, ".kota", "runs", `forged-${id}.json`),
        JSON.stringify({
          id: "approve-comment",
          type: "approval",
          status: "skipped",
        }),
        "utf-8",
      );
    }

    const audit = collectRuntimeHealthAudit({
      projectDir,
      options: { nowIso: NOW, interruptedRunMinCount: 2 },
    });

    expect(audit.inspected.controlCoverageArtifacts).toBe(2);
    expect(audit.inspected.controlCoverageGapRuns).toBe(2);
    expectApprovalOwnerGatePattern(audit);
  });

  it("does not suppress approval gate gaps from skipped non-gate step artifacts", () => {
    writeRunWithApprovalOwnerGateGap({
      id: "skipped-non-gate-a",
      startedAt: "2026-06-19T10:00:00.000Z",
      step: { id: "sort-inbox", type: "code", status: "skipped" },
    });
    writeRunWithApprovalOwnerGateGap({
      id: "skipped-non-gate-b",
      startedAt: "2026-06-19T11:00:00.000Z",
      step: { id: "sort-inbox", type: "code", status: "skipped" },
    });

    const audit = collectRuntimeHealthAudit({
      projectDir,
      options: { nowIso: NOW, interruptedRunMinCount: 2 },
    });

    expect(audit.inspected.controlCoverageArtifacts).toBe(2);
    expect(audit.inspected.controlCoverageGapRuns).toBe(2);
    expectApprovalOwnerGatePattern(audit);
  });

  it("distinguishes producer-missing control evidence from policy-pruned run references", () => {
    const missingRunDir = join(projectDir, ".kota", "runs", "missing-coverage");
    mkdirSync(missingRunDir, { recursive: true });
    writeFileSync(
      join(missingRunDir, "metadata.json"),
      JSON.stringify({
        id: "missing-coverage",
        workflow: "builder",
        status: "success",
        startedAt: "2026-06-19T10:00:00.000Z",
        completedAt: "2026-06-19T10:01:00.000Z",
        durationMs: 1000,
        runDir: ".kota/runs/missing-coverage",
        steps: [],
      }),
      "utf-8",
    );
    writeFileSync(
      join(projectDir, ".kota", "runs", "pruned-runs.jsonl"),
      `${JSON.stringify({
        artifactType: "workflow-run",
        id: "pruned-coverage",
        prunedAt: "2026-06-19T11:00:00.000Z",
        retained: {
          id: "pruned-coverage",
          workflow: "builder",
          status: "success",
          startedAt: "2026-06-19T09:00:00.000Z",
          completedAt: "2026-06-19T09:01:00.000Z",
        },
        provenance: {
          workflowName: "builder",
          runId: "pruned-coverage",
          sourceEventIds: ["evtj-pruned-coverage"],
          transformedFrom: [
            { artifactType: "event-envelope", id: "evtj-pruned-coverage" },
          ],
        },
        payloadExpired: true,
      })}\n`,
      "utf-8",
    );

    const audit = collectRuntimeHealthAudit({
      projectDir,
      options: { nowIso: NOW, interruptedRunMinCount: 2 },
    });

    expect(audit.inspected.producerMissingEvidenceRefs).toBe(1);
    expect(audit.inspected.policyPrunedEvidenceRefs).toBe(1);
    expect(audit.evidenceGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "producer-missing",
          reasonCode: "producer-missing",
          ref: ".kota/runs/missing-coverage/control-monitor-coverage.json",
        }),
        expect.objectContaining({
          kind: "policy-pruned",
          reasonCode: "policy-pruned-payload",
          ref: ".kota/runs/pruned-runs.jsonl#pruned-coverage",
          summary: expect.stringContaining("policy-pruned-payload"),
        }),
      ]),
    );
  });
});
