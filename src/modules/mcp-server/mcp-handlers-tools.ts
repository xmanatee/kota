/**
 * MCP `tools/list` and `tools/call` handlers plus the small adapters that
 * convert KOTA's neutral tool shape and tool-result shape into the MCP wire
 * representation.
 */

import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolDef } from "#core/modules/module-types.js";
import { getToolMcpAnnotations } from "#core/tools/guardrails-classify.js";
import { executeTool, getAllTools, type ToolResult } from "#core/tools/index.js";
import {
	type JsonSchemaObject,
	validateJsonSchemaValue,
} from "#core/util/json-schema-validator.js";
import type { ElicitationHandler } from "./mcp-handlers-elicitation.js";
import type {
	ElicitationResponse,
	HandlerContext,
	JsonRpcRequest,
	McpContentBlock,
	McpProtocolVersion,
	McpToolCompleteResult,
	McpToolInputRequiredResult,
	McpToolInputResponses,
	McpToolResult,
} from "./mcp-protocol-types.js";
import { MCP_DRAFT_PROTOCOL_VERSION } from "./mcp-protocol-types.js";

type ToolRunnerInput = Parameters<ToolDef["runner"]>[0];
type RequestParamValue = NonNullable<JsonRpcRequest["params"]>[string];

type PendingConfirmInput = {
	name: "confirm";
	args: ToolRunnerInput;
	requestId: "confirm";
};

type RetryParams =
	| { kind: "none" }
	| { kind: "invalid"; message: string }
	| { kind: "retry"; requestState: string; inputResponses: McpToolInputResponses };

type McpLegacyToolResult = {
	content: McpContentBlock[];
	structuredContent?: ToolResult["structuredContent"];
	_meta?: ToolResult["_meta"];
	isError?: true;
};

export class ToolsHandler {
	private readonly toolFilter: Set<string> | null;
	private readonly moduleRunners = new Map<string, ToolDef["runner"]>();
	private readonly moduleToolList: KotaTool[] = [];
	private readonly pendingInputRequests = new Map<string, PendingConfirmInput>();
	private inputRequestStateCounter = 0;

	constructor(
		private readonly ctx: HandlerContext,
		private readonly elicitation: ElicitationHandler,
		options: { toolFilter?: string[]; moduleTools?: ToolDef[] } = {},
	) {
		this.toolFilter = options.toolFilter?.length ? new Set(options.toolFilter) : null;
		for (const def of options.moduleTools ?? []) {
			this.moduleRunners.set(def.tool.name, def.runner);
			this.moduleToolList.push(def.tool);
		}
	}

	/** The tools this server exposes (respecting filter). Merges project and module tools. */
	getExposedTools(): KotaTool[] {
		const builtinNames = new Set(getAllTools().map((t) => t.name));
		const all = [
			...getAllTools(),
			...this.moduleToolList.filter((t) => !builtinNames.has(t.name)),
		];
		if (!this.toolFilter) return all;
		return all.filter((t) => this.toolFilter!.has(t.name));
	}

	handleList(msg: JsonRpcRequest): void {
		if (!this.ctx.session.initialized) {
			this.ctx.transport.sendError(msg, -32002, "Server not initialized");
			return;
		}

		const tools = this.getExposedTools().map((t) => {
			const mcp = kotaToolToMcp(t);
			const annotations = getToolMcpAnnotations(t.name);
			return annotations ? { ...mcp, annotations } : mcp;
		});
		this.ctx.transport.sendResult(msg, { tools });
	}

	async handleCall(msg: JsonRpcRequest): Promise<void> {
		if (!this.ctx.session.initialized) {
			this.ctx.transport.sendError(msg, -32002, "Server not initialized");
			return;
		}

		const params = msg.params ?? {};
		const name = params.name as string;
		const args = readToolArguments(params.arguments);

		if (!name || typeof name !== "string") {
			return this.ctx.transport.sendError(msg, -32602, "Missing required parameter: name");
		}

		const exposed = this.getExposedTools();
		const tool = exposed.find((t) => t.name === name);
		if (!tool) {
			return this.ctx.transport.sendError(msg, -32602, `Unknown tool: ${name}`);
		}

		const retry = decodeRetryParams(params);
		if (retry.kind === "invalid") {
			return this.ctx.transport.sendError(msg, -32602, retry.message);
		}
		if (retry.kind === "retry") {
			return this.handleInputRequiredRetry(msg, name, retry.requestState, retry.inputResponses);
		}

		this.ctx.log(`Calling tool: ${name}`);

		if (name === "confirm" && usesDraftToolResults(this.ctx.session.protocolVersion)) {
			this.handleConfirmViaInputRequired(msg, args);
			return;
		}

		// When the confirm tool is called over MCP and the client supports elicitation,
		// use the standard elicitation protocol instead of falling back to /dev/tty.
		if (name === "confirm" && this.ctx.session.clientSupportsElicitation) {
			await this.handleConfirmViaElicitation(msg, args);
			return;
		}

		let result: ToolResult;
		const extRunner = this.moduleRunners.get(name);
		if (extRunner) {
			try {
				result = await extRunner(args);
			} catch (err) {
				const errMsg = err instanceof Error ? err.message : String(err);
				result = { content: `Tool error: ${errMsg}`, is_error: true };
			}
		} else {
			result = await executeTool(name, args);
		}

		this.sendToolExecutionResult(msg, tool, result);
	}

