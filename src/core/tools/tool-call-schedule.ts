import type { McpManager } from "#core/mcp/manager.js";
import { classifyToolCallInputEffectOverride } from "./guardrails-classify.js";
import { getToolEffect } from "./index.js";
import type {
	ExecuteToolBlock,
	ToolResultEntry,
	ValidatedToolUseBlock,
} from "./tool-runner-types.js";

function isReadOnlyToolCall(
	block: ValidatedToolUseBlock,
	mcpManager: McpManager | undefined,
): boolean {
	if (mcpManager?.isMcpTool(block.name)) {
		return mcpManager.isToolReadOnly?.(block.name) === true;
	}
	const inputEffectOverride = classifyToolCallInputEffectOverride(
		block.name,
		block.input,
	);
	if (inputEffectOverride) return inputEffectOverride.kind === "read";
	return getToolEffect(block.name)?.kind === "read";
}

export async function executeToolCallSchedule(
	toolBlocks: ValidatedToolUseBlock[],
	executeBlock: ExecuteToolBlock,
	mcpManager: McpManager | undefined,
): Promise<ToolResultEntry[]> {
	const results = new Array<ToolResultEntry>(toolBlocks.length);
	let readOnlyBatch: Array<{ block: ValidatedToolUseBlock; index: number }> = [];

	const flushReadOnlyBatch = async (): Promise<void> => {
		if (readOnlyBatch.length === 0) return;
		const batch = readOnlyBatch;
		readOnlyBatch = [];
		await Promise.all(
			batch.map(async ({ block, index }) => {
				results[index] = await executeBlock(block);
			}),
		);
	};

	for (const [index, block] of toolBlocks.entries()) {
		if (isReadOnlyToolCall(block, mcpManager)) {
			readOnlyBatch.push({ block, index });
			continue;
		}
		await flushReadOnlyBatch();
		results[index] = await executeBlock(block);
	}

	await flushReadOnlyBatch();
	return results;
}
