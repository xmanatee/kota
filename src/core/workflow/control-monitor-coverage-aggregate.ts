import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type CoverageEvent,
  type SnapshotStep,
  stringField,
} from "./control-monitor-coverage-readers.js";
import type {
  ControlCoverageFamily,
  ControlCoverageFamilyBuilder,
  ControlCoverageFamilyName,
  ControlCoverageStatus,
} from "./control-monitor-coverage-types.js";
import type { WorkflowRunMetadata } from "./run-types.js";

export function newControlCoverageFamily(
  family: ControlCoverageFamilyName,
): ControlCoverageFamilyBuilder {
  return {
    family,
    numerator: 0,
    denominator: 0,
    pending: 0,
    blocked: 0,
    warned: 0,
    unsupported: 0,
    evidenceRefs: [],
    gapIds: [],
  };
}

function familyStatus(
  family: ControlCoverageFamilyBuilder,
): ControlCoverageStatus {
  if (family.denominator === 0) return "not-applicable";
  if (family.pending > 0 && family.numerator === 0 && family.gapIds.length === 0) {
    return "pending";
  }
  if (family.gapIds.length === 0 && family.numerator >= family.denominator) {
    return "covered";
  }
  if (family.unsupported >= family.denominator && family.numerator === 0) {
    return "unsupported";
  }
  if (family.numerator > 0) return "partial";
  return "missing";
}

export function finishControlCoverageFamilies(
  families: Map<ControlCoverageFamilyName, ControlCoverageFamilyBuilder>,
): ControlCoverageFamily[] {
  return [...families.values()].map(({ unsupported, ...family }) => ({
    ...family,
    status: familyStatus({ ...family, unsupported }),
    evidenceRefs: [...new Set(family.evidenceRefs)].sort(),
    gapIds: [...new Set(family.gapIds)].sort(),
  }));
}

export function matchingCoverageEvents(
  events: readonly CoverageEvent[],
  name: string,
): CoverageEvent[] {
  return events.filter((event) => event.name === name);
}

export function daemonHostControlDenialCount(
  guardrailEvents: readonly CoverageEvent[],
): number {
  return guardrailEvents.filter((event) => {
    if (stringField(event.payload.policy) !== "deny") return false;
    const control =
      stringField(event.payload.control) ??
      stringField(event.payload.guard) ??
      stringField(event.payload.reasonCode);
    return control === "daemon-host-control" || control === "daemon-host";
  }).length;
}

function hasAgentStepEvidence(runDirPath: string, stepId: string): boolean {
  return [
    `${stepId}.events.jsonl`,
    `${stepId}.harness-capability.json`,
    `${stepId}.token-budget.json`,
    `${stepId}.tool-telemetry.json`,
    `${stepId}.trajectory-diagnostics.json`,
  ].some((name) => existsSync(join(runDirPath, "steps", name)));
}

export function activeAgentStepIds(
  metadata: WorkflowRunMetadata,
  snapshotSteps: readonly SnapshotStep[],
  runDirPath: string,
): string[] {
  const ids = new Set(
    metadata.steps
      .filter((step) => step.type === "agent" && step.status !== "skipped")
      .map((step) => step.id),
  );
  for (const step of snapshotSteps) {
    if (step.type === "agent" && hasAgentStepEvidence(runDirPath, step.id)) {
      ids.add(step.id);
    }
  }
  return [...ids];
}
