import { executeTool } from "./tools/index.js";
import { truncateToolResult } from "./context.js";

type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};

export type ToolResultEntry = {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

/**
 * Execute tool calls in parallel, with verbose logging and result truncation.
 */
export async function executeToolCalls(
  toolBlocks: ToolUseBlock[],
  resultLimit: number,
  verbose: boolean,
): Promise<ToolResultEntry[]> {
  const results = await Promise.all(
    toolBlocks.map(async (block) => {
      if (verbose) {
        console.error(
          `[kota] Tool: ${block.name}(${JSON.stringify(block.input).slice(0, 100)}...)`,
        );
      }
      const result = await executeTool(
        block.name,
        block.input as Record<string, unknown>,
      );
      return {
        tool_use_id: block.id,
        content: result.content,
        is_error: result.is_error,
      };
    }),
  );

  return results.map((r) => ({
    ...r,
    content: truncateToolResult(r.content, resultLimit),
  }));
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
