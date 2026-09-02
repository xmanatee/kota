/**
 * History module — conversation recall across sessions.
 *
 * Owns the file-based ConversationHistory store and registers it as the
 * `default` history provider. Contributes the `conversation_recall` tool
 * in the `management` group and the `/api/history` HTTP routes.
 */


import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import type { KotaModule, ModuleRuntimeContext } from "#core/modules/module-types.js";
import {
	HISTORY_PROVIDER_TOKEN,
	HISTORY_SCOPE_PROVIDER_TOKEN,
} from "#core/modules/provider-registry.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { readOnlyDaemonEffect } from "#core/tools/effect.js";
import { createHistoryDaemonClient } from "#root/client/kota-client.generated.js";
import { createHistoryReadinessSource } from "./capability-readiness.js";
import type {
	HistoryClient,
	HistoryDetail,
} from "./client.js";
import {
	conversationRecallTool,
	runConversationRecall,
} from "./conversation-recall.js";
import { getScopeHistoryStore } from "./history.js";
import {
	buildHistoryDetailQuery,
	normalizeHistoryShowOptions,
} from "./history-detail.js";
import { listLocalScopeHistoryRecords } from "./local-history-scan.js";
import {
	deleteHistory,
	listHistory,
	reindexHistory,
	searchHistory,
	showHistory,
} from "./operations.js";
import { historyControlRoutes, historyRoutes } from "./routes.js";
import {
	createHistoryScopeStores,
	type HistoryScopeStores,
} from "./scope.js";
import { historyUiSurfaceSource } from "./ui-surface.js";

const historyModule: KotaModule = {
	name: "history",
	version: "1.0.0",
	description:
		"Conversation recall — search and read past conversations",
	dependencies: ["rendering", "repl"],
	uiSurfaces: [historyUiSurfaceSource],
	tools: [
		{
			tool: conversationRecallTool,
			runner: runConversationRecall,
			effect: readOnlyDaemonEffect(),
			group: "management",
		},
	],
	skills: [{ name: "history", promptPath: "src/modules/history/history.md" }],

	onLoad: (ctx: ModuleRuntimeContext) => {
		const store = getScopeHistoryStore(ctx.cwd);
		ctx.registerProvider(HISTORY_PROVIDER_TOKEN, store);
		ctx.registerProvider(HISTORY_SCOPE_PROVIDER_TOKEN, {
			forScope: (scope) => {
				if (scope.isDefault) {
					return ctx.getProvider(HISTORY_PROVIDER_TOKEN) ?? store;
				}
				return getScopeHistoryStore(scope.scopeRoot);
			},
		});
		ctx.registerProvider(
			CAPABILITY_READINESS_PROVIDER_TYPE,
			createHistoryReadinessSource(store),
		);
	},

	routes: (ctx) =>
		historyRoutes(
			createHistoryScopeStores(ctx.cwd, () => {
				const provider = ctx.getProvider(HISTORY_PROVIDER_TOKEN);
				if (!provider) throw new Error("history provider is not registered");
				return provider;
			}, () => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE)),
		),
	controlRoutes: (ctx) =>
		historyControlRoutes(
			createHistoryScopeStores(ctx.cwd, () => {
				const provider = ctx.getProvider(HISTORY_PROVIDER_TOKEN);
				if (!provider) throw new Error("history provider is not registered");
				return provider;
			}, () => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE)),
			ctx.cwd,
		),

	localClient: (ctx) => {
		const scopeStores = createHistoryScopeStores(
			ctx.cwd,
			() => ctx.getProvider(HISTORY_PROVIDER_TOKEN),
			() => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE),
		);
		const handler: HistoryClient = {
			async list(filter) {
				const provider = resolveHistoryProvider(scopeStores, filter?.scopeId);
				return listHistory(provider, filter);
			},
			async listDiscoveredScopeRecords(filter) {
				return {
					conversations: listLocalScopeHistoryRecords({
						cwd: ctx.cwd,
						limit: filter?.limit,
					}),
				};
			},
			async show(id, options) {
				const provider = resolveHistoryProvider(scopeStores, options?.scopeId);
				return showHistory(provider, id, options);
			},
			async delete(id, scopeSelector) {
				const provider = resolveHistoryProvider(scopeStores, scopeSelector?.scopeId);
				return deleteHistory(provider, id);
			},
			async search(query, filter) {
				const provider = resolveHistoryProvider(scopeStores, filter?.scopeId);
				return searchHistory(provider, query, filter);
			},
			async reindex(scopeSelector) {
				const provider = resolveHistoryProvider(scopeStores, scopeSelector?.scopeId);
				return reindexHistory(provider);
			},
		};
		return { history: handler };
	},

	daemonClient: (link) => ({ history: buildHistoryDaemonHandler(link) }),
};

/** Daemon-side history client over the module's typed routes. */
function buildHistoryDaemonHandler(link: DaemonTransport): HistoryClient {
	return createHistoryDaemonClient(link, {
		show: async (id, options) => {
			const request = normalizeHistoryShowOptions(options);
			const query = buildHistoryDetailQuery(request, options?.scopeId);
			const detail = await requestNullableHistoryRoute<HistoryDetail>(
				link,
				"GET",
				`/history/${encodeURIComponent(id)}${query}`,
			);
			return detail ? { found: true, detail } : { found: false };
		},
		delete: async (id, scopeSelector) => {
			const query = scopeQuery(scopeSelector?.scopeId);
			const result = await requestNullableHistoryRoute<{ deleted: string }>(
				link,
				"DELETE",
				`/history/${encodeURIComponent(id)}${query}`,
			);
			return result ? { ok: true } : { ok: false, reason: "not_found" };
		},
	});
}

type HistoryRouteErrorBody = {
	error?: string;
	reason?: string;
	scopeId?: string;
};

async function requestNullableHistoryRoute<T>(
	link: DaemonTransport,
	method: string,
	path: string,
): Promise<T | null> {
	const res = await link.fetchRaw(path, { method });
	if (res.status === 404) {
		const body = await readHistoryRouteError(res);
		if (body?.reason === "unknown_scope" && body.scopeId) {
			throw new Error(`Unknown scope: ${body.scopeId}`);
		}
		return null;
	}
	if (!res.ok) {
		const body = await readHistoryRouteError(res);
		throw new Error(body?.error ?? `HTTP ${res.status}`);
	}
	if (res.status === 204) return null;
	return (await res.json()) as T;
}

async function readHistoryRouteError(
	res: Response,
): Promise<HistoryRouteErrorBody | null> {
	try {
		const parsed = (await res.json()) as HistoryRouteErrorBody;
		return typeof parsed === "object" && parsed !== null ? parsed : null;
	} catch {
		return null;
	}
}

function resolveHistoryProvider(
	scopeStores: HistoryScopeStores,
	scopeId: string | undefined,
) {
	const resolved = scopeStores.resolve(scopeId);
	if (!resolved.ok) {
		throw new Error(`Unknown scope: ${resolved.error.scopeId}`);
	}
	return resolved.store;
}

function scopeQuery(scopeId: string | undefined): string {
	if (!scopeId) return "";
	const params = new URLSearchParams();
	params.set("scopeId", scopeId);
	return `?${params.toString()}`;
}

export default historyModule;
