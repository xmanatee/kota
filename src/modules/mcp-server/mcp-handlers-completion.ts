/**
 * MCP `completion/complete` handler. Provides argument-value autocompletion
 * for the KOTA prompts that have a finite, discoverable value space (workflow
 * names, recent run ids).
 */

import { loadConfig } from "#core/config/config.js";
import { loadModuleMetadata } from "#core/modules/module-metadata.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { HandlerContext, JsonRpcRequest } from "./mcp-protocol-types.js";

export class CompletionHandler {
	constructor(
		private readonly ctx: HandlerContext,
		private readonly projectDir: string,
	) {}

	async handleComplete(msg: JsonRpcRequest): Promise<void> {
		if (!this.ctx.session.initialized) {
			this.ctx.transport.sendError(msg, -32002, "Server not initialized");
			return;
		}
		const params = (msg.params ?? {}) as Record<string, unknown>;
		const ref = params.ref as { type?: string; name?: string } | undefined;
		const argument = params.argument as { name?: string; value?: string } | undefined;

		if (!ref || !argument) {
			this.ctx.transport.sendResult(msg, { completion: { values: [], hasMore: false } });
			return;
		}

		const argName = argument.name ?? "";
		const partial = (argument.value ?? "").toLowerCase();
		let values: string[] = [];

		if (ref.type === "ref/prompt") {
			const promptName = ref.name ?? "";
			if (promptName === "kota-trigger-workflow" && argName === "workflow") {
				const loader = await loadModuleMetadata(
					loadConfig(this.projectDir),
					this.projectDir,
					false,
				);
				const defs = loader.getContributedWorkflows();
				values = defs.map((d) => d.name).filter((n) => n.toLowerCase().startsWith(partial));
			} else if (promptName === "kota-summarize-run" && argName === "run_id") {
				try {
					const store = new WorkflowRunStore(this.projectDir);
					const runs = store.listRuns({ limit: 20 });
					values = runs.map((r) => r.id).filter((id) => id.toLowerCase().startsWith(partial));
				} catch {
					values = [];
				}
			}
		}

		this.ctx.transport.sendResult(msg, { completion: { values, hasMore: false } });
	}
}
