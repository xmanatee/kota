import type {
  WorkflowAwaitEventStep,
  WorkflowAwaitEventStepInput,
} from "#core/workflow/types.js";
import {
  expectName,
  expectNonEmptyString,
  expectOptionalBoolean,
  expectOptionalFunction,
  expectOptionalInteger,
  expectOptionalString,
  WorkflowDefinitionError,
} from "#core/workflow/validation-primitives.js";

const DEFAULT_MATCH_FIELD = "id";

export function validateAwaitEventStep(
  step: WorkflowAwaitEventStepInput,
  definitionPath: string,
  index: number,
): WorkflowAwaitEventStep {
  if (
    typeof step.matchValue !== "string" &&
    typeof step.matchValue !== "number" &&
    typeof step.matchValue !== "function"
  ) {
    throw new WorkflowDefinitionError(
      `steps[${index}].matchValue must be a string, number, or resolver function`,
      definitionPath,
    );
  }
  if (typeof step.matchValue === "string" && !step.matchValue.trim()) {
    throw new WorkflowDefinitionError(
      `steps[${index}].matchValue must be a non-empty string`,
      definitionPath,
    );
  }

  return {
    id: expectName(step.id, `steps[${index}].id`, definitionPath),
    type: "await-event",
    event: expectNonEmptyString(step.event, `steps[${index}].event`, definitionPath),
    matchField:
      expectOptionalString(
        step.matchField,
        `steps[${index}].matchField`,
        definitionPath,
      ) ?? DEFAULT_MATCH_FIELD,
    matchValue: step.matchValue,
    awaitTimeoutMs: expectOptionalInteger(
      step.awaitTimeoutMs,
      `steps[${index}].awaitTimeoutMs`,
      definitionPath,
      1,
    ),
    when: expectOptionalFunction(
      step.when,
      `steps[${index}].when`,
      definitionPath,
    ) as WorkflowAwaitEventStep["when"],
    continueOnFailure: expectOptionalBoolean(
      step.continueOnFailure,
      `steps[${index}].continueOnFailure`,
      definitionPath,
    ),
    timeoutMs: expectOptionalInteger(
      step.timeoutMs,
      `steps[${index}].timeoutMs`,
      definitionPath,
      1,
    ),
    exposeOutputToAgent: expectOptionalBoolean(
      step.exposeOutputToAgent,
      `steps[${index}].exposeOutputToAgent`,
      definitionPath,
    ),
  };
}
