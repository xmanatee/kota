/**
 * MCP `prompts/{list,get}` handlers. Prompt definitions and rendering live
 * in `prompts.ts`; this file is the JSON-RPC surface around them.
 */

import type { KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import type { HandlerContext, JsonRpcRequest } from "./mcp-protocol-types.js";
import { hasActiveMcpContext } from "./mcp-protocol-types.js";
import { listPromptCatalogPage, renderPrompt } from "./prompts.js";

function decodePromptArguments(value: KotaJsonValue | undefined): {
	ok: true;
	args: Record<string, string>;
} | {
	ok: false;
	message: string;
} {
	if (value === undefined) return { ok: true, args: {} };
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { ok: false, message: "arguments must be an object" };
	}
	const args: Record<string, string> = {};
	for (const [key, argValue] of Object.entries(value)) {
		if (typeof argValue !== "string") {
			return { ok: false, message: `arguments.${key} must be a string` };
		}
		args[key] = argValue;
	}
	return { ok: true, args };
}

export class PromptsHandler {
	constructor(
		private readonly ctx: HandlerContext,
		private readonly resolveProjectDir: () => string,
	) {}

	handleList(msg: JsonRpcRequest): void {
		if (!hasActiveMcpContext(this.ctx)) {
			this.ctx.transport.sendError(msg, -32002, "Server not initialized");
			return;
		}
		const result = listPromptCatalogPage(
			this.resolveProjectDir(),
			msg.params?.cursor,
		);
		if (!result.ok) {
			this.ctx.transport.sendError(msg, result.code, result.message);
			return;
		}
		this.ctx.transport.sendResult(msg, result.result);
	}

	handleGet(msg: JsonRpcRequest): void {
		if (!hasActiveMcpContext(this.ctx)) {
			this.ctx.transport.sendError(msg, -32002, "Server not initialized");
			return;
		}
		const params = msg.params ?? {};
		const name = params.name;
		if (typeof name !== "string" || name.length === 0) {
			this.ctx.transport.sendError(msg, -32602, "Missing required parameter: name");
			return;
		}
		const decodedArgs = decodePromptArguments(params.arguments);
		if (!decodedArgs.ok) {
			this.ctx.transport.sendError(msg, -32602, decodedArgs.message);
			return;
		}
		const result = renderPrompt(this.resolveProjectDir(), name, decodedArgs.args);
		if (!result.ok) {
			this.ctx.transport.sendError(msg, result.code, result.message);
			return;
		}
		this.ctx.transport.sendResult(msg, result.result);
	}
}
