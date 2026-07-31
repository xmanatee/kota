import type {
	KotaJsonObject,
	KotaJsonValue,
	KotaToolInputSchema,
	KotaToolUseBlock,
} from "#core/agent-harness/message-protocol.js";
import type { McpManager } from "#core/mcp/manager.js";
import { validatePayloadSchema } from "#core/workflow/payload-validator.js";
import { getAllTools } from "./index.js";

declare const validatedToolCallInput: unique symbol;

export type ValidatedToolCallInput = KotaJsonObject & {
	readonly [validatedToolCallInput]: true;
};

export type ToolInputValidationResult =
	| { ok: true; input: ValidatedToolCallInput }
	| { ok: false; error: string };

function isJsonValue(
	value: KotaToolUseBlock["input"],
	ancestors: Set<object>,
): value is KotaJsonValue {
	if (
		value === null
		|| typeof value === "string"
		|| typeof value === "boolean"
	) {
		return true;
	}
	if (typeof value === "number") return Number.isFinite(value);
	if (typeof value !== "object") return false;
	if (ancestors.has(value)) return false;
	if (!Array.isArray(value)) {
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) return false;
	}

	ancestors.add(value);
	const valid = Array.isArray(value)
		? value.every((entry) => isJsonValue(entry, ancestors))
		: Object.values(value).every((entry) => isJsonValue(entry, ancestors));
	ancestors.delete(value);
	return valid;
}

function isJsonObject(value: KotaToolUseBlock["input"]): value is KotaJsonObject {
	return (
		typeof value === "object"
		&& value !== null
		&& !Array.isArray(value)
		&& isJsonValue(value, new Set())
	);
}

function resolveInputSchema(
	toolName: string,
	mcpManager: McpManager | undefined,
): KotaToolInputSchema | undefined {
	if (mcpManager?.isMcpTool(toolName)) {
		return mcpManager.getTools().find((tool) => tool.name === toolName)?.input_schema;
	}
	return getAllTools().find((tool) => tool.name === toolName)?.input_schema;
}

export function validateToolCallInput(
	toolName: string,
	value: KotaToolUseBlock["input"],
	mcpManager?: McpManager,
): ToolInputValidationResult {
	const schema = resolveInputSchema(toolName, mcpManager);
	return validateToolCallInputAgainstSchema(toolName, value, schema);
}

export function validateToolCallInputAgainstSchema(
	toolName: string,
	value: KotaToolUseBlock["input"],
	schema: KotaToolInputSchema | undefined,
): ToolInputValidationResult {
	if (!isJsonObject(value)) {
		return {
			ok: false,
			error: `Invalid tool input for "${toolName}": expected a JSON object`,
		};
	}
	if (!schema) {
		return {
			ok: false,
			error: `Invalid tool input for "${toolName}": no registered input schema`,
		};
	}
	const validationError = validatePayloadSchema(schema, value, "input");
	if (validationError) {
		return {
			ok: false,
			error: `Invalid tool input for "${toolName}": ${validationError}`,
		};
	}
	return { ok: true, input: value as ValidatedToolCallInput };
}
