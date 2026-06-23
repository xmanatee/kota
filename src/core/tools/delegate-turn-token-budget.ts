import {
  type AgentTokenBudgetSource,
  TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
} from "#core/agent-harness/token-budget.js";
import type { TurnLoopResult } from "./delegate-turn.js";

export function delegateTokenBudgetSource(
  selectedModel: string,
  turn: number,
): AgentTokenBudgetSource {
  return {
    kind: "delegate-turn",
    model: selectedModel,
    turn,
  };
}

export function tokenBudgetEarlyError(
  message: string,
  lastText: string,
  totalTurns: number,
): TurnLoopResult {
  return {
    earlyError: {
      content: `Sub-agent stopped (${TOKEN_BUDGET_EXHAUSTED_SUBTYPE}): ${message}`,
      is_error: true,
    },
    naturalEnd: false,
    completionReason: "done",
    lastText,
    totalTurns,
  };
}
