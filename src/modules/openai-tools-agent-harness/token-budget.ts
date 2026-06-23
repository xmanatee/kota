import type {
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentTokenBudgetSource,
} from "#core/agent-harness/index.js";
import { TOKEN_BUDGET_EXHAUSTED_SUBTYPE } from "#core/agent-harness/index.js";
import { OPENAI_TOOLS_AGENT_HARNESS_NAME } from "./constants.js";

export function openaiToolsTokenBudgetSource(
  options: AgentHarnessRunOptions,
  model: string,
  turn: number,
): AgentTokenBudgetSource {
  return {
    kind: "harness-turn",
    harness: OPENAI_TOOLS_AGENT_HARNESS_NAME,
    model,
    turn,
    ...(options.workflowContext !== undefined
      ? {
          workflowName: options.workflowContext.workflowName,
          runId: options.workflowContext.runId,
          stepId: options.workflowContext.stepId,
          spanId: options.workflowContext.spanId,
        }
      : {}),
  };
}

export function openaiToolsTokenBudgetErrorResult(input: {
  message: string;
  streamedChunks: readonly string[];
  lastSessionId: string | undefined;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
}): AgentHarnessResult {
  return {
    text: input.message,
    streamedText: input.streamedChunks.join(""),
    ...(input.lastSessionId !== undefined
      ? { sessionId: input.lastSessionId }
      : {}),
    turns: input.turnCount,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    isError: true,
    subtype: TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
  };
}
