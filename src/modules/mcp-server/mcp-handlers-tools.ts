/**
 * MCP `tools/list` and `tools/call` handlers plus the small adapters that
 * convert KOTA's neutral tool shape and tool-result shape into the MCP wire
 * representation.
 */

import type { KotaJsonValue, KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolDef } from "#core/modules/module-types.js";
import { getToolMcpAnnotations } from "#core/tools/guardrails-classify.js";
import { executeTool, getAllTools, type ToolResult } from "#core/tools/index.js";
import { validateToolStructuredOutput } from "#core/tools/output-schema.js";
import type { ElicitationHandler } from "./mcp-handlers-elicitation.js";
import {
	decodeMrtrRetryParams,
	type McpMrtrStateCodec,
	readElicitationInputResponse,
} from "./mcp-mrtr.js";
import type {
	ElicitationResponse,
	HandlerContext,
	JsonRpcErrorObject,
	JsonRpcOutboundPayload,
	JsonRpcRequest,
	McpContentBlock,
	McpCreateTaskResult,
	McpProtocolVersion,
	McpToolCompleteResult,
	McpToolInputRequiredResult,
	McpToolInputResponses,
	McpToolResult,
} from "./mcp-protocol-types.js";
import {
	activeClientSupportsElicitation,
	activeMcpProtocolVersion,
	hasActiveMcpContext,
	MCP_DRAFT_PROTOCOL_VERSION,
	MCP_RELATED_TASK_META_KEY,
} from "./mcp-protocol-types.js";
import type { McpTaskStore } from "./mcp-task-store.js";

type ToolRunnerInput = Parameters<ToolDef["runner"]>[0];
type RequestParamValue = NonNullable<JsonRpcRequest["params"]>[string];

type McpLegacyToolResult = {
	content: McpContentBlock[];
	structuredContent?: ToolResult["structuredContent"];
	_meta?: ToolResult["_meta"];
	isError?: true;
};

type McpToolTaskSupport = "required" | "optional" | "forbidden";

type ToolCallTaskAugmentation =
	| { kind: "none" }
	| { kind: "invalid"; message: string }
	| { kind: "task"; requestedTtlMs?: number };

type ToolCallOutcome =
	| {
			kind: "result";
			result: McpToolResult | McpLegacyToolResult;
			failed: boolean;
		}
	| {
			kind: "jsonrpc_error";
			error: JsonRpcErrorObject;
		};

export type TaskInputResumePreparation =
	| { ok: true; run: () => void }
	| { ok: false; message: string };

export class ToolsHandler {
	private readonly toolFilter: Set<string> | null;
	private readonly moduleRunners = new Map<string, ToolDef["runner"]>();
	private readonly moduleToolList: KotaTool[] = [];
	private readonly taskContinuations = new Map<string, JsonRpcRequest>();

	constructor(
		private readonly ctx: HandlerContext,
		private readonly elicitation: ElicitationHandler,
		private readonly mrtr: McpMrtrStateCodec,
		private readonly taskStore: McpTaskStore,
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
		if (!hasActiveMcpContext(this.ctx)) {
			this.ctx.transport.sendError(msg, -32002, "Server not initialized");
			return;
		}

		const taskSupport = usesDraftToolResults(activeMcpProtocolVersion(this.ctx))
			? "optional"
			: undefined;
		const tools = this.getExposedTools().map((t) => {
			const mcp = kotaToolToMcp(t, { taskSupport });
			const annotations = getToolMcpAnnotations(t.name);
			return annotations ? { ...mcp, annotations } : mcp;
		});
		this.ctx.transport.sendResult(msg, { tools });
	}

	async handleCall(msg: JsonRpcRequest): Promise<void> {
		if (!hasActiveMcpContext(this.ctx)) {
			this.ctx.transport.sendError(msg, -32002, "Server not initialized");
			return;
		}

		const params = msg.params ?? {};
		const taskAugmentation = usesDraftToolResults(activeMcpProtocolVersion(this.ctx))
			? decodeToolCallTaskAugmentation(params.task)
			: { kind: "none" as const };
		if (taskAugmentation.kind === "invalid") {
			this.ctx.transport.sendError(msg, -32602, taskAugmentation.message);
			return;
		}
		if (taskAugmentation.kind === "task") {
			this.handleTaskAugmentedCall(msg, taskAugmentation);
			return;
		}

		this.sendToolCallOutcome(msg, await this.executeToolCall(msg, { progress: true }));
	}

