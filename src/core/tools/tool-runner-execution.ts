import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import { truncateToolResult } from "#core/loop/context.js";
import { maskToolResultSecrets } from "./secret-masking.js";
import { executeToolCallSchedule } from "./tool-call-schedule.js";
import { executeToolBlock } from "./tool-runner-execute-block.js";
import type {
	ToolCallExecutionOptions,
	ToolResultEntry,
	ToolUseBlock,
} from "./tool-runner-types.js";

type ToolInput = KotaJsonObject;

type PreparedToolCall =
	| { kind: "execute"; originalIndex: number; block: ToolUseBlock }
	| { kind: "result"; originalIndex: number; result: ToolResultEntry };

export class ToolPermissionInterruptedError extends Error {
	readonly result: ToolResultEntry;

	constructor(message: string, result: ToolResultEntry) {
		super(message);
		this.name = "ToolPermissionInterruptedError";
		this.result = result;
	}
}

function abortReason(signal: AbortSignal): Error {
	const { reason } = signal;
	return reason instanceof Error ? reason : new Error("Tool execution aborted");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw abortReason(signal);
}

function errorEntry(block: ToolUseBlock, content: string): ToolResultEntry {
	return { tool_use_id: block.id, content, is_error: true };
}

function isPlainToolInput(value: ToolUseBlock["input"] | undefined): value is ToolInput {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function runCanUseTool(
	block: ToolUseBlock,
	input: ToolInput,
	options: ToolCallExecutionOptions,
): Promise<{ kind: "allow"; input: ToolInput } | { kind: "deny"; result: ToolResultEntry; interrupt: boolean }> {
	if (!options.canUseTool) return { kind: "allow", input };
	const abortController = new AbortController();
	const forwardAbort = (): void => {
		abortController.abort(options.signal?.reason);
	};
	if (options.signal) {
		if (options.signal.aborted) {
			abortController.abort(options.signal.reason);
		} else {
			options.signal.addEventListener("abort", forwardAbort, { once: true });
		}
	}
	try {
		const decision = await options.canUseTool(block.name, input, {
			signal: abortController.signal,
			suggestions: [],
			toolUseId: block.id,
		});
		if (decision.behavior === "deny") {
			return {
				kind: "deny",
				result: errorEntry(block, decision.message),
				interrupt: decision.interrupt === true,
			};
		}
		if (decision.behavior === "allow" && isPlainToolInput(decision.updatedInput)) {
			return { kind: "allow", input: decision.updatedInput };
		}
		return { kind: "allow", input };
	} finally {
		options.signal?.removeEventListener("abort", forwardAbort);
	}
}

async function preparePermissionedToolCall(
	block: ToolUseBlock,
	input: ToolInput,
	originalIndex: number,
	options: ToolCallExecutionOptions,
): Promise<PreparedToolCall> {
	const canUseTool = await runCanUseTool(block, input, options);
	if (canUseTool.kind === "deny") {
		if (canUseTool.interrupt) {
			throw new ToolPermissionInterruptedError(canUseTool.result.content, canUseTool.result);
		}
		return { kind: "result", originalIndex, result: canUseTool.result };
	}
	return {
		kind: "execute",
		originalIndex,
		block: canUseTool.input === block.input ? block : { ...block, input: canUseTool.input },
	};
}

function prepareToolCall(
	block: ToolUseBlock,
	originalIndex: number,
	options: ToolCallExecutionOptions,
): PreparedToolCall | Promise<PreparedToolCall> {
	throwIfAborted(options.signal);
	if (options.disallowedTools?.includes(block.name)) {
		return {
			kind: "result",
			originalIndex,
			result: errorEntry(
				block,
				`Tool "${block.name}" is in disallowedTools and cannot run.`,
			),
		};
	}
	if (
		options.allowedTools &&
		options.allowedTools.length > 0 &&
		!options.allowedTools.includes(block.name)
	) {
		return {
			kind: "result",
			originalIndex,
			result: errorEntry(
				block,
				`Tool "${block.name}" is not in allowedTools and cannot run.`,
			),
		};
	}
	if (!isPlainToolInput(block.input) || !options.canUseTool) {
		return {
			kind: "execute",
			originalIndex,
			block,
		};
	}
	return preparePermissionedToolCall(block, block.input, originalIndex, options);
}

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
	const resultSlots = new Array<ToolResultEntry>(toolBlocks.length);
	const executableBlocks: ToolUseBlock[] = [];
	const executableIndexes: number[] = [];
	for (const [index, block] of toolBlocks.entries()) {
		const pendingPrepared = prepareToolCall(block, index, options);
		const prepared = pendingPrepared instanceof Promise ? await pendingPrepared : pendingPrepared;
		if (prepared.kind === "result") {
			resultSlots[prepared.originalIndex] = prepared.result;
			continue;
		}
		executableBlocks.push(prepared.block);
		executableIndexes.push(prepared.originalIndex);
	}
	const results = await executeToolCallSchedule(
		executableBlocks,
		(block) => executeToolBlock(block, options),
		options.mcpManager,
	);
	for (const [index, result] of results.entries()) {
		resultSlots[executableIndexes[index]] = result;
	}
	return resultSlots.map((result) => truncateAndMaskResult(result, options.resultLimit));
}
