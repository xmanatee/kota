import { truncateToolResult } from "./context.js";
import { assess, type GuardrailsConfig } from "./guardrails.js";
import type { McpManager } from "./mcp-manager.js";
import { getSecretStore } from "./secrets.js";
import { getToolMiddleware } from "./tool-middleware.js";
import { maybeRetry } from "./tool-retry.js";
import { getToolTelemetry } from "./tool-telemetry.js";
import type { ToolResultBlock } from "./tools/index.js";
import { executeTool } from "./tools/index.js";
import type { Transport } from "./transport.js";

type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};

export type ToolResultEntry = {
  tool_use_id: string;
  content: string;
  blocks?: ToolResultBlock[];
  is_error?: boolean;
};

/**
 * Execute tool calls in parallel, with verbose logging and result truncation.
 * Routes MCP-namespaced tools through the McpManager when provided.
 * When guardrailsConfig is set, each tool call is assessed before execution.
 */
export async function executeToolCalls(
  toolBlocks: ToolUseBlock[],
  resultLimit: number,
  verbose: boolean,
  mcpManager?: McpManager,
  transport?: Transport,
  guardrailsConfig?: GuardrailsConfig,
): Promise<ToolResultEntry[]> {
  const results = await Promise.all(
    toolBlocks.map(async (block) => {
      if (verbose && transport) {
        transport.emit({
          type: "status",
          message: `[kota] Tool: ${block.name}(${JSON.stringify(block.input).slice(0, 100)}...)`,
        });
      }
      const input = block.input as Record<string, unknown>;

      // Guardrails: assess risk and enforce policy before execution
      if (guardrailsConfig) {
        const assessment = assess(block.name, input, guardrailsConfig);
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
      }

      // Route MCP tools through the manager, with middleware chain
      const startMs = performance.now();
      const middleware = getToolMiddleware();
      const baseFn = () =>
        mcpManager?.isMcpTool(block.name)
          ? mcpManager.executeTool(block.name, input)
          : executeTool(block.name, input);
      let result = await middleware.execute({ name: block.name, input }, baseFn);

      // Auto-retry transient failures (timeouts, network errors)
      if (result.is_error) {
        const executor = mcpManager?.isMcpTool(block.name)
          ? (n: string, i: Record<string, unknown>) => mcpManager.executeTool(n, i)
          : executeTool;
        const retried = await maybeRetry(block.name, input, result, executor);
        if (retried) result = retried;
      }

      const durationMs = Math.round(performance.now() - startMs);
      const telemetry = getToolTelemetry();
      telemetry.record(
        block.name,
        durationMs,
        !result.is_error,
        result.is_error ? result.content.slice(0, 200) : undefined,
      );
      if (transport) {
        transport.emit({ type: "tool_metric", tool: block.name, durationMs, success: !result.is_error });
      }

      return {
        tool_use_id: block.id,
        content: result.content,
        blocks: result.blocks,
        is_error: result.is_error,
      };
    }),
  );

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
