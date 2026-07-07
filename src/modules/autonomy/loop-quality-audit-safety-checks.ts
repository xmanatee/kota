import { RISKY_TOOL_PATTERN } from "./loop-quality-audit-rule-data.js";
import {
  finding,
  notApplicable,
  pass,
  pathBase,
  workflowCompletedTriggerIsSelfSafe,
} from "./loop-quality-audit-support.js";
import type {
  LoopQualityCheckResult,
  LoopQualityWorkflowInput,
  StepRef,
} from "./loop-quality-audit-types.js";

export function humanGate(
  workflow: LoopQualityWorkflowInput,
  steps: readonly StepRef[],
): LoopQualityCheckResult {
  const risky = steps.filter(({ step }) =>
    step.type === "tool" &&
    (RISKY_TOOL_PATTERN.test(step.tool) || RISKY_TOOL_PATTERN.test(step.id)),
  );
  if (risky.length === 0) return notApplicable("human-gate");
  const evidence = steps.flatMap((entry) => {
    if (entry.step.type === "approval" || entry.step.type === "await-event") {
      return [{ ref: entry.ref, detail: "human gate step" }];
    }
    if (/\b(owner|approval|confirm|escalate)\b/i.test(entry.step.id)) {
      return [{ ref: entry.ref, detail: `step id "${entry.step.id}" is human-gate shaped` }];
    }
    return [];
  });
  if (evidence.length > 0) return pass("human-gate", evidence);
  return finding(
    workflow,
    "human-gate",
    "loop.human-gate.missing",
    "error",
    "high-risk or irreversible tool path lacks approval, owner, or await-event gate",
    risky.map((entry) => ({ ref: entry.ref, detail: "risky step" })),
  );
}

export function workflowCompletedSelfTrigger(
  workflow: LoopQualityWorkflowInput,
): LoopQualityCheckResult {
  const risky = workflow.triggers
    .map((trigger, index) => ({ trigger, index }))
    .filter(({ trigger }) => trigger.event === "workflow.completed")
    .filter(({ trigger }) => !workflowCompletedTriggerIsSelfSafe(workflow, trigger.filter));
  if (risky.length === 0) {
    return pass("workflow-completed-self-trigger", [{
      ref: pathBase(workflow),
      detail: "workflow.completed triggers are absent or narrowed away from this workflow",
    }]);
  }
  return finding(
    workflow,
    "workflow-completed-self-trigger",
    "loop.workflow-completed.self-trigger",
    "error",
    "workflow.completed trigger can match this workflow's own completion payload",
    risky.map(({ index }) => ({
      ref: `${pathBase(workflow)}:triggers.${index}`,
      detail: "self-matching workflow.completed trigger",
    })),
  );
}
