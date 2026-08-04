import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentDef, AgentWriteScope } from "#core/agents/agent-types.js";
import type { AgentHandoffRequest } from "#core/agents/handoff.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import {
  tryCaptureWorkflowMutationSnapshot,
  type WorkflowMutationSnapshot,
} from "#core/workflow/steps/agent-write-scope-snapshot.js";
import { getDelegateConfig } from "./delegate-config.js";
import { errorResult } from "./handoff-agent-input.js";
import {
  getCurrentHandoffAgentRuntime,
  type HandoffAgentRuntime,
} from "./handoff-agent-runtime.js";
import type { ToolResult, ToolRunnerContext } from "./index.js";

export function currentScope(
  cwd: string,
  context: ToolRunnerContext | undefined,
): AgentHandoffRequest["scope"] {
  const scopeId = context?.scopeId ?? context?.workflow?.scopeId ?? deriveDirectoryScopeId(cwd);
  const projectId = context?.projectId ?? context?.workflow?.projectId ?? scopeId;
  return { scopeId, projectId };
}

export function createChildAbortController(
  context: ToolRunnerContext | undefined,
): AbortController | undefined {
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

export function createHarnessWriter(transport: HandoffAgentRuntime["transport"]) {
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

export function resolveHandoffRuntime(): HandoffAgentRuntime | ToolResult {
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
    ...(delegateConfig.modelProvider !== undefined
      ? { modelProvider: delegateConfig.modelProvider }
      : {}),
    ...(delegateConfig.modelOutputTokenLimits !== undefined
      ? { modelOutputTokenLimits: delegateConfig.modelOutputTokenLimits }
      : {}),
    delegateBudget: delegateConfig.delegateBudget,
    ...(delegateConfig.transport !== undefined
      ? { transport: delegateConfig.transport }
      : {}),
    ...(delegateConfig.tokenBudget !== undefined
      ? { tokenBudget: delegateConfig.tokenBudget }
      : {}),
  };
}

export function buildSystemPrompt(
  agent: AgentDef,
  cwd: string,
  skillsPrompt: string | undefined,
): string | ToolResult {
  try {
    const mainPrompt = readFileSync(resolve(cwd, agent.promptPath), "utf-8");
    return [mainPrompt, skillsPrompt].filter(Boolean).join("\n\n");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return errorResult(`failed to read prompt for agent "${agent.name}": ${detail}`);
  }
}

export function writeScopeSnapshot(
  cwd: string,
  writeScope: AgentWriteScope,
): WorkflowMutationSnapshot | undefined | ToolResult {
  if (writeScope !== "deny-all" && writeScope.length === 0) {
    return undefined;
  }
  const snapshot = tryCaptureWorkflowMutationSnapshot(cwd);
  if (snapshot === undefined) {
    return errorResult("writeScope enforcement requires a git worktree");
  }
  return snapshot;
}
