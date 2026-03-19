import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowAgentStep,
  WorkflowAgentStepInput,
  WorkflowCodeStep,
  WorkflowCodeStepInput,
  WorkflowDefinition,
  WorkflowEmitStep,
  WorkflowEmitStepInput,
  WorkflowFilterValue,
  WorkflowRestartStep,
  WorkflowRestartStepInput,
  WorkflowStep,
  WorkflowStepInput,
  WorkflowToolStep,
  WorkflowToolStepInput,
  WorkflowTrigger,
  WorkflowTriggerInput,
} from "./types.js";

const VALID_SETTING_SOURCES = new Set(["project", "local", "user"]);
const VALID_PERMISSION_MODES = new Set([
  "default",
  "acceptEdits",
  "dontAsk",
  "bypassPermissions",
]);

export class WorkflowDefinitionError extends Error {
  constructor(message: string, readonly definitionPath: string) {
    super(`${definitionPath}: ${message}`);
    this.name = "WorkflowDefinitionError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function expectRelativePath(value: unknown, field: string, definitionPath: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkflowDefinitionError(
      `${field} must be a non-empty relative path`,
      definitionPath,
    );
  }
  const trimmed = value.trim();
  if (isAbsolute(trimmed)) {
    throw new WorkflowDefinitionError(
      `${field} must be project-relative, not absolute`,
      definitionPath,
    );
  }
  return trimmed;
}

function expectName(value: unknown, field: string, definitionPath: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkflowDefinitionError(
      `${field} must be a non-empty string`,
      definitionPath,
    );
  }
  const trimmed = value.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) {
    throw new WorkflowDefinitionError(
      `${field} must match /^[a-z0-9][a-z0-9-]*$/`,
      definitionPath,
    );
  }
  return trimmed;
}

function expectNonEmptyString(
  value: unknown,
  field: string,
  definitionPath: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkflowDefinitionError(
      `${field} must be a non-empty string`,
      definitionPath,
    );
  }
  return value.trim();
}

function expectOptionalString(
  value: unknown,
  field: string,
  definitionPath: string,
): string | undefined {
  if (value === undefined) return undefined;
  return expectNonEmptyString(value, field, definitionPath);
}

function expectOptionalBoolean(
  value: unknown,
  field: string,
  definitionPath: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new WorkflowDefinitionError(`${field} must be a boolean`, definitionPath);
  }
  return value;
}

function expectOptionalInteger(
  value: unknown,
  field: string,
  definitionPath: string,
  minimum = 0,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new WorkflowDefinitionError(
      `${field} must be an integer >= ${minimum}`,
      definitionPath,
    );
  }
  return value as number;
}

function expectOptionalPositiveNumber(
  value: unknown,
  field: string,
  definitionPath: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new WorkflowDefinitionError(
      `${field} must be a positive number`,
      definitionPath,
    );
  }
  return value;
}

function expectOptionalStringArray(
  value: unknown,
  field: string,
  definitionPath: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new WorkflowDefinitionError(
      `${field} must be an array of non-empty strings`,
      definitionPath,
    );
  }
  return value.map((item) => item.trim());
}

function expectOptionalScalarFilter(
  value: unknown,
  field: string,
  definitionPath: string,
): Record<string, WorkflowFilterValue> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new WorkflowDefinitionError(`${field} must be an object`, definitionPath);
  }
  const filter: Record<string, WorkflowFilterValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry !== "string" &&
      typeof entry !== "number" &&
      typeof entry !== "boolean"
    ) {
      throw new WorkflowDefinitionError(
        `${field}.${key} must be a string, number, or boolean`,
        definitionPath,
      );
    }
    filter[key] = entry;
  }
  return filter;
}

function expectOptionalObjectOrFunction(
  value: unknown,
  field: string,
  definitionPath: string,
): Record<string, unknown> | ((...args: never[]) => unknown) | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "function") return value as (...args: never[]) => unknown;
  if (!isPlainObject(value)) {
    throw new WorkflowDefinitionError(
      `${field} must be an object or function`,
      definitionPath,
    );
  }
  return value;
}

