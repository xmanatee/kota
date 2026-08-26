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
import { createHistoryReadinessSource } from "./capability-readiness.js";
import type {
	HistoryClient,
	HistoryDeleteResult,
	HistoryDetail,
	HistoryListResult,
	HistoryReindexResult,
	HistorySearchResult,
	HistoryShowResult,
} from "./client.js";
import {
	conversationRecallTool,
	runConversationRecall,
} from "./conversation-recall.js";
import { getScopeHistoryStore } from "./history.js";
import {
	buildHistoryDetailQuery,
	normalizeHistoryShowOptions,
	readHistoryDetail,
} from "./history-detail.js";
import { listLocalScopeHistoryRecords } from "./local-history-scan.js";
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
				return { conversations: provider.list(filter) };
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
				return readHistoryDetail(
					provider,
					id,
					normalizeHistoryShowOptions(options),
				);
			},
			async delete(id, scopeSelector) {
				const provider = resolveHistoryProvider(scopeStores, scopeSelector?.scopeId);
				return provider.remove(id)
					? { ok: true }
					: { ok: false, reason: "not_found" };
			},
			async search(query, filter) {
				const provider = resolveHistoryProvider(scopeStores, filter?.scopeId);
				const limit = filter?.limit ?? 20;
				if (filter?.semantic) {
					if (!provider.supportsSemanticSearch()) {
						return { ok: false, reason: "semantic_unavailable" };
					}
					const conversations = await provider.semanticSearch(query, limit, {
						cwd: filter.cwd,
						source: filter.source,
					});
					return { ok: true, conversations };
				}
				const conversations = provider.list({
					search: query,
					limit,
					cwd: filter?.cwd,
					source: filter?.source,
				});
				return { ok: true, conversations };
			},
			async reindex(scopeSelector) {
				const provider = resolveHistoryProvider(scopeStores, scopeSelector?.scopeId);
				return provider.reindex();
			},
		};
		return { history: handler };
	},

	daemonClient: (link) => ({ history: buildHistoryDaemonHandler(link) }),
};

/** Daemon-side history client over the module's typed routes. */
function buildHistoryDaemonHandler(link: DaemonTransport): HistoryClient {
	return {
		list: async (filter): Promise<HistoryListResult> => {
			const params = new URLSearchParams();
			if (filter?.search) params.set("search", filter.search);
			if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
			if (filter?.cwd) params.set("cwd", filter.cwd);
			if (filter?.source) params.set("source", filter.source);
			if (filter?.scopeId) params.set("scopeId", filter.scopeId);
			const query = params.toString() ? `?${params.toString()}` : "";
			return link.requestStrict<HistoryListResult>(
				"GET",
				`/history${query}`,
			);
		},
		listDiscoveredScopeRecords: async (
			filter,
		): Promise<HistoryListResult> => {
			const params = new URLSearchParams();
			if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
			const query = params.toString() ? `?${params.toString()}` : "";
			return link.requestStrict<HistoryListResult>(
				"GET",
				`/history/discovered-scope-records${query}`,
			);
		},
		show: async (id, options): Promise<HistoryShowResult> => {
			const request = normalizeHistoryShowOptions(options);
			const query = buildHistoryDetailQuery(request, options?.scopeId);
			const detail = await requestNullableHistoryRoute<HistoryDetail>(
				link,
				"GET",
				`/history/${encodeURIComponent(id)}${query}`,
			);
			return detail ? { found: true, detail } : { found: false };
		},
		delete: async (id, scopeSelector): Promise<HistoryDeleteResult> => {
			const query = scopeQuery(scopeSelector?.scopeId);
			const result = await requestNullableHistoryRoute<{ deleted: string }>(
				link,
				"DELETE",
				`/history/${encodeURIComponent(id)}${query}`,
			);
			return result ? { ok: true } : { ok: false, reason: "not_found" };
		},
		search: async (query, filter): Promise<HistorySearchResult> => {
			const params = new URLSearchParams();
			params.set("q", query);
			if (filter?.cwd) params.set("cwd", filter.cwd);
			if (filter?.source) params.set("source", filter.source);
			if (filter?.semantic) params.set("semantic", "true");
			if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
			if (filter?.scopeId) params.set("scopeId", filter.scopeId);
			return link.requestStrict<HistorySearchResult>(
				"GET",
				`/api/history/search?${params.toString()}`,
			);
		},
		reindex: async (scopeSelector): Promise<HistoryReindexResult> => {
			const query = scopeQuery(scopeSelector?.scopeId);
			return link.requestStrict<HistoryReindexResult>(
				"POST",
				`/history/reindex${query}`,
			);
		},
	};
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
