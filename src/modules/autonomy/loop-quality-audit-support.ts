import type { WorkflowStepInput } from "#core/workflow/step-input-types.js";
import type {
  WorkflowFilterScalar,
  WorkflowFilterValue,
} from "#core/workflow/trigger-types.js";
import type {
  LoopQualityCheckId,
  LoopQualityCheckResult,
  LoopQualityEvidence,
  LoopQualityFinding,
  LoopQualityFindingId,
  LoopQualitySeverity,
  LoopQualityWorkflowInput,
  StepRef,
} from "./loop-quality-audit-types.js";

export function flattenSteps(
  steps: readonly WorkflowStepInput[],
  base: string,
): StepRef[] {
  return steps.flatMap((step, index) => {
    const ref = `${base}:steps.${index}.${step.id}`;
    const current = [{ step, ref }];
    switch (step.type) {
      case "parallel":
        return [...current, ...flattenSteps(step.steps, `${ref}.parallel`)];
      case "branch":
        return [
          ...current,
          ...flattenSteps(step.ifTrue, `${ref}.ifTrue`),
          ...flattenSteps(step.ifFalse ?? [], `${ref}.ifFalse`),
        ];
      case "foreach":
        return [...current, ...flattenSteps(step.steps, `${ref}.foreach`)];
      default:
        return current;
    }
  });
}

export function pathBase(workflow: LoopQualityWorkflowInput): string {
  return workflow.definitionPath ?? `workflow:${workflow.name}`;
}

export function pass(
  check: LoopQualityCheckId,
  evidence: LoopQualityEvidence[],
): LoopQualityCheckResult {
  return { check, status: "pass", evidence };
}

export function notApplicable(check: LoopQualityCheckId): LoopQualityCheckResult {
  return { check, status: "not-applicable", evidence: [] };
}

export function finding(
  workflow: LoopQualityWorkflowInput,
  check: LoopQualityCheckId,
  id: LoopQualityFindingId,
  severity: LoopQualitySeverity,
  message: string,
  evidence: LoopQualityEvidence[],
): LoopQualityCheckResult {
  const findingValue: LoopQualityFinding = {
    id,
    severity,
    workflow: workflow.name,
    check,
    message,
    evidence: evidence.length > 0
      ? evidence
      : [{
        ref: pathBase(workflow),
        detail: `no typed evidence found for ${check}`,
      }],
  };
  return {
    check,
    status: severity,
    evidence: findingValue.evidence,
    finding: findingValue,
  };
}

export function repairCheckEvidence(
  entry: StepRef,
  needles: readonly string[],
  detail: string,
): LoopQualityEvidence[] {
  if (entry.step.type !== "agent") return [];
  return (entry.step.repairLoop?.checks ?? [])
    .filter((check) => needles.some((needle) => check.id.includes(needle)))
    .map((check) => ({ ref: `${entry.ref}.repairLoop.${check.id}`, detail }));
}

export function stepBrakeEvidence(entry: StepRef): LoopQualityEvidence[] {
  const evidence: LoopQualityEvidence[] = [];
  if (hasBaseStepFields(entry.step)) {
    if (entry.step.timeoutMs) evidence.push({ ref: entry.ref, detail: "step timeout" });
    if (entry.step.idleTimeoutMs) evidence.push({ ref: entry.ref, detail: "step idle timeout" });
  }
  if (entry.step.type === "agent" && entry.step.repairLoop?.maxRepairAttempts) {
    evidence.push({ ref: entry.ref, detail: "repair-loop attempt cap" });
  }
  if (entry.step.type === "tool" && entry.step.retry) {
    evidence.push({ ref: entry.ref, detail: "tool retry bound" });
  }
  return evidence;
}

export function workflowCompletedTriggerIsSelfSafe(
  workflow: LoopQualityWorkflowInput,
  filter: Record<string, WorkflowFilterValue> | undefined,
): boolean {
  if (!filter) return false;
  if (filter.workflow && !filterIncludes(filter.workflow, workflow.name)) return true;
  if (filter.tags && !values(filter.tags).some((tag) => workflow.tags?.includes(String(tag)))) {
    return true;
  }
  return false;
}

export function exposesOutputToAgent(step: WorkflowStepInput): boolean {
  return hasBaseStepFields(step) && step.exposeOutputToAgent === true;
}

function hasBaseStepFields(
  step: WorkflowStepInput,
): step is Exclude<WorkflowStepInput, { type: "parallel" }> {
  return step.type !== "parallel";
}

function filterIncludes(value: WorkflowFilterValue, expected: string): boolean {
  return values(value).some((candidate) => String(candidate) === expected);
}

function values(value: WorkflowFilterValue): readonly WorkflowFilterScalar[] {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return [value];
  }
  return value;
}
