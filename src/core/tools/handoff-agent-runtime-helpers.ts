import type { AgentDef, AgentWriteScope } from "#core/agents/agent-types.js";
import type { AgentHandoffRequest } from "#core/agents/handoff.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { type PromptReadPolicy, readKotaPrompt } from "#core/util/kota-install-paths.js";
import {
  tryCaptureWorkflowMutationSnapshot,
  type WorkflowMutationSnapshot,
} from "#core/workflow/steps/agent-write-scope-snapshot.js";
import {
  type DelegationRuntime,
  getCurrentDelegationRuntime,
} from "./delegation-runtime.js";
import { errorResult } from "./handoff-agent-input.js";
import type { ToolResult, ToolRunnerContext } from "./index.js";

export function currentScope(
  cwd: string,
  context: ToolRunnerContext | undefined,
): AgentHandoffRequest["scope"] {
  const scopeId = context?.scopeId ?? context?.workflow?.scopeId ?? deriveDirectoryScopeId(cwd);
  return { scopeId };
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

export function createHarnessWriter(transport: DelegationRuntime["transport"]) {
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

export function resolveHandoffRuntime(
  explicitRuntime?: DelegationRuntime,
): (DelegationRuntime & { harness: string; resolveAgentDef: NonNullable<DelegationRuntime["resolveAgentDef"]> }) | ToolResult {
  const runtime = explicitRuntime ?? getCurrentDelegationRuntime();
  if (!runtime) return errorResult("handoff_agent requires an owning delegation runtime");
  if (!runtime.resolveAgentDef) return errorResult("agent registry unavailable for handoff_agent");
  if (!runtime.harness) return errorResult("handoff_agent requires an explicit harness");
  return { ...runtime, harness: runtime.harness, resolveAgentDef: runtime.resolveAgentDef };
}

export function buildSystemPrompt(
  agent: AgentDef,
  cwd: string,
  skillsPrompt: string | undefined,
  policy?: PromptReadPolicy,
): string | ToolResult {
  try {
    const mainPrompt = readKotaPrompt(cwd, agent.promptPath, policy);
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
