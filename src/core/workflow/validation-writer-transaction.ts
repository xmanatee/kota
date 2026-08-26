import { getToolEffect } from "#core/tools/index.js";
import type { WorkflowStep } from "./step-types.js";
import { isRunLocalEffect } from "./transaction-effect-policy.js";
import type { WorkflowDefinition } from "./types.js";
import { WorkflowDefinitionError } from "./validation-primitives.js";

function validateWriterStep(
  step: WorkflowStep,
  definition: WorkflowDefinition,
): void {
  if (step.type === "agent") {
    step.ownerQuestionAccess = "disabled";
    for (const check of step.repairLoop?.checks ?? []) {
      if (check.type !== "code" || check.resolveAgentContract === undefined) {
        continue;
      }
      const resolveAgentContract = check.resolveAgentContract;
      check.resolveAgentContract = (parentStep) => ({
        ...resolveAgentContract(parentStep),
        ownerQuestionAccess: "disabled",
      });
    }
    return;
  }
  if (step.type === "code" && step.resolveAgentContract !== undefined) {
    const resolveAgentContract = step.resolveAgentContract;
    step.resolveAgentContract = (runtime) => ({
      ...resolveAgentContract(runtime),
      ownerQuestionAccess: "disabled",
    });
    return;
  }
  if (step.type === "tool") {
    const effect = getToolEffect(step.tool);
    if (!isRunLocalEffect(effect)) {
      const detail = effect === undefined
        ? "has no registered effect"
        : `has ${effect.kind} effect on ${effect.scope}`;
      throw new WorkflowDefinitionError(
        `repository writer workflow "${definition.name}" tool step "${step.id}" ${detail}; ` +
          "shared effects must run from a repository:none workflow after integration",
        definition.definitionPath,
      );
    }
    return;
  }
  if (
    step.type === "approval" ||
    step.type === "await-event" ||
    step.type === "restart" ||
    step.type === "trigger"
  ) {
    throw new WorkflowDefinitionError(
      `repository writer workflow "${definition.name}" cannot contain ${step.type} step "${step.id}" before integration`,
      definition.definitionPath,
    );
  }
  if (step.type === "branch") {
    for (const child of [...step.ifTrue, ...step.ifFalse]) {
      validateWriterStep(child, definition);
    }
    return;
  }
  if (step.type === "parallel" || step.type === "foreach") {
    for (const child of step.steps) validateWriterStep(child, definition);
  }
}

/**
 * Repository writers run before their branch is integrated. Keep irreversible
 * and shared coordination on post-integration, repository:none rails. Reads,
 * sandbox-local filesystem changes, and run-local session/environment effects
 * remain inside the run transaction.
 * Declarative emits are intentionally allowed because execution stages them in
 * the durable publication outbox until the run integrates successfully.
 */
export function validateWriterTransaction(definition: WorkflowDefinition): void {
  if (definition.repository !== "write") return;
  for (const step of definition.steps) validateWriterStep(step, definition);
}
