/**
 * Working Memory module — explicit, agent-controlled scratchpad.
 *
 * Gives the agent a set of named entries that appear in the system prompt
 * every turn. Unlike the knowledge store (persistent cross-session data)
 * or memory system (long-term recall), working memory is session-scoped
 * and visible without explicit reads — perfect for accumulating research
 * findings, tracking multi-step plans, or maintaining context during
 * long conversations.
 *
 * Inspired by Letta/MemGPT's core memory blocks.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { KotaModule, ModuleContext } from "../module-types.js";
import type { ToolResult } from "../tools/index.js";
import {
	clearAll,
	getEntry,
	listEntries,
	removeEntry,
	setEntry,
} from "../working-memory.js";

type Action = "write" | "read" | "list" | "remove" | "clear";

const workingMemoryTool: Anthropic.Tool = {
	name: "working_memory",
	description:
		"Manage your working memory — named entries visible in your system prompt every turn. " +
		"Use to accumulate findings, track plans, or maintain state across turns without re-reading. " +
		"Actions: write (set key+value), read (get one key), list (all entries), remove (delete key), clear (reset all).",
	input_schema: {
		type: "object" as const,
		properties: {
			action: {
				type: "string",
				enum: ["write", "read", "list", "remove", "clear"],
				description: "Operation to perform",
			},
			key: {
				type: "string",
				description: "Entry name (required for write/read/remove)",
			},
			value: {
				type: "string",
				description: "Entry content (required for write, max 500 chars)",
			},
		},
		required: ["action"],
	},
};

function makeRunner(_ctx: ModuleContext) {
	return async (input: Record<string, unknown>): Promise<ToolResult> => {
		const action = input.action as Action;
		const key = input.key as string | undefined;
		const value = input.value as string | undefined;

		switch (action) {
			case "write": {
				if (!key) return { content: "Error: key is required for write", is_error: true };
				if (!value) return { content: "Error: value is required for write", is_error: true };
				const err = setEntry(key, value);
				if (err) return { content: `Error: ${err}`, is_error: true };
				return { content: `Working memory "${key}" updated.` };
			}
			case "read": {
				if (!key) return { content: "Error: key is required for read", is_error: true };
				const entry = getEntry(key);
				if (!entry) return { content: `No entry "${key}" in working memory.`, is_error: true };
				return { content: `${entry.key}: ${entry.value}` };
			}
			case "list": {
				const entries = listEntries();
				if (entries.length === 0) return { content: "Working memory is empty." };
				const lines = entries.map((e) => `- ${e.key}: ${e.value}`);
				return { content: `Working memory (${entries.length} entries):\n${lines.join("\n")}` };
			}
			case "remove": {
				if (!key) return { content: "Error: key is required for remove", is_error: true };
				if (!removeEntry(key)) return { content: `No entry "${key}" to remove.`, is_error: true };
				return { content: `Removed "${key}" from working memory.` };
			}
			case "clear": {
				const count = clearAll();
				return { content: count > 0 ? `Cleared ${count} entries from working memory.` : "Working memory was already empty." };
			}
			default:
				return { content: `Unknown action: ${action}`, is_error: true };
		}
	};
}

const workingMemoryModule: KotaModule = {
	name: "working-memory",
	version: "1.0.0",
	description: "Agent-controlled scratchpad visible in the system prompt every turn",

	tools: (ctx) => [
		{
			tool: workingMemoryTool,
			runner: makeRunner(ctx),
		},
	],

	promptSection: () =>
		"You have a working memory scratchpad. Entries you write appear in your system prompt " +
		"every turn inside <working-memory> tags — no need to re-read them. Use it to accumulate " +
		"research findings, track multi-step plans, or maintain context during long tasks. " +
		"Session-scoped (cleared on restart). For permanent storage, use the knowledge store.",
};

export default workingMemoryModule;
