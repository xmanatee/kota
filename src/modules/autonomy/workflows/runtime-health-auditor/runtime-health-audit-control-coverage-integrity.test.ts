import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONTROL_COVERAGE_NOW,
  collectControlCoverageAudit,
  expectApprovalOwnerGatePattern,
  expectNoObservableGateDiagnostics,
  makeControlCoverageScopeRoot,
} from "./runtime-health-audit-control-coverage-test-context.js";
import {
  writeRunWithAgentRuntimeCoverageGaps,
  writeRunWithApprovalOwnerGateGap,
  writeRunWithSkippedApprovalGateGap,
} from "./runtime-health-audit-control-coverage-test-support.js";

describe("runtime health audit control coverage integrity", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = makeControlCoverageScopeRoot();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("rejects an alternate-run metadata id before the gate suppressor reads artifacts", () => {
    writeRunWithSkippedApprovalGateGap(
      workspaceRoot,
      "authentic-skipped-gate",
      "2026-06-19T10:00:00.000Z",
    );
    writeRunWithApprovalOwnerGateGap(workspaceRoot, {
      id: "forged-current-run",
      metadataId: "authentic-skipped-gate",
      startedAt: "2026-06-19T11:00:00.000Z",
      step: { id: "approve-comment", type: "approval", status: "skipped" },
    });

    const audit = collectControlCoverageAudit({
      workspaceRoot,
      options: { nowIso: CONTROL_COVERAGE_NOW, interruptedRunMinCount: 2 },
    });

    expect(audit.inspected.recentRuns).toBe(1);
    expect(audit.inspected.controlCoverageArtifacts).toBe(1);
    expectNoObservableGateDiagnostics(audit);
  });

  it("ignores missing agent runtime evidence from infrastructure failed steps", () => {
    writeRunWithAgentRuntimeCoverageGaps(workspaceRoot, {
      id: "transport-missing-runtime-a",
      startedAt: "2026-06-19T10:00:00.000Z",
      error:
        'Agent step "review-evidence" failed (codex_cli_error): stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)',
    });
    writeRunWithAgentRuntimeCoverageGaps(workspaceRoot, {
      id: "transport-missing-runtime-b",
      startedAt: "2026-06-19T11:00:00.000Z",
      error:
        'Step "review-evidence" timed out after 1800000ms of active runtime',
      errorKind: "step-timeout",
    });

    const audit = collectControlCoverageAudit({
      workspaceRoot,
      options: { nowIso: CONTROL_COVERAGE_NOW, interruptedRunMinCount: 2 },
    });

    expect(audit.inspected.controlCoverageArtifacts).toBe(2);
    expect(audit.inspected.controlCoverageGapRuns).toBe(0);
    expectNoObservableGateDiagnostics(audit);
  });

  it("keeps missing agent runtime evidence from unclassified failed steps actionable", () => {
    writeRunWithAgentRuntimeCoverageGaps(workspaceRoot, {
      id: "local-missing-runtime-a",
      startedAt: "2026-06-19T10:00:00.000Z",
      error: 'Agent step "review-evidence" failed: local invariant broke',
    });
    writeRunWithAgentRuntimeCoverageGaps(workspaceRoot, {
      id: "local-missing-runtime-b",
      startedAt: "2026-06-19T11:00:00.000Z",
      error: 'Agent step "review-evidence" failed: local invariant broke',
    });

    const audit = collectControlCoverageAudit({
      workspaceRoot,
      options: { nowIso: CONTROL_COVERAGE_NOW, interruptedRunMinCount: 2 },
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
      writeRunWithApprovalOwnerGateGap(workspaceRoot, {
        id,
        startedAt,
        step: { id: "approve-comment", type: "approval", status: "skipped" },
        evidenceRefs: [`.kota/runs/${id}/steps/../../forged-${id}.json`],
      });
      writeFileSync(
        join(workspaceRoot, ".kota", "runs", `forged-${id}.json`),
        JSON.stringify({
          id: "approve-comment",
          type: "approval",
          status: "skipped",
        }),
        "utf-8",
      );
    }

    const audit = collectControlCoverageAudit({
      workspaceRoot,
      options: { nowIso: CONTROL_COVERAGE_NOW, interruptedRunMinCount: 2 },
    });

    expect(audit.inspected.controlCoverageArtifacts).toBe(2);
    expect(audit.inspected.controlCoverageGapRuns).toBe(2);
    expectApprovalOwnerGatePattern(audit);
  });

  it("does not suppress approval gate gaps from skipped non-gate step artifacts", () => {
    writeRunWithApprovalOwnerGateGap(workspaceRoot, {
      id: "skipped-non-gate-a",
      startedAt: "2026-06-19T10:00:00.000Z",
      step: { id: "sort-inbox", type: "code", status: "skipped" },
    });
    writeRunWithApprovalOwnerGateGap(workspaceRoot, {
      id: "skipped-non-gate-b",
      startedAt: "2026-06-19T11:00:00.000Z",
      step: { id: "sort-inbox", type: "code", status: "skipped" },
    });

    const audit = collectControlCoverageAudit({
      workspaceRoot,
      options: { nowIso: CONTROL_COVERAGE_NOW, interruptedRunMinCount: 2 },
    });

    expect(audit.inspected.controlCoverageArtifacts).toBe(2);
    expect(audit.inspected.controlCoverageGapRuns).toBe(2);
    expectApprovalOwnerGatePattern(audit);
  });

  it("distinguishes producer-missing control evidence from policy-pruned run references", () => {
    const missingRunDir = join(workspaceRoot, ".kota", "runs", "missing-coverage");
    mkdirSync(missingRunDir, { recursive: true });
    writeFileSync(
      join(missingRunDir, "metadata.json"),
      JSON.stringify({
        id: "missing-coverage",
        workflow: "builder",
        definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
        trigger: {
          event: "autonomy.queue.available",
          schemaRef: null,
          payload: {},
        },
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
      join(workspaceRoot, ".kota", "runs", "pruned-runs.jsonl"),
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

    const audit = collectControlCoverageAudit({
      workspaceRoot,
      options: { nowIso: CONTROL_COVERAGE_NOW, interruptedRunMinCount: 2 },
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
