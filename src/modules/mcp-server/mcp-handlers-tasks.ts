/**
 * MCP `tasks/{get,update,cancel}` handlers over the module-local task
 * lifecycle store.
 */

import type {
	KotaJsonObject,
	KotaJsonValue,
} from "#core/agent-harness/message-protocol.js";
import { decodeMrtrInputResponses } from "./mcp-mrtr.js";
import type {
	HandlerContext,
	JsonRpcErrorObject,
	JsonRpcOutboundPayload,
	JsonRpcRequest,
	McpInputResponses,
	McpTask,
	McpTaskResultSettlement,
} from "./mcp-protocol-types.js";
import {
	activeClientSupportsLegacyDraftTasks,
	activeClientSupportsMcpTasks,
	hasActiveMcpContext,
	MCP_RELATED_TASK_META_KEY,
	MCP_TASKS_EXTENSION_ID,
} from "./mcp-protocol-types.js";
import type { McpTaskStore } from "./mcp-task-store.js";

type TaskIdParams = {
	taskId: string;
};

type InputResponseParams = {
	taskId: string;
	inputResponses: McpInputResponses;
	requestState?: string;
};

type ListParams = {
	cursor?: string;
	limit?: number;
};

type DecodeResult<T> =
	| { ok: true; params: T }
	| { ok: false; message: string };

type TaskProtocolOperation = "retrieve" | "cancel" | "list" | "input_response" | "update";

type TaskInputResumePreparation =
	| { ok: true; run: () => void }
	| { ok: false; message: string };

type TaskInputResume = (args: {
	taskId: string;
	inputResponses: McpInputResponses;
	requestState: string;
	inputRequestIds: string[];
}) => TaskInputResumePreparation;

type TasksHandlerOptions = {
	resumeInput?: TaskInputResume;
	forgetTaskContinuation?: (taskId: string) => void;
};

function isJsonObject(value: KotaJsonValue | undefined): value is KotaJsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeTaskIdParams(params: JsonRpcRequest["params"]): DecodeResult<TaskIdParams> {
	const taskId = params?.taskId;
	if (typeof taskId !== "string" || taskId.length === 0) {
		return { ok: false, message: "Missing required parameter: taskId" };
	}
	return { ok: true, params: { taskId } };
}

function decodeInputResponseParams(
	params: JsonRpcRequest["params"],
): DecodeResult<InputResponseParams> {
	const taskId = params?.taskId;
	if (typeof taskId !== "string" || taskId.length === 0) {
		return { ok: false, message: "Missing required parameter: taskId" };
	}
	const decodedInputResponses = decodeMrtrInputResponses(params?.inputResponses);
	if (!decodedInputResponses.ok) {
		return { ok: false, message: decodedInputResponses.message };
	}
	const requestState = params?.requestState;
	if (
		requestState !== undefined &&
		(typeof requestState !== "string" || requestState.length === 0)
	) {
		return { ok: false, message: "requestState must be a non-empty string" };
	}
	return {
		ok: true,
		params: {
			taskId,
			inputResponses: decodedInputResponses.inputResponses,
			...(requestState !== undefined && { requestState }),
		},
	};
}

function decodeListParams(params: JsonRpcRequest["params"]): DecodeResult<ListParams> {
	const cursor = params?.cursor;
	if (cursor !== undefined && typeof cursor !== "string") {
		return { ok: false, message: "cursor must be a string" };
	}
	const limit = params?.limit;
	if (
		limit !== undefined &&
		(typeof limit !== "number" || !Number.isSafeInteger(limit) || limit <= 0)
	) {
		return { ok: false, message: "limit must be a positive integer" };
	}
	return {
		ok: true,
		params: {
			...(cursor !== undefined && { cursor }),
			...(limit !== undefined && { limit }),
		},
	};
}

function relatedTaskMeta(taskId: string): KotaJsonObject {
	return { [MCP_RELATED_TASK_META_KEY]: { taskId } };
}

function attachRelatedTaskMeta(
	result: KotaJsonValue,
	taskId: string,
): JsonRpcOutboundPayload {
	if (!isJsonObject(result)) return result;
	const existingMeta = result._meta;
	const meta = isJsonObject(existingMeta) ? existingMeta : {};
	return {
		...result,
		_meta: {
			...meta,
			...relatedTaskMeta(taskId),
		},
	};
}

function terminalStatusFromMessage(message: string): string | null {
	const match = /from terminal state "([^"]+)"/.exec(message);
	return match?.[1] ?? null;
}