function expectOptionalFunction(
  value: unknown,
  field: string,
  definitionPath: string,
): ((...args: never[]) => unknown) | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "function") {
    throw new WorkflowDefinitionError(`${field} must be a function`, definitionPath);
  }
  return value as (...args: never[]) => unknown;
}

function validateTrigger(
  trigger: WorkflowTriggerInput,
  definitionPath: string,
  index: number,
): WorkflowTrigger {
  const event = expectNonEmptyString(
    trigger?.event,
    `triggers[${index}].event`,
    definitionPath,
  );
  return {
    event,
    filter: expectOptionalScalarFilter(
      trigger.filter,
      `triggers[${index}].filter`,
      definitionPath,
    ),
    cooldownMs:
      expectOptionalInteger(
        trigger.cooldownMs,
        `triggers[${index}].cooldownMs`,
        definitionPath,
        0,
      ) ?? 0,
  };
}

function validateToolStep(
  step: WorkflowToolStepInput,
  definitionPath: string,
  index: number,
): WorkflowToolStep {
  return {
    id: expectName(step.id, `steps[${index}].id`, definitionPath),
    type: "tool",
    tool: expectNonEmptyString(step.tool, `steps[${index}].tool`, definitionPath),
    input: expectOptionalObjectOrFunction(
      step.input,
      `steps[${index}].input`,
      definitionPath,
    ) as WorkflowToolStep["input"],
    when: expectOptionalFunction(
      step.when,
      `steps[${index}].when`,
      definitionPath,
    ) as WorkflowToolStep["when"],
  };
}

function validateAgentStep(
  step: WorkflowAgentStepInput,
  definitionPath: string,
  index: number,
  projectDir: string,
): WorkflowAgentStep {
  const promptPath = expectRelativePath(
    step.promptPath,
    `steps[${index}].promptPath`,
    definitionPath,
  );
  if (!promptPath.endsWith(".md")) {
    throw new WorkflowDefinitionError(
      `steps[${index}].promptPath must point to a markdown file`,
      definitionPath,
    );
  }
  if (!existsSync(resolve(projectDir, promptPath))) {
    throw new WorkflowDefinitionError(
      `steps[${index}].promptPath does not exist: ${promptPath}`,
      definitionPath,
    );
  }

  const permissionMode =
    expectOptionalString(
      step.permissionMode,
      `steps[${index}].permissionMode`,
      definitionPath,
    ) ?? "bypassPermissions";
  if (!VALID_PERMISSION_MODES.has(permissionMode)) {
    throw new WorkflowDefinitionError(
      `steps[${index}].permissionMode must be one of ${Array.from(VALID_PERMISSION_MODES).join(", ")}`,
      definitionPath,
    );
  }

  const settingSources =
    expectOptionalStringArray(
      step.settingSources,
      `steps[${index}].settingSources`,
      definitionPath,
    ) ?? ["project"];
  for (const source of settingSources) {
    if (!VALID_SETTING_SOURCES.has(source)) {
      throw new WorkflowDefinitionError(
        `steps[${index}].settingSources entries must be one of ${Array.from(VALID_SETTING_SOURCES).join(", ")}`,
        definitionPath,
      );
    }
  }

  return {
    id: expectName(step.id, `steps[${index}].id`, definitionPath),
    type: "agent",
    promptPath,
    model: expectOptionalString(step.model, `steps[${index}].model`, definitionPath),
    maxTurns: expectOptionalInteger(
      step.maxTurns,
      `steps[${index}].maxTurns`,
      definitionPath,
      1,
    ),
    maxBudgetUsd: expectOptionalPositiveNumber(
      step.maxBudgetUsd,
      `steps[${index}].maxBudgetUsd`,
      definitionPath,
    ),
    permissionMode: permissionMode as WorkflowAgentStep["permissionMode"],
    allowedTools: expectOptionalStringArray(
      step.allowedTools,
      `steps[${index}].allowedTools`,
      definitionPath,
    ),
    disallowedTools: expectOptionalStringArray(
      step.disallowedTools,
      `steps[${index}].disallowedTools`,
      definitionPath,
    ),
    settingSources: settingSources as WorkflowAgentStep["settingSources"],
    when: expectOptionalFunction(
      step.when,
      `steps[${index}].when`,
      definitionPath,
    ) as WorkflowAgentStep["when"],
  };
}

