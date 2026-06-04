/**
 * MCP `sampling/createMessage` handler. Forwards the request to the
 * configured model client, writes a synthetic run-artifact entry for cost
 * tracking, and returns the assistant turn in MCP wire shape.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	KotaMessage,
	KotaModelResponse,
} from "#core/agent-harness/message-protocol.js";
import { CostTracker } from "#core/loop/cost.js";
import type { MessageCreateParams, ModelClient } from "#core/model/model-client.js";
import type { HandlerContext, JsonRpcRequest } from "./mcp-protocol-types.js";
import {
	activeMcpProtocolVersion,
	MCP_LEGACY_PROTOCOL_VERSION,
} from "./mcp-protocol-types.js";

export type SamplingOptions = {
	enabled: boolean;
	modelClient: ModelClient | null;
	samplingModel: string;
	projectDir: string;
};

export class SamplingHandler {
	constructor(
		private readonly ctx: HandlerContext,
		private readonly options: SamplingOptions,
	) {}

	/** True when the server should advertise the `sampling` capability. */
	isAvailable(): boolean {
		return this.options.enabled && this.options.modelClient !== null;
	}

	async handleCreateMessage(msg: JsonRpcRequest): Promise<void> {
		if (
			!this.ctx.session.initialized ||
			activeMcpProtocolVersion(this.ctx) !== MCP_LEGACY_PROTOCOL_VERSION
		) {
			this.ctx.transport.sendError(msg, -32601, "Method not found: sampling/createMessage");
			return;
		}
		if (!this.options.enabled || !this.options.modelClient) {
			this.ctx.transport.sendError(msg, -32601, "Sampling capability not enabled");
			return;
		}

		const params = (msg.params ?? {}) as Record<string, unknown>;
		const rawMessages = params.messages as
			| Array<{
					role: string;
					content: { type: string; text?: string; data?: string; mimeType?: string };
			  }>
			| undefined;
		if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
			this.ctx.transport.sendError(msg, -32602, "Missing required parameter: messages");
			return;
		}

		const maxTokens =
			typeof params.maxTokens === "number" && params.maxTokens > 0 ? params.maxTokens : 1024;
		const systemPrompt = typeof params.systemPrompt === "string" ? params.systemPrompt : undefined;

		// Convert MCP message format to Anthropic format
		const messages: KotaMessage[] = rawMessages.map((m) => {
			const role = m.role === "assistant" ? "assistant" : "user";
			const content: string =
				m.content.type === "text" && m.content.text != null ? m.content.text : "";
			return { role, content };
		});

		const callParams: MessageCreateParams = {
			model: this.options.samplingModel,
			max_tokens: maxTokens,
			messages,
			...(systemPrompt && { system: systemPrompt }),
		};

		let response: KotaModelResponse;
		try {
			response = await this.options.modelClient.messages.create(callParams);
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			this.ctx.transport.sendError(msg, -32603, `Model call failed: ${errMsg}`);
			return;
		}

		this.writeSamplingRunArtifact(response.usage, response.model);

		const textBlock = response.content.find((b) => b.type === "text");
		const text = textBlock && "text" in textBlock ? textBlock.text : "";

		const stopReason =
			response.stop_reason === "end_turn"
				? "endTurn"
				: response.stop_reason === "max_tokens"
					? "maxTokens"
					: (response.stop_reason ?? "endTurn");

		this.ctx.transport.sendResult(msg, {
			role: "assistant",
			content: { type: "text", text },
			model: response.model,
			stopReason,
		});
	}

	private writeSamplingRunArtifact(
		usage: { input_tokens: number; output_tokens: number },
		model: string,
	): void {
		try {
			const stamp = new Date().toISOString().replace(/[:.]/g, "-");
			const suffix = Math.random().toString(36).slice(2, 8);
			const runId = `${stamp}-mcp-sampling-${suffix}`;
			const runDir = join(this.options.projectDir, ".kota", "runs", runId);

			let costUsd = 0;
			try {
				const tracker = new CostTracker();
				tracker.addUsage(model, {
					input_tokens: usage.input_tokens,
					output_tokens: usage.output_tokens,
				});
				costUsd = tracker.getTotalCost();
			} catch {
				this.ctx.log("Warning: failed to calculate sampling cost");
			}

			const now = new Date().toISOString();
			const metadata = {
				id: runId,
				workflow: "mcp-sampling",
				definitionPath: "",
				trigger: { event: "mcp.sampling", schemaRef: null, payload: {} },
				startedAt: now,
				completedAt: now,
				durationMs: 0,
				status: "success",
				runDir,
				steps: [],
				totalCostUsd: costUsd,
			};

			mkdirSync(runDir, { recursive: true });
			writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2));
		} catch {
			// Non-fatal: cost tracking failure should not break the sampling response
			this.ctx.log("Warning: failed to write sampling run artifact");
		}
	}
}
