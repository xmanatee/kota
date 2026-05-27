import type {
  KotaJsonObject,
  KotaMessage,
  KotaTextBlock,
} from "#core/agent-harness/message-protocol.js";
import { getSecretStore } from "#core/config/secrets.js";
import { getApprovalQueue } from "#core/daemon/approval-queue.js";
import { tryEmit } from "#core/events/event-bus.js";
import { truncateToolResult } from "#core/loop/context.js";
import type { Transport } from "#core/loop/transport.js";
import type {
  McpExecuteToolOptions,
  McpInputResolver,
  McpManager,
} from "#core/mcp/manager.js";
import { confirmAction } from "#core/util/confirm.js";
import { type AutonomyMode, resolveAutonomyGate } from "./autonomy-mode.js";
import { assess, type GuardrailsConfig } from "./guardrails.js";
import type { ToolResult, ToolResultBlock } from "./index.js";
import { executeTool, getToolEffect } from "./index.js";
import { getToolMiddleware } from "./tool-middleware.js";
import {
  getToolTelemetry,
  hasToolResultTruncationMarker,
  measureTelemetryPayloadBytes,
  type ToolTelemetryResultContentKind,
} from "./tool-telemetry.js";

type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};

function abortReason(signal: AbortSignal): Error {
  const { reason } = signal;
  return reason instanceof Error ? reason : new Error("Tool execution aborted");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

const CONTEXT_MAX_CHARS = 2000;
const CONTEXT_TURNS = 3;

/**
 * Extract the last N text-bearing turns from conversation messages as a plain
 * string for operator context. Skips tool-result-only messages.
 */
export function extractApprovalContext(
  messages: KotaMessage[],
  turns = CONTEXT_TURNS,
  maxChars = CONTEXT_MAX_CHARS,
): string | undefined {
  const lines: string[] = [];
  let collected = 0;
  for (let i = messages.length - 1; i >= 0 && collected < turns; i--) {
    const msg = messages[i];
    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter((b): b is KotaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ");
    }
    if (!text.trim()) continue;
    const prefix = msg.role === "assistant" ? "Assistant" : "User";
    lines.unshift(`${prefix}: ${text.trim()}`);
    collected++;
  }
  if (lines.length === 0) return undefined;
  const joined = lines.join("\n");
  return joined.length > maxChars ? `${joined.slice(0, maxChars)}…` : joined;
}

export type ToolResultEntry = {
  tool_use_id: string;
  content: string;
  blocks?: ToolResultBlock[];
  structuredContent?: KotaJsonObject;
  _meta?: KotaJsonObject;
  is_error?: boolean;
};

export type ToolCallExecutionOptions = {
  resultLimit: number;
  verbose: boolean;
  autonomyMode: AutonomyMode;
  mcpManager?: McpManager;
  mcpInputResolver?: McpInputResolver;
  transport?: Transport;
  guardrailsConfig?: GuardrailsConfig;
  sessionId?: string;
  messages?: KotaMessage[];
  signal?: AbortSignal;
};

function getToolResultTelemetryPayload(result: ToolResult): string | object {
  if (!result.blocks && !result.structuredContent && !result._meta) {
    return result.content;
  }
  return {
    content: result.content,
    ...(result.blocks ? { blocks: result.blocks } : {}),
    ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
    ...(result._meta ? { _meta: result._meta } : {}),
  };
}

function getToolResultContentKind(result: ToolResult): ToolTelemetryResultContentKind {
  const hasBlocks = result.blocks !== undefined && result.blocks.length > 0;
  const hasStructured = result.structuredContent !== undefined || result._meta !== undefined;
  if (hasBlocks && hasStructured) return "mixed";
  if (hasBlocks) return "blocks";
  if (hasStructured) return "structured";
  if (result.content.length === 0) return "empty";
  return "text";
}

function toolResultWouldTruncate(result: ToolResult, resultLimit: number): boolean {
  const payload = getToolResultTelemetryPayload(result);
  if (result.content.length > resultLimit) return true;
  if (result.blocks?.some((block) => block.type === "text" && block.text.length > resultLimit)) return true;
  return hasToolResultTruncationMarker(payload);
}

type ExecuteToolBlock = (block: ToolUseBlock) => Promise<ToolResultEntry>;

function isReadOnlyToolCall(
  block: ToolUseBlock,
  mcpManager: McpManager | undefined,
): boolean {
  if (mcpManager?.isMcpTool(block.name)) {
    return mcpManager.isToolReadOnly?.(block.name) === true;
  }
  return getToolEffect(block.name)?.kind === "read";
}

async function executeToolCallSchedule(
  toolBlocks: ToolUseBlock[],
  executeBlock: ExecuteToolBlock,
  mcpManager: McpManager | undefined,
): Promise<ToolResultEntry[]> {
  const results = new Array<ToolResultEntry>(toolBlocks.length);
  let readOnlyBatch: Array<{ block: ToolUseBlock; index: number }> = [];

  const flushReadOnlyBatch = async (): Promise<void> => {
    if (readOnlyBatch.length === 0) return;
    const batch = readOnlyBatch;
    readOnlyBatch = [];
    await Promise.all(
      batch.map(async ({ block, index }) => {
        results[index] = await executeBlock(block);
      }),
    );
  };

  for (const [index, block] of toolBlocks.entries()) {
    if (isReadOnlyToolCall(block, mcpManager)) {
      readOnlyBatch.push({ block, index });
      continue;
    }
    await flushReadOnlyBatch();
    results[index] = await executeBlock(block);
  }

  await flushReadOnlyBatch();
  return results;
}

/**
 * Execute tool calls with effect-aware scheduling, verbose logging, and result truncation.
 * Contiguous read-only calls may run concurrently; mutating, destructive, or
 * unknown calls are ordered barriers.
 * Routes MCP-namespaced tools through the McpManager when provided.
 * When guardrailsConfig is set, each tool call is assessed before execution.
 * Autonomy mode is consulted first: passive denies any non-safe tool, supervised
 * queues any non-safe tool for operator approval, and autonomous falls through
 * to normal guardrail policy resolution.
 * When messages are provided, the last few turns are captured as context on queued approvals.
 */
export async function executeToolCalls(
  toolBlocks: ToolUseBlock[],
  options: ToolCallExecutionOptions,
): Promise<ToolResultEntry[]> {
  const {
    resultLimit,
    verbose,
    autonomyMode,
    mcpManager,
    mcpInputResolver,
    transport,
    guardrailsConfig,
    sessionId,
    messages,
    signal,
  } = options;
  const executeBlock = async (block: ToolUseBlock): Promise<ToolResultEntry> => {
    throwIfAborted(signal);
    if (verbose && transport) {
      transport.emit({
        type: "status",
        message: `[kota] Tool: ${block.name}(${JSON.stringify(block.input).slice(0, 100)}...)`,
      });
    }
    const input = block.input as Record<string, unknown>;

    // Assess risk once up front so autonomy-mode gating and guardrails share
    // a single classification. Fall back to a neutral moderate assessment if
    // the session has no guardrails config attached — autonomy-mode still
    // needs a classification to gate non-safe tools.
    const assessment = guardrailsConfig
      ? assess(block.name, input, guardrailsConfig)
      : assess(block.name, input);

    // Autonomy-mode gating runs before policy resolution so passive and
    // supervised sessions cannot be bypassed by a moderate tool whose policy
    // happens to be "allow".
    const autonomyDecision = resolveAutonomyGate(autonomyMode, assessment);
    if (autonomyDecision.action === "deny") {
      tryEmit("guardrail.assessed", {
        tool: assessment.tool,
        risk: assessment.risk,
        policy: "deny",
        reason: autonomyDecision.message,
        ...(sessionId && { session: sessionId }),
      });
      if (transport) {
        transport.emit({
          type: "guardrail",
          tool: assessment.tool,
          risk: assessment.risk,
          policy: "deny",
          reason: autonomyDecision.message,
        });
      }
      return {
        tool_use_id: block.id,
        content: autonomyDecision.message,
        is_error: true,
      };
    }
    if (autonomyDecision.action === "queue") {
      const approvalContext = messages ? extractApprovalContext(messages) : undefined;
      const queued = getApprovalQueue().enqueue(
        block.name,
        input,
        assessment.risk,
        autonomyDecision.reason,
        sessionId,
        guardrailsConfig?.approvalTimeoutMs,
        undefined,
        approvalContext,
        sessionId,
      );
      tryEmit("guardrail.assessed", {
        tool: assessment.tool,
        risk: assessment.risk,
        policy: "queue",
        reason: autonomyDecision.reason,
        ...(sessionId && { session: sessionId }),
      });
      if (transport) {
        transport.emit({
          type: "guardrail",
          tool: assessment.tool,
          risk: assessment.risk,
          policy: "queue",
          reason: autonomyDecision.reason,
        });
      }
      return {
        tool_use_id: block.id,
        content: `Queued for approval [${queued.id}]: ${block.name} — ${autonomyDecision.reason}. ` +
          "Operators can review and resolve it through the approval CLI or authenticated daemon client.",
        is_error: true,
      };
    }

    // Guardrails: assess risk and enforce policy before execution
    if (guardrailsConfig) {
      tryEmit("guardrail.assessed", {
        tool: assessment.tool,
        risk: assessment.risk,
        policy: assessment.policy,
        reason: assessment.reason,
        ...(sessionId && { session: sessionId }),
      });
      if (transport) {
        transport.emit({
          type: "guardrail",
          tool: assessment.tool,
          risk: assessment.risk,
          policy: assessment.policy,
          reason: assessment.reason,
        });
      }
      if (assessment.policy === "deny") {
        return {
          tool_use_id: block.id,
          content: `Blocked by guardrails: ${block.name} is classified as ${assessment.risk} (${assessment.reason}). ` +
            "This operation requires approval. Use ask_user to request permission, or try a safer approach.",
          is_error: true,
        };
      }
      if (assessment.policy === "queue") {
        const approvalContext = messages ? extractApprovalContext(messages) : undefined;
        const queued = getApprovalQueue().enqueue(
          block.name, input, assessment.risk, assessment.reason, sessionId,
          guardrailsConfig.approvalTimeoutMs, undefined, approvalContext,
          sessionId,
        );
        return {
          tool_use_id: block.id,
          content: `Queued for approval [${queued.id}]: ${block.name} is classified as ${assessment.risk} (${assessment.reason}). ` +
            "Operators can review and resolve it through the approval CLI or authenticated daemon client.",
          is_error: true,
        };
      }
      if (assessment.policy === "confirm") {
        const approved = await confirmAction(
          `Allow ${block.name}? (${assessment.reason})`,
        );
        if (!approved) {
          return {
            tool_use_id: block.id,
            content: `Blocked by guardrails: ${block.name} requires confirmation (${assessment.reason}). ` +
              "Use ask_user to request explicit human approval, then retry.",
            is_error: true,
          };
        }
      }
    }

    // Route MCP tools through the manager, with middleware chain.
    // baseFn reads from call.input so retry middleware can adjust it
    // (e.g. shell timeout doubling).
    const startMs = performance.now();
    const inputBytes = measureTelemetryPayloadBytes(input);
    const telemetry = getToolTelemetry();
    telemetry.recordCallStart({
      toolUseId: block.id,
      tool: block.name,
      inputBytes,
    });
    const middleware = getToolMiddleware();
    const runnerContext = {
      ...(sessionId && { sessionId }),
      toolUseId: block.id,
      ...(signal ? { signal } : {}),
    };
    const call = {
      name: block.name,
      input,
      context: { autonomyMode, ...runnerContext },
    };
    const baseFn = () => {
      if (!mcpManager?.isMcpTool(call.name)) {
        return executeTool(call.name, call.input, runnerContext);
      }

      const mcpOptions: McpExecuteToolOptions = {};
      if (mcpInputResolver) mcpOptions.inputResolver = mcpInputResolver;
      if (signal) mcpOptions.signal = signal;

      return Object.keys(mcpOptions).length > 0
        ? mcpManager.executeTool(call.name, call.input, mcpOptions)
        : mcpManager.executeTool(call.name, call.input);
    };
    const result = await middleware.execute(call, baseFn);
    throwIfAborted(signal);

    const durationMs = Math.round(performance.now() - startMs);
    const resultPayload = getToolResultTelemetryPayload(result);
    telemetry.recordCallResult({
      toolUseId: block.id,
      tool: block.name,
      durationMs,
      success: !result.is_error,
      resultBytes: measureTelemetryPayloadBytes(resultPayload),
      resultContentKind: getToolResultContentKind(result),
      truncated: toolResultWouldTruncate(result, resultLimit),
      ...(result.is_error ? { error: result.content.slice(0, 200) } : {}),
    });
    if (transport) {
      transport.emit({ type: "tool_metric", tool: block.name, durationMs, success: !result.is_error });
    }

    return {
      tool_use_id: block.id,
      content: result.content,
      ...(result.blocks ? { blocks: result.blocks } : {}),
      ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
      ...(result._meta ? { _meta: result._meta } : {}),
      ...(result.is_error !== undefined ? { is_error: result.is_error } : {}),
    };
  };

  const results = await executeToolCallSchedule(toolBlocks, executeBlock, mcpManager);

  const secretStore = getSecretStore();
  const mask = secretStore ? (s: string) => secretStore.mask(s) : (s: string) => s;

  return results.map((r) => {
    if (r.blocks) {
      // Truncate text blocks within rich results — images pass through untouched
      const truncatedBlocks = r.blocks.map((b) =>
        b.type === "text"
          ? { ...b, text: mask(truncateToolResult(b.text, resultLimit)) }
          : b,
      );
      return { ...r, content: mask(truncateToolResult(r.content, resultLimit)), blocks: truncatedBlocks };
    }
    return { ...r, content: mask(truncateToolResult(r.content, resultLimit)) };
  });
}

export type FailureAction = "continue" | "inject_guidance" | "circuit_break";

/**
 * Tracks consecutive tool failures to detect stuck loops.
 *
 * Two detection levels:
 * - **Identical failures** (same error text): hard circuit break after 3.
 *   The agent is repeating the exact same failing operation.
 * - **Diverse failures** (different errors): soft guidance after 5.
 *   The agent is trying variations that all fail — time to step back.
 */
export class FailureTracker {
  private consecutiveFailures = 0;
  private lastSignature = "";
  private identicalCount = 0;

  record(results: ToolResultEntry[]): FailureAction {
    const failed = results.filter((r) => r.is_error);

    if (failed.length === 0) {
      this.consecutiveFailures = 0;
      this.identicalCount = 0;
      this.lastSignature = "";
      return "continue";
    }

    this.consecutiveFailures++;

    const sig = failed.map((r) => r.content).join("|");
    if (sig === this.lastSignature) {
      this.identicalCount++;
      if (this.identicalCount >= 3) {
        return "circuit_break";
      }
    } else {
      this.identicalCount = 1;
      this.lastSignature = sig;
    }

    if (this.consecutiveFailures >= 5) {
      this.consecutiveFailures = 0;
      return "inject_guidance";
    }

    return "continue";
  }

  static getMessage(action: FailureAction): string {
    if (action === "circuit_break") {
      return "You have failed the same way 3 times in a row. Stop and explain what's going wrong.";
    }
    if (action === "inject_guidance") {
      return (
        "You have had 5 consecutive tool failures with different errors. " +
        "Step back and reconsider: re-read relevant files, try a different strategy, " +
        "or break the task into smaller steps."
      );
    }
    return "";
  }
}
