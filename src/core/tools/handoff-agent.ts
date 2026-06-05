import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  resolveAgentHarness,
  routeKotaToolControlOptions,
  runAgentHarness,
} from "#core/agent-harness/index.js";
import type {
  KotaJsonObject,
  KotaTool,
  KotaToolInputSchema,
} from "#core/agent-harness/message-protocol.js";
import type { AgentDef, AgentToolPolicy } from "#core/agents/agent-types.js";
import {
  type AgentHandoffMode,
  type AgentHandoffRequest,
  buildAgentHandoffPrompt,
  resolveAgentToolPolicy,
} from "#core/agents/handoff.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { type AutonomyMode, isAutonomyMode } from "#core/tools/autonomy-mode.js";
import { validatePayloadSchema } from "#core/workflow/payload-validator.js";
import {
  diffMutatedPaths,
  findWriteScopeViolations,
  pathInScope,
  tryListWorkflowMutatedPaths,
} from "#core/workflow/steps/agent-write-scope.js";
import { extractJsonOutput } from "#core/workflow/steps/step-executor-agent-json.js";
import { resolveAgentToolScope } from "#core/workflow/steps/step-executor-agent-tool-scope.js";
import {
  type DelegateBudgetFailure,
  serializeDelegateBudgetFailure,
} from "./delegate-budget.js";
import { getDelegateConfig } from "./delegate-config.js";
import { assembleDelegateResult } from "./delegate-format.js";
import { localWriteEffect } from "./effect.js";
import {
  getCurrentHandoffAgentRuntime,
  type HandoffAgentRuntime,
} from "./handoff-agent-runtime.js";
import type { ToolResult, ToolRunner, ToolRunnerContext } from "./index.js";

type ToolInput = Parameters<ToolRunner>[0];
type ToolInputValue = ToolInput[string];

const VALID_HANDOFF_MODES = new Set<AgentHandoffMode>(["call", "transfer"]);

export const handoffAgentTool: KotaTool = {
  name: "handoff_agent",
  description:
    "Hand work to a registered named KOTA agent through the agent harness. " +
    "Use this when a known specialist AgentDef should own the next segment. " +
    "The request must include explicit autonomy mode, budget, reason, trace links, and any schema expectations.",
  input_schema: {
    type: "object",
    properties: {
      agent: {
        type: "string",
        description: "Registered AgentDef name to run.",
      },
      mode: {
        type: "string",
        enum: ["call", "transfer"],
        description: "call keeps the parent in control; transfer persists the child session when supported.",
      },
      input: {
        type: "object",
        description: "Structured handoff input for the named agent.",
      },
      reason: {
        type: "string",
        description: "Why this handoff is needed.",
      },
      autonomy_mode: {
        type: "string",
        enum: ["passive", "supervised", "autonomous"],
      },
      budget: {
        type: "object",
        properties: {
          max_turns: { type: "number" },
        },
        required: ["max_turns"],
        additionalProperties: false,
      },
      input_schema: {
        type: "object",
        description: "Optional JSON Schema used to validate the structured input before dispatch.",
      },
      output_schema: {
        type: "object",
        description: "Optional JSON Schema for a final fenced JSON object returned by the child agent.",
      },
      scope: {
        type: "object",
        properties: {
          scope_id: { type: "string" },
          project_id: { type: "string" },
        },
        required: ["scope_id"],
        additionalProperties: false,
      },
      resume_session_id: {
        type: "string",
        description: "Existing child session id to resume. Only valid with transfer mode.",
      },
      parent: {
        type: "object",
        properties: {
          run_id: { type: "string" },
          step_id: { type: "string" },
          session_id: { type: "string" },
          tool_use_id: { type: "string" },
          span_id: { type: "string" },
        },
        additionalProperties: false,
      },
      allowed_tools: {
        type: "array",
        items: { type: "string" },
      },
      disallowed_tools: {
        type: "array",
        items: { type: "string" },
      },
      write_scope: {
        type: "array",
        items: { type: "string" },
        description: "Optional narrower write scope for this handoff.",
      },
    },
    required: ["agent", "mode", "input", "reason", "autonomy_mode", "budget", "scope"],
    additionalProperties: false,
  },
  output_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["completed"] },
      agentName: { type: "string" },
      mode: { type: "string", enum: ["call", "transfer"] },
      childSessionId: { type: "string" },
      resumedSessionId: { type: "string" },
      turns: { type: "number" },
      content: { type: "string" },
      trace: { type: "object" },
      structuredOutput: { type: "object" },
    },
    required: ["kind", "agentName", "mode", "turns", "content", "trace"],
  },
};

