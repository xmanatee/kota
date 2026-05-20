/**
 * MCP resource methods plus the bus listeners that turn relevant KOTA events
 * into draft `subscriptions/listen` notifications. The older
 * `resources/{subscribe,unsubscribe}` pair is kept as one compatibility branch
 * over the same per-resource update path.
 */

import { existsSync, type FSWatcher, watch } from "node:fs";
import { dirname } from "node:path";
import type { EventBus } from "#core/events/event-bus.js";
import { getEventBus } from "#core/events/event-bus.js";
import { getPromptTemplatesDir } from "#modules/prompt-templates/prompt-template.js";
import {
	type McpMrtrStateCodec,
	resolveProjectDirFromRootsInput,
} from "./mcp-mrtr.js";
import type {
	HandlerContext,
	JsonRpcNotification,
	JsonRpcRequest,
} from "./mcp-protocol-types.js";
import { hasActiveMcpContext } from "./mcp-protocol-types.js";
import { getPromptCatalogSignature } from "./prompts.js";
import {
	isKnownKotaResourceUri,
	listKotaResources,
	readKotaResource,
} from "./resources.js";

const SUBSCRIPTION_ID_META_KEY = "io.modelcontextprotocol/subscriptionId";
const PROMPT_LIST_CHANGED_DEBOUNCE_MS = 25;
const PROMPT_LIST_CHANGED_POLL_MS = 100;

type DraftResourceSubscription = {
	resourceUris: Set<string>;
	resourcesListChanged: boolean;
	promptsListChanged: boolean;
};

