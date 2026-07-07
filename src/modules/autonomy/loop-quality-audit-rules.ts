import {
  completionEvidence,
  contextHygiene,
  independentVerifier,
  mutatingRetrySafety,
} from "./loop-quality-audit-agent-checks.js";
import {
  noProgressDetection,
  repeatBrake,
} from "./loop-quality-audit-runtime-checks.js";
import {
  humanGate,
  workflowCompletedSelfTrigger,
} from "./loop-quality-audit-safety-checks.js";
import type {
  LoopQualityCheckId,
  LoopQualityCheckResult,
  LoopQualityWorkflowInput,
  StepRef,
} from "./loop-quality-audit-types.js";

export { CHECKS } from "./loop-quality-audit-rule-data.js";

export function evaluateCheck(
  workflow: LoopQualityWorkflowInput,
  steps: readonly StepRef[],
  check: LoopQualityCheckId,
): LoopQualityCheckResult {
  switch (check) {
    case "completion-evidence":
      return completionEvidence(workflow, steps);
    case "repeat-brake":
      return repeatBrake(workflow, steps);
    case "no-progress-detection":
      return noProgressDetection(workflow, steps);
    case "context-hygiene":
      return contextHygiene(workflow, steps);
    case "mutating-retry-safety":
      return mutatingRetrySafety(workflow, steps);
    case "independent-verifier":
      return independentVerifier(workflow, steps);
    case "human-gate":
      return humanGate(workflow, steps);
    case "workflow-completed-self-trigger":
      return workflowCompletedSelfTrigger(workflow);
  }
}
