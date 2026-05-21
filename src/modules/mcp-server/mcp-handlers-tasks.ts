/**
 * MCP `tasks/{get,result,list,cancel}` handlers over the module-local task
 * lifecycle store.
 */

import type {
	KotaJsonObject,
	KotaJsonValue,
} from "#core/agent-harness/message-protocol.js";
import type {
	HandlerContext,
	JsonRpcErrorObject,
	JsonRpcOutboundPayload,
	JsonRpcRequest,
	McpTaskResultSettlement,
} from "./mcp-protocol-types.js";
import {
	hasActiveMcpContext,
	MCP_RELATED_TASK_META_KEY,
} from "./mcp-protocol-types.js";
import type { McpTaskStore } from "./mcp-task-store.js";

type TaskIdParams = {
	taskId: string;
};

type ListParams = {
	cursor?: string;
	limit?: number;
};

type DecodeResult<T> =
	| { ok: true; params: T }
	| { ok: false; message: string };

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
	operation: "retrieve" | "cancel" | "list",
): JsonRpcErrorObject {
	if (message.includes("expired")) {
		return { code: -32602, message: `Failed to ${operation} task: Task has expired` };
	}
	if (message.includes("not found")) {
		return { code: -32602, message: `Failed to ${operation} task: Task not found` };
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

export class TasksHandler {
	constructor(
		private readonly ctx: HandlerContext,
		private readonly store: McpTaskStore,
	) {}

	handleGet(msg: JsonRpcRequest): void {
		if (!this.assertActive(msg)) return;
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
		if (!this.assertActive(msg)) return;
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
		if (!this.assertActive(msg)) return;
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
		if (!this.assertActive(msg)) return;
		const decoded = decodeTaskIdParams(msg.params);
		if (!decoded.ok) {
			this.ctx.transport.sendError(msg, -32602, decoded.message);
			return;
		}
		try {
			this.ctx.transport.sendResult(
				msg,
				this.store.cancel(decoded.params.taskId, {
					statusMessage: "The task was cancelled by request.",
				}),
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.sendTaskError(msg, taskProtocolError(message, "cancel"));
		}
	}

	private assertActive(msg: JsonRpcRequest): boolean {
		if (hasActiveMcpContext(this.ctx)) return true;
		this.ctx.transport.sendError(msg, -32002, "Server not initialized");
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
