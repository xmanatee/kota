/**
 * MCP `resources/{list,read,subscribe,unsubscribe}` plus the bus listeners
 * that turn relevant `workflow.*` and `task.changed` events into outbound
 * `notifications/resources/updated` messages for subscribed URIs.
 */

import type { EventBus } from "#core/events/event-bus.js";
import { getEventBus } from "#core/events/event-bus.js";
import type { HandlerContext, JsonRpcRequest } from "./mcp-protocol-types.js";
import {
	KNOWN_RESOURCE_URIS,
	KOTA_RESOURCES,
	readKotaResource,
} from "./resources.js";

export class ResourcesHandler {
	private readonly subscriptions = new Set<string>();
	private busUnsubs: (() => void)[] = [];

	constructor(
		private readonly ctx: HandlerContext,
		private readonly eventBusOverride: EventBus | null | undefined,
		private readonly resolveProjectDir: () => string,
	) {}

	registerBusListeners(): void {
		const bus = this.eventBusOverride !== undefined ? this.eventBusOverride : getEventBus();
		if (!bus) return;

		const notifyWorkflowStatus = () => {
			if (this.subscriptions.has("kota://workflow/status")) {
				this.ctx.transport.sendNotification("notifications/resources/updated", {
					uri: "kota://workflow/status",
				});
			}
		};

		const notifyTasksReady = () => {
			if (this.subscriptions.has("kota://tasks/ready")) {
				this.ctx.transport.sendNotification("notifications/resources/updated", {
					uri: "kota://tasks/ready",
				});
			}
		};

		this.busUnsubs.push(bus.on("workflow.started", notifyWorkflowStatus));
		this.busUnsubs.push(bus.on("workflow.completed", notifyWorkflowStatus));
		this.busUnsubs.push(bus.on("task.changed", notifyTasksReady));
	}

	cleanup(): void {
		for (const unsub of this.busUnsubs) unsub();
		this.busUnsubs = [];
	}

	handleList(msg: JsonRpcRequest): void {
		if (!this.ctx.session.initialized) {
			this.ctx.transport.sendError(msg, -32002, "Server not initialized");
			return;
		}
		this.ctx.transport.sendResult(msg, { resources: KOTA_RESOURCES });
	}

	handleRead(msg: JsonRpcRequest): void {
		if (!this.ctx.session.initialized) {
			this.ctx.transport.sendError(msg, -32002, "Server not initialized");
			return;
		}
		const uri = (msg.params as Record<string, unknown> | undefined)?.uri as string | undefined;
		if (!uri || typeof uri !== "string") {
			this.ctx.transport.sendError(msg, -32602, "Missing required parameter: uri");
			return;
		}
		if (!KNOWN_RESOURCE_URIS.has(uri)) {
			this.ctx.transport.sendError(msg, -32002, `Unknown resource: ${uri}`);
			return;
		}
		const text = readKotaResource(uri, this.resolveProjectDir());
		this.ctx.transport.sendResult(msg, {
			contents: [{ uri, mimeType: "application/json", text }],
		});
	}

	handleSubscribe(msg: JsonRpcRequest): void {
		if (!this.ctx.session.initialized) {
			this.ctx.transport.sendError(msg, -32002, "Server not initialized");
			return;
		}
		const uri = (msg.params as Record<string, unknown> | undefined)?.uri as string | undefined;
		if (!uri || typeof uri !== "string") {
			this.ctx.transport.sendError(msg, -32602, "Missing required parameter: uri");
			return;
		}
		if (!KNOWN_RESOURCE_URIS.has(uri)) {
			this.ctx.transport.sendError(msg, -32002, `Unknown resource: ${uri}`);
			return;
		}
		this.subscriptions.add(uri);
		this.ctx.transport.sendResult(msg, {});
	}

	handleUnsubscribe(msg: JsonRpcRequest): void {
		if (!this.ctx.session.initialized) {
			this.ctx.transport.sendError(msg, -32002, "Server not initialized");
			return;
		}
		const uri = (msg.params as Record<string, unknown> | undefined)?.uri as string | undefined;
		if (!uri || typeof uri !== "string") {
			this.ctx.transport.sendError(msg, -32602, "Missing required parameter: uri");
			return;
		}
		this.subscriptions.delete(uri);
		this.ctx.transport.sendResult(msg, {});
	}
}
