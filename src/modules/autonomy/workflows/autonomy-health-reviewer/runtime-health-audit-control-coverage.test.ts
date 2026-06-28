import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyAutonomyHealthReviewActions,
  buildAutonomyHealthReviewFromSignals,
} from "./health-review.js";
import { collectRuntimeHealthAudit } from "./runtime-health-audit.js";
import {
  readyTaskPath,
  writeRunWithAgentRuntimeCoverageGaps,
  writeRunWithApprovalOwnerGateGap,
  writeRunWithCoverage,
  writeRunWithSkippedApprovalGateGap,
  writeRunWithSkippedOwnerWaitGateGap,
} from "./runtime-health-audit-control-coverage-test-support.js";

const NOW = "2026-06-19T12:00:00.000Z";

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

  function expectNoObservableGateDiagnostics(
    audit: ReturnType<typeof collectRuntimeHealthAudit>,
  ): void {
    expect({
      evidenceGaps: audit.evidenceGaps,
      warningOrErrorPatterns: audit.patterns.filter((pattern) =>
        pattern.severity === "warning" || pattern.severity === "error"
      ),
    }).toEqual({ evidenceGaps: [], warningOrErrorPatterns: [] });
  }

  it("creates one local repair task for recurring control coverage gaps", () => {
    writeRunWithCoverage(projectDir, "control-gap-a", "2026-06-19T10:00:00.000Z");
    writeRunWithCoverage(projectDir, "control-gap-b", "2026-06-19T11:00:00.000Z");

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
    const observableArtifactRefs = audit.patterns.flatMap((pattern) =>
      pattern.evidenceRefs.map((ref) => ref.ref)
    );
    expect(observableArtifactRefs).toEqual(
      expect.arrayContaining([
        ".kota/runs/control-gap-a/control-monitor-coverage.json",
        ".kota/runs/control-gap-b/control-monitor-coverage.json",
      ]),
    );

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
      projectDir,
      "stale-skipped-approval-a",
      "2026-06-19T10:00:00.000Z",
    );
    writeRunWithSkippedApprovalGateGap(
      projectDir,
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
    expectNoObservableGateDiagnostics(audit);
  });

  it("ignores stale skipped owner-wait gate gaps from historical coverage artifacts", () => {
    writeRunWithSkippedOwnerWaitGateGap(
      projectDir,
      "stale-skipped-owner-wait-a",
      "2026-06-19T10:00:00.000Z",
    );
    writeRunWithSkippedOwnerWaitGateGap(
      projectDir,
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
    expectNoObservableGateDiagnostics(audit);
  });

  it("ignores missing agent runtime evidence from infrastructure failed steps", () => {
    writeRunWithAgentRuntimeCoverageGaps(projectDir, {
      id: "transport-missing-runtime-a",
      startedAt: "2026-06-19T10:00:00.000Z",
      error:
        'Agent step "review-evidence" failed (codex_cli_error): stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)',
    });
    writeRunWithAgentRuntimeCoverageGaps(projectDir, {
      id: "transport-missing-runtime-b",
      startedAt: "2026-06-19T11:00:00.000Z",
      error: 'Step "review-evidence" timed out after 1800000ms',
    });

    const audit = collectRuntimeHealthAudit({
      projectDir,
      options: { nowIso: NOW, interruptedRunMinCount: 2 },
    });

    expect(audit.inspected.controlCoverageArtifacts).toBe(2);
    expect(audit.inspected.controlCoverageGapRuns).toBe(0);
    expectNoObservableGateDiagnostics(audit);
  });

  it("keeps missing agent runtime evidence from unclassified failed steps actionable", () => {
    writeRunWithAgentRuntimeCoverageGaps(projectDir, {
      id: "local-missing-runtime-a",
      startedAt: "2026-06-19T10:00:00.000Z",
      error: 'Agent step "review-evidence" failed: local invariant broke',
    });
    writeRunWithAgentRuntimeCoverageGaps(projectDir, {
      id: "local-missing-runtime-b",
      startedAt: "2026-06-19T11:00:00.000Z",
      error: 'Agent step "review-evidence" failed: local invariant broke',
    });

    const audit = collectRuntimeHealthAudit({
      projectDir,
      options: { nowIso: NOW, interruptedRunMinCount: 2 },
    });

    expect(audit.inspected.controlCoverageArtifacts).toBe(2);
    expect(audit.inspected.controlCoverageGapRuns).toBe(2);
    expect(audit.patterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dedupeKey:
            "control-coverage:agent-step-stream:missing-agent-step-events",
          observationCount: 2,
        }),
        expect.objectContaining({
          dedupeKey:
            "control-coverage:trajectory-diagnostics:missing-trajectory-diagnostics",
          observationCount: 2,
        }),
      ]),
    );
  });

  it("does not suppress approval gate gaps with escaping step evidence refs", () => {
    for (const [id, startedAt] of [
      ["escaping-step-ref-a", "2026-06-19T10:00:00.000Z"],
      ["escaping-step-ref-b", "2026-06-19T11:00:00.000Z"],
    ] as const) {
      writeRunWithApprovalOwnerGateGap(projectDir, {
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
    writeRunWithApprovalOwnerGateGap(projectDir, {
      id: "skipped-non-gate-a",
      startedAt: "2026-06-19T10:00:00.000Z",
      step: { id: "sort-inbox", type: "code", status: "skipped" },
    });
    writeRunWithApprovalOwnerGateGap(projectDir, {
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
