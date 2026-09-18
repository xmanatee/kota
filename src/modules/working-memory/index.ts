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


import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import { createDirectoryScopeSelector } from "#core/daemon/scope-selection.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { daemonWriteEffect, readOnlySessionEffect } from "#core/tools/effect.js";
import type { ToolResult, ToolRunnerContext } from "#core/tools/index.js";
import {
  defineSessionResourceKey,
  getSessionEnvironmentResource,
} from "#core/tools/session-environment.js";
import { readPersistentEntries } from "./persistence.js";
import { WorkingMemoryStore } from "./store.js";

const memoryKey = defineSessionResourceKey<WorkingMemoryStore>("working-memory");

function createMemoryResolver(ctx: ModuleContext) {
  const selectScope = createDirectoryScopeSelector({
    defaultScopeRoot: ctx.cwd,
    getDaemonScopeProvider: () => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE),
  });
  return (execution: ToolRunnerContext | undefined): WorkingMemoryStore | undefined => {
    if (!execution?.sessionId || !execution.scopeId) return undefined;
    const selected = execution.resolveRuntimeScope
      ? execution.resolveRuntimeScope(execution.scopeId)
      : selectScope(execution.scopeId);
    if (!selected.ok) return undefined;
    const scope = "runtime" in selected ? selected.runtime.scope : selected.scope;
    return getSessionEnvironmentResource(execution, memoryKey,
      () => new WorkingMemoryStore(new ModuleStorage(scope.scopeRoot, "working-memory")),
      (memory) => memory.dispose());
  };
}

const workingMemoryTool: KotaTool = {
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
					"If true, entry survives session restarts within this scope. Omit to retain an existing setting; new entries default to session-only. False removes the durable copy.",
			},
		},
		required: ["action"],
	},
};

function makeRunner(ctx: ModuleContext) {
	const resolveMemory = createMemoryResolver(ctx);
	return async (input: Record<string, unknown>, execution?: ToolRunnerContext): Promise<ToolResult> => {
		const memory = resolveMemory(execution);
		if (!memory) return { content: "Working memory requires a live session in an available directory scope.", is_error: true };
		const action = input.action;
		const key = typeof input.key === "string" ? input.key : undefined;
		const value = typeof input.value === "string" ? input.value : undefined;
		if (input.persist !== undefined && typeof input.persist !== "boolean") {
			return { content: "Error: persist must be a boolean", is_error: true };
		}
		const persist = input.persist;

		switch (action) {
			case "write": {
				if (!key) return { content: "Error: key is required for write", is_error: true };
				if (value === undefined) return { content: "Error: value is required for write", is_error: true };
				const err = memory.setEntry(key, value, persist);
				if (err) return { content: `Error: ${err}`, is_error: true };
				const label = memory.getEntry(key)?.persistent ? " (persistent)" : "";
				return { content: `Working memory "${key}" updated${label}.` };
			}
			case "read": {
				if (!key) return { content: "Error: key is required for read", is_error: true };
				const entry = memory.getEntry(key);
				if (!entry) return { content: `No entry "${key}" in working memory.`, is_error: true };
				const tag = entry.persistent ? " [persistent]" : "";
				return { content: `${entry.key}: ${entry.value}${tag}` };
			}
			case "list": {
				const entries = memory.listEntries();
				if (entries.length === 0) return { content: "Working memory is empty." };
				const lines = entries.map((e) => {
					const tag = e.persistent ? " [persistent]" : "";
					return `- ${e.key}: ${e.value}${tag}`;
				});
				return { content: `Working memory (${entries.length} entries):\n${lines.join("\n")}` };
			}
			case "remove": {
				if (!key) return { content: "Error: key is required for remove", is_error: true };
				if (!memory.removeEntry(key)) return { content: `No entry "${key}" to remove.`, is_error: true };
				return { content: `Removed "${key}" from working memory.` };
			}
			case "clear": {
				const count = memory.clearAll();
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
			effect: daemonWriteEffect(),
			resolveEffect: ({ action }) => action === "read" || action === "list"
				? readOnlySessionEffect()
				: daemonWriteEffect(),
		},
	],

	onLoad: (ctx) => {
		readPersistentEntries(ctx.storage);
		const resolveMemory = createMemoryResolver(ctx);
		ctx.registerDynamicStateProvider("working-memory", ({ activeTools, execution }) => {
			if (!activeTools.has("working_memory")) return "";
			return resolveMemory(execution)?.getWorkingMemoryState() ?? "";
		});
	},

	skills: [{ name: "working-memory", promptPath: "src/modules/working-memory/working-memory.md", roles: ["builder", "improver"] }],
};

export default workingMemoryModule;
