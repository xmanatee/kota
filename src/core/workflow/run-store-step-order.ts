import type { WorkflowStep } from "./step-types.js";

export function buildStepOrder(steps: readonly WorkflowStep[]): ReadonlyMap<string, number> {
  const order = new Map<string, number>();
  const visit = (step: WorkflowStep): void => {
    order.set(step.id, order.size);
    if (step.type === "parallel" || step.type === "foreach") {
      for (const child of step.steps) visit(child);
      return;
    }
    if (step.type === "branch") {
      for (const child of step.ifTrue) visit(child);
      for (const child of step.ifFalse) visit(child);
    }
  };

  for (const step of steps) visit(step);
  return order;
}
