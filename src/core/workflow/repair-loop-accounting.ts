import type { RepairAgentIterationResult } from "./repair-loop-agent-iteration.js";
import type { RepairIteration } from "./repair-loop-types.js";

export type RepairLoopAccounting = {
  turns: number;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  sessionId: string | undefined;
  content: string;
};

export function recordRepairIteration(
  accounting: RepairLoopAccounting,
  iterations: RepairIteration[],
  iteration: RepairIteration,
  result: RepairAgentIterationResult,
): void {
  iteration.agentResponse = result.text;
  iteration.agentTurns = result.turns;
  iteration.agentCostUsd = result.totalCostUsd;
  iteration.agentInputTokens = result.inputTokens;
  iteration.agentOutputTokens = result.outputTokens;
  iteration.agentSessionId = result.sessionId;
  iterations.push(iteration);

  accounting.content = result.text;
  accounting.turns += result.turns ?? 0;
  accounting.totalCostUsd += result.totalCostUsd ?? 0;
  accounting.inputTokens += result.inputTokens ?? 0;
  accounting.outputTokens += result.outputTokens ?? 0;
  accounting.sessionId = result.sessionId ?? accounting.sessionId;
}
