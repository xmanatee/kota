import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { WorkflowCodeStepInput } from "#core/workflow/step-input-code.js";
import type { WorkflowParallelGroupInput } from "#core/workflow/step-input-control-flow.js";
import type { WorkflowAgentStep, WorkflowCodeStep, WorkflowParallelGroup } from "#core/workflow/step-types.js";
import {
  expectName,
  expectOptionalBoolean,
  expectOptionalFunction,
  expectOptionalInteger,
  WorkflowDefinitionError,
  type WorkflowValidationOptions,
} from "#core/workflow/validation-primitives.js";
import { validateAgentStep } from "./validate-agent-step.js";
import { validateCodeStep } from "./validate-code-step.js";

const UNSUPPORTED_PARALLEL_TYPES = new Set(["emit", "restart", "trigger", "parallel"]);

export function validateParallelGroup(
  step: WorkflowParallelGroupInput,
  definitionPath: string,
  index: number,
  moduleRoot: string,
  workflowDefaultAutonomyMode: AutonomyMode | undefined,
  options: WorkflowValidationOptions,
): WorkflowParallelGroup {
  if (!Array.isArray(step.steps) || step.steps.length === 0) {
    throw new WorkflowDefinitionError(
      `steps[${index}].steps must be a non-empty array`,
      definitionPath,
    );
  }
  if ("idleTimeoutMs" in step) {
    throw new WorkflowDefinitionError(
      `steps[${index}].idleTimeoutMs is not supported on parallel groups — put idleTimeoutMs on leaf steps`,
      definitionPath,
    );
  }

  const steps = step.steps.map((childStep, childIndex) => {
    const label = `steps[${index}].steps[${childIndex}]`;
    if (!childStep || typeof childStep !== "object") {
      throw new WorkflowDefinitionError(`${label} must be an object`, definitionPath);
    }
    const type = (childStep as { type?: unknown }).type;
    if (UNSUPPORTED_PARALLEL_TYPES.has(type as string)) {
      throw new WorkflowDefinitionError(
        `${label}.type "${String(type)}" is not supported in parallel groups (allowed: "code", "agent")`,
        definitionPath,
      );
    }
    if (type === "agent") {
      return validateAgentStep(
        childStep as Parameters<typeof validateAgentStep>[0],
        definitionPath,
        index,
        moduleRoot,
        workflowDefaultAutonomyMode,
        options,
        childIndex,
      ) as WorkflowAgentStep;
    }
    if (type !== "code") {
      throw new WorkflowDefinitionError(
        `${label}.type must be "code" or "agent"`,
        definitionPath,
      );
    }
    return validateCodeStep(
      childStep as WorkflowCodeStepInput,
      definitionPath,
      childIndex,
      label,
    ) as WorkflowCodeStep;
  });

  const maxParallelAgents = expectOptionalInteger(
    step.maxParallelAgents,
    `steps[${index}].maxParallelAgents`,
    definitionPath,
    1,
  );

  return {
    id: expectName(step.id, `steps[${index}].id`, definitionPath),
    type: "parallel",
    steps,
    when: expectOptionalFunction(
      step.when,
      `steps[${index}].when`,
      definitionPath,
    ) as WorkflowParallelGroup["when"],
    continueOnFailure: expectOptionalBoolean(
      step.continueOnFailure,
      `steps[${index}].continueOnFailure`,
      definitionPath,
    ),
    ...(maxParallelAgents !== undefined ? { maxParallelAgents } : {}),
  };
}
