// Extracted from loop.ts to keep it under 300 lines.
// Runs the architect/editor two-pass pipeline when architect mode is enabled.

import type Anthropic from "@anthropic-ai/sdk";
import type { CostTracker } from "./cost.js";
import { runArchitectPass, runEditorLoop } from "./architect.js";

export type ArchitectStepConfig = {
  client: Anthropic;
  model: string;
  editorModel: string;
  maxTokens: number;
  effectiveMaxTokens: number;
  systemContext: string;
  messages: Anthropic.Messages.MessageParam[];
  costTracker: CostTracker;
  verbose: boolean;
  thinkingConfig?: Anthropic.Messages.ThinkingConfigParam;
};

export type ArchitectStepResult = {
  lastResult: string;
  summary: string;
  modifiedFiles: string[];
};

/**
 * Run architect pass (planning) then editor loop (execution).
 * Returns null if the architect produces no plan.
 */
export async function runArchitectStep(
  config: ArchitectStepConfig,
): Promise<ArchitectStepResult | null> {
  const plan = await runArchitectPass({
    client: config.client,
    model: config.model,
    maxTokens: config.effectiveMaxTokens,
    systemContext: config.systemContext,
    messages: config.messages,
    costTracker: config.costTracker,
    verbose: config.verbose,
    thinking: config.thinkingConfig,
  });
  if (!plan) return null;

  const editorResult = await runEditorLoop({
    client: config.client,
    model: config.editorModel,
    maxTokens: config.maxTokens,
    plan,
    costTracker: config.costTracker,
    verbose: config.verbose,
  });

  return {
    lastResult: editorResult.text || plan,
    summary:
      `[Architect/Editor completed]\n\nPlan executed:\n${plan.slice(0, 500)}` +
      (editorResult.text ? `\n\nEditor result: ${editorResult.text}` : ""),
    modifiedFiles: editorResult.modifiedFiles,
  };
}
