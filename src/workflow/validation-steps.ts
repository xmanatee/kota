import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getAgent } from "../agents/index.js";
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
  expectOptionalBoolean,
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
export const VALID_MODEL_IDS = new Set([
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
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
    continueOnFailure: expectOptionalBoolean(
      step.continueOnFailure,
      `steps[${index}].continueOnFailure`,
      definitionPath,
    ),
    retry: step.retry,
  };
}

export function validateAgentStep(
  step: WorkflowAgentStepInput,
  definitionPath: string,
  index: number,
  projectDir: string,
): WorkflowAgentStep {
  // Resolve agent definition when agentName is provided.
  let agentName: string | undefined;
  let agentPromptPath: string | undefined;
  let agentModel: string | undefined;
  let agentPermissionMode: string | undefined;
  let agentSettingSources: string[] | undefined;

  if (step.agentName !== undefined) {
    agentName = expectNonEmptyString(step.agentName, `steps[${index}].agentName`, definitionPath);
    const agentDef = getAgent(agentName);
    if (!agentDef) {
      throw new WorkflowDefinitionError(
        `steps[${index}].agentName: unknown agent "${agentName}"`,
        definitionPath,
      );
    }
    agentPromptPath = agentDef.promptPath;
    agentModel = agentDef.model;
    agentPermissionMode = agentDef.tools?.permissionMode;
    agentSettingSources = agentDef.settingSources;
  }

  // promptPath: step-level overrides agent def; one of the two must be present.
  const rawPromptPath = step.promptPath ?? agentPromptPath;
  if (!rawPromptPath) {
    throw new WorkflowDefinitionError(
      `steps[${index}] must specify agentName or promptPath`,
      definitionPath,
    );
  }
  const promptPath = expectRelativePath(rawPromptPath, `steps[${index}].promptPath`, definitionPath);
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

  // permissionMode: step-level overrides agent def; default is "bypassPermissions".
  const permissionMode =
    expectOptionalString(
      step.permissionMode,
      `steps[${index}].permissionMode`,
      definitionPath,
    ) ??
    agentPermissionMode ??
    "bypassPermissions";
  if (!VALID_PERMISSION_MODES.has(permissionMode)) {
    throw new WorkflowDefinitionError(
      `steps[${index}].permissionMode must be one of ${Array.from(VALID_PERMISSION_MODES).join(", ")}`,
      definitionPath,
    );
  }

  // settingSources: step-level overrides agent def; default is ["project"].
  const settingSources =
    expectOptionalStringArray(
      step.settingSources,
      `steps[${index}].settingSources`,
      definitionPath,
    ) ??
    agentSettingSources ??
    ["project"];
  for (const source of settingSources) {
    if (!VALID_SETTING_SOURCES.has(source)) {
      throw new WorkflowDefinitionError(
        `steps[${index}].settingSources entries must be one of ${Array.from(VALID_SETTING_SOURCES).join(", ")}`,
        definitionPath,
      );
    }
  }

  // model: step-level overrides agent def.
  const model =
    expectOptionalString(step.model, `steps[${index}].model`, definitionPath) ?? agentModel;
  if (model !== undefined && !VALID_MODEL_IDS.has(model)) {
    throw new WorkflowDefinitionError(
      `steps[${index}].model: unknown model "${model}"`,
      definitionPath,
    );
  }

  return {
    id: expectName(step.id, `steps[${index}].id`, definitionPath),
    type: "agent",
    agentName,
    promptPath,
    model,
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
    continueOnFailure: expectOptionalBoolean(
      step.continueOnFailure,
      `steps[${index}].continueOnFailure`,
      definitionPath,
    ),
    retry: step.retry,
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
    continueOnFailure: expectOptionalBoolean(
      step.continueOnFailure,
      `steps[${index}].continueOnFailure`,
      definitionPath,
    ),
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
    continueOnFailure: expectOptionalBoolean(
      step.continueOnFailure,
      `steps[${index}].continueOnFailure`,
      definitionPath,
    ),
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
    continueOnFailure: expectOptionalBoolean(
      step.continueOnFailure,
      `steps[${index}].continueOnFailure`,
      definitionPath,
    ),
  };
}
