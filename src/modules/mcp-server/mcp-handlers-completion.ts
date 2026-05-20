/**
 * MCP `completion/complete` handler. Provides argument-value autocompletion
 * for the KOTA prompts that have a finite, discoverable value space (workflow
 * names, recent run ids) and validates resource references against the KOTA
 * resource catalog.
 */

import type { KotaJsonObject, KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import { loadConfig } from "#core/config/config.js";
import { loadModuleMetadata } from "#core/modules/module-metadata.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { HandlerContext, JsonRpcRequest } from "./mcp-protocol-types.js";
import { hasActiveMcpContext } from "./mcp-protocol-types.js";
import { listPromptCatalog, type McpPrompt } from "./prompts.js";
import { listKotaResources } from "./resources.js";

const COMPLETION_LIMIT = 100;
const TASK_PRIORITIES = ["p1", "p2", "p3"];

type PromptCompletionRef = {
	type: "ref/prompt";
	name: string;
};

type ResourceCompletionRef = {
	type: "ref/resource";
	uri: string;
};

type CompletionRef = PromptCompletionRef | ResourceCompletionRef;

type CompletionArgument = {
	name: string;
	value: string;
};

type DecodedCompletionRequest = {
	ref: CompletionRef;
	argument: CompletionArgument;
	contextArguments: Record<string, string>;
};

type DecodeCompletionRequestResult =
	| { ok: true; request: DecodedCompletionRequest }
	| { ok: false; message: string };

function isJsonObject(value: KotaJsonValue | undefined): value is KotaJsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeStringMap(
	value: KotaJsonValue | undefined,
	label: string,
): { ok: true; value: Record<string, string> } | { ok: false; message: string } {
	if (value === undefined) return { ok: true, value: {} };
	if (!isJsonObject(value)) return { ok: false, message: `${label} must be an object` };
	const result: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry !== "string") {
			return { ok: false, message: `${label}.${key} must be a string` };
		}
		result[key] = entry;
	}
	return { ok: true, value: result };
}

function decodeCompletionRequest(
	params: KotaJsonObject | undefined,
): DecodeCompletionRequestResult {
	const refValue = params?.ref;
	if (refValue === undefined) return { ok: false, message: "Missing required parameter: ref" };
	if (!isJsonObject(refValue)) return { ok: false, message: "ref must be an object" };
	const refType = refValue.type;
	let ref: CompletionRef;
	if (refType === "ref/prompt") {
		const name = refValue.name;
		if (typeof name !== "string" || name.length === 0) {
			return { ok: false, message: "ref.name must be a non-empty string" };
		}
		ref = { type: "ref/prompt", name };
	} else if (refType === "ref/resource") {
		const uri = refValue.uri;
		if (typeof uri !== "string" || uri.length === 0) {
			return { ok: false, message: "ref.uri must be a non-empty string" };
		}
		ref = { type: "ref/resource", uri };
	} else {
		return {
			ok: false,
			message: "ref.type must be ref/prompt or ref/resource",
		};
	}

	const argumentValue = params?.argument;
	if (argumentValue === undefined) {
		return { ok: false, message: "Missing required parameter: argument" };
	}
	if (!isJsonObject(argumentValue)) return { ok: false, message: "argument must be an object" };
	const argumentName = argumentValue.name;
	if (typeof argumentName !== "string" || argumentName.length === 0) {
		return { ok: false, message: "argument.name must be a non-empty string" };
	}
	const partialValue = argumentValue.value;
	if (typeof partialValue !== "string") {
		return { ok: false, message: "argument.value must be a string" };
	}

	const contextValue = params?.context;
	if (contextValue !== undefined && !isJsonObject(contextValue)) {
		return { ok: false, message: "context must be an object" };
	}
	const contextArguments = decodeStringMap(contextValue?.arguments, "context.arguments");
	if (!contextArguments.ok) return contextArguments;

	return {
		ok: true,
		request: {
			ref,
			argument: { name: argumentName, value: partialValue },
			contextArguments: contextArguments.value,
		},
	};
}

