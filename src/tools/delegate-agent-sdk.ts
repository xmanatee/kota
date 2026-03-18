/**
 * Agent SDK delegate backend — routes delegate tasks through Claude Code's
 * full agent runtime via @anthropic-ai/claude-agent-sdk.
 *
 * Unlike the "thin" delegate backend (single LLM call loop with KOTA tools),
 * this gives sub-agents access to Claude Code's built-in tools (Read, Write,
 * Edit, Bash, Glob, Grep, etc.) with autonomous execution.
 */

import { loadSDK } from "../agent-sdk/index.js";
import type { SDKMessage, SDKQueryOptions } from "../agent-sdk/types.js";
import type { CostTracker } from "../cost.js";
import {
	buildSubAgentPrompt,
	EXECUTE_PROMPT,
	EXPLORE_PROMPT,
	type PromptConfig,
} from "../delegate-prompts.js";
import type { Transport } from "../transport.js";
import {
	assembleDelegateResult,
	type CompletionReason,
	type DelegateMetadata,
} from "./delegate-format.js";
import type { ToolResult } from "./index.js";

const EXPLORE_MAX_TURNS = 15;
const EXECUTE_MAX_TURNS = 25;
const DEFAULT_BUDGET_USD = 0.5;

/** Agent SDK tool names allowed in explore mode (read-only). */
const EXPLORE_SDK_TOOLS = [
	"Read",
	"Glob",
	"Grep",
	"WebSearch",
	"WebFetch",
	"Bash",
];

/** Agent SDK tool names allowed in execute mode (read + write). */
const EXECUTE_SDK_TOOLS = [
	...EXPLORE_SDK_TOOLS,
	"Edit",
	"Write",
];

export type AgentSDKDelegateConfig = {
	cwd?: string;
	projectContext?: string;
	costTracker?: CostTracker;
	transport?: Transport;
	maxBudgetUsd?: number;
	model?: string;
};

/**
 * Run a delegate task via the Claude Agent SDK.
 *
 * Dynamically imports the SDK — if not installed, returns a clear error
 * prompting fallback to the thin backend.
 */
export async function runDelegateAgentSDK(
	task: string,
	mode: "explore" | "execute",
	config: AgentSDKDelegateConfig,
): Promise<ToolResult> {
	let sdk: Awaited<ReturnType<typeof loadSDK>>;
	try {
		sdk = await loadSDK();
	} catch {
		return {
			content:
				"Agent SDK not available — falling back to standard delegate. " +
				"Install @anthropic-ai/claude-agent-sdk for enhanced delegation.",
			is_error: true,
		};
	}

	const isExecute = mode === "execute";
	const basePrompt = isExecute ? EXECUTE_PROMPT : EXPLORE_PROMPT;
	const promptConfig: PromptConfig = {
		cwd: config.cwd,
		projectContext: config.projectContext,
	};
	const systemPrompt = buildSubAgentPrompt(basePrompt, promptConfig);
	const maxTurns = isExecute ? EXECUTE_MAX_TURNS : EXPLORE_MAX_TURNS;
	const allowedTools = isExecute ? EXECUTE_SDK_TOOLS : EXPLORE_SDK_TOOLS;

	const queryOpts: SDKQueryOptions = {
		model: config.model,
		systemPrompt,
		maxTurns,
		allowedTools,
		permissionMode: "bypassPermissions",
		cwd: config.cwd ?? process.cwd(),
		maxBudgetUsd: config.maxBudgetUsd ?? DEFAULT_BUDGET_USD,
	};

	const transport = config.transport;
	const taskChars = [...task];
	const taskPreview =
		taskChars.length > 60 ? `${taskChars.slice(0, 57).join("")}...` : task;
	if (transport)
		transport.emit({
			type: "status",
			message: `[kota] delegate(${mode}:agent-sdk) starting: ${taskPreview}`,
		});

	let resultText = "";
	let sessionId: string | undefined;
	let turns = 0;
	let totalCostUsd: number | undefined;
	let completionReason: CompletionReason = "done";
	let resultSubtype: string | undefined;

	for await (const message of sdk.query({
		prompt: task,
		options: queryOpts,
	})) {
		handleMessage(message, mode, transport);
	}

	function handleMessage(
		message: SDKMessage,
		delegateMode: string,
		tr?: Transport,
	): void {
		switch (message.type) {
			case "system":
				if (message.sessionId) sessionId = message.sessionId;
				break;

			case "assistant": {
				turns++;
				const text = extractTextFromMessage(message);
				if (text && tr)
					tr.emit({
						type: "progress",
						content: text,
						source: `delegate(${delegateMode}:agent-sdk)`,
					});
				break;
			}

			case "result":
				resultText = message.result ?? extractTextFromMessage(message);
				totalCostUsd = message.total_cost_usd;
				if (message.num_turns) turns = message.num_turns;
				resultSubtype = message.subtype;
				break;
		}
	}

	if (resultSubtype === "error_max_turns") completionReason = "turn_limit";
	else if (resultSubtype === "error_during_execution")
		completionReason = "circuit_break";
	else if (resultSubtype === "error_max_budget_usd")
		completionReason = "circuit_break";

	if (config.costTracker && totalCostUsd != null) {
		config.costTracker.addRawCost(totalCostUsd);
	}

	if (transport)
		transport.emit({
			type: "status",
			message: `[kota] delegate(${mode}:agent-sdk) done — ${turns} turn(s)${sessionId ? ` [${sessionId.slice(0, 8)}]` : ""}`,
		});

	const meta: DelegateMetadata = {
		mode: `${mode}:agent-sdk`,
		turnsUsed: turns,
		turnsMax: maxTurns,
		toolsUsed: ["agent-sdk"],
		completionReason,
		urlsFetched: [],
		searchQueries: [],
	};

	return assembleDelegateResult(resultText, meta, new Set(), []);
}

function extractTextFromMessage(message: SDKMessage): string {
	if (!message.content) return "";
	return message.content
		.filter((b) => b.type === "text" && b.text)
		.map((b) => b.text as string)
		.join("");
}
