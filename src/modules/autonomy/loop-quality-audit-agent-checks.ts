import {
  COMPLETION_CHECK_IDS,
  CONTEXT_CHECK_IDS,
  CONTEXT_STEP_PATTERN,
  MUTATION_SAFETY_IDS,
  MUTATION_STEP_PATTERN,
  VERIFIER_CHECK_IDS,
} from "./loop-quality-audit-rule-data.js";
import {
  exposesOutputToAgent,
  finding,
  notApplicable,
  pass,
  pathBase,
  repairCheckEvidence,
} from "./loop-quality-audit-support.js";
import type {
  LoopQualityCheckResult,
  LoopQualityEvidence,
  LoopQualityWorkflowInput,
  StepRef,
} from "./loop-quality-audit-types.js";

export function completionEvidence(
  workflow: LoopQualityWorkflowInput,
  steps: readonly StepRef[],
): LoopQualityCheckResult {
  const agentSteps = steps.filter(({ step }) => step.type === "agent");
  if (agentSteps.length === 0) {
    return pass("completion-evidence", [{
      ref: pathBase(workflow),
      detail: "code-only workflow does not complete from agent self-report",
    }]);
  }
  const evidence = agentSteps.flatMap((s) => agentCompletionEvidence(s));
  if (evidence.length === agentSteps.length) return pass("completion-evidence", evidence);
  return finding(
    workflow,
    "completion-evidence",
    "loop.completion-evidence.missing",
    "error",
    "agent step can finish without typed completion evidence or objective repair checks",
    evidence,
  );
}

export function contextHygiene(
  workflow: LoopQualityWorkflowInput,
  steps: readonly StepRef[],
): LoopQualityCheckResult {
  if (!steps.some(({ step }) => step.type === "agent")) {
    return pass("context-hygiene", [{
      ref: pathBase(workflow),
      detail: "no agent context is accumulated",
    }]);
  }
  const evidence = steps.flatMap((entry) => {
    const refs: LoopQualityEvidence[] = [];
    if (exposesOutputToAgent(entry.step)) {
      refs.push({ ref: entry.ref, detail: "explicit bounded output is exposed to agent context" });
    }
    if (CONTEXT_STEP_PATTERN.test(entry.step.id)) {
      refs.push({ ref: entry.ref, detail: `step id "${entry.step.id}" is context/evidence shaped` });
    }
    refs.push(...repairCheckEvidence(
      entry,
      CONTEXT_CHECK_IDS,
      "repair check keeps run artifacts or context hygiene reviewable",
    ));
    return refs;
  });
  if (evidence.length > 0) return pass("context-hygiene", evidence);
  return finding(
    workflow,
    "context-hygiene",
    "loop.context-hygiene.missing",
    "warning",
    "agent loop lacks bounded context handoff, run-artifact, or reviewable evidence strategy",
    [],
  );
}

export function mutatingRetrySafety(
  workflow: LoopQualityWorkflowInput,
  steps: readonly StepRef[],
): LoopQualityCheckResult {
  const mutating = steps.some(({ step }) =>
    step.type === "agent" ||
    step.type === "tool" ||
    MUTATION_STEP_PATTERN.test(step.id),
  );
  if (!mutating) return notApplicable("mutating-retry-safety");
  const evidence = steps.flatMap((entry) => {
    const refs = repairCheckEvidence(
      entry,
      MUTATION_SAFETY_IDS,
      "repair check validates mutation safety before publication",
    );
    if (MUTATION_SAFETY_IDS.some((needle) => entry.step.id.includes(needle))) {
      refs.push({ ref: entry.ref, detail: `step id "${entry.step.id}" records retry or idempotency posture` });
    }
    return refs;
  });
  if (evidence.length > 0) return pass("mutating-retry-safety", evidence);
  return finding(
    workflow,
    "mutating-retry-safety",
    "loop.mutating-retry-safety.missing",
    "warning",
    "mutating workflow has no typed idempotency, marker, task validation, or publication-safety evidence",
    [],
  );
}

export function independentVerifier(
  workflow: LoopQualityWorkflowInput,
  steps: readonly StepRef[],
): LoopQualityCheckResult {
  if (!steps.some(({ step }) => step.type === "agent")) {
    return notApplicable("independent-verifier");
  }
  const evidence = steps.flatMap((entry) =>
    repairCheckEvidence(entry, VERIFIER_CHECK_IDS, "independent repair-loop verifier"),
  );
  if (evidence.length > 0) return pass("independent-verifier", evidence);
  return finding(
    workflow,
    "independent-verifier",
    "loop.verifier.missing",
    "warning",
    "agent loop can reach a terminal result without an independent verifier, test, validation, or critic signal",
    [],
  );
}

function agentCompletionEvidence(entry: StepRef): LoopQualityEvidence[] {
  const step = entry.step;
  if (step.type !== "agent") return [];
  const evidence = repairCheckEvidence(
    entry,
    COMPLETION_CHECK_IDS,
    "objective completion repair check",
  );
  if (step.outputSchema || step.validate) {
    evidence.push({ ref: entry.ref, detail: "agent output has typed validation" });
  }
  return evidence.length > 0 ? [evidence[0]] : [];
}
