import {
  resolveAgentHarness,
  routeKotaToolControlOptions,
  runAgentHarness,
} from "#core/agent-harness/index.js";
import type { AgentHandoffRequest } from "#core/agents/handoff.js";
import { buildAgentHandoffPrompt } from "#core/agents/handoff.js";
import { getGlobalConfigPath } from "#core/config/config.js";
import { capScopeAutonomyMode } from "#core/daemon/scope-policy.js";
import {
  findWriteScopeViolations,
} from "#core/workflow/steps/agent-write-scope.js";
import { capAutonomyMode } from "./autonomy-mode.js";
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
import { formatCompletedHandoffResult } from "./handoff-agent-result.js";
import { withHandoffAgentRuntime } from "./handoff-agent-runtime.js";
import {
  buildSystemPrompt,
  createChildAbortController,
  createHarnessWriter,
  currentScope,
  resolveHandoffRuntime,
  writeScopeSnapshot,
} from "./handoff-agent-runtime-helpers.js";
import { buildAgentToolPolicy } from "./handoff-agent-tool-policy.js";
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
  const scopePolicy = runtime.getScopePolicySnapshot?.().policy ?? runtime.scopePolicy;
  const parentCappedAutonomyMode = capAutonomyMode(
    autonomyMode,
    runtime.autonomyMode ?? "autonomous",
  );
  const effectiveAutonomyMode = scopePolicy
    ? capScopeAutonomyMode(parentCappedAutonomyMode, scopePolicy)
    : parentCappedAutonomyMode;
  const agent = runtime.resolveAgentDef(agentName);
  if (!agent) {
    return errorResult(`unknown registered agent "${agentName}"`);
  }

  const harness = resolveAgentHarness(runtime.harness);
  if (
    harness.toolControl === "kota" &&
    scopePolicy !== undefined &&
    runtime.approvalQueue === undefined
  ) {
    return errorResult(
      "KOTA-hosted handoff scope-policy enforcement requires the parent approval queue",
    );
  }
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
    effectiveAutonomyMode,
    resolvedToolPolicy,
    askOwnerToolName,
  );
  if (isErrorResult(toolScope)) return toolScope;
  const writeScope = resolveWriteScope(agent, requestedWriteScope);
  if (isErrorResult(writeScope)) return writeScope;

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
      const current = currentScope(cwd, context);
      if (runtime.scopeId !== undefined && runtime.scopeId !== current.scopeId) {
        return errorResult(
          `handoff runtime scope "${runtime.scopeId}" does not match current scope "${current.scopeId}"`,
        );
      }
      if (
        runtime.scopeId !== undefined &&
        runtime.scopeId !== current.scopeId
      ) {
        return errorResult(
          `handoff runtime scope "${runtime.scopeId}" does not match current scope "${current.scopeId}"`,
        );
      }
      const scope = readScope(input, current);
      if (isErrorResult(scope)) return scope;
      const preSnapshot = writeScopeSnapshot(cwd, writeScope);
      if (preSnapshot !== undefined && isErrorResult(preSnapshot)) {
        return preSnapshot;
      }
      const trace = readParent(input, context);
      const request: AgentHandoffRequest = {
        agentName,
        mode,
        reason,
        input: structuredInput,
        ...(inputSchema !== undefined ? { inputSchema } : {}),
        ...(outputSchema !== undefined ? { outputSchema } : {}),
        scope,
        autonomyMode: effectiveAutonomyMode,
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
      const result = await withHandoffAgentRuntime(
        {
          ...runtime,
          cwd,
          autonomyMode: effectiveAutonomyMode,
          scopeId: scope.scopeId,
          ...(scopePolicy !== undefined ? { scopePolicy } : {}),
        },
        () => runAgentHarness(
          harness,
          {
            prompt: buildAgentHandoffPrompt(request),
            model: agent.model,
            ...(runtime.modelProvider !== undefined ? { modelProvider: runtime.modelProvider } : {}),
            modelOutputTokenLimits: runtime.modelOutputTokenLimits,
            systemPrompt,
            scopeRoot: runtime.scopeRoot ?? cwd,
            cwd,
            ...(runtime.env !== undefined ? { env: runtime.env } : {}),
            effort: agent.effort,
            maxTurns: budget.maxTurns,
            autonomyMode: effectiveAutonomyMode,
            persistSession: mode === "transfer",
            ...(resumeSessionId !== undefined ? { resumeSessionId } : {}),
            ...routeKotaToolControlOptions(harness, {
              allowedTools: toolScope.allowedTools,
              disallowedTools: toolScope.disallowedTools,
              canUseTool: runtime.canUseTool,
              scopePolicy,
              scopePolicyAuthority: runtime.scopePolicyAuthority,
              getScopePolicySnapshot: runtime.getScopePolicySnapshot,
            }),
            authorityConfigPath:
              runtime.authorityConfigPath ?? getGlobalConfigPath(),
            ...(harness.toolControl === "kota" && runtime.approvalQueue !== undefined
              ? { approvalQueue: runtime.approvalQueue }
              : {}),
            ...(runtime.guardrailsConfig !== undefined
              ? { guardrailsConfig: runtime.guardrailsConfig }
              : {}),
            ...(runtime.idempotencyStore !== undefined
              ? { idempotencyStore: runtime.idempotencyStore }
              : {}),
            sessionContext: {
              sessionId: `handoff:${trace.causationId}`,
              scopeId: scope.scopeId,
            },
            ...(runtime.askOwner !== undefined ? { askOwner: runtime.askOwner } : {}),
            abortController: createChildAbortController(context),
            ...(childTokenBudget !== undefined ? { tokenBudget: childTokenBudget } : {}),
            ...(context?.workflow !== undefined ? { workflowContext: context.workflow } : {}),
          },
          createHarnessWriter(runtime.transport),
        ),
      );
      const postSnapshot = writeScopeSnapshot(cwd, writeScope);
      if (postSnapshot !== undefined && isErrorResult(postSnapshot)) {
        return postSnapshot;
      }
      const violations = findWriteScopeViolations(
        preSnapshot && postSnapshot
          ? preSnapshot.changedPathsSince(postSnapshot)
          : [],
        writeScope,
      );
      if (violations.length > 0) {
        if (writeScope === "deny-all") {
          preSnapshot?.restoreDenyAllMutations(cwd, violations);
        }
        return errorResult(
          `child agent "${agent.name}" wrote outside writeScope: ${violations.join(", ")}`,
        );
      }
      if (result.isError) {
        return errorResult(
          `child agent "${agent.name}" failed (${result.subtype ?? "error"}): ${result.text.trim()}`,
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
