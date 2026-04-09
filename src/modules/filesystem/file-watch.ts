import type Anthropic from "@anthropic-ai/sdk";
import { getWatcherManager } from "../../file-watcher.js";
import type { ToolResult } from "../../tools/tool-result.js";

export const fileWatchTool: Anthropic.Tool = {
	name: "file_watch",
	description:
		"Watch a directory for file changes. Changes emit 'file.changed' events on the event bus " +
		"(usable with schedule on_event). Actions: start (begin watching), stop (by ID), list (active watchers).",
	input_schema: {
		type: "object" as const,
		properties: {
			action: {
				type: "string",
				enum: ["start", "stop", "list"],
				description: "start: begin watching, stop: stop a watcher, list: show active watchers",
			},
			path: {
				type: "string",
				description: "Directory path to watch (for 'start')",
			},
			recursive: {
				type: "boolean",
				description: "Watch subdirectories (default: true, for 'start')",
			},
			modules: {
				type: "array",
				items: { type: "string" },
				description: 'Filter by file modules, e.g. [".ts", ".json"] (for \'start\')',
			},
			id: {
				type: "string",
				description: "Watcher ID to stop (for 'stop')",
			},
		},
		required: ["action"],
	},
};

export async function runFileWatch(
	input: Record<string, unknown>,
): Promise<ToolResult> {
	const action = input.action as string;
	const mgr = getWatcherManager();

	switch (action) {
		case "start": {
			const watchPath = input.path as string;
			if (!watchPath)
				return { content: "Error: path is required", is_error: true };

			try {
				const id = await mgr.start(watchPath, {
					recursive: (input.recursive as boolean) ?? true,
					modules: input.modules as string[] | undefined,
				});
				const extLabel = input.modules
					? ` [${(input.modules as string[]).join(", ")}]`
					: "";
				return {
					content: `Watcher ${id} started: ${watchPath}${extLabel}. Events emit as "file.changed" on the event bus.`,
				};
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return { content: `Error: ${msg}`, is_error: true };
			}
		}

		case "stop": {
			const id = input.id as string;
			if (!id) return { content: "Error: id is required", is_error: true };
			const stopped = mgr.stop(id);
			return stopped
				? { content: `Watcher ${id} stopped.` }
				: { content: `Watcher ${id} not found.`, is_error: true };
		}

		case "list": {
			const watchers = mgr.list();
			if (watchers.length === 0)
				return { content: "No active watchers." };
			const lines = watchers.map((w) => {
				const ext = w.modules ? ` [${w.modules.join(", ")}]` : "";
				return `${w.id}: ${w.path}${ext} (${w.changeCount} changes since ${w.createdAt})`;
			});
			return {
				content: `${watchers.length} active:\n${lines.join("\n")}`,
			};
		}

		default:
			return {
				content: `Error: unknown action '${action}'`,
				is_error: true,
			};
	}
}

export const registration = {
	tool: fileWatchTool,
	runner: runFileWatch,
	risk: "moderate" as const,
	kind: "action" as const,
	group: "management",
};
