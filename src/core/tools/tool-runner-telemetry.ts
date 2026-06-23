import type { ToolResult } from "./index.js";
import {
	hasToolResultTruncationMarker,
	type ToolTelemetryResultContentKind,
} from "./tool-telemetry.js";

export function getToolResultTelemetryPayload(result: ToolResult): string | object {
	if (!result.blocks && !result.structuredContent && !result._meta) {
		return result.content;
	}
	return {
		content: result.content,
		...(result.blocks ? { blocks: result.blocks } : {}),
		...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
		...(result._meta ? { _meta: result._meta } : {}),
	};
}

export function getToolResultContentKind(result: ToolResult): ToolTelemetryResultContentKind {
	const hasBlocks = result.blocks !== undefined && result.blocks.length > 0;
	const hasStructured = result.structuredContent !== undefined || result._meta !== undefined;
	if (hasBlocks && hasStructured) return "mixed";
	if (hasBlocks) return "blocks";
	if (hasStructured) return "structured";
	if (result.content.length === 0) return "empty";
	return "text";
}

export function toolResultWouldTruncate(result: ToolResult, resultLimit: number): boolean {
	const payload = getToolResultTelemetryPayload(result);
	if (result.content.length > resultLimit) return true;
	if (result.blocks?.some((block) => block.type === "text" && block.text.length > resultLimit)) return true;
	return hasToolResultTruncationMarker(payload);
}
