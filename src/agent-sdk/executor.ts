/**
 * Agent SDK Executor — runs tasks via @anthropic-ai/claude-agent-sdk.
 *
 * The Agent SDK spawns a Claude Code child process with built-in tools
 * (Read, Write, Edit, Bash, Glob, Grep, WebSearch, etc.). Unlike the
 * ModelClient abstraction (single LLM call), this executes entire agent
 * sessions — Claude Code handles tool execution autonomously.
 *
 * Used as an alternative execution backend: `kota run --provider agent-sdk`.
 */

import type { SDKMessage, SDKModule, SDKQueryOptions } from "./types.js";

export type ExecutorOptions = {
	model?: string;
	cwd?: string;
	verbose?: boolean;
	systemPrompt?: string;
	maxTurns?: number;
	maxBudgetUsd?: number;
	allowedTools?: string[];
	disallowedTools?: string[];
	permissionMode?: SDKQueryOptions["permissionMode"];
};

export type ExecutorResult = {
	text: string;
	sessionId?: string;
	turns: number;
};

/** Extract text from an SDK message's content blocks. */
function extractText(message: SDKMessage): string {
	if (!message.content) return "";
	return message.content
		.filter((b) => b.type === "text" && b.text)
		.map((b) => b.text as string)
		.join("");
}

/** Dynamically import the Agent SDK. Throws a clear error if not installed. */
export async function loadSDK(): Promise<SDKModule> {
	try {
		return (await import(
			"@anthropic-ai/claude-agent-sdk"
		)) as unknown as SDKModule;
	} catch {
		throw new Error(
			"@anthropic-ai/claude-agent-sdk is not installed.\n\n" +
				"Install it to use the agent-sdk provider:\n" +
				"  npm install @anthropic-ai/claude-agent-sdk\n\n" +
				"Or use a different provider:\n" +
				"  kota run --model claude-sonnet-4-6 ...",
		);
	}
}

/**
 * Execute a task via the Claude Agent SDK.
 *
 * Streams assistant text to the provided writer (defaults to process.stdout).
 * Returns the full text, session ID, and turn count.
 */
export async function executeWithAgentSDK(
	prompt: string,
	options?: ExecutorOptions,
	writer?: { write(s: string): boolean },
): Promise<ExecutorResult> {
	const sdk = await loadSDK();
	const out = writer ?? process.stdout;

	const queryOpts: SDKQueryOptions = {
		model: options?.model,
		maxTurns: options?.maxTurns ?? 50,
		systemPrompt: options?.systemPrompt,
		allowedTools: options?.allowedTools,
		disallowedTools: options?.disallowedTools,
		permissionMode: options?.permissionMode ?? "bypassPermissions",
		cwd: options?.cwd ?? process.cwd(),
		maxBudgetUsd: options?.maxBudgetUsd,
	};

	const textChunks: string[] = [];
	let sessionId: string | undefined;
	let turns = 0;

	for await (const message of sdk.query({ prompt, options: queryOpts })) {
		if (message.type === "system" && message.sessionId) {
			sessionId = message.sessionId;
		}

		if (message.type === "assistant") {
			turns++;
			const text = extractText(message);
			if (text) {
				out.write(text);
				textChunks.push(text);
			}
		}

		if (options?.verbose && message.type === "status" && message.message) {
			process.stderr.write(`[agent-sdk] ${message.message}\n`);
		}
	}

	return {
		text: textChunks.join(""),
		sessionId,
		turns,
	};
}
