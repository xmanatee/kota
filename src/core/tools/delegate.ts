import type {
  KotaMessage,
  KotaTextBlock,
  KotaTool,
} from "#core/agent-harness/message-protocol.js";
import {
  buildSubAgentPrompt,
  EXECUTE_PROMPT,
  EXPLORE_PROMPT,
  getExecuteToolSet,
  getExploreToolSet,
  getResearchToolSet,
  RESEARCH_PROMPT,
} from "#core/agents/delegate-prompts.js";
import { createModelClient } from "#core/model/model-client.js";
import { routeModel } from "#core/model/model-router.js";
import {
  type DelegateBudgetFailure,
  type DelegateBudgetLease,
  formatDelegateBudgetSnapshot,
  serializeDelegateBudgetFailure,
} from "./delegate-budget.js";
import {
  type DelegateMode,
  EXECUTE_MAX_TURNS,
  EXPLORE_MAX_TURNS,
  getDelegateConfig,
  RESEARCH_MAX_TURNS,
  type ResolvedDelegateConfig,
  resolvePromptTemplate,
} from "./delegate-config.js";
import {
  assembleDelegateResult,
  type CompletionReason,
  type DelegateMetadata,
} from "./delegate-format.js";
import { runDelegateTurns } from "./delegate-turn.js";
import { localWriteEffect } from "./effect.js";
import type { ResolvedToolSet, ToolResult } from "./index.js";

export {
  createDelegateBudget,
  DEFAULT_DELEGATE_MAX_ACTIVE_CHILDREN,
  DEFAULT_DELEGATE_MAX_DEPTH,
  type DelegateBudget,
  type DelegateBudgetLimits,
} from "./delegate-budget.js";
export type { DelegateConfig, DelegateMode } from "./delegate-config.js";
export { setDelegateConfig } from "./delegate-config.js";
export type { CompletionReason, DelegateMetadata } from "./delegate-format.js";
export { buildDelegateResult, buildSourcesSection, collectImageBlocks, extractModifiedFiles, formatMetadata } from "./delegate-format.js";

export const delegateTool: KotaTool = {
  name: "delegate",
  description:
    "Delegate a task to a sub-agent with its own context. " +
    "explore (default): read-only research. " +
    "execute: can modify files and run commands. " +
    "research: deep multi-step research with iterative search and source tracking. " +
    "Use 'prompt' to override the sub-agent's system prompt with a template from .kota/prompts/. " +
    "Do NOT use when a single grep, glob, or file_read call would answer the question — delegate only when multi-step reasoning across many files is needed.",
  input_schema: {
    type: "object" as const,
    properties: {
      task: {
        type: "string",
        description:
          "What to do (e.g. 'find all API endpoints' or 'fix the type error in src/utils.ts')",
      },
      mode: {
        type: "string",
        enum: ["explore", "execute", "research"],
        description: "explore (default): read-only. execute: can modify files. research: deep multi-step research with iterative search.",
      },
      prompt: {
        type: "string",
        description: "Name of a prompt template from .kota/prompts/ to use as the sub-agent system prompt (overrides default mode prompt).",
      },
      prompt_vars: {
        type: "object",
        description: "Variables to substitute in the prompt template (e.g. {\"language\": \"TypeScript\"}).",
      },
    },
    required: ["task"],
  },
};

function budgetFailureResult(failure: DelegateBudgetFailure): ToolResult {
  return {
    content: `Error: delegate budget exhausted: ${failure.message}`,
    is_error: true,
    _meta: {
      delegateBudget: serializeDelegateBudgetFailure(failure),
    },
  };
}

function omitRecursiveDelegateTool(toolSet: ResolvedToolSet): ResolvedToolSet {
  const tools = toolSet.tools.filter((tool) => tool.name !== delegateTool.name);
  const runners: ResolvedToolSet["runners"] = {};
  for (const [name, runner] of Object.entries(toolSet.runners)) {
    if (name !== delegateTool.name) runners[name] = runner;
  }
  return { tools, runners };
}

function formatBudgetStatus(lease: DelegateBudgetLease): string {
  return formatDelegateBudgetSnapshot(lease.snapshot());
}

type DelegateInput = Record<string, unknown>;

const VALID_MODES: Set<DelegateMode> = new Set(["explore", "execute", "research"]);

export async function runDelegate(input: DelegateInput): Promise<ToolResult> {
  const task = input.task as string;
  const rawMode = (input.mode as string) || "explore";

  if (!task || (typeof task === "string" && !task.trim())) {
    return { content: "Error: task is required", is_error: true };
  }
  if (!VALID_MODES.has(rawMode as DelegateMode)) {
    return { content: `Error: mode must be "explore", "execute", or "research", got "${rawMode}"`, is_error: true };
  }
  const mode = rawMode as DelegateMode;
  const delegateConfig = getDelegateConfig();
  const budgetStart = delegateConfig.delegateBudget.tryStart();
  if (!budgetStart.ok) {
    const result = budgetFailureResult(budgetStart.failure);
    delegateConfig.transport?.emit({
      type: "error",
      message: `[kota] ${result.content}`,
    });
    return result;
  }
  const budgetLease = budgetStart.lease;

  try {
    return await budgetLease.run(() =>
      runDelegateWithBudget(input, task, mode, delegateConfig, budgetLease),
    );
  } finally {
    budgetLease.release();
  }
}

