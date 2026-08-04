import type {
  KotaJsonObject,
  KotaToolInputSchema,
} from "#core/agent-harness/message-protocol.js";
import type {
  AgentDef,
  AgentToolPolicy,
  AgentWriteScope,
} from "#core/agents/agent-types.js";
import type {
  AgentHandoffMode,
  AgentHandoffRequest,
} from "#core/agents/handoff.js";
import { type AutonomyMode, isAutonomyMode } from "#core/tools/autonomy-mode.js";
import { validatePayloadSchema } from "#core/workflow/payload-validator.js";
import { pathInScope } from "#core/workflow/steps/agent-write-scope.js";
import { extractJsonOutput } from "#core/workflow/steps/step-executor-agent-json.js";
import { resolveAgentToolScope } from "#core/workflow/steps/step-executor-agent-tool-scope.js";
import {
  type DelegateBudgetFailure,
  serializeDelegateBudgetFailure,
} from "./delegate-budget.js";
import type { ToolResult, ToolRunner, ToolRunnerContext } from "./index.js";

export type ToolInput = Parameters<ToolRunner>[0];
type ToolInputValue = ToolInput[string];

const VALID_HANDOFF_MODES = new Set<AgentHandoffMode>(["call", "transfer"]);

export function errorResult(content: string): ToolResult {
  return { content: `Error: ${content}`, is_error: true };
}

export function isErrorResult<T>(value: T | ToolResult): value is ToolResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "is_error" in value &&
    value.is_error === true
  );
}

export function budgetFailureResult(failure: DelegateBudgetFailure): ToolResult {
  return {
    content: `Error: handoff_agent budget exhausted: ${failure.message}`,
    is_error: true,
    _meta: {
      delegateBudget: serializeDelegateBudgetFailure(failure),
    },
  };
}

export function readRequiredString(input: ToolInput, key: string): string | ToolResult {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    return errorResult(`${key} is required`);
  }
  return value.trim();
}

function readOptionalString(value: ToolInputValue): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isObject(value: ToolInputValue): value is KotaJsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readStringArray(
  input: ToolInput,
  key: string,
): string[] | ToolResult | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    return errorResult(`${key} must be an array of non-empty strings`);
  }
  return value.map((item) => item.trim()).sort();
}

export function readSchema(
  input: ToolInput,
  key: string,
): KotaToolInputSchema | ToolResult | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!isObject(value) || value.type !== "object") {
    return errorResult(`${key} must be a JSON Schema object with type "object"`);
  }
  return value as KotaToolInputSchema;
}

export function readStructuredInput(input: ToolInput): KotaJsonObject | ToolResult {
  const value = input.input;
  if (!isObject(value)) {
    return errorResult("input must be a structured JSON object");
  }
  return value;
}

export function validateStructuredInput(
  value: KotaJsonObject,
  inputSchema: KotaToolInputSchema | undefined,
): ToolResult | undefined {
  if (inputSchema === undefined) return undefined;
  const validationError = validatePayloadSchema(inputSchema, value, "input");
  if (validationError === null) return undefined;
  return errorResult(`input failed input_schema validation: ${validationError}`);
}

export function readBudget(
  input: ToolInput,
): { maxTurns: number; maxTotalTokens?: number } | ToolResult {
  const budget = input.budget;
  if (!isObject(budget)) return errorResult("budget.max_turns is required");
  const maxTurns = budget.max_turns;
  if (typeof maxTurns !== "number" || !Number.isInteger(maxTurns) || maxTurns < 1) {
    return errorResult("budget.max_turns must be an integer >= 1");
  }
  const maxTotalTokens = budget.max_total_tokens;
  if (maxTotalTokens === undefined) return { maxTurns };
  if (
    typeof maxTotalTokens !== "number" ||
    !Number.isInteger(maxTotalTokens) ||
    maxTotalTokens < 1
  ) {
    return errorResult("budget.max_total_tokens must be an integer >= 1");
  }
  return { maxTurns, maxTotalTokens };
}

export function readMode(rawMode: string): AgentHandoffMode | ToolResult {
  if (!VALID_HANDOFF_MODES.has(rawMode as AgentHandoffMode)) {
    return errorResult(`mode must be "call" or "transfer", got "${rawMode}"`);
  }
  return rawMode as AgentHandoffMode;
}

