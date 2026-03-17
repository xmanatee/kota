import type Anthropic from "@anthropic-ai/sdk";
import { runDelegate } from "./delegate.js";
import type { ToolResult } from "./index.js";

export const batchTool: Anthropic.Tool = {
	name: "batch",
	description:
		"Run multiple independent tasks in parallel via sub-agents. " +
		"Each task gets its own context (like delegate). Returns all results. " +
		"Use for: parallel research, multi-angle analysis, concurrent file processing.",
	input_schema: {
		type: "object" as const,
		properties: {
			tasks: {
				type: "array",
				items: { type: "string" },
				description: "Task descriptions to run in parallel",
			},
			mode: {
				type: "string",
				enum: ["explore", "execute"],
				description:
					"explore (default): read-only research. execute: can modify files.",
			},
			max_concurrent: {
				type: "number",
				description: "Max parallel sub-agents (default: 3, max: 5)",
			},
		},
		required: ["tasks"],
	},
};

const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 5;
const MAX_TASKS = 10;
const TOTAL_RESULT_BUDGET = 30_000;

type BatchItemResult = {
	task: string;
	status: "success" | "error";
	content: string;
};

/**
 * Run async functions over items with a concurrency limit.
 * Workers pull from a shared index — items complete as fast as possible
 * without exceeding the limit.
 */
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

export async function runBatch(
	input: Record<string, unknown>,
): Promise<ToolResult> {
	const tasks = input.tasks as string[];
	const mode = (input.mode as string) || "explore";
	const maxConcurrent = Math.min(
		Math.max(1, (input.max_concurrent as number) || DEFAULT_CONCURRENCY),
		MAX_CONCURRENCY,
	);

	if (!Array.isArray(tasks) || tasks.length === 0) {
		return {
			content: "Error: tasks array is required and must not be empty",
			is_error: true,
		};
	}
	if (tasks.length > MAX_TASKS) {
		return {
			content: `Error: max ${MAX_TASKS} tasks per batch, got ${tasks.length}`,
			is_error: true,
		};
	}
	if (mode !== "explore" && mode !== "execute") {
		return {
			content: `Error: mode must be "explore" or "execute", got "${mode}"`,
			is_error: true,
		};
	}

	const perTaskBudget = Math.floor(TOTAL_RESULT_BUDGET / tasks.length);

	const results = await mapConcurrent(
		tasks,
		maxConcurrent,
		async (task): Promise<BatchItemResult> => {
			try {
				const r = await runDelegate({ task, mode });
				return {
					task,
					status: r.is_error ? "error" : "success",
					content: truncate(r.content, perTaskBudget),
				};
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return { task, status: "error", content: `Failed: ${msg}` };
			}
		},
	);

	const succeeded = results.filter((r) => r.status === "success").length;
	const failed = results.filter((r) => r.status === "error").length;

	const header = `[batch: ${tasks.length} tasks | ${succeeded} ok, ${failed} failed | mode: ${mode}]`;

	const body = results
		.map((r, i) => {
			const tag = r.status === "success" ? "OK" : "ERR";
			return `--- Task ${i + 1} [${tag}]: ${r.task} ---\n${r.content}`;
		})
		.join("\n\n");

	return { content: `${header}\n\n${body}` };
}

export const registration = {
	tool: batchTool,
	runner: runBatch,
	risk: "moderate" as const,
};
