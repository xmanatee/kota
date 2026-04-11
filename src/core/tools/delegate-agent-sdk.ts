/**
 * Agent SDK delegate backend — routes delegate tasks through Claude Code's
 * full agent runtime via @anthropic-ai/claude-agent-sdk.
 */

import { executeWithAgentSDK } from "#core/agent-sdk/index.js";
import {
  buildSubAgentPrompt,
  EXECUTE_PROMPT,
  EXPLORE_PROMPT,
  type PromptConfig,
} from "#core/agents/delegate-prompts.js";
import type { CostTracker } from "#core/loop/cost.js";
import type { Transport } from "#core/loop/transport.js";
import {
  assembleDelegateResult,
  type CompletionReason,
  type DelegateMetadata,
} from "./delegate-format.js";
import type { ToolResult } from "./index.js";

const EXPLORE_MAX_TURNS = 15;
const EXECUTE_MAX_TURNS = 25;
const DEFAULT_BUDGET_USD = 0.5;

const EXPLORE_SDK_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "Bash",
];

const EXECUTE_SDK_TOOLS = [
  ...EXPLORE_SDK_TOOLS,
  "Edit",
  "Write",
];

export type AgentSDKDelegateConfig = {
  cwd?: string;
  projectContext?: string;
  instructionContext?: string;
  costTracker?: CostTracker;
  transport?: Transport;
  maxBudgetUsd?: number;
  model?: string;
};

export async function runDelegateAgentSDK(
  task: string,
  mode: "explore" | "execute" | "research",
  config: AgentSDKDelegateConfig,
): Promise<ToolResult> {
  const isExecute = mode === "execute";
  const basePrompt = isExecute ? EXECUTE_PROMPT : EXPLORE_PROMPT;
  const promptConfig: PromptConfig = {
    cwd: config.cwd,
    projectContext: config.projectContext,
    instructionContext: config.instructionContext,
  };
  const systemPrompt = buildSubAgentPrompt(basePrompt, promptConfig);
  const maxTurns = isExecute ? EXECUTE_MAX_TURNS : EXPLORE_MAX_TURNS;
  const allowedTools = isExecute ? EXECUTE_SDK_TOOLS : EXPLORE_SDK_TOOLS;
  const transport = config.transport;
  const taskChars = [...task];
  const taskPreview =
    taskChars.length > 60 ? `${taskChars.slice(0, 57).join("")}...` : task;

  if (transport) {
    transport.emit({
      type: "status",
      message: `[kota] delegate(${mode}:agent-sdk) starting: ${taskPreview}`,
    });
  }

  const result = await executeWithAgentSDK(
    task,
    {
      model: config.model,
      systemPrompt,
      maxTurns,
      allowedTools,
      permissionMode: "bypassPermissions",
      cwd: config.cwd ?? process.cwd(),
      maxBudgetUsd: config.maxBudgetUsd ?? DEFAULT_BUDGET_USD,
    },
    transport
      ? {
          write(text: string) {
            transport.emit({
              type: "progress",
              content: text,
              source: `delegate(${mode}:agent-sdk)`,
            });
            return true;
          },
        }
      : undefined,
  );

  let completionReason: CompletionReason = "done";
  if (result.subtype === "error_max_turns") completionReason = "turn_limit";
  else if (result.subtype === "error_during_execution") {
    completionReason = "circuit_break";
  } else if (result.subtype === "error_max_budget_usd") {
    completionReason = "circuit_break";
  }

  if (config.costTracker && result.totalCostUsd != null) {
    config.costTracker.addRawCost(result.totalCostUsd);
  }

  if (transport) {
    transport.emit({
      type: "status",
      message: `[kota] delegate(${mode}:agent-sdk) done — ${result.turns} turn(s)${result.sessionId ? ` [${result.sessionId.slice(0, 8)}]` : ""}`,
    });
  }

  const meta: DelegateMetadata = {
    mode: `${mode}:agent-sdk`,
    turnsUsed: result.turns,
    turnsMax: maxTurns,
    toolsUsed: ["agent-sdk"],
    completionReason,
    urlsFetched: [],
    searchQueries: [],
  };

  return assembleDelegateResult(result.text, meta, new Set(), []);
}