	private handleConfirmViaInputRequired(
		msg: JsonRpcRequest,
		args: ToolRunnerInput,
	): void {
		const requestState = `confirm:${++this.inputRequestStateCounter}`;
		const pending: PendingConfirmInput = {
			name: "confirm",
			args,
			requestId: "confirm",
		};
		this.pendingInputRequests.set(requestState, pending);
		const result: McpToolInputRequiredResult = {
			resultType: "input_required",
			inputRequests: {
				confirm: {
					method: "elicitation/create",
					params: {
						mode: "form",
						message: buildConfirmElicitationMessage(args),
						requestedSchema: {
							type: "object",
							properties: { confirmed: { type: "boolean", title: "Approve?" } },
						},
					},
				},
			},
			requestState,
		};
		this.ctx.transport.sendResult(msg, result);
	}

	private handleInputRequiredRetry(
		msg: JsonRpcRequest,
		name: string,
		requestState: string,
		inputResponses: McpToolInputResponses,
	): void {
		if (!usesDraftToolResults(this.ctx.session.protocolVersion)) {
			this.ctx.transport.sendError(
				msg,
				-32602,
				"inputResponses are only supported by the draft tool result protocol",
			);
			return;
		}
		const pending = this.pendingInputRequests.get(requestState);
		if (!pending) {
			this.ctx.transport.sendError(msg, -32602, "Unknown requestState");
			return;
		}
		if (pending.name !== name) {
			this.ctx.transport.sendError(msg, -32602, "requestState does not match requested tool");
			return;
		}
		const inputResponse = inputResponses[pending.requestId];
		if (!inputResponse) {
			this.ctx.transport.sendError(
				msg,
				-32602,
				`Missing input response for request "${pending.requestId}"`,
			);
			return;
		}
		this.pendingInputRequests.delete(requestState);
		const tool = this.getExposedTools().find((t) => t.name === name) ?? null;
		this.sendToolExecutionResult(
			msg,
			tool,
			confirmToolResultFromInputResponse(pending.args, inputResponse),
		);
	}

	private sendToolExecutionResult(
		msg: JsonRpcRequest,
		tool: KotaTool | null,
		result: ToolResult,
	): void {
		const outputSchemaError = tool ? validateToolStructuredOutput(tool, result) : null;
		if (outputSchemaError) {
			this.ctx.transport.sendError(msg, -32603, outputSchemaError);
			return;
		}
		this.ctx.transport.sendResult(
			msg,
			toolResultToMcpCallResult(result, this.ctx.session.protocolVersion),
		);
	}

	private async handleConfirmViaElicitation(
		msg: JsonRpcRequest,
		args: ToolRunnerInput,
	): Promise<void> {
		const action = readConfirmAction(args);
		const risk = readConfirmRisk(args);
		const timeoutSec =
			typeof args.timeout === "number"
				? args.timeout
				: { low: 60, medium: 300, high: 600 }[risk] ?? 300;
		let elicitResult: Awaited<ReturnType<ElicitationHandler["request"]>> | null;
		try {
			elicitResult = await this.elicitation.request(
				buildConfirmElicitationMessage(args),
				{
					type: "object",
					properties: { confirmed: { type: "boolean", title: "Approve?" } },
				},
				timeoutSec * 1000,
			);
		} catch {
			elicitResult = null;
		}
		let text: string;
		if (!elicitResult || elicitResult.action === "cancel") {
			text = `REJECTED: ${action}\nReason: Timed out or cancelled`;
		} else if (elicitResult.action === "reject") {
			text = `REJECTED: ${action}`;
		} else {
			const approved = elicitResult.content.confirmed === true;
			text = approved ? `APPROVED: ${action}` : `REJECTED: ${action}`;
		}
		const tool = this.getExposedTools().find((t) => t.name === "confirm") ?? null;
		this.sendToolExecutionResult(msg, tool, { content: text });
	}
}

/** Convert a neutral KotaTool to MCP tool format. */
export function kotaToolToMcp(tool: KotaTool): {
	name: string;
	description: string;
	inputSchema: KotaTool["input_schema"];
	outputSchema?: NonNullable<KotaTool["output_schema"]>;
} {
	return {
		name: tool.name,
		description: tool.description,
		inputSchema: tool.input_schema,
		...(tool.output_schema ? { outputSchema: tool.output_schema } : {}),
	};
}