	private handleTaskAugmentedCall(
		msg: JsonRpcRequest,
		taskAugmentation: Extract<ToolCallTaskAugmentation, { kind: "task" }>,
	): void {
		const created = this.taskStore.create({
			...(taskAugmentation.requestedTtlMs !== undefined && {
				requestedTtlMs: taskAugmentation.requestedTtlMs,
			}),
			statusMessage: "The operation is now in progress.",
		});
		this.taskContinuations.set(created.task.taskId, msg);
		this.ctx.transport.sendResult(msg, createTaskResultWithRelatedTaskMeta(created));
		setImmediate(() => {
			this.executeTaskAugmentedToolCall(msg, created.task.taskId).catch((err) => {
				const message = err instanceof Error ? err.message : String(err);
				this.settleTaskWithJsonRpcError(created.task.taskId, {
					code: -32603,
					message: `Internal tool task error: ${message}`,
				});
			});
		});
	}

	prepareTaskInputResponse(args: {
		taskId: string;
		inputResponses: McpToolInputResponses;
		requestState: string;
		inputRequestIds: string[];
	}): TaskInputResumePreparation {
		const original = this.taskContinuations.get(args.taskId);
		if (!original) {
			return {
				ok: false,
				message: "Task input cannot be resumed: original request state is unavailable",
			};
		}
		const retryMsg: JsonRpcRequest = {
			...original,
			params: {
				...(original.params ?? {}),
				inputResponses: args.inputResponses,
				requestState: args.requestState,
			},
		};
		const verified = this.mrtr.verify(args.requestState, retryMsg, args.inputRequestIds);
		if (!verified.ok) return { ok: false, message: verified.message };
		for (const inputRequestId of verified.inputRequestIds) {
			if (!Object.hasOwn(args.inputResponses, inputRequestId)) {
				return {
					ok: false,
					message: `Missing input response for request "${inputRequestId}"`,
				};
			}
		}
		return {
			ok: true,
			run: () => {
				setImmediate(() => {
					this.executeTaskAugmentedToolCall(retryMsg, args.taskId).catch((err) => {
						const message = err instanceof Error ? err.message : String(err);
						this.settleTaskWithJsonRpcError(args.taskId, {
							code: -32603,
							message: `Internal tool task error: ${message}`,
						});
					});
				});
			},
		};
	}

	private async executeTaskAugmentedToolCall(
		msg: JsonRpcRequest,
		taskId: string,
	): Promise<void> {
		const outcome = await this.executeToolCall(msg, { progress: false });
		this.settleToolTask(taskId, outcome);
	}

	private async executeToolCall(
		msg: JsonRpcRequest,
		options: { progress: boolean },
	): Promise<ToolCallOutcome> {
		const params = msg.params ?? {};
		const name = params.name;
		const args = readToolArguments(params.arguments);

		if (!name || typeof name !== "string") {
			return jsonRpcError(-32602, "Missing required parameter: name");
		}

		const exposed = this.getExposedTools();
		const tool = exposed.find((t) => t.name === name) ?? null;
		if (!tool) {
			return jsonRpcError(-32602, `Unknown tool: ${name}`);
		}

		const retry = decodeMrtrRetryParams(params);
		if (retry.kind === "invalid") {
			return jsonRpcError(-32602, retry.message);
		}
		if (retry.kind === "retry") {
			return this.inputRequiredRetryOutcome(msg, name, retry.requestState, retry.inputResponses);
		}

		this.ctx.log(`Calling tool: ${name}`);
		if (options.progress) {
			this.ctx.sendProgress(0, {
				total: 1,
				message: `Calling tool: ${name}`,
			});
		}

		if (name === "confirm" && usesDraftToolResults(activeMcpProtocolVersion(this.ctx))) {
			return this.confirmInputRequiredOutcome(msg, args);
		}

		let result: ToolResult;
		if (name === "confirm" && activeClientSupportsElicitation(this.ctx, "form")) {
			result = await this.confirmViaElicitationResult(args);
		} else {
			result = await this.runTool(name, args);
		}

		const outcome = this.toolResultOutcome(tool, result);
		if (
			options.progress &&
			outcome.kind === "result" &&
			!isInputRequiredResult(outcome.result)
		) {
			this.ctx.sendProgress(1, {
				total: 1,
				message: "Tool call complete",
			});
		}
		return outcome;
	}