async function runDelegateWithBudget(
  input: DelegateInput,
  task: string,
  mode: DelegateMode,
  delegateConfig: ResolvedDelegateConfig,
  budgetLease: DelegateBudgetLease,
): Promise<ToolResult> {
  const isExecute = mode === "execute";

  const modelRoute = delegateConfig.modelTiers
    ? routeModel(task, mode, delegateConfig.modelTiers, delegateConfig.model)
    : null;
  const selectedModel = modelRoute?.model ?? delegateConfig.model;

  const resolvedBackend = delegateConfig.backend ?? modelRoute?.backend ?? "thin";
  if (resolvedBackend === "agent-sdk") {
    const { runDelegateHarness } = await import("./delegate-harness.js");
    if (!delegateConfig.harness) {
      return {
        content:
          "Error: delegate(agent-sdk backend) requires a harness. Set config.defaultAgentHarness so it flows through DelegateConfig.harness. No implicit default.",
        is_error: true,
      };
    }
    delegateConfig.transport?.emit({
      type: "status",
      message: `[kota] delegate(${mode}) budget ${formatBudgetStatus(budgetLease)}`,
    });
    return runDelegateHarness(task, mode, {
      cwd: delegateConfig.cwd,
      projectContext: delegateConfig.projectContext,
      instructionContext: delegateConfig.instructionContext,
      costTracker: delegateConfig.costTracker,
      transport: delegateConfig.transport,
      model: selectedModel,
      modelOutputTokenLimits: delegateConfig.modelOutputTokenLimits,
      harness: delegateConfig.harness,
    });
  }

  const TOOLSET_BY_MODE = { explore: getExploreToolSet, execute: getExecuteToolSet, research: getResearchToolSet } as const;
  const TURNS_BY_MODE = { explore: EXPLORE_MAX_TURNS, execute: EXECUTE_MAX_TURNS, research: RESEARCH_MAX_TURNS } as const;
  const PROMPT_BY_MODE = { explore: EXPLORE_PROMPT, execute: EXECUTE_PROMPT, research: RESEARCH_PROMPT } as const;

  let { tools: builtinTools, runners } = TOOLSET_BY_MODE[mode]();
  if (delegateConfig.delegateBudget.isAtDepthLimit(budgetLease.depth)) {
    ({ tools: builtinTools, runners } = omitRecursiveDelegateTool({ tools: builtinTools, runners }));
  }

  const mcpMgr = delegateConfig.mcpManager;
  const mcpTools = mcpMgr ? mcpMgr.getTools() : [];
  const rawTools = mcpTools.length > 0 ? [...builtinTools, ...mcpTools] : builtinTools;
  const tools = delegateConfig.delegateBudget.isAtDepthLimit(budgetLease.depth)
    ? rawTools.filter((tool) => tool.name !== delegateTool.name)
    : rawTools;
  const maxTurns = TURNS_BY_MODE[mode];

  const promptName = input.prompt as string | undefined;
  const promptVars = (input.prompt_vars as Record<string, string>) || {};
  let basePrompt: string;
  if (promptName) {
    const resolved = resolvePromptTemplate(promptName, promptVars, delegateConfig.cwd);
    if (resolved.error) return { content: resolved.error, is_error: true };
    basePrompt = resolved.content!;
  } else {
    basePrompt = PROMPT_BY_MODE[mode];
  }
  const systemPrompt = buildSubAgentPrompt(basePrompt, {
    cwd: delegateConfig.cwd,
    projectContext: delegateConfig.projectContext,
    instructionContext: delegateConfig.instructionContext,
    tools,
  });

  const modifiedFiles = new Set<string>();
  const collectedImages: import("./index.js").ToolResultBlock[] = [];
  const toolsUsed = new Set<string>();
  const urlsFetched = new Set<string>();
  const searchQueries = new Set<string>();

  const client = delegateConfig.client ?? createModelClient({
    model: delegateConfig.model,
    projectDir: delegateConfig.cwd,
  }).client;
  const costTracker = delegateConfig.costTracker;
  const transport = delegateConfig.transport;
  const messages: KotaMessage[] = [{ role: "user", content: task }];
  const systemBlocks: KotaTextBlock[] = [
    { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
  ];

  const taskChars = [...task];
  const taskPreview = taskChars.length > 60 ? `${taskChars.slice(0, 57).join("")}...` : task;
  const routeInfo = modelRoute ? ` [${modelRoute.tier}:${selectedModel}]` : "";
  if (transport) {
    transport.emit({
      type: "status",
      message: `[kota] delegate(${mode})${routeInfo} [budget ${formatBudgetStatus(budgetLease)}] starting: ${taskPreview}`,
    });
  }

  const loopResult = await runDelegateTurns({
    client, messages, systemBlocks, tools, runners, mcpMgr,
    isExecute, selectedModel, modelOutputTokenLimits: delegateConfig.modelOutputTokenLimits,
    maxTurns, mode, transport, costTracker,
    modifiedFiles, collectedImages, toolsUsed, urlsFetched, searchQueries,
  });

  if (loopResult.earlyError) return loopResult.earlyError;

  const { naturalEnd, completionReason: loopReason, lastText, totalTurns } = loopResult;
  const completionReason: CompletionReason = !naturalEnd && loopReason === "done" ? "turn_limit" : loopReason;

  if (transport) {
    transport.emit({
      type: "status",
      message: `[kota] delegate(${mode}) done — ${totalTurns} turn(s) [budget ${formatBudgetStatus(budgetLease)}]`,
    });
  }

  const meta: DelegateMetadata = {
    mode,
    turnsUsed: totalTurns,
    turnsMax: maxTurns,
    toolsUsed: [...toolsUsed].sort(),
    completionReason,
    urlsFetched: [...urlsFetched],
    searchQueries: [...searchQueries],
  };

  return assembleDelegateResult(lastText, meta, modifiedFiles, collectedImages);
}

export const registration = {
  tool: delegateTool,
  runner: runDelegate,
  effect: localWriteEffect(),
};
