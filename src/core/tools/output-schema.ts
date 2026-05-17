import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import {
	type JsonSchemaObject,
	validateJsonSchemaValue,
} from "#core/util/json-schema-validator.js";
import type { ToolResult } from "./tool-result.js";

export function validateToolStructuredOutput(
	tool: KotaTool,
	result: ToolResult,
): string | null {
	if (!tool.output_schema || result.is_error === true) return null;
	if (result.structuredContent === undefined) {
		return `Tool "${tool.name}" declared output_schema but returned no structuredContent`;
	}
	const validationError = validateJsonSchemaValue(
		tool.output_schema as JsonSchemaObject,
		result.structuredContent,
		"structuredContent",
	);
	if (!validationError) return null;
	return `Tool "${tool.name}" structuredContent does not match output_schema: ${validationError}`;
}

export function assertToolStructuredOutput(
	tool: KotaTool,
	result: ToolResult,
): void {
	const error = validateToolStructuredOutput(tool, result);
	if (error) throw new Error(error);
}
