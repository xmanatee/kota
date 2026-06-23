import type {
  KotaModelUsage,
} from "#core/agent-harness/message-protocol.js";
import {
  type AgentTokenBudgetLedger,
  type AgentTokenBudgetSource,
  agentTokenUsageFromModelUsage,
  TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
} from "#core/agent-harness/token-budget.js";
import type { AgentLoopState } from "./loop-init.js";

const loopTokenBudgets = new WeakMap<object, AgentTokenBudgetLedger>();

export function setAgentLoopTokenBudget(
  state: object,
  tokenBudget: AgentTokenBudgetLedger | undefined,
): void {
  if (tokenBudget === undefined) {
    loopTokenBudgets.delete(state);
    return;
  }
  loopTokenBudgets.set(state, tokenBudget);
}

export function getAgentLoopTokenBudget(
  state: object,
): AgentTokenBudgetLedger | undefined {
  return loopTokenBudgets.get(state);
}

export function sessionTokenBudgetSource(
  state: AgentLoopState,
  turn: number,
): AgentTokenBudgetSource {
  return {
    kind: "session-turn",
    model: state.model,
    turn,
  };
}

export function tokenBudgetExhaustedError(message: string): Error {
  const error = new Error(`${TOKEN_BUDGET_EXHAUSTED_SUBTYPE}: ${message}`);
  error.name = TOKEN_BUDGET_EXHAUSTED_SUBTYPE;
  return error;
}

export function debitSessionTokenBudget(
  state: AgentLoopState,
  usage: KotaModelUsage,
  source: AgentTokenBudgetSource,
): void {
  getAgentLoopTokenBudget(state)?.debitUsage(
    agentTokenUsageFromModelUsage(usage),
    source,
  );
}
