import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { hasAgentHarness, resolveAgentHarness } from "#core/agent-harness/registry.js";
import { resolveAgentToolPolicy } from "#core/agents/handoff.js";
import { type AutonomyMode, isAutonomyMode } from "#core/tools/autonomy-mode.js";
import type { WorkflowAgentStepInput } from "#core/workflow/step-input-base.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import { resolveStaticWorkflowAgentRunContract } from "#core/workflow/steps/step-executor-agent-run-contract.js";
import {
  expectName,
  expectNonEmptyString,
  expectOptionalBoolean,
  expectOptionalFunction,
  expectOptionalInteger,
  expectOptionalString,
  expectOptionalStringArray,
  expectRelativePath,
  validateProgressStepTimeouts,
  WorkflowDefinitionError,
  type WorkflowValidationOptions,
} from "#core/workflow/validation-primitives.js";
import {
  resolveStepModel,
  validateHarnessOptions,
  validateOutputFormat,
  validateOutputSchema,
  validateTokenBudget,
} from "./validate-agent-step-helpers.js";
import { validateRepairLoop } from "./validate-agent-step-repair-loop.js";
import { validateExposedOutputTrust } from "./validate-exposed-output-trust.js";

export const VALID_EFFORT_LEVELS = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export function validateAgentStep(
  step: WorkflowAgentStepInput,
  definitionPath: string,
  stepLabel: string,
  moduleRoot: string,
  workflowDefaultAutonomyMode: AutonomyMode | undefined,
  options: WorkflowValidationOptions,
  workflowName: string,
): WorkflowAgentStep {
  const agentName = step.agentName !== undefined
    ? expectNonEmptyString(step.agentName, `${stepLabel}.agentName`, definitionPath)
    : undefined;
  const agentDef = agentName && options.resolveAgentDef
    ? options.resolveAgentDef(agentName)
    : undefined;
  if (agentName && options.resolveAgentDef && !agentDef) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.agentName references unknown registered agent "${agentName}"`,
      definitionPath,
    );
  }

  const rawPromptPath = step.promptPath ?? agentDef?.promptPath;
  if (!rawPromptPath) {
    throw new WorkflowDefinitionError(
      `${stepLabel} must specify promptPath or reference a registered agent with promptPath`,
      definitionPath,
    );
  }
  const promptPath = expectRelativePath(rawPromptPath, `${stepLabel}.promptPath`, definitionPath);
  if (!promptPath.endsWith(".md")) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.promptPath must point to a markdown file`,
      definitionPath,
    );
  }
  if (!existsSync(resolve(moduleRoot, promptPath))) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.promptPath does not exist: ${promptPath}`,
      definitionPath,
    );
  }

  const rawEffort = step.effort ?? (step.tier !== undefined
    ? options.preset?.defaultEffort ?? agentDef?.effort
    : agentDef?.effort);
  const effort = expectNonEmptyString(rawEffort, `${stepLabel}.effort`, definitionPath);
  if (!VALID_EFFORT_LEVELS.has(effort)) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.effort must be one of ${Array.from(VALID_EFFORT_LEVELS).join(", ")}`,
      definitionPath,
    );
  }

  if (step.autonomyMode !== undefined && !isAutonomyMode(step.autonomyMode)) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.autonomyMode must be one of passive, supervised, autonomous`,
      definitionPath,
    );
  }
  const autonomyMode: AutonomyMode | undefined =
    step.autonomyMode ?? workflowDefaultAutonomyMode;
  if (autonomyMode === undefined) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.autonomyMode is required — set autonomyMode on the step or declare defaultAutonomyMode on the workflow`,
      definitionPath,
    );
  }
  const declaredHarness = expectOptionalString(
    step.harness,
    `${stepLabel}.harness`,
    definitionPath,
  );
  const harnessName = declaredHarness ?? options.defaultAgentHarness;
  if (!harnessName) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.harness is required — set harness on the step or configure KotaConfig.defaultAgentHarness`,
      definitionPath,
    );
  }

  const { model: declaredModel, tier } = resolveStepModel({
    rawModel: step.model ?? (step.tier === undefined ? agentDef?.model : undefined),
    rawTier: step.tier,
    stepLabel,
    definitionPath,
    preset: options.preset,
    modelTiers: options.modelTiers,
  });
  const model = (agentName ? options.agentModels?.[agentName] : undefined) ?? declaredModel;

  const harnessOptions = validateHarnessOptions(
    step.harnessOptions,
    harnessName,
    stepLabel,
    definitionPath,
  );

  const requestedToolPolicy = {
    allowed: expectOptionalStringArray(
      step.allowedTools,
      `${stepLabel}.allowedTools`,
      definitionPath,
    ),
    disallowed: expectOptionalStringArray(
      step.disallowedTools,
      `${stepLabel}.disallowedTools`,
      definitionPath,
    ),
  };
  const toolPolicy = resolveAgentToolPolicy(agentDef?.tools, requestedToolPolicy);
  if (!toolPolicy.ok) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.allowedTools ${toolPolicy.message}`,
      definitionPath,
    );
  }
  const validatedStep: WorkflowAgentStep = {
    id: expectName(step.id, `${stepLabel}.id`, definitionPath),
    type: "agent",
    agentName,
    harness: harnessName,
    promptPath,
    moduleRoot,
    model,
    ...(tier !== undefined ? { tier } : {}),
    effort: effort as WorkflowAgentStep["effort"],
    ...validateProgressStepTimeouts(step, stepLabel, definitionPath),
    maxTurns: expectOptionalInteger(
      step.maxTurns,
      `${stepLabel}.maxTurns`,
      definitionPath,
      1,
    ),
    tokenBudget: validateTokenBudget(
      step.tokenBudget,
      `${stepLabel}.tokenBudget`,
      definitionPath,
    ),
    thinkingEnabled: expectOptionalBoolean(
      step.thinkingEnabled,
      `${stepLabel}.thinkingEnabled`,
      definitionPath,
    ),
    thinkingBudget: expectOptionalInteger(
      step.thinkingBudget,
      `${stepLabel}.thinkingBudget`,
      definitionPath,
      1024,
    ),
    allowedTools: toolPolicy.policy.allowed,
    disallowedTools: toolPolicy.policy.disallowed,
    harnessOptions,
    autonomyMode,
    when: expectOptionalFunction(
      step.when,
      `${stepLabel}.when`,
      definitionPath,
    ) as WorkflowAgentStep["when"],
    continueOnFailure: expectOptionalBoolean(
      step.continueOnFailure,
      `${stepLabel}.continueOnFailure`,
      definitionPath,
    ),
    exposeOutputToAgent: expectOptionalBoolean(
      step.exposeOutputToAgent,
      `${stepLabel}.exposeOutputToAgent`,
      definitionPath,
    ),
    exposedOutputTrust: validateExposedOutputTrust(
      step,
      stepLabel,
      definitionPath,
    ),
    retry: step.retry,
    repairLoop:
      step.repairLoop !== undefined
        ? validateRepairLoop(step.repairLoop, `${stepLabel}.repairLoop`, definitionPath)
        : undefined,
    outputFormat: validateOutputFormat(step.outputFormat, stepLabel, definitionPath),
    outputSchema: validateOutputSchema(step.outputSchema, step.outputFormat, stepLabel, definitionPath),
    validate: expectOptionalFunction(
      step.validate,
      `${stepLabel}.validate`,
      definitionPath,
    ) as WorkflowAgentStep["validate"],
  };

  if (hasAgentHarness(harnessName)) {
    try {
      resolveStaticWorkflowAgentRunContract({
        step: validatedStep,
        harness: resolveAgentHarness(harnessName),
        source: `workflow:${workflowName}/${stepLabel}`,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new WorkflowDefinitionError(
        `workflow "${workflowName}" ${stepLabel} resolved agent run contract is incompatible: ${detail}`,
        definitionPath,
      );
    }
  }

  for (const [checkIndex, check] of (validatedStep.repairLoop?.checks ?? []).entries()) {
    if (check.type !== "code" || check.resolveAgentContract === undefined) continue;
    const checkLabel = `${stepLabel}.repairLoop.checks[${checkIndex}]`;
    try {
      const contract = check.resolveAgentContract(validatedStep);
      if (!hasAgentHarness(contract.harness)) continue;
      resolveStaticWorkflowAgentRunContract({
        step: contract,
        harness: resolveAgentHarness(contract.harness),
        source: `workflow:${workflowName}/${checkLabel}`,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new WorkflowDefinitionError(
        `workflow "${workflowName}" ${checkLabel} resolved judge run contract is incompatible: ${detail}`,
        definitionPath,
      );
    }
  }

  return validatedStep;
}
