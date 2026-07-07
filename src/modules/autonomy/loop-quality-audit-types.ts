import type { WorkflowStepInput } from "#core/workflow/step-input-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";

export type LoopQualityFindingId =
  | "loop.completion-evidence.missing"
  | "loop.repeatable-without-brake"
  | "loop.no-progress-detection.missing"
  | "loop.context-hygiene.missing"
  | "loop.mutating-retry-safety.missing"
  | "loop.verifier.missing"
  | "loop.human-gate.missing"
  | "loop.workflow-completed.self-trigger";

export type LoopQualityCheckId =
  | "completion-evidence"
  | "repeat-brake"
  | "no-progress-detection"
  | "context-hygiene"
  | "mutating-retry-safety"
  | "independent-verifier"
  | "human-gate"
  | "workflow-completed-self-trigger";

export type LoopQualitySeverity = "warning" | "error";
export type LoopQualityStatus = "pass" | "warning" | "error" | "not-applicable";

export type LoopQualityEvidence = {
  ref: string;
  detail: string;
};

export type LoopQualityFinding = {
  id: LoopQualityFindingId;
  severity: LoopQualitySeverity;
  workflow: string;
  check: LoopQualityCheckId;
  message: string;
  evidence: LoopQualityEvidence[];
};

export type LoopQualityCheckResult = {
  check: LoopQualityCheckId;
  status: LoopQualityStatus;
  evidence: LoopQualityEvidence[];
  finding?: LoopQualityFinding;
};

export type LoopQualityWorkflowInput = WorkflowDefinitionInput & {
  definitionPath?: string;
};

export type LoopQualityWorkflowAudit = {
  workflow: string;
  definitionPath: string | null;
  checks: LoopQualityCheckResult[];
};

export type LoopQualityAuditReport = {
  schemaVersion: 1;
  summary: {
    workflowCount: number;
    findingCount: number;
    warningCount: number;
    errorCount: number;
  };
  workflows: LoopQualityWorkflowAudit[];
  findings: LoopQualityFinding[];
};

export type StepRef = {
  step: WorkflowStepInput;
  ref: string;
};
