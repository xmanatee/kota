import type { EvidenceJsonValue } from "#core/evidence/policy.js";
import { cloneEvidenceJsonObject } from "#core/evidence/policy.js";
import type { ToolCallInput } from "./guardrails-classify.js";
import type { ToolCall } from "./tool-middleware.js";

export type ToolApprovalExecutionBinding = {
	reviewedInput: ToolCallInput;
	matches(call: Pick<ToolCall, "name" | "input">): boolean;
};

export function snapshotToolCallForExecution(
	call: Pick<ToolCall, "name" | "input">,
): Pick<ToolCall, "name" | "input"> {
	return { name: call.name, input: cloneEvidenceJsonObject(call.input) };
}

function canonicalJson(value: EvidenceJsonValue): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	return `{${Object.keys(value)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`)
		.join(",")}}`;
}

function executionMaterial(toolName: string, input: ToolCallInput): string {
	return `${JSON.stringify(toolName)}:${canonicalJson(cloneEvidenceJsonObject(input))}`;
}

/** Capture the exact tool and validated input a client approval request reviews. */
export function createToolApprovalExecutionBinding(
	toolName: string,
	input: ToolCallInput,
): ToolApprovalExecutionBinding {
	const reviewedInput = snapshotToolCallForExecution({ name: toolName, input }).input;
	const material = executionMaterial(toolName, reviewedInput);
	return {
		reviewedInput,
		matches: (call) => executionMaterial(call.name, call.input) === material,
	};
}
