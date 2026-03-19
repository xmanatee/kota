import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  WorkflowAgentStep,
  WorkflowAgentStepInput,
  WorkflowCodeStep,
  WorkflowCodeStepInput,
  WorkflowEmitStep,
  WorkflowEmitStepInput,
  WorkflowRestartStep,
  WorkflowRestartStepInput,
  WorkflowToolStep,
  WorkflowToolStepInput,
} from "./types.js";
import {
  expectName,
  expectNonEmptyString,
  expectOptionalFunction,
  expectOptionalInteger,
  expectOptionalObjectOrFunction,
  expectOptionalPositiveNumber,
  expectOptionalString,
  expectOptionalStringArray,
  expectRelativePath,
  WorkflowDefinitionError,
} from "./validation-primitives.js";

const VALID_SETTING_SOURCES = new Set(["project", "local", "user"]);
const VALID_PERMISSION_MODES = new Set([
  "default",
  "acceptEdits",
  "dontAsk",
  "bypassPermissions",
]);

export function validateToolStep(
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

export function validateAgentStep(
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

export function validateEmitStep(
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

export function validateRestartStep(
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

export function validateCodeStep(
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