	private confirmInputRequiredOutcome(
		msg: JsonRpcRequest,
		args: ToolRunnerInput,
	): ToolCallOutcome {
		if (!activeClientSupportsElicitation(this.ctx, "form")) {
			return jsonRpcError(-32602, "Client does not support form elicitation");
		}
		const result: McpToolInputRequiredResult = this.mrtr.createInputRequiredResult(
			msg,
			{
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
		);
		return { kind: "result", result, failed: false };
	}

	private inputRequiredRetryOutcome(
		msg: JsonRpcRequest,
		name: string,
		requestState: string,
		inputResponses: McpToolInputResponses,
	): ToolCallOutcome {
		if (!usesDraftToolResults(activeMcpProtocolVersion(this.ctx))) {
			return jsonRpcError(
				-32602,
				"inputResponses are only supported by the draft tool result protocol",
			);
		}
		if (!activeClientSupportsElicitation(this.ctx, "form")) {
			return jsonRpcError(-32602, "Client does not support form elicitation");
		}
		const verified = this.mrtr.verify(requestState, msg, ["confirm"]);
		if (!verified.ok) {
			return jsonRpcError(-32602, verified.message);
		}
		if (name !== "confirm") {
			return jsonRpcError(-32602, "requestState does not match requested tool");
		}
		const inputResponse = readElicitationInputResponse(inputResponses, "confirm", "form");
		if (typeof inputResponse === "string") {
			return jsonRpcError(-32602, inputResponse);
		}
		const tool = this.getExposedTools().find((t) => t.name === name) ?? null;
		return this.toolResultOutcome(
			tool,
			confirmToolResultFromInputResponse(readToolArguments(msg.params?.arguments ?? {}), inputResponse),
		);
	}

	private sendToolCallOutcome(msg: JsonRpcRequest, outcome: ToolCallOutcome): void {
		if (outcome.kind === "jsonrpc_error") {
			this.ctx.transport.sendError(
				msg,
				outcome.error.code,
				outcome.error.message,
				outcome.error.data,
			);
			return;
		}
		this.ctx.transport.sendResult(msg, outcome.result as JsonRpcOutboundPayload);
	}

	private settleToolTask(taskId: string, outcome: ToolCallOutcome): void {
		if (outcome.kind === "jsonrpc_error") {
			this.settleTaskWithJsonRpcError(taskId, outcome.error);
			return;
		}
		if (isInputRequiredResult(outcome.result)) {
			this.settleTaskInputRequired(taskId, outcome.result);
			return;
		}
		if (outcome.failed) {
			this.settleTaskWithFailedResult(taskId, outcome.result);
			return;
		}
		this.settleTaskCompleted(taskId, outcome.result);
	}

	private settleTaskCompleted(taskId: string, result: KotaJsonValue): void {
		try {
			this.taskStore.complete(taskId, result, { statusMessage: "Tool call complete" });
			this.taskContinuations.delete(taskId);
		} catch (err) {
			this.logUnexpectedTaskSettlementError(taskId, err);
		}
	}

	private settleTaskWithFailedResult(taskId: string, result: KotaJsonValue): void {
		try {
			this.taskStore.failWithResult(taskId, result, {
				statusMessage: "Tool execution failed",
			});
			this.taskContinuations.delete(taskId);
		} catch (err) {
			this.logUnexpectedTaskSettlementError(taskId, err);
		}
	}

	private settleTaskWithJsonRpcError(taskId: string, error: JsonRpcErrorObject): void {
		try {
			this.taskStore.fail(taskId, error, { statusMessage: error.message });
			this.taskContinuations.delete(taskId);
		} catch (err) {
			this.logUnexpectedTaskSettlementError(taskId, err);
		}
	}

	forgetTaskContinuation(taskId: string): void {
		this.taskContinuations.delete(taskId);
	}

	private settleTaskInputRequired(
		taskId: string,
		inputRequired: McpToolInputRequiredResult,
	): void {
		try {
			this.taskStore.transition(taskId, {
				status: "input_required",
				inputRequired,
				statusMessage: "Tool call requires input.",
			});
		} catch (err) {
			this.logUnexpectedTaskSettlementError(taskId, err);
		}
	}

	private logUnexpectedTaskSettlementError(taskId: string, err: unknown): void {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes("from terminal state")) return;
		this.ctx.log(`Failed to settle MCP tool task ${taskId}: ${message}`);
	}