function validateToolStructuredOutput(tool: KotaTool, result: ToolResult): string | null {
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

export function toolResultToMcpCallResult(
	result: ToolResult,
	protocolVersion: McpProtocolVersion,
): McpToolResult | McpLegacyToolResult {
	if (usesDraftToolResults(protocolVersion)) return toolResultToMcpCompleteResult(result);
	return toolResultToMcpLegacyResult(result);
}

export function toolResultToMcpCompleteResult(result: ToolResult): McpToolCompleteResult {
	return {
		resultType: "complete",
		content: toolResultToMcp(result),
		...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
		...(result._meta ? { _meta: result._meta } : {}),
		isError: result.is_error === true,
	};
}

/** Convert KOTA ToolResult to MCP content blocks. */
export function toolResultToMcp(result: ToolResult): McpContentBlock[] {
	if (result.blocks?.length) {
		return result.blocks.map((block) => {
			if (block.type === "image") {
				return {
					type: "image" as const,
					data: block.source.data,
					mimeType: block.source.media_type,
					...(block.annotations ? { annotations: block.annotations } : {}),
					...(block._meta ? { _meta: block._meta } : {}),
				};
			}
			if (block.type === "mcp_content") {
				return block.content;
			}
			return {
				type: "text" as const,
				text: block.text,
				...(block.annotations ? { annotations: block.annotations } : {}),
				...(block._meta ? { _meta: block._meta } : {}),
			};
		});
	}
	return [{ type: "text", text: result.content }];
}

function toolResultToMcpLegacyResult(result: ToolResult): McpLegacyToolResult {
	return {
		content: toolResultToMcp(result),
		...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
		...(result._meta ? { _meta: result._meta } : {}),
		...(result.is_error && { isError: true }),
	};
}

function usesDraftToolResults(protocolVersion: McpProtocolVersion): boolean {
	return protocolVersion === MCP_DRAFT_PROTOCOL_VERSION;
}

function readToolArguments(value: RequestParamValue): ToolRunnerInput {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return value as ToolRunnerInput;
}

function decodeRetryParams(params: NonNullable<JsonRpcRequest["params"]>): RetryParams {
	const hasInputResponses = "inputResponses" in params;
	const hasRequestState = "requestState" in params;
	if (!hasInputResponses && !hasRequestState) return { kind: "none" };
	if (!hasInputResponses || !hasRequestState) {
		return {
			kind: "invalid",
			message: "Retry calls must include both inputResponses and requestState",
		};
	}
	if (typeof params.requestState !== "string" || params.requestState.length === 0) {
		return { kind: "invalid", message: "requestState must be a non-empty string" };
	}
	const inputResponses = decodeInputResponses(params.inputResponses);
	if (typeof inputResponses === "string") {
		return { kind: "invalid", message: inputResponses };
	}
	return {
		kind: "retry",
		requestState: params.requestState,
		inputResponses,
	};
}

function decodeInputResponses(value: RequestParamValue): McpToolInputResponses | string {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return "inputResponses must be an object";
	}
	const inputResponses = value as McpToolInputResponses;
	for (const [requestId, response] of Object.entries(inputResponses)) {
		if (!response || typeof response !== "object" || Array.isArray(response)) {
			return `inputResponses.${requestId} must be an object`;
		}
		if (
			response.action !== "accept" &&
			response.action !== "reject" &&
			response.action !== "cancel"
		) {
			return `inputResponses.${requestId}.action must be accept, reject, or cancel`;
		}
		if (
			response.action === "accept" &&
			(!response.content || typeof response.content !== "object" || Array.isArray(response.content))
		) {
			return `inputResponses.${requestId}.content must be an object when action is accept`;
		}
	}
	return inputResponses;
}

function buildConfirmElicitationMessage(args: ToolRunnerInput): string {
	const action = readConfirmAction(args);
	const details = typeof args.details === "string" ? args.details : undefined;
	const risk = readConfirmRisk(args);
	return `Approve this action? [${risk.toUpperCase()} risk]\n${action}${details ? `\n\nDetails: ${details}` : ""}`;
}

function confirmToolResultFromInputResponse(
	args: ToolRunnerInput,
	response: ElicitationResponse,
): ToolResult {
	const action = readConfirmAction(args);
	if (response.action === "cancel") {
		return { content: `REJECTED: ${action}\nReason: Timed out or cancelled` };
	}
	if (response.action === "reject") {
		return { content: `REJECTED: ${action}` };
	}
	const approved = response.content.confirmed === true;
	return { content: approved ? `APPROVED: ${action}` : `REJECTED: ${action}` };
}

function readConfirmAction(args: ToolRunnerInput): string {
	return typeof args.action === "string" ? args.action : "";
}

function readConfirmRisk(args: ToolRunnerInput): string {
	return typeof args.risk === "string" ? args.risk : "medium";
}
