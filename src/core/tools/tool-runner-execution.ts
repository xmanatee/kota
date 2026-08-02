import { truncateToolResult } from "#core/loop/context.js";
import { maskToolResultSecrets } from "./secret-masking.js";
import { executeToolCallSchedule } from "./tool-call-schedule.js";
import {
	type ValidatedToolCallInput,
	validateToolCallInput,
} from "./tool-input-validation.js";
import { throwIfToolRunnerAborted } from "./tool-runner-abort.js";
import { executeToolBlock } from "./tool-runner-execute-block.js";
import { staleMcpDeclarationResult } from "./tool-runner-mcp.js";
import type {
	ToolCallExecutionOptions,
	ToolResultEntry,
	ToolUseBlock,
	ValidatedToolUseBlock,
} from "./tool-runner-types.js";

type PreparedToolCall =
	| { kind: "execute"; originalIndex: number; block: ValidatedToolUseBlock }
	| { kind: "result"; originalIndex: number; result: ToolResultEntry };

export class ToolPermissionInterruptedError extends Error {
	readonly result: ToolResultEntry;

	constructor(message: string, result: ToolResultEntry) {
		super(message);
		this.name = "ToolPermissionInterruptedError";
		this.result = result;
	}
}

function errorEntry(block: ToolUseBlock, content: string): ToolResultEntry {
	return { tool_use_id: block.id, content, is_error: true };
}

function staleResultEntry(
	block: ToolUseBlock,
	result: NonNullable<ReturnType<typeof staleMcpDeclarationResult>>,
): ToolResultEntry {
	return {
		tool_use_id: block.id,
		content: result.content,
		...(result.blocks ? { blocks: result.blocks } : {}),
		...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
		...(result._meta ? { _meta: result._meta } : {}),
		...(result.is_error !== undefined ? { is_error: result.is_error } : {}),
	};
}

async function runCanUseTool(
	block: ToolUseBlock,
	input: ValidatedToolCallInput,
	options: ToolCallExecutionOptions,
): Promise<
	| { kind: "allow"; input: ToolUseBlock["input"] }
	| { kind: "deny"; result: ToolResultEntry; interrupt: boolean }
> {
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
		if (decision.behavior === "allow" && decision.updatedInput !== undefined) {
			return { kind: "allow", input: decision.updatedInput };
		}
		return { kind: "allow", input };
	} finally {
		options.signal?.removeEventListener("abort", forwardAbort);
	}
}

async function preparePermissionedToolCall(
	block: ToolUseBlock,
	input: ValidatedToolCallInput,
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
	const validated = validateToolCallInput(block.name, canUseTool.input, options.mcpManager);
	if (!validated.ok) {
		return {
			kind: "result",
			originalIndex,
			result: errorEntry(block, validated.error),
		};
	}
	return {
		kind: "execute",
		originalIndex,
		block: { ...block, input: validated.input },
	};
}

function prepareToolCall(
	block: ToolUseBlock,
	originalIndex: number,
	options: ToolCallExecutionOptions,
): PreparedToolCall | Promise<PreparedToolCall> {
	throwIfToolRunnerAborted(options.signal);
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
	if (
		options.mcpPromptToolDeclarationFingerprints?.has(block.name)
		&& options.mcpManager?.isMcpTool(block.name) !== true
	) {
		const staleResult = staleMcpDeclarationResult(
			block.name,
			options.mcpManager,
			options.mcpPromptToolDeclarationFingerprints,
		);
		if (staleResult) {
			return {
				kind: "result",
				originalIndex,
				result: staleResultEntry(block, staleResult),
			};
		}
	}
	const validated = validateToolCallInput(block.name, block.input, options.mcpManager);
	if (!validated.ok) {
		return {
			kind: "result",
			originalIndex,
			result: errorEntry(block, validated.error),
		};
	}
	if (!options.canUseTool) {
		return {
			kind: "execute",
			originalIndex,
			block: { ...block, input: validated.input },
		};
	}
	return preparePermissionedToolCall(block, validated.input, originalIndex, options);
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
	const executableBlocks: ValidatedToolUseBlock[] = [];
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
