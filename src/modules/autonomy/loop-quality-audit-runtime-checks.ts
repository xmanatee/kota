import { NO_PROGRESS_STEP_PATTERN } from "./loop-quality-audit-rule-data.js";
import {
  finding,
  notApplicable,
  pass,
  pathBase,
  stepBrakeEvidence,
} from "./loop-quality-audit-support.js";
import type {
  LoopQualityCheckResult,
  LoopQualityEvidence,
  LoopQualityWorkflowInput,
  StepRef,
} from "./loop-quality-audit-types.js";

export function repeatBrake(
  workflow: LoopQualityWorkflowInput,
  steps: readonly StepRef[],
): LoopQualityCheckResult {
  if (workflow.triggers.length === 0) return notApplicable("repeat-brake");
  const evidence = [
    ...workflow.triggers.flatMap((trigger, index) => {
      const refs: LoopQualityEvidence[] = [];
      if ((trigger.cooldownMs ?? 0) > 0) {
        refs.push({ ref: `${pathBase(workflow)}:triggers.${index}.cooldownMs`, detail: "trigger cooldown" });
      }
      if (trigger.batch) {
        refs.push({ ref: `${pathBase(workflow)}:triggers.${index}.batch`, detail: "bounded trigger batch" });
      }
      if (trigger.intervalMs || trigger.schedule) {
        refs.push({ ref: `${pathBase(workflow)}:triggers.${index}`, detail: "scheduled cadence" });
      }
      return refs;
    }),
    ...(workflow.maxConcurrentRuns
      ? [{ ref: `${pathBase(workflow)}:maxConcurrentRuns`, detail: "workflow concurrency brake" }]
      : []),
    ...(workflow.dispatchBurst
      ? [{ ref: `${pathBase(workflow)}:dispatchBurst`, detail: "dispatch burst cap" }]
      : []),
    ...(workflow.runTimeoutMs
      ? [{ ref: `${pathBase(workflow)}:runTimeoutMs`, detail: "workflow timeout" }]
      : []),
    ...steps.flatMap(stepBrakeEvidence),
  ];
  if (evidence.length > 0) return pass("repeat-brake", evidence);
  return finding(
    workflow,
    "repeat-brake",
    "loop.repeatable-without-brake",
    "warning",
    "repeatable trigger has no cooldown, batch bound, timeout, concurrency cap, or retry brake",
    [],
  );
}

export function noProgressDetection(
  workflow: LoopQualityWorkflowInput,
  steps: readonly StepRef[],
): LoopQualityCheckResult {
  const evidence = [
    ...workflow.triggers.flatMap((trigger, index) =>
      trigger.cooldownMs || trigger.batch
        ? [{ ref: `${pathBase(workflow)}:triggers.${index}`, detail: "trigger-level spin brake" }]
        : [],
    ),
    ...steps.flatMap((entry) => {
      const refs: LoopQualityEvidence[] = [];
      if (entry.step.when) refs.push({ ref: entry.ref, detail: "step predicate gates progress" });
      if (entry.step.type === "code" && entry.step.exposeOutputToAgent) {
        refs.push({ ref: entry.ref, detail: "bounded inspection output feeds later decision" });
      }
      if (NO_PROGRESS_STEP_PATTERN.test(entry.step.id)) {
        refs.push({ ref: entry.ref, detail: `step id "${entry.step.id}" records or gates loop progress` });
      }
      return refs;
    }),
  ];
  if (evidence.length > 0) return pass("no-progress-detection", evidence);
  return finding(
    workflow,
    "no-progress-detection",
    "loop.no-progress-detection.missing",
    "warning",
    "repeatable workflow has no visible no-progress gate, marker, cooldown, or bounded batch",
    [],
  );
}
