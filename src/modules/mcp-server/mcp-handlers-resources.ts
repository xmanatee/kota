/**
 * MCP resource methods plus the bus listeners that turn relevant KOTA events
 * into draft `subscriptions/listen` notifications. The older
 * `resources/{subscribe,unsubscribe}` pair is kept as one compatibility branch
 * over the same per-resource update path.
 */

import type { EventBus } from "#core/events/event-bus.js";
import { getEventBus } from "#core/events/event-bus.js";
import type {
	HandlerContext,
	JsonRpcNotification,
	JsonRpcRequest,
} from "./mcp-protocol-types.js";
import {
	isKnownKotaResourceUri,
	listKotaResources,
	readKotaResource,
} from "./resources.js";

const SUBSCRIPTION_ID_META_KEY = "io.modelcontextprotocol/subscriptionId";

type DraftResourceSubscription = {
	resourceUris: Set<string>;
	resourcesListChanged: boolean;
};

type ListenParams = {
	notifications?: {
		resourceSubscriptions?: string[];
		resourcesListChanged?: boolean;
	};
};

function subscriptionMeta(subscriptionId: string): Record<string, string> {
	return { [SUBSCRIPTION_ID_META_KEY]: subscriptionId };
}

function currentResourceCatalogSignature(): string {
	return listKotaResources()
		.map((resource) => resource.uri)
		.sort()
		.join("\n");
}

export class ResourcesHandler {
	private readonly legacyResourceSubscriptions = new Set<string>();
	private readonly draftResourceSubscriptions = new Map<string, DraftResourceSubscription>();
	private busUnsubs: (() => void)[] = [];
	private resourceCatalogSignature = currentResourceCatalogSignature();

	constructor(
		private readonly ctx: HandlerContext,
		private readonly eventBusOverride: EventBus | null | undefined,
		private readonly resolveProjectDir: () => string,
	) {}

	registerBusListeners(): void {
		const bus = this.eventBusOverride !== undefined ? this.eventBusOverride : getEventBus();
		if (!bus) return;

		const notifyWorkflowStatus = () => {
			this.notifyResourceUpdated("kota://workflow/status");
		};

		const notifyTasksReady = () => {
			this.notifyResourceUpdated("kota://tasks/ready");
		};

		this.busUnsubs.push(bus.on("workflow.started", notifyWorkflowStatus));
		this.busUnsubs.push(bus.on("workflow.completed", notifyWorkflowStatus));
		this.busUnsubs.push(bus.on("task.changed", notifyTasksReady));
		this.busUnsubs.push(bus.on("daemon.config.reload", () => this.notifyResourceListChangedIfNeeded()));
	}

	cleanup(): void {
		for (const unsub of this.busUnsubs) unsub();
		this.busUnsubs = [];
		this.draftResourceSubscriptions.clear();
		this.legacyResourceSubscriptions.clear();
	}

	handleList(msg: JsonRpcRequest): void {
		if (!this.ctx.session.initialized) {
			this.ctx.transport.sendError(msg, -32002, "Server not initialized");
			return;
		}
		const resources = listKotaResources();
		this.resourceCatalogSignature = currentResourceCatalogSignature();
		this.ctx.transport.sendResult(msg, { resources });
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
		const result = readKotaResource(uri, this.resolveProjectDir());
		if (!result.ok) {
			this.ctx.transport.sendError(msg, result.code, result.message);
			return;
		}
		this.ctx.transport.sendResult(msg, {
			contents: [{ uri, mimeType: "application/json", text: result.text }],
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
		if (!isKnownKotaResourceUri(uri)) {
			this.ctx.transport.sendError(msg, -32002, `Unknown resource: ${uri}`);
			return;
		}
		this.legacyResourceSubscriptions.add(uri);
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
		this.legacyResourceSubscriptions.delete(uri);
		this.ctx.transport.sendResult(msg, {});
	}

	handleListen(msg: JsonRpcRequest): void {
		if (!this.ctx.session.initialized) {
			this.ctx.transport.sendError(msg, -32002, "Server not initialized");
			return;
		}
		const params = msg.params as ListenParams | undefined;
		const notifications = params?.notifications;
		if (
			notifications !== undefined &&
			(!notifications || typeof notifications !== "object" || Array.isArray(notifications))
		) {
			this.ctx.transport.sendError(msg, -32602, "notifications must be an object");
			return;
		}

		const rawResourceSubscriptions = notifications?.resourceSubscriptions;
		if (rawResourceSubscriptions !== undefined && !Array.isArray(rawResourceSubscriptions)) {
			this.ctx.transport.sendError(msg, -32602, "notifications.resourceSubscriptions must be an array");
			return;
		}

		const resourceUris = rawResourceSubscriptions ?? [];
		for (const uri of resourceUris) {
			if (typeof uri !== "string") {
				this.ctx.transport.sendError(msg, -32602, "notifications.resourceSubscriptions must contain strings");
				return;
			}
			if (!isKnownKotaResourceUri(uri)) {
				this.ctx.transport.sendError(msg, -32002, `Unknown resource: ${uri}`);
				return;
			}
		}

		const subscriptionId = String(msg.id);
		const resourcesListChanged = notifications?.resourcesListChanged === true;
		const acknowledgedNotifications: {
			resourceSubscriptions?: string[];
			resourcesListChanged?: boolean;
		} = {};
		if (resourceUris.length > 0) acknowledgedNotifications.resourceSubscriptions = resourceUris;
		if (resourcesListChanged) acknowledgedNotifications.resourcesListChanged = true;

		if (resourceUris.length > 0 || resourcesListChanged) {
			this.draftResourceSubscriptions.set(subscriptionId, {
				resourceUris: new Set(resourceUris),
				resourcesListChanged,
			});
		}

		this.ctx.transport.sendNotification("notifications/subscriptions/acknowledged", {
			_meta: subscriptionMeta(subscriptionId),
			notifications: acknowledgedNotifications,
		});
	}

	handleCancelledNotification(msg: JsonRpcNotification): void {
		const requestId = msg.params?.requestId;
		if (typeof requestId !== "string" && typeof requestId !== "number") return;
		this.draftResourceSubscriptions.delete(String(requestId));
	}

	private notifyResourceUpdated(uri: string): void {
		if (this.legacyResourceSubscriptions.has(uri)) {
			this.ctx.transport.sendNotification("notifications/resources/updated", { uri });
		}
		for (const [subscriptionId, subscription] of this.draftResourceSubscriptions) {
			if (!subscription.resourceUris.has(uri)) continue;
			this.ctx.transport.sendNotification("notifications/resources/updated", {
				_meta: subscriptionMeta(subscriptionId),
				uri,
			});
		}
	}

	private notifyResourceListChangedIfNeeded(): void {
		const nextSignature = currentResourceCatalogSignature();
		if (nextSignature === this.resourceCatalogSignature) return;
		this.resourceCatalogSignature = nextSignature;
		for (const [subscriptionId, subscription] of this.draftResourceSubscriptions) {
			if (!subscription.resourcesListChanged) continue;
			this.ctx.transport.sendNotification("notifications/resources/list_changed", {
				_meta: subscriptionMeta(subscriptionId),
			});
		}
	}
}
