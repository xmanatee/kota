/**
 * MCP `tools/list` and `tools/call` handlers plus the small adapters that
 * convert KOTA's neutral tool shape and tool-result shape into the MCP wire
 * representation.
 */

import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolDef } from "#core/modules/module-types.js";
import { getToolMcpAnnotations } from "#core/tools/guardrails-classify.js";
import { executeTool, getAllTools, type ToolResult } from "#core/tools/index.js";
import type { ElicitationHandler } from "./mcp-handlers-elicitation.js";
import type {
	HandlerContext,
	JsonRpcRequest,
	McpContentBlock,
} from "./mcp-protocol-types.js";

export class ToolsHandler {
	private readonly toolFilter: Set<string> | null;
	private readonly moduleRunners = new Map<
		string,
		(input: Record<string, unknown>) => Promise<ToolResult>
	>();
	private readonly moduleToolList: KotaTool[] = [];

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
		const args = (params.arguments ?? {}) as Record<string, unknown>;

		if (!name || typeof name !== "string") {
			return this.ctx.transport.sendError(msg, -32602, "Missing required parameter: name");
		}

		const exposed = this.getExposedTools();
		if (!exposed.some((t) => t.name === name)) {
			return this.ctx.transport.sendError(msg, -32602, `Unknown tool: ${name}`);
		}

		this.ctx.log(`Calling tool: ${name}`);

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
		const content = toolResultToMcp(result);

		this.ctx.transport.sendResult(msg, {
			content,
			...(result.is_error && { isError: true }),
		});
	}

	private async handleConfirmViaElicitation(
		msg: JsonRpcRequest,
		args: Record<string, unknown>,
	): Promise<void> {
		const action = args.action as string;
		const details = args.details as string | undefined;
		const risk = (args.risk as string) ?? "medium";
		const timeoutSec =
			typeof args.timeout === "number"
				? args.timeout
				: { low: 60, medium: 300, high: 600 }[risk] ?? 300;
		const elicitMessage = `Approve this action? [${risk.toUpperCase()} risk]\n${action}${details ? `\n\nDetails: ${details}` : ""}`;
		let elicitResult: Awaited<ReturnType<ElicitationHandler["request"]>> | null;
		try {
			elicitResult = await this.elicitation.request(
				elicitMessage,
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
		this.ctx.transport.sendResult(msg, { content: [{ type: "text", text }] });
	}
}

/** Convert a neutral KotaTool to MCP tool format. */
export function kotaToolToMcp(tool: KotaTool): {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
} {
	return {
		name: tool.name,
		description: tool.description,
		inputSchema: tool.input_schema as Record<string, unknown>,
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
				};
			}
			return { type: "text" as const, text: block.text };
		});
	}
	return [{ type: "text", text: result.content }];
}
