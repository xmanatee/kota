import type {
  AgentCanUseTool,
  AgentPermissionResult,
} from "#core/agent-harness/index.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import {
  capScopeAutonomyMode,
  type ResolvedScopePolicy,
  type ScopePolicySnapshotAccessor,
} from "#core/daemon/scope-policy.js";
import { decideScopePolicyToolCall } from "#core/daemon/scope-policy-tool-query.js";
import { type AutonomyMode, resolveAutonomyGate } from "#core/tools/autonomy-mode.js";
import {
  localWriteEffect,
  networkReadEffect,
  operatorSurfaceEffect,
  readOnlyLocalEffect,
  readOnlySessionEffect,
  riskFromEffect,
  sessionWriteEffect,
  type ToolEffect,
} from "#core/tools/effect.js";
import { resolveOpaqueExecutionPrimaryEffect } from "#core/tools/opaque-execution-effects.js";
import type { ValidatedToolCallInput } from "#core/tools/tool-input-validation.js";
import { KOTA_OWNER_QUESTIONS_MCP_TOOL } from "./kota-tools-mcp.js";

type AgentToolInput = Parameters<AgentCanUseTool>[1];

type ClaudeToolPolicyBinding = {
  moduleName: string;
  effect: (input: AgentToolInput) => ToolEffect;
  normalizeInput?: (input: AgentToolInput) => AgentToolInput;
};

const localRead = () => readOnlyLocalEffect();
const localWrite = () => localWriteEffect();
const networkRead = () => networkReadEffect();
const sessionRead = () => readOnlySessionEffect();
const sessionWrite = () => sessionWriteEffect();
const operatorWrite = () => operatorSurfaceEffect();

const CLAUDE_TOOL_POLICY_BINDINGS = new Map<string, ClaudeToolPolicyBinding>([
  ["Read", binding("filesystem", localRead, normalizeFilePath)],
  ["Glob", binding("filesystem", localRead)],
  ["Grep", binding("filesystem", localRead)],
  ["Write", binding("filesystem", localWrite, normalizeFilePath)],
  ["Edit", binding("filesystem", localWrite, normalizeFilePath)],
  ["MultiEdit", binding("filesystem", localWrite)],
  ["NotebookRead", binding("notebook", localRead, normalizeNotebookPath)],
  ["NotebookEdit", binding("notebook", localWrite, normalizeNotebookPath)],
  ["WebFetch", binding("web-access", networkRead)],
  ["WebSearch", binding("web-access", networkRead)],
  ["Bash", binding("execution", shellEffect)],
  ["Task", binding("claude-agent-harness", localWrite)],
  ["Skill", binding("claude-agent-harness", localRead)],
  ["ToolSearch", binding("claude-agent-harness", sessionRead)],
  ["TodoRead", binding("claude-agent-harness", sessionRead)],
  ["TodoWrite", binding("claude-agent-harness", sessionWrite)],
  ["EnterPlanMode", binding("claude-agent-harness", sessionWrite)],
  ["ExitPlanMode", binding("claude-agent-harness", sessionWrite)],
  ["AskUserQuestion", binding("claude-agent-harness", operatorWrite)],
  [KOTA_OWNER_QUESTIONS_MCP_TOOL, binding("claude-agent-harness", operatorWrite)],
]);

function binding(
  moduleName: string,
  effect: ClaudeToolPolicyBinding["effect"],
  normalizeInput?: ClaudeToolPolicyBinding["normalizeInput"],
): ClaudeToolPolicyBinding {
  return { moduleName, effect, ...(normalizeInput ? { normalizeInput } : {}) };
}

function normalizeFilePath(input: AgentToolInput): AgentToolInput {
  const path = input.path ?? input.file_path;
  return path === undefined ? input : { ...input, path };
}

function normalizeNotebookPath(input: AgentToolInput): AgentToolInput {
  const path = input.path ?? input.notebook_path;
  return path === undefined ? input : { ...input, path };
}

function shellEffect(input: AgentToolInput): ToolEffect {
  return resolveOpaqueExecutionPrimaryEffect("Bash", input)
    ?? localWriteEffect();
}

function moduleAvailability(
  policy: ResolvedScopePolicy,
  moduleName: string,
): ResolvedScopePolicy["modules"]["defaultAvailability"] {
  return policy.modules.overrides.find(
    (entry) => entry.moduleName === moduleName,
  )?.availability ?? policy.modules.defaultAvailability;
}

function deny(message: string): AgentPermissionResult {
  return {
    behavior: "deny",
    message,
    decisionAttribution: "operator-deny",
  };
}

export function createClaudeScopePolicyGuard(args: {
  policy: ResolvedScopePolicy;
  autonomyMode: AutonomyMode;
  getScopePolicySnapshot?: ScopePolicySnapshotAccessor;
  approvalQueue?: ApprovalQueue;
  cwd?: string;
  sessionId?: string;
}): AgentCanUseTool {
  return async (toolName, input): Promise<AgentPermissionResult> => {
    if (JSON.stringify(input).toLowerCase().includes("scope-authority-token.json")) {
      return deny(
        "Blocked by scope policy: machine-owned scope authority credentials are not agent-readable.",
      );
    }
    const binding = CLAUDE_TOOL_POLICY_BINDINGS.get(toolName);
    if (!binding) {
      return deny(
        `Blocked by scope policy: Claude tool ${toolName} has no effect-aware policy binding.`,
      );
    }

    const policy = args.getScopePolicySnapshot?.().policy ?? args.policy;

    const availability = moduleAvailability(policy, binding.moduleName);
    if (availability !== "enabled") {
      return deny(
        `Blocked by scope policy: module ${binding.moduleName} is ${availability} ` +
          `(source ${policy.modules.source.scopeId}).`,
      );
    }

    const normalizedInput = binding.normalizeInput?.(input) ?? input;
    const effect = binding.effect(normalizedInput);
    const risk = riskFromEffect(effect);
    const decision = decideScopePolicyToolCall(
      policy,
      toolName,
      effect,
      normalizedInput as ValidatedToolCallInput,
    );
    if (decision.outcome === "deny" || decision.outcome === "ignore") {
      return deny(`Blocked by scope policy: ${decision.rendered}`);
    }

    const effectiveAutonomyMode = capScopeAutonomyMode(args.autonomyMode, policy);
    const autonomyDecision = resolveAutonomyGate(effectiveAutonomyMode, {
      tool: toolName,
      risk,
      policy: "allow",
      reason: `${effect.kind} on ${effect.scope}`,
    });
    if (autonomyDecision.action === "deny") {
      return deny(autonomyDecision.message);
    }

    const queueReason = decision.outcome === "confirm"
      ? decision.rendered
      : autonomyDecision.action === "queue"
        ? autonomyDecision.reason
        : undefined;
    if (queueReason === undefined) {
      return { behavior: "allow", updatedInput: input };
    }

    if (!args.approvalQueue) {
      return deny(
        `Blocked because the approval queue is unavailable: ${queueReason}`,
      );
    }
    const queued = args.approvalQueue.enqueue(
      toolName,
      input,
      risk,
      queueReason,
      "claude-agent-sdk-scope-policy",
      undefined,
      undefined,
      undefined,
      args.sessionId,
    );
    return deny(`Queued for approval [${queued.id}]: ${queueReason}`);
  };
}