function errorResult(content: string): ToolResult {
  return { content: `Error: ${content}`, is_error: true };
}

function isErrorResult(value: object): value is ToolResult {
  return "is_error" in value && value.is_error === true;
}

function budgetFailureResult(failure: DelegateBudgetFailure): ToolResult {
  return {
    content: `Error: handoff_agent budget exhausted: ${failure.message}`,
    is_error: true,
    _meta: {
      delegateBudget: serializeDelegateBudgetFailure(failure),
    },
  };
}

function readRequiredString(input: ToolInput, key: string): string | ToolResult {
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

function readStringArray(input: ToolInput, key: string): string[] | ToolResult | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    return errorResult(`${key} must be an array of non-empty strings`);
  }
  return value.map((item) => item.trim()).sort();
}

function readSchema(input: ToolInput, key: string): KotaToolInputSchema | ToolResult | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!isObject(value) || value.type !== "object") {
    return errorResult(`${key} must be a JSON Schema object with type "object"`);
  }
  return value as KotaToolInputSchema;
}

function readStructuredInput(input: ToolInput): KotaJsonObject | ToolResult {
  const value = input.input;
  if (!isObject(value)) {
    return errorResult("input must be a structured JSON object");
  }
  return value;
}

function validateStructuredInput(
  value: KotaJsonObject,
  inputSchema: KotaToolInputSchema | undefined,
): ToolResult | undefined {
  if (inputSchema === undefined) return undefined;
  const validationError = validatePayloadSchema(inputSchema, value, "input");
  if (validationError === null) return undefined;
  return errorResult(`input failed input_schema validation: ${validationError}`);
}

function readBudget(input: ToolInput): { maxTurns: number } | ToolResult {
  const budget = input.budget;
  if (!isObject(budget)) return errorResult("budget.max_turns is required");
  const maxTurns = budget.max_turns;
  if (typeof maxTurns !== "number" || !Number.isInteger(maxTurns) || maxTurns < 1) {
    return errorResult("budget.max_turns must be an integer >= 1");
  }
  return { maxTurns };
}

function readMode(rawMode: string): AgentHandoffMode | ToolResult {
  if (!VALID_HANDOFF_MODES.has(rawMode as AgentHandoffMode)) {
    return errorResult(`mode must be "call" or "transfer", got "${rawMode}"`);
  }
  return rawMode as AgentHandoffMode;
}

function readAutonomyMode(rawMode: string): AutonomyMode | ToolResult {
  if (!isAutonomyMode(rawMode)) {
    return errorResult("autonomy_mode must be passive, supervised, or autonomous");
  }
  if (rawMode === "supervised") {
    return errorResult("autonomy_mode supervised is not supported for handoff_agent because child SDK tool calls cannot be routed through KOTA approvals");
  }
  return rawMode;
}

function resolveWriteScope(agent: AgentDef, requested: string[] | undefined): string[] | ToolResult {
  if (requested === undefined) return agent.writeScope;
  if (agent.writeScope.length === 0) return requested;
  const outside = requested.filter((entry) => !pathInScope(entry, agent.writeScope));
  if (outside.length > 0) {
    return errorResult(
      `requested write_scope exceeds the registered agent writeScope: ${outside.sort().join(", ")}`,
    );
  }
  return requested;
}