function validateEmitStep(
  step: WorkflowEmitStepInput,
  definitionPath: string,
  index: number,
): WorkflowEmitStep {
  return {
    id: expectName(step.id, `steps[${index}].id`, definitionPath),
    type: "emit",
    event: expectNonEmptyString(step.event, `steps[${index}].event`, definitionPath),
    payload: expectOptionalObjectOrFunction(
      step.payload,
      `steps[${index}].payload`,
      definitionPath,
    ) as WorkflowEmitStep["payload"],
    when: expectOptionalFunction(
      step.when,
      `steps[${index}].when`,
      definitionPath,
    ) as WorkflowEmitStep["when"],
  };
}

function validateRestartStep(
  step: WorkflowRestartStepInput,
  definitionPath: string,
  index: number,
): WorkflowRestartStep {
  const reason = step.reason;
  if (
    reason !== undefined &&
    typeof reason !== "string" &&
    typeof reason !== "function"
  ) {
    throw new WorkflowDefinitionError(
      `steps[${index}].reason must be a string or function`,
      definitionPath,
    );
  }

  return {
    id: expectName(step.id, `steps[${index}].id`, definitionPath),
    type: "restart",
    reason: reason as WorkflowRestartStep["reason"],
    requires:
      expectOptionalStringArray(
        step.requires,
        `steps[${index}].requires`,
        definitionPath,
      ) ?? [],
    when: expectOptionalFunction(
      step.when,
      `steps[${index}].when`,
      definitionPath,
    ) as WorkflowRestartStep["when"],
  };
}

function validateCodeStep(
  step: WorkflowCodeStepInput,
  definitionPath: string,
  index: number,
): WorkflowCodeStep {
  if (typeof step.run !== "function") {
    throw new WorkflowDefinitionError(
      `steps[${index}].run must be a function`,
      definitionPath,
    );
  }

  return {
    id: expectName(step.id, `steps[${index}].id`, definitionPath),
    type: "code",
    run: step.run,
    when: expectOptionalFunction(
      step.when,
      `steps[${index}].when`,
      definitionPath,
    ) as WorkflowCodeStep["when"],
  };
}

function validateStep(
  step: WorkflowStepInput,
  definitionPath: string,
  index: number,
  projectDir: string,
): WorkflowStep {
  if (!step || typeof step !== "object") {
    throw new WorkflowDefinitionError(
      `steps[${index}] must be an object`,
      definitionPath,
    );
  }

  if (step.type === "tool") return validateToolStep(step, definitionPath, index);
  if (step.type === "agent") {
    return validateAgentStep(step, definitionPath, index, projectDir);
  }
  if (step.type === "emit") return validateEmitStep(step, definitionPath, index);
  if (step.type === "restart") {
    return validateRestartStep(step, definitionPath, index);
  }
  if (step.type === "code") return validateCodeStep(step, definitionPath, index);

  throw new WorkflowDefinitionError(
    `steps[${index}].type must be "tool", "agent", "emit", "restart", or "code"`,
    definitionPath,
  );
}

export function registerWorkflowDefinition(
  definitionPath: string,
  definition: Omit<RegisteredWorkflowDefinitionInput, "definitionPath">,
): RegisteredWorkflowDefinitionInput {
  return {
    ...definition,
    definitionPath,
  };
}

