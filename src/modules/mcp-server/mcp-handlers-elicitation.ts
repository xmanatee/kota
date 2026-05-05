/**
 * MCP elicitation handler — outbound `sampling/elicit` requests and the
 * pending-response routing for their replies. The `confirm` tool's
 * elicitation path runs through `request()` from the tools handler.
 */

import type {
	ElicitationResponse,
	ElicitationSchema,
	HandlerContext,
	JsonRpcResponse,
} from "./mcp-protocol-types.js";

type Pending = {
	resolve: (r: ElicitationResponse) => void;
	reject: (e: Error) => void;
};

export class ElicitationHandler {
	private readonly pending = new Map<number | string, Pending>();
	private idCounter = 0;

	constructor(private readonly ctx: HandlerContext) {}

	/**
	 * Send a `sampling/elicit` request to the client and await the user's
	 * response. Returns null if the client does not support elicitation.
	 * Rejects if the timeout expires before the client responds.
	 */
	async request(
		message: string,
		requestedSchema: ElicitationSchema,
		timeoutMs = 300_000,
	): Promise<ElicitationResponse | null> {
		if (!this.ctx.session.clientSupportsElicitation) return null;
		const id = `elicit-${++this.idCounter}`;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error("Elicitation timed out"));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (r) => {
					clearTimeout(timer);
					resolve(r);
				},
				reject: (e) => {
					clearTimeout(timer);
					reject(e);
				},
			});
			this.ctx.transport.send({
				jsonrpc: "2.0",
				id,
				method: "sampling/elicit",
				params: { message, requestedSchema },
			});
		});
	}

	/**
	 * Try to consume a JSON-RPC response that may belong to a pending
	 * elicitation. Returns true when the id matches one we issued.
	 */
	tryConsumeResponse(msg: JsonRpcResponse): boolean {
		const pending = this.pending.get(msg.id);
		if (!pending) return false;
		this.pending.delete(msg.id);
		if (msg.error) {
			pending.reject(new Error(msg.error.message));
			return true;
		}
		const result = msg.result as
			| { action?: string; content?: Record<string, unknown> }
			| undefined;
		const action = result?.action;
		if (action === "accept") {
			pending.resolve({ action: "accept", content: result?.content ?? {} });
		} else if (action === "reject") {
			pending.resolve({ action: "reject" });
		} else {
			pending.resolve({ action: "cancel" });
		}
		return true;
	}
}
