import type Anthropic from "@anthropic-ai/sdk";
import { executeTool, type ToolResult } from "./index.js";

export const mapTool: Anthropic.Tool = {
	name: "map",
	description:
		"Apply one tool to every item in a list — parallel, no LLM overhead. " +
		"Unlike batch (sub-agents), this calls the tool directly for each item. " +
		"Use for: grep N dirs, fetch N URLs, read N files, any mechanical fan-out.",
	input_schema: {
		type: "object" as const,
		properties: {
			tool: {
				type: "string",
				description: "Tool name to apply to each item",
			},
			items: {
				type: "array",
				items: { type: "object" },
				description:
					"Array of input objects — each becomes the tool's input for one invocation",
			},
			max_concurrent: {
				type: "number",
				description: "Max parallel executions (default: 5, max: 20)",
			},
		},
		required: ["tool", "items"],
	},
};

const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 20;
const MAX_ITEMS = 50;
const TOTAL_RESULT_BUDGET = 30_000;

type MapItemResult = {
	index: number;
	status: "ok" | "error";
	content: string;
};

async function mapConcurrent<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;

	async function worker(): Promise<void> {
		while (next < items.length) {
			const i = next++;
			results[i] = await fn(items[i], i);
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, () => worker()),
	);
	return results;
}

function truncate(text: string, limit: number): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit - 16)}\n... (truncated)`;
}

export async function runMap(
	input: Record<string, unknown>,
): Promise<ToolResult> {
	const toolName = input.tool as string;
	const items = input.items as Record<string, unknown>[];
	const maxConcurrent = Math.min(
		Math.max(1, (input.max_concurrent as number) || DEFAULT_CONCURRENCY),
		MAX_CONCURRENCY,
	);

	if (!toolName || typeof toolName !== "string") {
		return { content: "Error: tool name is required", is_error: true };
	}
	if (!Array.isArray(items) || items.length === 0) {
		return {
			content: "Error: items array is required and must not be empty",
			is_error: true,
		};
	}
	if (items.length > MAX_ITEMS) {
		return {
			content: `Error: max ${MAX_ITEMS} items per map, got ${items.length}`,
			is_error: true,
		};
	}

	const perItemBudget = Math.floor(TOTAL_RESULT_BUDGET / items.length);

	const results = await mapConcurrent(
		items,
		maxConcurrent,
		async (item, index): Promise<MapItemResult> => {
			const result = await executeTool(
				toolName,
				item as Record<string, unknown>,
			);
			return {
				index,
				status: result.is_error ? "error" : "ok",
				content: truncate(result.content, perItemBudget),
			};
		},
	);

	const okCount = results.filter((r) => r.status === "ok").length;
	const errCount = results.filter((r) => r.status === "error").length;

	const header = `[map: ${items.length} items | tool: ${toolName} | ${okCount} ok, ${errCount} failed]`;

	const body = results
		.map((r) => {
			const tag = r.status === "ok" ? "OK" : "ERR";
			return `--- Item ${r.index + 1} [${tag}] ---\n${r.content}`;
		})
		.join("\n\n");

	return { content: `${header}\n\n${body}` };
}

export const registration = {
	tool: mapTool,
	runner: runMap,
	risk: "moderate" as const,
	group: "orchestration",
};