export function validateWorkflowDefinitions(
  definitions: readonly RegisteredWorkflowDefinitionInput[],
  projectDir = process.cwd(),
): WorkflowDefinition[] {
  const seenWorkflowNames = new Set<string>();

  return definitions.map((definition, definitionIndex) => {
    const definitionPath = expectRelativePath(
      definition.definitionPath,
      `definitions[${definitionIndex}].definitionPath`,
      `<workflow-${definitionIndex}>`,
    );
    const name = expectName(definition.name, "name", definitionPath);
    if (seenWorkflowNames.has(name)) {
      throw new WorkflowDefinitionError(
        `duplicate workflow name "${name}"`,
        definitionPath,
      );
    }
    seenWorkflowNames.add(name);

    if (!Array.isArray(definition.triggers) || definition.triggers.length === 0) {
      throw new WorkflowDefinitionError(
        "triggers must be a non-empty array",
        definitionPath,
      );
    }
    if (!Array.isArray(definition.steps) || definition.steps.length === 0) {
      throw new WorkflowDefinitionError(
        "steps must be a non-empty array",
        definitionPath,
      );
    }

    const steps = definition.steps.map((step, stepIndex) =>
      validateStep(step, definitionPath, stepIndex, projectDir),
    );
    const seenStepIds = new Set<string>();
    for (const step of steps) {
      if (seenStepIds.has(step.id)) {
        throw new WorkflowDefinitionError(
          `duplicate step id "${step.id}"`,
          definitionPath,
        );
      }
      seenStepIds.add(step.id);
    }

    const restartSteps = steps.filter(
      (step): step is WorkflowRestartStep => step.type === "restart",
    );
    if (restartSteps.length > 1) {
      throw new WorkflowDefinitionError(
        "workflows may contain at most one restart step",
        definitionPath,
      );
    }
    if (restartSteps.length === 1) {
      const restartStep = restartSteps[0];
      const restartIndex = steps.findIndex((step) => step.id === restartStep.id);
      if (restartIndex !== steps.length - 1) {
        throw new WorkflowDefinitionError(
          `restart step "${restartStep.id}" must be the final step`,
          definitionPath,
        );
      }
      if (restartStep.requires.length === 0) {
        throw new WorkflowDefinitionError(
          `restart step "${restartStep.id}" must declare at least one required verification step`,
          definitionPath,
        );
      }

      const seenRequiredIds = new Set<string>();
      for (const requiredId of restartStep.requires) {
        if (seenRequiredIds.has(requiredId)) {
          throw new WorkflowDefinitionError(
            `restart step "${restartStep.id}" references duplicate required step "${requiredId}"`,
            definitionPath,
          );
        }
        seenRequiredIds.add(requiredId);

        const requiredIndex = steps.findIndex((step) => step.id === requiredId);
        if (requiredIndex < 0) {
          throw new WorkflowDefinitionError(
            `restart step "${restartStep.id}" references unknown step "${requiredId}"`,
            definitionPath,
          );
        }
        if (requiredIndex >= restartIndex) {
          throw new WorkflowDefinitionError(
            `restart step "${restartStep.id}" requires step "${requiredId}" to run before restart`,
            definitionPath,
          );
        }

        const requiredStep = steps[requiredIndex];
        if (requiredStep.type !== "tool" && requiredStep.type !== "code") {
          throw new WorkflowDefinitionError(
            `restart step "${restartStep.id}" may only require tool or code steps, got "${requiredStep.type}" for "${requiredId}"`,
            definitionPath,
          );
        }
      }
    }

    return {
      name,
      description: expectOptionalString(
        definition.description,
        "description",
        definitionPath,
      ),
      enabled: expectOptionalBoolean(
        definition.enabled,
        "enabled",
        definitionPath,
      ) ?? true,
      definitionPath,
      triggers: definition.triggers.map((trigger, triggerIndex) =>
        validateTrigger(trigger, definitionPath, triggerIndex),
      ),
      steps,
    };
  });
}
