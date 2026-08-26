import type {
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentTokenBudgetSource,
  AgentUsage,
} from "#core/agent-harness/index.js";
import { TOKEN_BUDGET_EXHAUSTED_SUBTYPE } from "#core/agent-harness/index.js";
import { GEMINI_AGENT_HARNESS_NAME } from "./constants.js";

export function geminiTokenBudgetSource(
  options: AgentHarnessRunOptions,
  model: string,
  turn: number,
): AgentTokenBudgetSource {
  return {
    kind: "harness-turn",
    harness: GEMINI_AGENT_HARNESS_NAME,
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

export function geminiTokenBudgetErrorResult(input: {
  message: string;
  streamedChunks: readonly string[];
  lastResponseId: string | undefined;
  turnCount: number;
  usage: AgentUsage;
}): AgentHarnessResult {
  return {
    text: input.message,
    streamedText: input.streamedChunks.join(""),
    ...(input.lastResponseId !== undefined
      ? { sessionId: input.lastResponseId }
      : {}),
    turns: input.turnCount,
    usage: input.usage,
    isError: true,
    subtype: TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
  };
}
