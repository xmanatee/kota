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
import type { WorkingMemoryEntry } from "#core/memory/working-memory.js";
import {
	clearAll,
	getEntry,
	getPersistentEntries,
	getWorkingMemoryState,
	listEntries,
	loadEntries,
	removeEntry,
	setEntry,
} from "#core/memory/working-memory.js";
import type { ModuleStorage } from "#core/modules/module-storage.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { ToolResult } from "#core/tools/index.js";

const STORAGE_KEY = "entries";

function savePersistent(storage: ModuleStorage): void {
	const entries = getPersistentEntries();
	if (entries.length === 0) {
		storage.delete(STORAGE_KEY);
		return;
	}
	storage.setJSON(
		STORAGE_KEY,
		entries.map((e) => ({ key: e.key, value: e.value, updatedAt: e.updatedAt })),
	);
}

function loadPersistent(storage: ModuleStorage): number {
	const raw = storage.getJSON<Array<{ key: string; value: string; updatedAt: number }>>(STORAGE_KEY);
	if (!raw || !Array.isArray(raw)) return 0;
	const entries: WorkingMemoryEntry[] = raw.map((e) => ({
		key: e.key,
		value: e.value,
		updatedAt: e.updatedAt ?? Date.now(),
		persistent: true,
	}));
	return loadEntries(entries);
}

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
			persist: {
				type: "boolean",
				description:
					"If true, entry survives session restarts. Default: false (session-only).",
			},
		},
		required: ["action"],
	},
};

function makeRunner(ctx: ModuleContext) {
	return async (input: Record<string, unknown>): Promise<ToolResult> => {
		const action = input.action as Action;
		const key = input.key as string | undefined;
		const value = input.value as string | undefined;
		const persist = input.persist as boolean | undefined;

		switch (action) {
			case "write": {
				if (!key) return { content: "Error: key is required for write", is_error: true };
				if (!value) return { content: "Error: value is required for write", is_error: true };
				const err = setEntry(key, value, persist);
				if (err) return { content: `Error: ${err}`, is_error: true };
				if (persist !== undefined) savePersistent(ctx.storage);
				const label = persist ? " (persistent)" : "";
				return { content: `Working memory "${key}" updated${label}.` };
			}
			case "read": {
				if (!key) return { content: "Error: key is required for read", is_error: true };
				const entry = getEntry(key);
				if (!entry) return { content: `No entry "${key}" in working memory.`, is_error: true };
				const tag = entry.persistent ? " [persistent]" : "";
				return { content: `${entry.key}: ${entry.value}${tag}` };
			}
			case "list": {
				const entries = listEntries();
				if (entries.length === 0) return { content: "Working memory is empty." };
				const lines = entries.map((e) => {
					const tag = e.persistent ? " [persistent]" : "";
					return `- ${e.key}: ${e.value}${tag}`;
				});
				return { content: `Working memory (${entries.length} entries):\n${lines.join("\n")}` };
			}
			case "remove": {
				if (!key) return { content: "Error: key is required for remove", is_error: true };
				const was = getEntry(key);
				if (!removeEntry(key)) return { content: `No entry "${key}" to remove.`, is_error: true };
				if (was?.persistent) savePersistent(ctx.storage);
				return { content: `Removed "${key}" from working memory.` };
			}
			case "clear": {
				const hadPersistent = getPersistentEntries().length > 0;
				const count = clearAll();
				if (hadPersistent) savePersistent(ctx.storage);
				return { content: count > 0 ? `Cleared ${count} entries from working memory.` : "Working memory was already empty." };
			}
			default:
				return { content: `Unknown action: ${action}`, is_error: true };
		}
	};
}

const workingMemoryModule: KotaModule = {
	name: "working-memory",
	version: "2.0.0",
	description: "Agent-controlled scratchpad visible in the system prompt every turn",

	tools: (ctx) => [
		{
			tool: workingMemoryTool,
			runner: makeRunner(ctx),
			risk: "safe",
			kind: "action",
		},
	],

	onLoad: (ctx) => {
		const count = loadPersistent(ctx.storage);
		if (count > 0) ctx.log.info(`Restored ${count} persistent working memory entries`);
		ctx.registerDynamicStateProvider("working-memory", getWorkingMemoryState);
	},

	skills: [{ name: "working-memory", promptPath: "src/modules/working-memory/working-memory.md", roles: ["builder", "improver"] }],
};

export default workingMemoryModule;
