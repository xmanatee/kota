import type { Transport } from "#core/loop/transport.js";
import type { ToolCallInput } from "./guardrails-classify.js";
import type { ToolResult } from "./index.js";
import type { ToolResultContentProvenance } from "./tool-middleware.js";
import {
	getToolResultContentKind,
	getToolResultTelemetryPayload,
	toolResultWouldTruncate,
} from "./tool-runner-telemetry.js";
import type { ToolUseBlock } from "./tool-runner-types.js";
import {
	getToolTelemetry,
	measureTelemetryPayloadBytes,
} from "./tool-telemetry.js";

export function recordToolExecutionMetric(args: {
	block: ToolUseBlock;
	input: ToolCallInput;
	result: ToolResult;
	resultLimit: number;
	transport?: Transport | undefined;
	resultContentProvenance?: ToolResultContentProvenance | undefined;
	startMs?: number;
}): void {
	const startMs = args.startMs ?? performance.now();
	const telemetry = getToolTelemetry();
	telemetry.recordCallStart({
		toolUseId: args.block.id,
		tool: args.block.name,
		inputBytes: measureTelemetryPayloadBytes(args.input),
	});
	const durationMs = Math.round(performance.now() - startMs);
	const resultPayload = getToolResultTelemetryPayload(args.result);
	telemetry.recordCallResult({
		toolUseId: args.block.id,
		tool: args.block.name,
		durationMs,
		success: !args.result.is_error,
		resultBytes: measureTelemetryPayloadBytes(resultPayload),
		resultContentKind: getToolResultContentKind(args.result),
		truncated: toolResultWouldTruncate(args.result, args.resultLimit),
		...(args.resultContentProvenance !== undefined
			? { resultContentProvenance: args.resultContentProvenance }
			: {}),
		...(args.result.is_error ? { error: args.result.content.slice(0, 200) } : {}),
	});
	if (args.transport) {
		args.transport.emit({
			type: "tool_metric",
			tool: args.block.name,
			durationMs,
			success: !args.result.is_error,
		});
	}
}
