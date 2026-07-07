import { CHECKS, evaluateCheck } from "./loop-quality-audit-rules.js";
import { flattenSteps, pathBase } from "./loop-quality-audit-support.js";
import type {
  LoopQualityAuditReport,
  LoopQualityWorkflowAudit,
  LoopQualityWorkflowInput,
} from "./loop-quality-audit-types.js";

export type {
  LoopQualityAuditReport,
  LoopQualityCheckId,
  LoopQualityCheckResult,
  LoopQualityEvidence,
  LoopQualityFinding,
  LoopQualityFindingId,
  LoopQualitySeverity,
  LoopQualityStatus,
  LoopQualityWorkflowAudit,
  LoopQualityWorkflowInput,
} from "./loop-quality-audit-types.js";

export function auditLoopQuality(
  workflows: readonly LoopQualityWorkflowInput[],
): LoopQualityAuditReport {
  const workflowAudits = [...workflows]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(auditWorkflow);
  const findings = workflowAudits.flatMap((workflow) =>
    workflow.checks.flatMap((check) => (check.finding ? [check.finding] : [])),
  );
  return {
    schemaVersion: 1,
    summary: {
      workflowCount: workflowAudits.length,
      findingCount: findings.length,
      warningCount: findings.filter((f) => f.severity === "warning").length,
      errorCount: findings.filter((f) => f.severity === "error").length,
    },
    workflows: workflowAudits,
    findings,
  };
}

function auditWorkflow(workflow: LoopQualityWorkflowInput): LoopQualityWorkflowAudit {
  const steps = flattenSteps(workflow.steps, pathBase(workflow));
  const checks = CHECKS.map((check) => evaluateCheck(workflow, steps, check));
  return {
    workflow: workflow.name,
    definitionPath: workflow.definitionPath ?? null,
    checks,
  };
}
