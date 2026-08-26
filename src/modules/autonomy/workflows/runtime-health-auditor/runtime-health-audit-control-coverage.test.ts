import { existsSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONTROL_COVERAGE_NOW,
  collectControlCoverageAudit,
  expectNoObservableGateDiagnostics,
  makeControlCoverageScopeRoot,
  reviewAndApplyControlCoverage,
} from "./runtime-health-audit-control-coverage-test-context.js";
import {
  readyTaskPath,
  writeRunWithCoverage,
  writeRunWithSkippedApprovalGateGap,
  writeRunWithSkippedOwnerWaitGateGap,
  writeRunWithUnknownCoverage,
  writeRunWithUnsupportedAgentStreamCoverageGaps,
} from "./runtime-health-audit-control-coverage-test-support.js";

describe("runtime health audit control coverage gaps", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = makeControlCoverageScopeRoot();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("requests one decision for recurring control coverage gaps", () => {
    writeRunWithCoverage(workspaceRoot, "control-gap-a", "2026-06-19T10:00:00.000Z");
    writeRunWithCoverage(workspaceRoot, "control-gap-b", "2026-06-19T11:00:00.000Z");

    const audit = collectControlCoverageAudit({
      workspaceRoot,
      options: { nowIso: CONTROL_COVERAGE_NOW, interruptedRunMinCount: 2 },
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

    const actions = reviewAndApplyControlCoverage(workspaceRoot, audit);
    expect(actions.applied).toEqual([
      expect.objectContaining({
        kind: "decision-requested",
        dedupeKey:
          "control-coverage:injection-defense:external-payload-unscreened",
      }),
    ]);
  });

  it("does not route declared unsupported agent streams into repair tasks", () => {
    writeRunWithUnsupportedAgentStreamCoverageGaps(
      workspaceRoot,
      "unsupported-stream-a",
      "2026-06-19T10:00:00.000Z",
    );
    writeRunWithUnsupportedAgentStreamCoverageGaps(
      workspaceRoot,
      "unsupported-stream-b",
      "2026-06-19T11:00:00.000Z",
    );

    const audit = collectControlCoverageAudit({
      workspaceRoot,
      options: { nowIso: CONTROL_COVERAGE_NOW, interruptedRunMinCount: 2 },
    });

    expect(audit.inspected.controlCoverageArtifacts).toBe(2);
    expect(audit.inspected.controlCoverageGapRuns).toBe(0);
    expect(audit.patterns).toEqual([]);
    expectNoObservableGateDiagnostics(audit);

    const actions = reviewAndApplyControlCoverage(workspaceRoot, audit);
    expect(actions.taskMutations).toEqual([]);
    for (const taskId of [
      "task-health-control-coverage-agent-step-stream-unsupported-agent-message-stream",
      "task-health-control-coverage-trajectory-diagnostics-unsupported-trajectory-diagnostics",
    ]) {
      expect(existsSync(readyTaskPath(workspaceRoot, taskId))).toBe(false);
    }
  });

  it("surfaces terminal unknown evidence without classifying owner interruption as local-code", () => {
    writeRunWithUnknownCoverage(
      workspaceRoot,
      "interrupted-unknown",
      "2026-06-19T11:00:00.000Z",
    );

    const audit = collectControlCoverageAudit({
      workspaceRoot,
      options: { nowIso: CONTROL_COVERAGE_NOW, interruptedRunMinCount: 2 },
    });

    expect(audit.inspected).toMatchObject({
      controlCoverageArtifacts: 1,
      controlCoverageUnknownRuns: 1,
    });
    expect(audit.patterns).toEqual([]);
    expect(audit.evidenceGaps).toEqual([]);
  });

  it("ignores stale skipped approval gate gaps from historical coverage artifacts", () => {
    writeRunWithSkippedApprovalGateGap(
      workspaceRoot,
      "stale-skipped-approval-a",
      "2026-06-19T10:00:00.000Z",
    );
    writeRunWithSkippedApprovalGateGap(
      workspaceRoot,
      "stale-skipped-approval-b",
      "2026-06-19T11:00:00.000Z",
    );

    const audit = collectControlCoverageAudit({
      workspaceRoot,
      options: { nowIso: CONTROL_COVERAGE_NOW, interruptedRunMinCount: 2 },
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
      workspaceRoot,
      "stale-skipped-owner-wait-a",
      "2026-06-19T10:00:00.000Z",
    );
    writeRunWithSkippedOwnerWaitGateGap(
      workspaceRoot,
      "stale-skipped-owner-wait-b",
      "2026-06-19T11:00:00.000Z",
    );

    const audit = collectControlCoverageAudit({
      workspaceRoot,
      options: { nowIso: CONTROL_COVERAGE_NOW, interruptedRunMinCount: 2 },
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

});
