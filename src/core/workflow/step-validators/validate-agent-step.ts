import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { type AutonomyMode, isAutonomyMode } from "#core/tools/autonomy-mode.js";
import type {
  WorkflowRepairLoopConfig,
  WorkflowStepContext,
  WorkflowValueResolver,
} from "#core/workflow/run-types.js";
import type { WorkflowAgentStep, WorkflowAgentStepInput } from "#core/workflow/types.js";
import {
  expectName,
  expectNonEmptyString,
  expectOptionalBoolean,
  expectOptionalFunction,
  expectOptionalInteger,
  expectOptionalObjectOrFunction,
  expectOptionalString,
  expectOptionalStringArray,
  expectRelativePath,
  isPlainObject,
  WorkflowDefinitionError,
  type WorkflowValidationOptions,
} from "#core/workflow/validation-primitives.js";

const VALID_SETTING_SOURCES = new Set(["project", "local", "user"]);
const VALID_PERMISSION_MODES = new Set([
  "default",
  "acceptEdits",
  "dontAsk",
  "bypassPermissions",
]);
export const VALID_MODEL_IDS = new Set([
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
]);
export const VALID_EFFORT_LEVELS = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function validateRepairLoop(
  value: unknown,
  field: string,
  definitionPath: string,
): WorkflowRepairLoopConfig {
  if (!isPlainObject(value)) {
    throw new WorkflowDefinitionError(`${field} must be an object`, definitionPath);
  }
  const maxRepairAttempts = expectOptionalInteger(
    value.maxRepairAttempts,
    `${field}.maxRepairAttempts`,
    definitionPath,
    1,
  );
  if (!Array.isArray(value.checks) || value.checks.length === 0) {
    throw new WorkflowDefinitionError(
      `${field}.checks must be a non-empty array`,
      definitionPath,
    );
  }
  const checks = value.checks.map((check: unknown, i: number) => {
    if (!isPlainObject(check)) {
      throw new WorkflowDefinitionError(
        `${field}.checks[${i}] must be an object`,
        definitionPath,
      );
    }
    const severity = expectOptionalString(
      check.severity,
      `${field}.checks[${i}].severity`,
      definitionPath,
    );
    if (
      severity !== undefined &&
      severity !== "error" &&
      severity !== "warning"
    ) {
      throw new WorkflowDefinitionError(
        `${field}.checks[${i}].severity must be "error" or "warning"`,
        definitionPath,
      );
    }

    const phase = expectOptionalInteger(
      check.phase,
      `${field}.checks[${i}].phase`,
      definitionPath,
      0,
    );

    if (check.type === "code") {
      const run = expectOptionalFunction(
        check.run,
        `${field}.checks[${i}].run`,
        definitionPath,
      );
      if (!run) {
        throw new WorkflowDefinitionError(
          `${field}.checks[${i}].run must be a function`,
          definitionPath,
        );
      }
      return {
        id: expectName(check.id, `${field}.checks[${i}].id`, definitionPath),
        type: "code" as const,
        severity: severity as "error" | "warning" | undefined,
        phase,
        run: run as (context: WorkflowStepContext) => Promise<unknown> | unknown,
      };
    }

    return {
      id: expectName(check.id, `${field}.checks[${i}].id`, definitionPath),
      type: "tool" as const,
      severity: severity as "error" | "warning" | undefined,
      phase,
      tool: expectNonEmptyString(check.tool, `${field}.checks[${i}].tool`, definitionPath),
      input: expectOptionalObjectOrFunction(
        check.input,
        `${field}.checks[${i}].input`,
        definitionPath,
      ) as WorkflowValueResolver<Record<string, unknown>>,
    };
  });
  return { checks, maxRepairAttempts };
}