type ListenParams = {
	notifications?: {
		resourceSubscriptions?: string[];
		resourcesListChanged?: boolean;
		promptsListChanged?: boolean;
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

function currentPromptCatalogSignature(projectDir: string): string {
	return getPromptCatalogSignature(projectDir);
}

function sameStringArray(left: string[], right: string[]): boolean {
	if (left.length !== right.length) return false;
	return left.every((value, index) => value === right[index]);
}

export class ResourcesHandler {
	private readonly legacyResourceSubscriptions = new Set<string>();
	private readonly draftResourceSubscriptions = new Map<string, DraftResourceSubscription>();
	private busUnsubs: (() => void)[] = [];
	private resourceCatalogSignature = currentResourceCatalogSignature();
	private promptCatalogSignature: string | null = null;
	private promptWatchers: FSWatcher[] = [];
	private promptWatchedPaths: string[] = [];
	private promptWatcherProjectDir: string | null = null;
	private promptListChangedTimer: ReturnType<typeof setTimeout> | null = null;
	private promptListChangedPollTimer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly ctx: HandlerContext,
		private readonly eventBusOverride: EventBus | null | undefined,
		private readonly resolveProjectDir: () => string,
		private readonly mrtr: McpMrtrStateCodec,
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
		this.closePromptWatchers();
		if (this.promptListChangedTimer) {
			clearTimeout(this.promptListChangedTimer);
			this.promptListChangedTimer = null;
		}
		if (this.promptListChangedPollTimer) {
			clearInterval(this.promptListChangedPollTimer);
			this.promptListChangedPollTimer = null;
		}
	}

	handleList(msg: JsonRpcRequest): void {
		if (!hasActiveMcpContext(this.ctx)) {
			this.ctx.transport.sendError(msg, -32002, "Server not initialized");
			return;
		}
		const resources = listKotaResources();
		this.resourceCatalogSignature = currentResourceCatalogSignature();
		this.ctx.transport.sendResult(msg, { resources });
	}

	handleRead(msg: JsonRpcRequest): void {
		if (!hasActiveMcpContext(this.ctx)) {
			this.ctx.transport.sendError(msg, -32002, "Server not initialized");
			return;
		}
		const uri = (msg.params as Record<string, unknown> | undefined)?.uri as string | undefined;
		if (!uri || typeof uri !== "string") {
			this.ctx.transport.sendError(msg, -32602, "Missing required parameter: uri");
			return;
		}
		const projectDir = this.resolveProjectDirForRead(msg);
		if (!projectDir) return;
		const result = readKotaResource(uri, projectDir);
		if (!result.ok) {
			this.ctx.transport.sendError(msg, result.code, result.message);
			return;
		}
		this.ctx.transport.sendResult(msg, {
			contents: [{ uri, mimeType: "application/json", text: result.text }],
		});
	}

	handleSubscribe(msg: JsonRpcRequest): void {
		if (!hasActiveMcpContext(this.ctx)) {
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
		if (!hasActiveMcpContext(this.ctx)) {
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
		if (!hasActiveMcpContext(this.ctx)) {
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
		if (
			notifications?.resourcesListChanged !== undefined &&
			typeof notifications.resourcesListChanged !== "boolean"
		) {
			this.ctx.transport.sendError(msg, -32602, "notifications.resourcesListChanged must be a boolean");
			return;
		}
		if (
			notifications?.promptsListChanged !== undefined &&
			typeof notifications.promptsListChanged !== "boolean"
		) {
			this.ctx.transport.sendError(msg, -32602, "notifications.promptsListChanged must be a boolean");
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
		const promptsListChanged = notifications?.promptsListChanged === true;
		const acknowledgedNotifications: {
			resourceSubscriptions?: string[];
			resourcesListChanged?: boolean;
			promptsListChanged?: boolean;
		} = {};
		if (resourceUris.length > 0) acknowledgedNotifications.resourceSubscriptions = resourceUris;
		if (resourcesListChanged) acknowledgedNotifications.resourcesListChanged = true;
		if (promptsListChanged) acknowledgedNotifications.promptsListChanged = true;

		if (resourceUris.length > 0 || resourcesListChanged || promptsListChanged) {
			this.draftResourceSubscriptions.set(subscriptionId, {
				resourceUris: new Set(resourceUris),
				resourcesListChanged,
				promptsListChanged,
			});
		}
		if (promptsListChanged) {
			this.promptCatalogSignature = currentPromptCatalogSignature(this.resolveProjectDir());
			this.startPromptCatalogMonitoring();
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
		this.stopPromptWatchersIfUnused();
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

	private resolveProjectDirForRead(msg: JsonRpcRequest): string | null {
		const resolved = resolveProjectDirFromRootsInput({
			ctx: this.ctx,
			mrtr: this.mrtr,
			msg,
			fallbackProjectDir: this.resolveProjectDir(),
		});
		if (resolved.kind === "ready") return resolved.projectDir;
		if (resolved.kind === "input_required") {
			this.ctx.transport.sendResult(msg, resolved.result);
			return null;
		}
		this.ctx.transport.sendError(msg, -32602, resolved.message);
		return null;
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

	private hasPromptListSubscriptions(): boolean {
		for (const subscription of this.draftResourceSubscriptions.values()) {
			if (subscription.promptsListChanged) return true;
		}
		return false;
	}

	private promptWatchPaths(projectDir: string): string[] {
		const promptsDir = getPromptTemplatesDir(projectDir);
		const kotaDir = dirname(promptsDir);
		if (existsSync(promptsDir)) return [promptsDir];
		if (existsSync(kotaDir)) return [kotaDir];
		return [projectDir].filter((path) => existsSync(path));
	}

	private ensurePromptWatchers(): void {
		if (!this.hasPromptListSubscriptions()) return;
		const projectDir = this.resolveProjectDir();
		const paths = this.promptWatchPaths(projectDir);
		if (
			this.promptWatcherProjectDir === projectDir &&
			sameStringArray(paths, this.promptWatchedPaths)
		) {
			return;
		}
		this.closePromptWatchers();
		this.promptWatcherProjectDir = projectDir;
		this.promptWatchedPaths = paths;
		for (const path of paths) {
			try {
				const watcher = watch(path, { persistent: false }, () => {
					this.ensurePromptWatchers();
					this.schedulePromptListChangedCheck();
				});
				watcher.on("error", (err) => {
					this.ctx.log(
						`Prompt catalog watcher failed for ${path}: ${err instanceof Error ? err.message : String(err)}`,
					);
				});
				this.promptWatchers.push(watcher);
			} catch (err) {
				this.ctx.log(
					`Failed to watch prompt catalog path ${path}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
	}

	private closePromptWatchers(): void {
		for (const watcher of this.promptWatchers) watcher.close();
		this.promptWatchers = [];
		this.promptWatchedPaths = [];
		this.promptWatcherProjectDir = null;
	}

	private stopPromptWatchersIfUnused(): void {
		if (this.hasPromptListSubscriptions()) return;
		this.closePromptWatchers();
		this.promptCatalogSignature = null;
		if (this.promptListChangedPollTimer) {
			clearInterval(this.promptListChangedPollTimer);
			this.promptListChangedPollTimer = null;
		}
	}

	private startPromptCatalogMonitoring(): void {
		this.ensurePromptWatchers();
		if (this.promptListChangedPollTimer) return;
		this.promptListChangedPollTimer = setInterval(() => {
			this.notifyPromptListChangedIfNeeded();
		}, PROMPT_LIST_CHANGED_POLL_MS);
		this.promptListChangedPollTimer.unref();
	}

	private schedulePromptListChangedCheck(): void {
		if (this.promptListChangedTimer) return;
		this.promptListChangedTimer = setTimeout(() => {
			this.promptListChangedTimer = null;
			this.notifyPromptListChangedIfNeeded();
		}, PROMPT_LIST_CHANGED_DEBOUNCE_MS);
	}

	private notifyPromptListChangedIfNeeded(): void {
		if (!this.hasPromptListSubscriptions()) return;
		this.ensurePromptWatchers();
		const nextSignature = currentPromptCatalogSignature(this.resolveProjectDir());
		if (nextSignature === this.promptCatalogSignature) return;
		this.promptCatalogSignature = nextSignature;
		for (const [subscriptionId, subscription] of this.draftResourceSubscriptions) {
			if (!subscription.promptsListChanged) continue;
			this.ctx.transport.sendNotification("notifications/prompts/list_changed", {
				_meta: subscriptionMeta(subscriptionId),
			});
		}
	}
}
