/**
 * MCP `prompts/{list,get}` handlers. Prompt definitions and rendering live
 * in `prompts.ts`; this file is the JSON-RPC surface around them.
 */

import type { KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import {
	type McpMrtrStateCodec,
	resolveScopeRootFromRootsInput,
} from "./mcp-mrtr.js";
import type { HandlerContext, JsonRpcRequest } from "./mcp-protocol-types.js";
import { hasActiveMcpContext, MCP_PUBLIC_CATALOG_CACHE_HINTS } from "./mcp-protocol-types.js";
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
		private readonly resolveScopeRoot: () => string,
		private readonly mrtr: McpMrtrStateCodec,
	) {}

	handleList(msg: JsonRpcRequest): void {
		if (!hasActiveMcpContext(this.ctx)) {
			this.ctx.transport.sendError(msg, -32002, "Server not initialized");
			return;
		}
		const result = listPromptCatalogPage(
			this.resolveScopeRoot(),
			msg.params?.cursor,
		);
		if (!result.ok) {
			this.ctx.transport.sendError(msg, result.code, result.message);
			return;
		}
		this.ctx.transport.sendResult(msg, {
			...result.result,
			...MCP_PUBLIC_CATALOG_CACHE_HINTS,
		});
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
		const scopeRoot = this.resolveScopeRootForGet(msg);
		if (!scopeRoot) return;
		const result = renderPrompt(scopeRoot, name, decodedArgs.args);
		if (!result.ok) {
			this.ctx.transport.sendError(msg, result.code, result.message);
			return;
		}
		this.ctx.transport.sendResult(msg, result.result);
	}

	private resolveScopeRootForGet(msg: JsonRpcRequest): string | null {
		const resolved = resolveScopeRootFromRootsInput({
			ctx: this.ctx,
			mrtr: this.mrtr,
			msg,
			fallbackScopeRoot: this.resolveScopeRoot(),
		});
		if (resolved.kind === "ready") return resolved.scopeRoot;
		if (resolved.kind === "input_required") {
			this.ctx.transport.sendResult(msg, resolved.result);
			return null;
		}
		this.ctx.transport.sendError(msg, -32602, resolved.message);
		return null;
	}
}