function filterCompletionValues(candidates: string[], partial: string): string[] {
	const normalizedPartial = partial.toLowerCase();
	return candidates.filter((candidate) =>
		candidate.toLowerCase().startsWith(normalizedPartial)
	);
}

function completionResult(values: string[]) {
	const boundedValues = values.slice(0, COMPLETION_LIMIT);
	return {
		completion: {
			values: boundedValues,
			total: values.length,
			hasMore: values.length > boundedValues.length,
		},
	};
}

function findPrompt(prompts: McpPrompt[], name: string): McpPrompt | null {
	return prompts.find((prompt) => prompt.name === name) ?? null;
}

function hasPromptArgument(prompt: McpPrompt, argumentName: string): boolean {
	return (prompt.arguments ?? []).some((argument) => argument.name === argumentName);
}

export class CompletionHandler {
	constructor(
		private readonly ctx: HandlerContext,
		private readonly resolveProjectDir: () => string,
	) {}

	async handleComplete(msg: JsonRpcRequest): Promise<void> {
		if (!hasActiveMcpContext(this.ctx)) {
			this.ctx.transport.sendError(msg, -32002, "Server not initialized");
			return;
		}
		const decoded = decodeCompletionRequest(msg.params);
		if (!decoded.ok) {
			this.ctx.transport.sendError(msg, -32602, decoded.message);
			return;
		}

		const { ref, argument } = decoded.request;
		if (ref.type === "ref/resource") {
			this.handleResourceCompletion(msg, ref, argument);
			return;
		}

		await this.handlePromptCompletion(msg, ref, argument);
	}

	private async handlePromptCompletion(
		msg: JsonRpcRequest,
		ref: PromptCompletionRef,
		argument: CompletionArgument,
	): Promise<void> {
		const projectDir = this.resolveProjectDir();
		const catalog = listPromptCatalog(projectDir);
		if (!catalog.ok) {
			this.ctx.transport.sendError(msg, catalog.code, catalog.message);
			return;
		}
		const prompt = findPrompt(catalog.result, ref.name);
		if (!prompt) {
			this.ctx.transport.sendError(msg, -32602, `Unknown prompt reference: ${ref.name}`);
			return;
		}
		if (!hasPromptArgument(prompt, argument.name)) {
			this.ctx.transport.sendError(
				msg,
				-32602,
				`Unknown prompt argument: ${ref.name}.${argument.name}`,
			);
			return;
		}

		const values = await this.completePromptArgument(projectDir, ref.name, argument);
		this.ctx.transport.sendResult(msg, completionResult(values));
	}

	private handleResourceCompletion(
		msg: JsonRpcRequest,
		ref: ResourceCompletionRef,
		_argument: CompletionArgument,
	): void {
		const knownResource = listKotaResources().some((resource) => resource.uri === ref.uri);
		if (!knownResource) {
			this.ctx.transport.sendError(msg, -32602, `Unknown resource reference: ${ref.uri}`);
			return;
		}

		this.ctx.transport.sendResult(msg, completionResult([]));
	}

	private async completePromptArgument(
		projectDir: string,
		promptName: string,
		argument: CompletionArgument,
	): Promise<string[]> {
		if (promptName === "kota-trigger-workflow" && argument.name === "workflow") {
			const loader = await loadModuleMetadata(
				loadConfig(projectDir),
				projectDir,
				false,
			);
			const defs = loader.getContributedWorkflows();
			return filterCompletionValues(defs.map((d) => d.name), argument.value);
		}
		if (promptName === "kota-summarize-run" && argument.name === "run_id") {
			const store = new WorkflowRunStore(projectDir);
			const runs = store.listRuns({ limit: 20 });
			return filterCompletionValues(runs.map((r) => r.id), argument.value);
		}
		if (promptName === "kota-create-task" && argument.name === "priority") {
			return filterCompletionValues(TASK_PRIORITIES, argument.value);
		}

		return [];
	}
}