	private async runTool(name: string, args: ToolRunnerInput): Promise<ToolResult> {
		const extRunner = this.moduleRunners.get(name);
		if (!extRunner) return executeTool(name, args);
		try {
			return await extRunner(args);
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			return { content: `Tool error: ${errMsg}`, is_error: true };
		}
	}

	private toolResultOutcome(tool: KotaTool | null, result: ToolResult): ToolCallOutcome {
		const outputSchemaError = tool ? validateToolStructuredOutput(tool, result) : null;
		if (outputSchemaError) {
			return jsonRpcError(-32603, outputSchemaError);
		}
		return {
			kind: "result",
			result: toolResultToMcpCallResult(result, activeMcpProtocolVersion(this.ctx)),
			failed: result.is_error === true,
		};
	}

	private async confirmViaElicitationResult(
		args: ToolRunnerInput,
	): Promise<ToolResult> {
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
		} else if (elicitResult.action === "decline") {
			text = `REJECTED: ${action}`;
		} else {
			const approved = elicitResult.content?.confirmed === true;
			text = approved ? `APPROVED: ${action}` : `REJECTED: ${action}`;
		}
		return { content: text };
	}
}

function jsonRpcError(
	code: number,
	message: string,
	data?: KotaJsonValue,
): ToolCallOutcome {
	return {
		kind: "jsonrpc_error",
		error: {
			code,
			message,
			...(data !== undefined && { data }),
		},
	};
}

function decodeToolCallTaskAugmentation(
	value: RequestParamValue,
): ToolCallTaskAugmentation {
	if (value === undefined) return { kind: "none" };
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { kind: "invalid", message: "task must be an object" };
	}
	const ttl = value.ttl;
	if (
		ttl !== undefined &&
		(typeof ttl !== "number" || !Number.isSafeInteger(ttl) || ttl <= 0)
	) {
		return { kind: "invalid", message: "task.ttl must be a positive integer" };
	}
	return {
		kind: "task",
		...(ttl !== undefined && { requestedTtlMs: ttl }),
	};
}

function createTaskResultWithRelatedTaskMeta(
	created: McpCreateTaskResult,
): McpCreateTaskResult {
	const existingMeta = created._meta ?? {};
	return {
		...created,
		_meta: {
			...existingMeta,
			[MCP_RELATED_TASK_META_KEY]: { taskId: created.task.taskId },
		},
	};
}

function isInputRequiredResult(
	result: McpToolResult | McpLegacyToolResult,
): result is McpToolInputRequiredResult {
	return "resultType" in result && result.resultType === "input_required";
}

/** Convert a neutral KotaTool to MCP tool format. */
export function kotaToolToMcp(tool: KotaTool, options: { taskSupport?: McpToolTaskSupport } = {}): {
	name: string;
	description: string;
	inputSchema: KotaTool["input_schema"];
	outputSchema?: NonNullable<KotaTool["output_schema"]>;
	execution?: { taskSupport: McpToolTaskSupport };
} {
	return {
		name: tool.name,
		description: tool.description,
		inputSchema: tool.input_schema,
		...(tool.output_schema ? { outputSchema: tool.output_schema } : {}),
		...(options.taskSupport ? { execution: { taskSupport: options.taskSupport } } : {}),
	};
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
	if (response.action === "decline") {
		return { content: `REJECTED: ${action}` };
	}
	const approved = response.content?.confirmed === true;
	return { content: approved ? `APPROVED: ${action}` : `REJECTED: ${action}` };
}

function readConfirmAction(args: ToolRunnerInput): string {
	return typeof args.action === "string" ? args.action : "";
}

function readConfirmRisk(args: ToolRunnerInput): string {
	return typeof args.risk === "string" ? args.risk : "medium";
}
