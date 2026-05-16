/**
 * Agent harness delegate backend — routes delegate tasks through a registered
 * agent harness. The harness name must be supplied by the caller (normally
 * pulled from `config.defaultAgentHarness` when wiring the delegate config);
 * there is no silent fallback that re-pins subagents to claude-agent-sdk.
 */

import {
  resolveAgentHarness,
  routeKotaToolControlOptions,
  runAgentHarness,
} from "#core/agent-harness/index.js";
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

const EXPLORE_HARNESS_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "Bash",
];

const EXECUTE_HARNESS_TOOLS = [
  ...EXPLORE_HARNESS_TOOLS,
  "Edit",
  "Write",
];

export type DelegateHarnessConfig = {
  cwd?: string;
  projectContext?: string;
  instructionContext?: string;
  costTracker?: CostTracker;
  transport?: Transport;
  model?: string;
  /**
   * Registered agent-harness name to run this delegate on. Required — the
   * caller must plumb it through from `config.defaultAgentHarness` (see
   * `setDelegateConfig` callers in the loop modules). If unset, the delegate
   * fails loudly rather than silently re-pinning subagents to claude.
   */
  harness: string;
};

export async function runDelegateHarness(
  task: string,
  mode: "explore" | "execute" | "research",
  config: DelegateHarnessConfig,
): Promise<ToolResult> {
  const isExecute = mode === "execute";
  const basePrompt = isExecute ? EXECUTE_PROMPT : EXPLORE_PROMPT;
  const promptConfig: PromptConfig = {
    cwd: config.cwd,
    projectContext: config.projectContext,
    instructionContext: config.instructionContext,
  };
  const systemPrompt = buildSubAgentPrompt(basePrompt, promptConfig);
  const allowedTools = isExecute ? EXECUTE_HARNESS_TOOLS : EXPLORE_HARNESS_TOOLS;
  const transport = config.transport;
  const taskChars = [...task];
  const taskPreview =
    taskChars.length > 60 ? `${taskChars.slice(0, 57).join("")}...` : task;

  if (!config.harness) {
    throw new Error(
      "delegate(agent-sdk backend) requires a harness name. Set config.defaultAgentHarness so it flows through DelegateConfig.harness. No implicit default.",
    );
  }
  const harnessName = config.harness;
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
      ...routeKotaToolControlOptions(harness, { allowedTools }),
      autonomyMode: "autonomous",
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
