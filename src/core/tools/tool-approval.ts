import type {
  KotaMessage,
  KotaTextBlock,
} from "#core/agent-harness/message-protocol.js";
import type { RiskLevel, ToolCallInput } from "./guardrails-classify.js";
import type { ToolResultEntry } from "./tool-runner.js";

export type ToolApprovalRequest = {
  id: string;
  toolUseId: string;
  toolName: string;
  input: ToolCallInput;
  risk: RiskLevel;
  reason: string;
  sessionId?: string;
  timeoutMs?: number;
  context?: string;
  signal?: AbortSignal;
};

export type ToolApprovalDecision =
  | { outcome: "allow" }
  | { outcome: "deny"; message: string }
  | { outcome: "cancelled"; message: string };

export type ToolApprovalResolver = (
  request: ToolApprovalRequest,
) => Promise<ToolApprovalDecision>;

export type ClientApprovalResult =
  | { outcome: "unavailable" }
  | { outcome: "allowed" }
  | { outcome: "blocked"; result: ToolResultEntry };

export class ToolApprovalCancelledError extends Error {
  constructor(message = "Client approval request was cancelled") {
    super(message);
    this.name = "ToolApprovalCancelledError";
  }
}

export class ToolApprovalTimeoutError extends Error {
  constructor(message = "Client approval request timed out") {
    super(message);
    this.name = "ToolApprovalTimeoutError";
  }
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