function taskProtocolError(
	message: string,
	operation: TaskProtocolOperation,
): JsonRpcErrorObject {
	if (message.includes("not waiting for input")) {
		return { code: -32602, message: "Task is not waiting for input" };
	}
	const operationPrefix = operation === "input_response"
		? "respond to task input"
		: `${operation} task`;
	if (message.includes("expired")) {
		return { code: -32602, message: `Failed to ${operationPrefix}: Task has expired` };
	}
	if (message.includes("not found")) {
		return { code: -32602, message: `Failed to ${operationPrefix}: Task not found` };
	}
	if (message.includes("Invalid MCP task cursor")) {
		return { code: -32602, message };
	}
	if (operation === "cancel") {
		const status = terminalStatusFromMessage(message);
		if (status) {
			return {
				code: -32602,
				message: `Cannot cancel task: already in terminal status '${status}'`,
			};
		}
	}
	if (message.includes("positive integer")) {
		return { code: -32602, message };
	}
	return { code: -32603, message: `Internal task error: ${message}` };
}

function filterInputResponses(
	inputResponses: McpInputResponses,
	inputRequestIds: string[],
): McpInputResponses {
	const out: McpInputResponses = {};
	for (const inputRequestId of inputRequestIds) {
		if (Object.hasOwn(inputResponses, inputRequestId)) {
			out[inputRequestId] = inputResponses[inputRequestId]!;
		}
	}
	return out;
}

function hasAllInputResponses(
	inputResponses: McpInputResponses,
	inputRequestIds: string[],
): boolean {
	return inputRequestIds.every((inputRequestId) => Object.hasOwn(inputResponses, inputRequestId));
}

function legacyTaskForDraft(task: McpTask): KotaJsonObject {
	return {
		taskId: task.taskId,
		status: task.status,
		...(task.statusMessage !== undefined && { statusMessage: task.statusMessage }),
		createdAt: task.createdAt,
		lastUpdatedAt: task.lastUpdatedAt,
		ttl: task.ttlMs,
		pollInterval: task.pollIntervalMs,
	};
}

export class TasksHandler {
	constructor(
		private readonly ctx: HandlerContext,
		private readonly store: McpTaskStore,
		private readonly options: TasksHandlerOptions = {},
	) {}

	handleGet(msg: JsonRpcRequest): void {
		if (!this.assertOfficialOrLegacyTasks(msg)) return;
		const decoded = decodeTaskIdParams(msg.params);
		if (!decoded.ok) {
			this.ctx.transport.sendError(msg, -32602, decoded.message);
			return;
		}
		try {
			this.ctx.transport.sendResult(msg, this.store.read(decoded.params.taskId));
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.sendTaskError(msg, taskProtocolError(message, "retrieve"));
		}
	}

