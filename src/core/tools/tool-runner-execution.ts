import { truncateToolResult } from "#core/loop/context.js";
import { maskToolResultSecrets } from "./secret-masking.js";
import { executeToolCallSchedule } from "./tool-call-schedule.js";
import { executeToolBlock } from "./tool-runner-execute-block.js";
import type {
	ToolCallExecutionOptions,
	ToolResultEntry,
	ToolUseBlock,
} from "./tool-runner-types.js";

function truncateAndMaskResult(
	result: ToolResultEntry,
	resultLimit: number,
): ToolResultEntry {
	if (!result.blocks) {
		return maskToolResultSecrets({
			...result,
			content: truncateToolResult(result.content, resultLimit),
		});
	}
	const blocks = result.blocks.map((block) =>
		block.type === "text"
			? { ...block, text: truncateToolResult(block.text, resultLimit) }
			: block
	);
	return maskToolResultSecrets({
		...result,
		content: truncateToolResult(result.content, resultLimit),
		blocks,
	});
}

/**
 * Execute tool calls with effect-aware scheduling, verbose logging, guardrails,
 * MCP dispatch, result truncation, and secret masking.
 */
export async function executeToolCalls(
	toolBlocks: ToolUseBlock[],
	options: ToolCallExecutionOptions,
): Promise<ToolResultEntry[]> {
	const results = await executeToolCallSchedule(
		toolBlocks,
		(block) => executeToolBlock(block, options),
		options.mcpManager,
	);
	return results.map((result) => truncateAndMaskResult(result, options.resultLimit));
}