export function validateAgentStep(
  step: WorkflowAgentStepInput,
  definitionPath: string,
  index: number,
  moduleRoot: string,
  workflowDefaultAutonomyMode: AutonomyMode | undefined,
  options: WorkflowValidationOptions,
  childIndex?: number,
): WorkflowAgentStep {
  const stepLabel = childIndex !== undefined
    ? `steps[${index}].steps[${childIndex}]`
    : `steps[${index}]`;
  const agentName = step.agentName !== undefined
    ? expectNonEmptyString(step.agentName, `${stepLabel}.agentName`, definitionPath)
    : undefined;

  if (!step.promptPath) {
    throw new WorkflowDefinitionError(
      `${stepLabel} must specify promptPath`,
      definitionPath,
    );
  }
  const promptPath = expectRelativePath(step.promptPath, `${stepLabel}.promptPath`, definitionPath);
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

  // permissionMode defaults to bypassPermissions when not specified.
  const permissionMode =
    expectOptionalString(
      step.permissionMode,
      `${stepLabel}.permissionMode`,
      definitionPath,
    ) ?? "bypassPermissions";
  if (!VALID_PERMISSION_MODES.has(permissionMode)) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.permissionMode must be one of ${Array.from(VALID_PERMISSION_MODES).join(", ")}`,
      definitionPath,
    );
  }

  // settingSources default to ["project"].
  const settingSources =
    expectOptionalStringArray(
      step.settingSources,
      `${stepLabel}.settingSources`,
      definitionPath,
    ) ?? ["project"];
  for (const source of settingSources) {
    if (!VALID_SETTING_SOURCES.has(source)) {
      throw new WorkflowDefinitionError(
        `${stepLabel}.settingSources entries must be one of ${Array.from(VALID_SETTING_SOURCES).join(", ")}`,
        definitionPath,
      );
    }
  }

  const model = expectNonEmptyString(step.model, `${stepLabel}.model`, definitionPath);
  if (!VALID_MODEL_IDS.has(model)) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.model: unknown model "${model}"`,
      definitionPath,
    );
  }

  const effort = expectNonEmptyString(step.effort, `${stepLabel}.effort`, definitionPath);
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
  if (autonomyMode === "supervised") {
    throw new WorkflowDefinitionError(
      `${stepLabel}.autonomyMode cannot be supervised for workflow agent steps because SDK tool calls cannot be routed through KOTA approvals`,
      definitionPath,
    );
  }

  const declaredHarness = expectOptionalString(
    step.harness,
    `${stepLabel}.harness`,
    definitionPath,
  );
  const harness = declaredHarness ?? options.defaultAgentHarness;
  if (!harness) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.harness is required — set harness on the step or configure KotaConfig.defaultAgentHarness`,
      definitionPath,
    );
  }

  return {
    id: expectName(step.id, `${stepLabel}.id`, definitionPath),
    type: "agent",
    agentName,
    harness,
    promptPath,
    moduleRoot,
    model,
    effort: effort as WorkflowAgentStep["effort"],
    timeoutMs: expectOptionalInteger(
      step.timeoutMs,
      `${stepLabel}.timeoutMs`,
      definitionPath,
      1,
    ),
    maxTurns: expectOptionalInteger(
      step.maxTurns,
      `${stepLabel}.maxTurns`,
      definitionPath,
      1,
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
    permissionMode: permissionMode as WorkflowAgentStep["permissionMode"],
    allowedTools: expectOptionalStringArray(
      step.allowedTools,
      `${stepLabel}.allowedTools`,
      definitionPath,
    ),
    disallowedTools: expectOptionalStringArray(
      step.disallowedTools,
      `${stepLabel}.disallowedTools`,
      definitionPath,
    ),
    settingSources: settingSources as WorkflowAgentStep["settingSources"],
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
    retry: step.retry,
    repairLoop:
      step.repairLoop !== undefined
        ? validateRepairLoop(step.repairLoop, `${stepLabel}.repairLoop`, definitionPath)
        : undefined,
    outputFormat: validateOutputFormat(step.outputFormat, stepLabel, definitionPath),
    outputSchema: validateOutputSchema(step.outputSchema, step.outputFormat, stepLabel, definitionPath),
  };
}

function validateOutputFormat(
  value: unknown,
  stepLabel: string,
  definitionPath: string,
): "json" | undefined {
  if (value === undefined) return undefined;
  if (value !== "json") {
    throw new WorkflowDefinitionError(
      `${stepLabel}.outputFormat must be "json"`,
      definitionPath,
    );
  }
  return "json";
}

function validateOutputSchema(
  value: unknown,
  outputFormat: unknown,
  stepLabel: string,
  definitionPath: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (outputFormat !== "json") {
    throw new WorkflowDefinitionError(
      `${stepLabel}.outputSchema requires outputFormat: "json"`,
      definitionPath,
    );
  }
  if (!isPlainObject(value)) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.outputSchema must be an object`,
      definitionPath,
    );
  }
  return value as Record<string, unknown>;
}
