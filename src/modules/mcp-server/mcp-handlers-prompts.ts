/**
 * MCP `prompts/{list,get}` handlers. Prompt definitions and rendering live
 * in `prompts.ts`; this file is the JSON-RPC surface around them.
 */

import type { HandlerContext, JsonRpcRequest } from "./mcp-protocol-types.js";
import { isKnownPrompt, KOTA_PROMPTS, renderPrompt } from "./prompts.js";

export class PromptsHandler {
	constructor(private readonly ctx: HandlerContext) {}

	handleList(msg: JsonRpcRequest): void {
		if (!this.ctx.session.initialized) {
			this.ctx.transport.sendError(msg, -32002, "Server not initialized");
			return;
		}
		this.ctx.transport.sendResult(msg, { prompts: KOTA_PROMPTS });
	}

	handleGet(msg: JsonRpcRequest): void {
		if (!this.ctx.session.initialized) {
			this.ctx.transport.sendError(msg, -32002, "Server not initialized");
			return;
		}
		const params = msg.params ?? {};
		const name = params.name as string | undefined;
		if (!name || typeof name !== "string") {
			this.ctx.transport.sendError(msg, -32602, "Missing required parameter: name");
			return;
		}
		if (!isKnownPrompt(name)) {
			this.ctx.transport.sendError(msg, -32602, `Unknown prompt: ${name}`);
			return;
		}
		const args = (params.arguments ?? {}) as Record<string, string>;
		const result = renderPrompt(name, args);
		this.ctx.transport.sendResult(msg, result);
	}
}
