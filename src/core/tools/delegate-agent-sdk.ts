/**
 * Agent harness delegate backend — routes delegate tasks through a registered
 * agent harness. The default is claude-agent-sdk for backwards-compat with the
 * previous `backend: "agent-sdk"` selection, but operators can point at any
 * registered harness by setting `harness` on the delegate config.
 */

import { resolveAgentHarness, runAgentHarness } from "#core/agent-harness/index.js";
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
  model?: string;
  /**
   * Registered agent-harness name to run this delegate on. Falls through to
   * `"claude-agent-sdk"` so the historical `backend: "agent-sdk"` delegate
   * shape still lands on the Claude Agent SDK when the caller leaves this
   * unset — callers that want the operator-configured default should read
   * `config.defaultAgentHarness` before invoking.
   */
  harness?: string;
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
  const allowedTools = isExecute ? EXECUTE_SDK_TOOLS : EXPLORE_SDK_TOOLS;
  const transport = config.transport;
  const taskChars = [...task];
  const taskPreview =
    taskChars.length > 60 ? `${taskChars.slice(0, 57).join("")}...` : task;

  const harnessName = config.harness ?? "claude-agent-sdk";
  const harness = resolveAgentHarness(harnessName);

  if (transport) {
    transport.emit({
      type: "status",
      message: `[kota] delegate(${mode}:${harnessName}) starting: ${taskPreview}`,
    });
  }
  const result = await runAgentHarness(
    harness,
    {
      prompt: task,
      model: config.model,
      systemPrompt,
      allowedTools,
      permissionMode: "bypassPermissions",
      cwd: config.cwd ?? process.cwd(),
      effort: "xhigh",
    },
    transport
      ? {
          write(text: string) {
            transport.emit({
              type: "progress",
              content: text,
              source: `delegate(${mode}:${harnessName})`,
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
  }

  if (config.costTracker && result.totalCostUsd != null) {
    config.costTracker.addRawCost(result.totalCostUsd);
  }

  if (transport) {
    transport.emit({
      type: "status",
      message: `[kota] delegate(${mode}:${harnessName}) done — ${result.turns} turn(s)${result.sessionId ? ` [${result.sessionId.slice(0, 8)}]` : ""}`,
    });
  }

  const meta: DelegateMetadata = {
    mode: `${mode}:${harnessName}`,
    turnsUsed: result.turns,
    turnsMax: undefined,
    toolsUsed: [harnessName],
    completionReason,
    urlsFetched: [],
    searchQueries: [],
  };

  return assembleDelegateResult(result.text, meta, new Set(), []);
}
