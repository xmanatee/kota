import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { EvidenceJsonObject } from "#core/evidence/policy.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import {
  CONTROL_MONITOR_COVERAGE_ARTIFACT,
  type ControlMonitorCoverageArtifact,
} from "#core/workflow/control-monitor-coverage.js";
import {
  readJsonObject,
  snapshotStepsFrom,
} from "#core/workflow/control-monitor-coverage-readers.js";
import { readPrunedWorkflowRunReferences } from "#core/workflow/run-store-retention.js";
import type {
  WorkflowRunMetadata,
  WorkflowStepResult,
} from "#core/workflow/run-types.js";
import type { AutonomyHealthEvidenceRef } from "#modules/autonomy/health-signal.js";
import {
  addPattern,
  type PatternInput,
  type RuntimeHealthAuditContext,
} from "./runtime-health-audit-model.js";

type WorkflowHistoryRunLike = Pick<
  WorkflowRunMetadata,
  "id" | "workflow" | "status" | "startedAt" | "steps"
>;

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
  id?: string;
  type?: string;
  status?: string;
};
type StepEvidenceRef = {
  path: string;
  stepId: string;
};
type TrustedSkippedGateStep = {
  id: string;
  type: "approval" | "await-event";
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

function hasDotSegment(path: string): boolean {
  return path.split(/[\\/]/).some((segment) => segment === "." || segment === "..");
}

function leavesDirectory(relativePath: string): boolean {
  return (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  );
}

function stepEvidenceRefForRun(
  ctx: RuntimeHealthAuditContext,
  run: WorkflowHistoryRunLike,
  ref: string,
): StepEvidenceRef | null {
  const path = (ref.split("#", 1)[0] ?? ref).trim();
  if (!path.endsWith(".json") || isAbsolute(path) || hasDotSegment(path)) {
    return null;
  }

  const stepsDir = resolve(ctx.projectDir, ".kota", "runs", run.id, "steps");
  const resolvedPath = resolve(ctx.projectDir, path);
  const relativeToSteps = relative(stepsDir, resolvedPath);
  if (
    relativeToSteps.length === 0 ||
    leavesDirectory(relativeToSteps) ||
    relativeToSteps.includes(sep)
  ) {
    return null;
  }

  const suffix = ".json";
  if (!relativeToSteps.endsWith(suffix)) return null;
  const stepId = relativeToSteps.slice(0, -suffix.length);
  return stepId.length > 0 ? { path: resolvedPath, stepId } : null;
}

function ownerWaitStepIdsForRun(
  ctx: RuntimeHealthAuditContext,
  run: WorkflowHistoryRunLike,
): Set<string> {
  const snapshot = readJsonObject(
    join(ctx.projectDir, ".kota", "runs", run.id, "workflow.json"),
  );
  return new Set(
    snapshotStepsFrom(snapshot)
      .filter((step) =>
        step.type === "await-event" && step.event === "owner.question.resolved"
      )
      .map((step) => step.id),
  );
}

function trustedSkippedGateStep(
  step: WorkflowStepResult,
  ownerWaitStepIds: ReadonlySet<string>,
): TrustedSkippedGateStep | null {
  if (step.status !== "skipped") return null;
  if (step.type === "approval") return { id: step.id, type: "approval" };
  if (step.type === "await-event" && ownerWaitStepIds.has(step.id)) {
    return { id: step.id, type: "await-event" };
  }
  return null;
}

function trustedSkippedGateStepsForRun(
  ctx: RuntimeHealthAuditContext,
  run: WorkflowHistoryRunLike,
): ReadonlyMap<string, TrustedSkippedGateStep> {
  const ownerWaitStepIds = ownerWaitStepIdsForRun(ctx, run);
  const trusted = new Map<string, TrustedSkippedGateStep>();
  for (const step of run.steps) {
    const gateStep = trustedSkippedGateStep(step, ownerWaitStepIds);
    if (gateStep) trusted.set(gateStep.id, gateStep);
  }
  return trusted;
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

  if (gap.evidenceRefs.length === 0) return false;

  const trustedGateSteps = trustedSkippedGateStepsForRun(ctx, run);
  const stepRefs: StepEvidenceRef[] = [];
  for (const ref of gap.evidenceRefs) {
    const stepRef = stepEvidenceRefForRun(ctx, run, ref);
    if (!stepRef) return false;
    stepRefs.push(stepRef);
  }
  return stepRefs.every((ref) => {
    const trustedStep = trustedGateSteps.get(ref.stepId);
    if (!trustedStep) return false;
    const step = readOptionalJsonFile<StepEvidence>(ref.path);
    return (
      step?.id === trustedStep.id &&
      step.type === trustedStep.type &&
      step.status === "skipped"
    );
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
