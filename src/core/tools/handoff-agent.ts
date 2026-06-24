import {
  resolveAgentHarness,
  routeKotaToolControlOptions,
  runAgentHarness,
} from "#core/agent-harness/index.js";
import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import type { AgentToolPolicy } from "#core/agents/agent-types.js";
import type { AgentHandoffRequest } from "#core/agents/handoff.js";
import {
  type AgentHandoffMode,
  buildAgentHandoffPrompt,
  resolveAgentToolPolicy,
} from "#core/agents/handoff.js";
import {
  diffMutatedPaths,
  findWriteScopeViolations,
} from "#core/workflow/steps/agent-write-scope.js";
import { assembleDelegateResult } from "./delegate-format.js";
import { localWriteEffect } from "./effect.js";
import {
  budgetFailureResult,
  buildRequestedToolPolicy,
  errorResult,
  extractStructuredOutput,
  isErrorResult,
  readAutonomyMode,
  readBudget,
  readMode,
  readParent,
  readRequiredString,
  readSchema,
  readScope,
  readStringArray,
  readStructuredInput,
  resolveHandoffToolScope,
  resolveWriteScope,
  type ToolInput,
  validateStructuredInput,
} from "./handoff-agent-input.js";
import {
  buildSystemPrompt,
  createChildAbortController,
  createHarnessWriter,
  currentScope,
  resolveHandoffRuntime,
  writeScopeSnapshot,
} from "./handoff-agent-runtime-helpers.js";
import { handoffAgentTool } from "./handoff-agent-tool.js";
import type { ToolResult, ToolRunnerContext } from "./index.js";

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
  const resumeSessionId =
    typeof input.resume_session_id === "string" && input.resume_session_id.trim()
      ? input.resume_session_id.trim()
      : undefined;
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
  const toolPolicy = requestedToolPolicy;
  const resolvedToolPolicy = agent.tools
    ? buildAgentToolPolicy(agent.tools, toolPolicy)
    : buildAgentToolPolicy(undefined, toolPolicy);
  if (isErrorResult(resolvedToolPolicy)) return resolvedToolPolicy;
  const askOwnerToolName = runtime.askOwner !== undefined ? harness.askOwnerToolName : null;
  const toolScope = resolveHandoffToolScope(
    autonomyMode,
    resolvedToolPolicy,
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
      const cwd = context?.cwd ?? runtime.cwd;
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
        budget: {
          maxTurns: budget.maxTurns,
          ...(budget.maxTotalTokens !== undefined
            ? { maxTotalTokens: budget.maxTotalTokens }
            : {}),
        },
        toolPolicy: resolvedToolPolicy,
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
      const childTokenBudget = runtime.tokenBudget && budget.maxTotalTokens !== undefined
        ? runtime.tokenBudget.createChild({ maxTotalTokens: budget.maxTotalTokens })
        : runtime.tokenBudget;
      const result = await runAgentHarness(
        harness,
        {
          prompt: buildAgentHandoffPrompt(request),
          model: agent.model,
          ...(runtime.modelProvider !== undefined ? { modelProvider: runtime.modelProvider } : {}),
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
          ...(childTokenBudget !== undefined ? { tokenBudget: childTokenBudget } : {}),
          ...(context?.workflow !== undefined ? { workflowContext: context.workflow } : {}),
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
      return formatCompletedHandoffResult({
        agentName: agent.name,
        mode,
        text: result.text,
        turns: result.turns,
        trace,
        childSessionId: result.sessionId,
        resumeSessionId,
        structuredOutput,
        harnessName: harness.name,
        maxTurns: budget.maxTurns,
      });
    });
  } finally {
    budgetLease.release();
  }
}

function buildAgentToolPolicy(
  agentPolicy: AgentToolPolicy | undefined,
  requestedToolPolicy: AgentToolPolicy,
): AgentToolPolicy | ToolResult {
  const toolPolicy = resolveAgentToolPolicy(agentPolicy, requestedToolPolicy);
  return toolPolicy.ok ? toolPolicy.policy : errorResult(toolPolicy.message);
}

function formatCompletedHandoffResult(input: {
  agentName: string;
  mode: AgentHandoffMode;
  text: string;
  turns: number;
  trace: AgentHandoffRequest["trace"];
  childSessionId?: string;
  resumeSessionId?: string;
  structuredOutput?: KotaJsonObject;
  harnessName: string;
  maxTurns: number;
}): ToolResult {
  const traceWithChild = {
    ...input.trace,
    ...(input.childSessionId ? { childSessionId: input.childSessionId } : {}),
  };
  const structuredContent: KotaJsonObject = {
    kind: "completed",
    agentName: input.agentName,
    mode: input.mode,
    turns: input.turns,
    content: input.text,
    trace: traceWithChild,
    ...(input.childSessionId ? { childSessionId: input.childSessionId } : {}),
    ...(input.resumeSessionId !== undefined ? { resumedSessionId: input.resumeSessionId } : {}),
    ...(input.structuredOutput ? { structuredOutput: input.structuredOutput } : {}),
  };
  const assembled = assembleDelegateResult(
    input.text,
    {
      mode: `handoff:${input.agentName}`,
      turnsUsed: input.turns,
      turnsMax: input.maxTurns,
      toolsUsed: [input.harnessName],
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
}

export const registration = {
  tool: handoffAgentTool,
  runner: runHandoffAgent,
  effect: localWriteEffect(),
};