	async handleResult(msg: JsonRpcRequest): Promise<void> {
		if (!this.assertLegacyDraftTasks(msg)) return;
		const decoded = decodeTaskIdParams(msg.params);
		if (!decoded.ok) {
			this.ctx.transport.sendError(msg, -32602, decoded.message);
			return;
		}
		try {
			this.sendTaskResultSettlement(
				msg,
				await this.store.waitForResult(decoded.params.taskId),
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.sendTaskError(msg, taskProtocolError(message, "retrieve"));
		}
	}

	handleList(msg: JsonRpcRequest): void {
		if (!this.assertLegacyDraftTasks(msg)) return;
		const decoded = decodeListParams(msg.params);
		if (!decoded.ok) {
			this.ctx.transport.sendError(msg, -32602, decoded.message);
			return;
		}
		try {
			this.ctx.transport.sendResult(msg, this.store.listPage(decoded.params));
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.sendTaskError(msg, taskProtocolError(message, "list"));
		}
	}

	handleCancel(msg: JsonRpcRequest): void {
		if (!this.assertOfficialOrLegacyTasks(msg)) return;
		const decoded = decodeTaskIdParams(msg.params);
		if (!decoded.ok) {
			this.ctx.transport.sendError(msg, -32602, decoded.message);
			return;
		}
		try {
			const cancelled = this.store.cancel(decoded.params.taskId, {
				statusMessage: "The task was cancelled by request.",
			});
			this.ctx.transport.sendResult(
				msg,
				activeClientSupportsLegacyDraftTasks(this.ctx) &&
					!activeClientSupportsMcpTasks(this.ctx)
					? legacyTaskForDraft(cancelled)
					: {},
			);
			this.options.forgetTaskContinuation?.(decoded.params.taskId);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.sendTaskError(msg, taskProtocolError(message, "cancel"));
		}
	}

	handleInputResponse(msg: JsonRpcRequest): void {
		if (!this.assertLegacyDraftTasks(msg)) return;
		this.handleInputUpdate(msg, { legacyResult: true, operation: "input_response" });
	}

	handleUpdate(msg: JsonRpcRequest): void {
		if (!this.assertOfficialTasks(msg)) return;
		this.handleInputUpdate(msg, { legacyResult: false, operation: "update" });
	}

	private handleInputUpdate(
		msg: JsonRpcRequest,
		options: { legacyResult: boolean; operation: "input_response" | "update" },
	): void {
		const decoded = decodeInputResponseParams(msg.params);
		if (!decoded.ok) {
			this.ctx.transport.sendError(msg, -32602, decoded.message);
			return;
		}
		if (!this.options.resumeInput) {
			this.ctx.transport.sendError(
				msg,
				-32602,
				"Task input cannot be resumed: original request state is unavailable",
			);
			return;
		}

		const { taskId, inputResponses } = decoded.params;
		try {
			let current: ReturnType<McpTaskStore["readInputRequired"]>;
			try {
				current = this.store.readInputRequired(taskId);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (
					options.operation === "update" &&
					message.includes("not waiting for input")
				) {
					this.ctx.transport.sendResult(msg, {});
					return;
				}
				throw err;
			}
			const storedRequestState = current.inputRequired.requestState;
			if (typeof storedRequestState !== "string" || storedRequestState.length === 0) {
				this.ctx.transport.sendError(
					msg,
					-32602,
					"Task input request is missing requestState",
				);
				return;
			}
			if (
				decoded.params.requestState !== undefined &&
				decoded.params.requestState !== storedRequestState
			) {
				this.ctx.transport.sendError(msg, -32602, "Stale requestState for task input");
				return;
			}
			const inputRequestIds = Object.keys(current.inputRequired.inputRequests ?? {});
			const recognizedInputResponses = filterInputResponses(inputResponses, inputRequestIds);
			if (
				options.operation === "update" &&
				(inputRequestIds.length === 0 ||
					!hasAllInputResponses(recognizedInputResponses, inputRequestIds))
			) {
				this.ctx.transport.sendResult(msg, {});
				return;
			}
			const resume = this.options.resumeInput({
				taskId,
				inputResponses: recognizedInputResponses,
				requestState: decoded.params.requestState ?? storedRequestState,
				inputRequestIds,
			});
			if (!resume.ok) {
				this.ctx.transport.sendError(msg, -32602, resume.message);
				return;
			}
			const working = this.store.transition(taskId, {
				status: "working",
				statusMessage: "Input received; resuming tool call.",
			});
			this.ctx.transport.sendResult(msg, options.legacyResult ? legacyTaskForDraft(working) : {});
			resume.run();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.sendTaskError(msg, taskProtocolError(message, options.operation));
		}
	}

	private assertActive(msg: JsonRpcRequest): boolean {
		if (hasActiveMcpContext(this.ctx)) return true;
		this.ctx.transport.sendError(msg, -32002, "Server not initialized");
		return false;
	}

	private assertOfficialTasks(msg: JsonRpcRequest): boolean {
		if (!this.assertActive(msg)) return false;
		if (activeClientSupportsMcpTasks(this.ctx)) return true;
		this.ctx.transport.sendError(
			msg,
			-32602,
			`MCP Tasks extension not negotiated: declare ${JSON.stringify(MCP_TASKS_EXTENSION_ID)} in client capabilities extensions`,
		);
		return false;
	}

	private assertLegacyDraftTasks(msg: JsonRpcRequest): boolean {
		if (!this.assertActive(msg)) return false;
		if (activeClientSupportsLegacyDraftTasks(this.ctx)) return true;
		this.ctx.transport.sendError(
			msg,
			-32602,
			"Deprecated MCP draft tasks utility compatibility was not negotiated",
		);
		return false;
	}

	private assertOfficialOrLegacyTasks(msg: JsonRpcRequest): boolean {
		if (!this.assertActive(msg)) return false;
		if (
			activeClientSupportsMcpTasks(this.ctx) ||
			activeClientSupportsLegacyDraftTasks(this.ctx)
		) return true;
		this.ctx.transport.sendError(
			msg,
			-32602,
			`MCP Tasks extension not negotiated: declare ${JSON.stringify(MCP_TASKS_EXTENSION_ID)} in client capabilities extensions`,
		);
		return false;
	}

	private sendTaskResultSettlement(
		msg: JsonRpcRequest,
		settlement: McpTaskResultSettlement,
	): void {
		if (settlement.kind === "input_required") {
			this.ctx.transport.sendResult(
				msg,
				attachRelatedTaskMeta(settlement.inputRequired, settlement.task.taskId),
			);
			return;
		}
		if (settlement.terminal.kind === "result") {
			this.ctx.transport.sendResult(
				msg,
				attachRelatedTaskMeta(settlement.terminal.result, settlement.task.taskId),
			);
			return;
		}
		const { code, message, data } = settlement.terminal.error;
		this.ctx.transport.sendError(msg, code, message, data);
	}

	private sendTaskError(msg: JsonRpcRequest, error: JsonRpcErrorObject): void {
		this.ctx.transport.sendError(msg, error.code, error.message, error.data);
	}
}
