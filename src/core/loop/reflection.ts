import type {
  KotaMessage,
  KotaTextBlock,
  KotaToolUseBlock,
} from "#core/agent-harness/message-protocol.js";

type Message = KotaMessage;

/**
 * Self-reflection: a lightweight evaluation step before the agent delivers
 * its final response. Research (PreFlect, Reflexion, MAR) consistently shows
 * +6-15% accuracy improvement on complex tasks with a single reflection round.
 *
 * Design principles:
 * - Only triggers for substantive task completions (not greetings/clarifications)
 * - Domain-adaptive criteria based on which tools were used
 * - Single round only — diminishing returns beyond that
 * - Structured evaluation prompt, not open-ended "find problems"
 */

/** Tools whose usage indicates code-editing work. */
const CODE_EDIT_TOOLS = new Set([
  "file_edit", "file_write", "multi_edit", "find_replace",
]);

/** Tools whose usage indicates research work. */
const RESEARCH_TOOLS = new Set([
  "web_search", "web_fetch", "http_request",
]);

/** Tools whose usage indicates data/computation work. */
const COMPUTE_TOOLS = new Set(["code_exec", "notebook"]);

/** Tools whose usage indicates verification ran. */
const VERIFY_TOOLS_PATTERN = /\b(test|lint|typecheck|type-check|check|build|tsc|vitest|jest|pytest|cargo test)\b/;

/** Minimum response length to consider reflection (chars). */
const MIN_RESPONSE_LENGTH = 200;

/** Minimum tool calls in session to consider reflection. */
const MIN_TOOL_CALLS = 3;

type ToolUsageSummary = {
  editedFiles: boolean;
  didResearch: boolean;
  didCompute: boolean;
  ranVerification: boolean;
  toolCallCount: number;
};

/** Scan conversation for tool usage patterns. */
export function analyzeToolUsage(messages: Message[]): ToolUsageSummary {
  let editedFiles = false;
  let didResearch = false;
  let didCompute = false;
  let ranVerification = false;
  let toolCallCount = 0;

  for (const msg of messages) {
    if (typeof msg.content === "string") continue;
    if (!Array.isArray(msg.content)) continue;

    for (const block of msg.content) {
      if (block.type === "tool_use") {
        toolCallCount++;
        const tu = block as KotaToolUseBlock;
        if (CODE_EDIT_TOOLS.has(tu.name)) editedFiles = true;
        if (RESEARCH_TOOLS.has(tu.name)) didResearch = true;
        if (COMPUTE_TOOLS.has(tu.name)) didCompute = true;
        if (tu.name === "shell") {
          const cmd = (tu.input as Record<string, unknown>).command as string | undefined;
          if (cmd && VERIFY_TOOLS_PATTERN.test(cmd)) ranVerification = true;
        }
      }
    }
  }

  return { editedFiles, didResearch, didCompute, ranVerification, toolCallCount };
}

/** Extract the text content from the last assistant message. */
export function getLastAssistantText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter((b) => b.type === "text")
        .map((b) => (b as KotaTextBlock).text);
      return textParts.join("\n");
    }
  }
  return "";
}

/** Extract the original user request (first user message). */
function getUserGoal(messages: Message[]): string {
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter((b) => b.type === "text")
        .map((b) => (b as KotaTextBlock).text);
      if (textParts.length > 0) return textParts.join("\n");
    }
  }
  return "";
}

/**
 * Determine if the current response warrants self-reflection.
 * Returns false for trivial interactions to avoid unnecessary overhead.
 */
export function shouldReflect(
  messages: Message[],
  responseText: string,
): boolean {
  if (responseText.length < MIN_RESPONSE_LENGTH) return false;

  const usage = analyzeToolUsage(messages);
  if (usage.toolCallCount < MIN_TOOL_CALLS) return false;

  return true;
}

/**
 * Build a domain-adaptive reflection prompt based on what tools were used.
 * Uses structured criteria instead of open-ended evaluation.
 */
export function buildReflectionPrompt(messages: Message[]): string {
  const usage = analyzeToolUsage(messages);
  const userGoal = getUserGoal(messages);
  const goalSnippet = userGoal.length > 300
    ? `${userGoal.slice(0, 300)}...`
    : userGoal;

  const criteria: string[] = [
    "1. **Completeness**: Does the response fully address the user's request? Any parts left unanswered?",
    "2. **Correctness**: Are the claims, code, or analysis accurate? Any logical errors or wrong assumptions?",
  ];

  if (usage.editedFiles) {
    criteria.push(
      "3. **Verification**: Were the changes verified (tests, typecheck, build, lint)? If not, run verification now.",
    );
    criteria.push(
      "4. **Side effects**: Could the changes break anything else? Any imports, dependencies, or call sites missed?",
    );
  }

  if (usage.didResearch) {
    criteria.push(
      `${criteria.length + 1}. **Sources**: Are findings supported by cited sources? Were multiple sources checked? Are any claims unsubstantiated?`,
    );
  }

  if (usage.didCompute) {
    criteria.push(
      `${criteria.length + 1}. **Methodology**: Is the analysis approach sound? Were edge cases handled? Are results presented clearly?`,
    );
  }

  criteria.push(
    `${criteria.length + 1}. **Quality**: Is the response well-structured and appropriate for the user? Anything unclear or redundant?`,
  );

  return (
    `[Self-review] Before delivering, evaluate your response against these criteria.\n` +
    `User's request: "${goalSnippet}"\n\n` +
    `${criteria.join("\n")}\n\n` +
    `If any criterion is NOT met, take action now (run verification, fix errors, add missing info). ` +
    `If all criteria are met, confirm briefly and deliver your final response.`
  );
}

/**
 * Check if the reflection response indicates the task is complete
 * (no further action needed) vs. needs more work.
 *
 * If the model produced tool calls during reflection, it's self-correcting.
 * If it produced only text, check whether it's a confirmation or identified issues.
 */
export function reflectionIndicatesComplete(
  hasToolCalls: boolean,
  responseText: string,
): boolean {
  // If the model made tool calls, it's actively fixing something — not complete yet
  if (hasToolCalls) return false;

  // Heuristic: if the response contains strong negative signals, it's not done
  const issuePatterns = [
    /\bnot met\b/i,
    /\bmissing\b/i,
    /\bfailed\b/i,
    /\bshould (run|add|fix|update|verify|check)\b/i,
    /\bneed(s)? to\b/i,
    /\bforgot\b/i,
    /\boverlooked\b/i,
    /\bincorrect\b/i,
  ];

  const issueCount = issuePatterns.filter((p) => p.test(responseText)).length;

  // If 3+ issue indicators, the reflection found real problems
  // (1-2 might be false positives from the model explaining what it already did)
  return issueCount < 3;
}
