import { join } from "node:path";
import type { EvidenceJsonObject } from "#core/evidence/policy.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import {
  CONTROL_MONITOR_COVERAGE_ARTIFACT,
  type ControlMonitorCoverageArtifact,
} from "#core/workflow/control-monitor-coverage.js";
import { readPrunedWorkflowRunReferences } from "#core/workflow/run-store-retention.js";
import type { AutonomyHealthEvidenceRef } from "#modules/autonomy/health-signal.js";
import {
  addPattern,
  type PatternInput,
  type RuntimeHealthAuditContext,
} from "./runtime-health-audit-model.js";

type WorkflowHistoryRunLike = {
  id: string;
  workflow: string;
  status: string;
  startedAt: string;
};

type ControlCoverageGapObservation = {
  run: WorkflowHistoryRunLike;
  family: string;
  reason: string;
  severity: "warning" | "error";
  artifactRef: string;
  gapCount: number;
};

type ControlCoverageGap = ControlMonitorCoverageArtifact["gaps"][number];
type StepEvidence = {
  status?: string;
};

function artifactRef(runId: string): string {
  return join(".kota", "runs", runId, CONTROL_MONITOR_COVERAGE_ARTIFACT);
}

function retainedString(retained: EvidenceJsonObject, key: string): string | null {
  const value = retained[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readArtifact(
  ctx: RuntimeHealthAuditContext,
  run: WorkflowHistoryRunLike,
): ControlMonitorCoverageArtifact | null {
  return readOptionalJsonFile<ControlMonitorCoverageArtifact>(
    join(ctx.projectDir, ".kota", "runs", run.id, CONTROL_MONITOR_COVERAGE_ARTIFACT),
  );
}

function recordProducerMissingCoverageArtifact(
  ctx: RuntimeHealthAuditContext,
  run: WorkflowHistoryRunLike,
): void {
  ctx.inspected.producerMissingEvidenceRefs += 1;
  ctx.evidenceGaps.push({
    kind: "producer-missing",
    reasonCode: "producer-missing",
    ref: artifactRef(run.id),
    summary:
      `${run.workflow} ${run.status} at ${run.startedAt}: ` +
      `${CONTROL_MONITOR_COVERAGE_ARTIFACT} was not produced`,
  });
}

function recordPolicyPrunedCoverageRefs(ctx: RuntimeHealthAuditContext): void {
  let references: ReturnType<typeof readPrunedWorkflowRunReferences>;
  try {
    references = readPrunedWorkflowRunReferences(join(ctx.projectDir, ".kota", "runs"));
  } catch (error) {
    ctx.inspected.producerMissingEvidenceRefs += 1;
    ctx.evidenceGaps.push({
      kind: "producer-missing",
      reasonCode: "producer-missing",
      ref: join(".kota", "runs", "pruned-runs.jsonl"),
      summary: `Pruned run references could not be read: ${String(error)}`,
    });
    return;
  }
  for (const reference of references) {
    const workflow = retainedString(reference.retained, "workflow") ?? "unknown";
    const status = retainedString(reference.retained, "status") ?? "unknown";
    const startedAt = retainedString(reference.retained, "startedAt") ?? reference.prunedAt;
    const startedMs = Date.parse(startedAt);
    const prunedAtMs = Date.parse(reference.prunedAt);
    if (
      Number.isFinite(startedMs) &&
      Number.isFinite(prunedAtMs) &&
      startedMs < ctx.windowStartMs &&
      prunedAtMs < ctx.windowStartMs
    ) {
      continue;
    }
    ctx.inspected.policyPrunedEvidenceRefs += 1;
    ctx.evidenceGaps.push({
      kind: "policy-pruned",
      reasonCode: "policy-pruned-payload",
      ref: `${join(".kota", "runs", "pruned-runs.jsonl")}#${reference.id}`,
      summary:
        `${workflow} ${status} (${reference.id}) control coverage body unavailable: ` +
        "policy-pruned-payload",
    });
  }
}

function evidenceRefs(
  observations: readonly ControlCoverageGapObservation[],
): AutonomyHealthEvidenceRef[] {
  return observations.map((observation) => ({
    kind: "artifact",
    ref: observation.artifactRef,
    summary:
      `${observation.run.workflow} ${observation.run.status} at ` +
      `${observation.run.startedAt}: ${observation.gapCount} ` +
      `${observation.family}/${observation.reason} gap(s)`,
  }));
}

function pattern(
  observations: readonly ControlCoverageGapObservation[],
): PatternInput {
  const first = observations[0]!;
  const count = observations.length;
  const severity = observations.some((observation) => observation.severity === "error")
    ? "error"
    : "warning";
  return {
    dedupeKey: `control-coverage:${first.family}:${first.reason}`,
    category: "local-code",
    severity,
    actionability: "local-code",
    labels: [
      "control-coverage",
      "local-code",
      "runtime",
      first.family,
      first.reason,
    ],
    summary:
      `Control monitor coverage gap ${first.family}/${first.reason} recurred ` +
      `in ${count} recent run(s).`,
    source: { kind: "workflow", id: "control-monitor-coverage" },
    observationCount: count,
    evidenceRefs: evidenceRefs(observations),
  };
}

function stepEvidenceRefForRun(run: WorkflowHistoryRunLike, ref: string): string | null {
  const path = ref.split("#", 1)[0] ?? ref;
  const prefix = `.kota/runs/${run.id}/steps/`;
  return path.startsWith(prefix) && path.endsWith(".json") ? path : null;
}

function isStaleSkippedApprovalOwnerGateGap(
  ctx: RuntimeHealthAuditContext,
  run: WorkflowHistoryRunLike,
  gap: ControlCoverageGap,
): boolean {
  if (
    gap.family !== "approval-owner-gates" ||
    gap.reason !== "approval-or-owner-gate-unresolved"
  ) {
    return false;
  }

  const stepRefs = gap.evidenceRefs
    .map((ref) => stepEvidenceRefForRun(run, ref))
    .filter((ref): ref is string => ref !== null);
  if (stepRefs.length === 0) return false;

  return stepRefs.every((ref) => {
    const step = readOptionalJsonFile<StepEvidence>(join(ctx.projectDir, ref));
    return step?.status === "skipped";
  });
}

function observationsFor(
  ctx: RuntimeHealthAuditContext,
  run: WorkflowHistoryRunLike,
  artifact: ControlMonitorCoverageArtifact,
): ControlCoverageGapObservation[] {
  const byKey = new Map<
    string,
    {
      family: string;
      reason: string;
      severity: "warning" | "error";
      gapCount: number;
    }
  >();
  for (const gap of artifact.gaps) {
    if (isStaleSkippedApprovalOwnerGateGap(ctx, run, gap)) continue;
    const key = `${gap.family}\0${gap.reason}`;
    const existing = byKey.get(key) ?? {
      family: gap.family,
      reason: gap.reason,
      severity: gap.severity,
      gapCount: 0,
    };
    existing.gapCount += 1;
    existing.severity =
      existing.severity === "error" || gap.severity === "error"
        ? "error"
        : "warning";
    byKey.set(key, existing);
  }
  return [...byKey.values()].map((gap) => ({
    run,
    family: gap.family,
    reason: gap.reason,
    severity: gap.severity,
    artifactRef: artifactRef(run.id),
    gapCount: gap.gapCount,
  }));
}

export function scanControlCoverageGaps(
  ctx: RuntimeHealthAuditContext,
  runs: readonly WorkflowHistoryRunLike[],
): void {
  const byFamilyReason = new Map<string, ControlCoverageGapObservation[]>();
  recordPolicyPrunedCoverageRefs(ctx);
  for (const run of runs) {
    const artifact = readArtifact(ctx, run);
    if (!artifact) {
      recordProducerMissingCoverageArtifact(ctx, run);
      continue;
    }
    ctx.inspected.controlCoverageArtifacts += 1;
    const observations = observationsFor(ctx, run, artifact);
    if (observations.length > 0) ctx.inspected.controlCoverageGapRuns += 1;
    for (const observation of observations) {
      const key = `${observation.family}\0${observation.reason}`;
      const existing = byFamilyReason.get(key) ?? [];
      existing.push(observation);
      byFamilyReason.set(key, existing);
    }
  }

  for (const observations of byFamilyReason.values()) {
    if (observations.length < ctx.interruptedRunMinCount) continue;
    addPattern(ctx, pattern(observations));
  }
}