export function readAutonomyMode(rawMode: string): AutonomyMode | ToolResult {
  if (!isAutonomyMode(rawMode)) {
    return errorResult("autonomy_mode must be passive, supervised, or autonomous");
  }
  if (rawMode === "supervised") {
    return errorResult("autonomy_mode supervised is not supported for handoff_agent because child SDK tool calls cannot be routed through KOTA approvals");
  }
  return rawMode;
}

export function resolveWriteScope(
  agent: AgentDef,
  requested: string[] | undefined,
): AgentWriteScope | ToolResult {
  const registeredScope = agent.writeScope;
  if (requested === undefined) return registeredScope;
  if (registeredScope === "deny-all") return "deny-all";
  if (registeredScope.length === 0) return requested;
  const outside = requested.filter((entry) => !pathInScope(entry, registeredScope));
  if (outside.length > 0) {
    return errorResult(
      `requested write_scope exceeds the registered agent writeScope: ${outside.sort().join(", ")}`,
    );
  }
  return requested;
}

export function readScope(
  input: ToolInput,
  current: AgentHandoffRequest["scope"],
): AgentHandoffRequest["scope"] | ToolResult {
  const value = input.scope;
  if (!isObject(value)) return errorResult("scope.scope_id is required");
  const scopeId = readOptionalString(value.scope_id);
  if (!scopeId) return errorResult("scope.scope_id is required");
  const projectId = readOptionalString(value.project_id);
  if (projectId && projectId !== scopeId) {
    return errorResult("scope.project_id must match scope.scope_id for directory-backed handoffs");
  }
  if (scopeId !== current.scopeId) {
    return errorResult(
      `requested scope.scope_id "${scopeId}" does not match current scope "${current.scopeId}"`,
    );
  }
  if (projectId && projectId !== current.projectId) {
    return errorResult(
      `requested scope.project_id "${projectId}" does not match current project "${current.projectId}"`,
    );
  }
  return {
    scopeId,
    projectId: projectId ?? current.projectId,
  };
}

export function readParent(
  input: ToolInput,
  context: ToolRunnerContext | undefined,
): AgentHandoffRequest["trace"] {
  const parent = input.parent;
  const parentObject: KotaJsonObject = isObject(parent) ? parent : {};
  const parentSessionId = readOptionalString(parentObject.session_id) ?? context?.sessionId;
  const parentToolUseId = readOptionalString(parentObject.tool_use_id) ?? context?.toolUseId;
  const parentRunId = readOptionalString(parentObject.run_id) ?? context?.workflow?.runId;
  const parentStepId = readOptionalString(parentObject.step_id) ?? context?.workflow?.stepId;
  const parentSpanId = readOptionalString(parentObject.span_id) ?? context?.workflow?.spanId;
  return {
    causationId: context?.toolUseId ?? parentSpanId ?? `handoff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ...(parentSessionId ? { parentSessionId } : {}),
    ...(parentToolUseId ? { parentToolUseId } : {}),
    ...(parentRunId ? { parentRunId } : {}),
    ...(parentStepId ? { parentStepId } : {}),
    ...(parentSpanId ? { parentSpanId } : {}),
  };
}

export function buildRequestedToolPolicy(input: ToolInput): AgentToolPolicy | ToolResult {
  const allowed = readStringArray(input, "allowed_tools");
  if (allowed && !Array.isArray(allowed)) return allowed;
  const disallowed = readStringArray(input, "disallowed_tools");
  if (disallowed && !Array.isArray(disallowed)) return disallowed;
  return {
    ...(allowed !== undefined ? { allowed } : {}),
    ...(disallowed !== undefined ? { disallowed } : {}),
  };
}

export function resolveHandoffToolScope(
  autonomyMode: AutonomyMode,
  toolPolicy: AgentToolPolicy,
  askOwnerToolName: string | null,
): ReturnType<typeof resolveAgentToolScope> | ToolResult {
  try {
    return resolveAgentToolScope(
      autonomyMode,
      toolPolicy.allowed,
      toolPolicy.disallowed,
      askOwnerToolName,
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return errorResult(detail);
  }
}

export function extractStructuredOutput(
  text: string,
  outputSchema: KotaToolInputSchema | undefined,
): KotaJsonObject | ToolResult | undefined {
  if (!outputSchema) return undefined;
  try {
    const parsed = extractJsonOutput(
      "handoff_agent",
      text,
      outputSchema as Parameters<typeof extractJsonOutput>[2],
    );
    if (!isObject(parsed)) {
      return errorResult("child output JSON must be an object");
    }
    return parsed;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return errorResult(`child structured output validation failed: ${detail}`);
  }
}