function readScope(
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

function readParent(input: ToolInput, context: ToolRunnerContext | undefined): AgentHandoffRequest["trace"] {
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

function currentScope(cwd: string, context: ToolRunnerContext | undefined): AgentHandoffRequest["scope"] {
  const scopeId = context?.scopeId ?? context?.workflow?.scopeId ?? deriveDirectoryScopeId(cwd);
  const projectId = context?.projectId ?? context?.workflow?.projectId ?? scopeId;
  return { scopeId, projectId };
}

function createChildAbortController(context: ToolRunnerContext | undefined): AbortController | undefined {
  if (!context?.signal) return undefined;
  const controller = new AbortController();
  if (context.signal.aborted) {
    controller.abort(context.signal.reason);
    return controller;
  }
  context.signal.addEventListener(
    "abort",
    () => controller.abort(context.signal?.reason),
    { once: true },
  );
  return controller;
}

function createHarnessWriter(transport: HandoffAgentRuntime["transport"]) {
  if (!transport) return undefined;
  return {
    write(text: string): boolean {
      transport.emit({
        type: "progress",
        content: text,
        source: "handoff_agent",
      });
      return true;
    },
  };
}

function resolveHandoffRuntime(): HandoffAgentRuntime | ToolResult {
  const scopedRuntime = getCurrentHandoffAgentRuntime();
  if (scopedRuntime) return scopedRuntime;

  const delegateConfig = getDelegateConfig();
  if (!delegateConfig.resolveAgentDef) {
    return errorResult("agent registry unavailable for handoff_agent");
  }
  if (!delegateConfig.harness) {
    return errorResult("handoff_agent requires config.defaultAgentHarness so the child run has an explicit harness");
  }
  return {
    cwd: delegateConfig.cwd ?? process.cwd(),
    harness: delegateConfig.harness,
    resolveAgentDef: delegateConfig.resolveAgentDef,
    ...(delegateConfig.resolveSkillsPrompt !== undefined
      ? { resolveSkillsPrompt: delegateConfig.resolveSkillsPrompt }
      : {}),
    ...(delegateConfig.modelOutputTokenLimits !== undefined
      ? { modelOutputTokenLimits: delegateConfig.modelOutputTokenLimits }
      : {}),
    delegateBudget: delegateConfig.delegateBudget,
    ...(delegateConfig.transport !== undefined
      ? { transport: delegateConfig.transport }
      : {}),
  };
}

function buildSystemPrompt(agent: AgentDef, cwd: string, skillsPrompt: string | undefined): string | ToolResult {
  try {
    const mainPrompt = readFileSync(resolve(cwd, agent.promptPath), "utf-8");
    return [mainPrompt, skillsPrompt].filter(Boolean).join("\n\n");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return errorResult(`failed to read prompt for agent "${agent.name}": ${detail}`);
  }
}

function buildRequestedToolPolicy(input: ToolInput): AgentToolPolicy | ToolResult {
  const allowed = readStringArray(input, "allowed_tools");
  if (allowed && !Array.isArray(allowed)) return allowed;
  const disallowed = readStringArray(input, "disallowed_tools");
  if (disallowed && !Array.isArray(disallowed)) return disallowed;
  return {
    ...(allowed !== undefined ? { allowed } : {}),
    ...(disallowed !== undefined ? { disallowed } : {}),
  };
}

function resolveHandoffToolScope(
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

function extractStructuredOutput(
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

function writeScopeSnapshot(cwd: string, writeScope: readonly string[]): string[] | ToolResult {
  if (writeScope.length === 0) return tryListWorkflowMutatedPaths(cwd) ?? [];
  const snapshot = tryListWorkflowMutatedPaths(cwd);
  if (snapshot === undefined) {
    return errorResult("writeScope enforcement requires a git worktree");
  }
  return snapshot;
}

export async function runHandoffAgent(
  input: ToolInput,
  context?: ToolRunnerContext,
): Promise<ToolResult> {
  const agentName = readRequiredString(input, "agent");
  if (typeof agentName !== "string") return agentName;
  const structuredInput = readStructuredInput(input);
  if (isErrorResult(structuredInput)) return structuredInput;
  const reason = readRequiredString(input, "reason");
  if (typeof reason !== "string") return reason;
  const rawMode = readRequiredString(input, "mode");
  if (typeof rawMode !== "string") return rawMode;
  const mode = readMode(rawMode);
  if (typeof mode !== "string") return mode;
  const rawAutonomyMode = readRequiredString(input, "autonomy_mode");
  if (typeof rawAutonomyMode !== "string") return rawAutonomyMode;
  const autonomyMode = readAutonomyMode(rawAutonomyMode);
  if (typeof autonomyMode !== "string") return autonomyMode;
  const budget = readBudget(input);
  if (isErrorResult(budget)) return budget;
  const inputSchema = readSchema(input, "input_schema");
  if (inputSchema && isErrorResult(inputSchema)) return inputSchema;
  const inputValidation = validateStructuredInput(structuredInput, inputSchema);
  if (inputValidation) return inputValidation;
  const outputSchema = readSchema(input, "output_schema");
  if (outputSchema && isErrorResult(outputSchema)) return outputSchema;
  const requestedToolPolicy = buildRequestedToolPolicy(input);
  if (isErrorResult(requestedToolPolicy)) return requestedToolPolicy;
  const requestedWriteScope = readStringArray(input, "write_scope");
  if (requestedWriteScope && !Array.isArray(requestedWriteScope)) return requestedWriteScope;
  const resumeSessionId = readOptionalString(input.resume_session_id);
  if (resumeSessionId !== undefined && mode !== "transfer") {
    return errorResult("resume_session_id is only valid with transfer mode");
  }

  const runtime = resolveHandoffRuntime();
  if (isErrorResult(runtime)) return runtime;
  const agent = runtime.resolveAgentDef(agentName);
  if (!agent) {
    return errorResult(`unknown registered agent "${agentName}"`);
  }

  const harness = resolveAgentHarness(runtime.harness);
  if (runtime.askOwner !== undefined && harness.askOwnerToolName === null) {
    return errorResult(
      `agent harness "${harness.name}" cannot host inherited owner-question context`,
    );
  }
  const toolPolicy = resolveAgentToolPolicy(agent.tools, requestedToolPolicy);
  if (!toolPolicy.ok) return errorResult(toolPolicy.message);
  const askOwnerToolName = runtime.askOwner !== undefined ? harness.askOwnerToolName : null;
  const toolScope = resolveHandoffToolScope(
    autonomyMode,
    toolPolicy.policy,
    askOwnerToolName,
  );
  if (isErrorResult(toolScope)) return toolScope;
  const writeScope = resolveWriteScope(agent, requestedWriteScope);
  if (!Array.isArray(writeScope)) return writeScope;

  const budgetStart = runtime.delegateBudget.tryStart();
  if (!budgetStart.ok) {
    const result = budgetFailureResult(budgetStart.failure);
    runtime.transport?.emit({ type: "error", message: `[kota] ${result.content}` });
    return result;
  }

  const budgetLease = budgetStart.lease;
  try {
    return await budgetLease.run(async () => {
      const cwd = runtime.cwd;
      const scope = readScope(input, currentScope(cwd, context));
      if (isErrorResult(scope)) return scope;
      const preSnapshot = writeScopeSnapshot(cwd, writeScope);
      if (!Array.isArray(preSnapshot)) return preSnapshot;
      const trace = readParent(input, context);
      const request: AgentHandoffRequest = {
        agentName,
        mode,
        reason,
        input: structuredInput,
        ...(inputSchema !== undefined ? { inputSchema } : {}),
        ...(outputSchema !== undefined ? { outputSchema } : {}),
        scope,
        autonomyMode,
        budget: { maxTurns: budget.maxTurns },
        toolPolicy: toolPolicy.policy,
        writeScope,
        ...(resumeSessionId !== undefined ? { resumeSessionId } : {}),
        trace,
      };
      const skillsPrompt = agent.skills && runtime.resolveSkillsPrompt
        ? runtime.resolveSkillsPrompt(agent.skills, agent.name)
        : undefined;
      const systemPrompt = buildSystemPrompt(agent, cwd, skillsPrompt);
      if (typeof systemPrompt !== "string") return systemPrompt;
      if (
        harness.toolControl !== "kota" &&
        ((toolScope.allowedTools?.length ?? 0) > 0 ||
          (toolScope.disallowedTools?.length ?? 0) > 0)
      ) {
        return errorResult(
          `agent harness "${harness.name}" cannot honor named handoff tool policy`,
        );
      }
      const result = await runAgentHarness(
        harness,
        {
          prompt: buildAgentHandoffPrompt(request),
          model: agent.model,
          modelOutputTokenLimits: runtime.modelOutputTokenLimits,
          systemPrompt,
          cwd,
          effort: agent.effort,
          maxTurns: budget.maxTurns,
          autonomyMode,
          persistSession: mode === "transfer",
          ...(resumeSessionId !== undefined ? { resumeSessionId } : {}),
          ...routeKotaToolControlOptions(harness, {
            allowedTools: toolScope.allowedTools,
            disallowedTools: toolScope.disallowedTools,
            canUseTool: runtime.canUseTool,
          }),
          ...(runtime.askOwner !== undefined ? { askOwner: runtime.askOwner } : {}),
          abortController: createChildAbortController(context),
        },
        createHarnessWriter(runtime.transport),
      );
      if (result.isError) {
        return errorResult(
          `child agent "${agent.name}" failed (${result.subtype ?? "error"}): ${result.text.trim()}`,
        );
      }

      const postSnapshot = writeScopeSnapshot(cwd, writeScope);
      if (!Array.isArray(postSnapshot)) return postSnapshot;
      const violations = findWriteScopeViolations(
        diffMutatedPaths(preSnapshot, postSnapshot),
        writeScope,
      );
      if (violations.length > 0) {
        return errorResult(
          `child agent "${agent.name}" wrote outside writeScope: ${violations.join(", ")}`,
        );
      }

      const structuredOutput = extractStructuredOutput(result.text, outputSchema);
      if (structuredOutput && isErrorResult(structuredOutput)) return structuredOutput;
      const traceWithChild = {
        ...trace,
        ...(result.sessionId ? { childSessionId: result.sessionId } : {}),
      };
      const structuredContent: KotaJsonObject = {
        kind: "completed",
        agentName: agent.name,
        mode,
        turns: result.turns,
        content: result.text,
        trace: traceWithChild,
        ...(result.sessionId ? { childSessionId: result.sessionId } : {}),
        ...(resumeSessionId !== undefined ? { resumedSessionId: resumeSessionId } : {}),
        ...(structuredOutput ? { structuredOutput } : {}),
      };
      const assembled = assembleDelegateResult(
        result.text,
        {
          mode: `handoff:${agent.name}`,
          turnsUsed: result.turns,
          turnsMax: budget.maxTurns,
          toolsUsed: [harness.name],
          completionReason: "done",
          urlsFetched: [],
          searchQueries: [],
        },
        new Set(),
        [],
      );
      return {
        ...assembled,
        structuredContent,
        _meta: {
          handoff: structuredContent,
        },
      };
    });
  } finally {
    budgetLease.release();
  }
}

export const registration = {
  tool: handoffAgentTool,
  runner: runHandoffAgent,
  effect: localWriteEffect(),
};
