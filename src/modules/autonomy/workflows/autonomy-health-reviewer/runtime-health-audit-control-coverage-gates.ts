import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { ControlMonitorCoverageArtifact } from "#core/workflow/control-monitor-coverage.js";
import {
  readJsonObject,
  snapshotStepsFrom,
} from "#core/workflow/control-monitor-coverage-readers.js";
import {
  isWorkflowStepTimeoutErrorKind,
  type WorkflowStepResult,
} from "#core/workflow/run-types.js";
import { classifyAgentRuntimeFailure } from "#core/workflow/steps/step-executor-retry.js";
import {
  type StoredWorkflowRun,
  storedWorkflowRunDirectory,
} from "#modules/workflow-ops/runs/workflow-history.js";
import type { RuntimeHealthAuditContext } from "./runtime-health-audit-model.js";

type WorkflowHistoryRunLike = Pick<StoredWorkflowRun, "id" | "steps">;
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

  const stepsDir = resolve(
    storedWorkflowRunDirectory(
      join(ctx.stateDir, "runs"),
      run,
    ),
    "steps",
  );
  const resolvedPath = resolve(ctx.stateDir, relative(".kota", path));
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
  const runDir = storedWorkflowRunDirectory(
    join(ctx.stateDir, "runs"),
    run,
  );
  const snapshot = readJsonObject(
    join(runDir, "workflow.json"),
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

export function isStaleSkippedApprovalOwnerGateGap(
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

function isAgentRuntimeEvidenceGap(gap: ControlCoverageGap): boolean {
  return (
    (gap.family === "agent-step-stream" &&
      gap.reason === "missing-agent-step-events") ||
    (gap.family === "trajectory-diagnostics" &&
      gap.reason === "missing-trajectory-diagnostics")
  );
}

function parseAgentFailureSubtype(error: string): string | undefined {
  const match = /\(([^)]+)\):/.exec(error);
  return match?.[1];
}

function isInfrastructureAgentFailure(step: WorkflowStepResult): boolean {
  if (step.type !== "agent" || step.status !== "failed") return false;
  if (isWorkflowStepTimeoutErrorKind(step.errorKind)) return true;
  if (typeof step.error !== "string") return false;
  return classifyAgentRuntimeFailure({
    message: step.error,
    subtype: parseAgentFailureSubtype(step.error),
  }) !== null;
}

export function isInfrastructureAgentRuntimeCoverageGap(
  run: WorkflowHistoryRunLike,
  gap: ControlCoverageGap,
): boolean {
  if (!isAgentRuntimeEvidenceGap(gap)) return false;
  const step = run.steps.find((candidate) => candidate.id === gap.subject);
  return step !== undefined && isInfrastructureAgentFailure(step);
}
