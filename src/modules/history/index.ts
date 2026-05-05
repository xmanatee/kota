/**
 * History module — conversation recall across sessions.
 *
 * Owns the file-based ConversationHistory store and registers it as the
 * `default` history provider. Contributes the `conversation_recall` tool
 * in the `management` group and the `/api/history` HTTP routes.
 */


import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import type { KotaModule, ModuleRuntimeContext } from "#core/modules/module-types.js";
import {
	getHistoryProvider,
	HISTORY_PROVIDER_TOKEN,
} from "#core/modules/provider-registry.js";
import type { ConversationData } from "#core/modules/provider-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { readOnlyDaemonEffect } from "#core/tools/effect.js";
import { createHistoryReadinessSource } from "./capability-readiness.js";
import type {
	HistoryClient,
	HistoryDeleteResult,
	HistoryListResult,
	HistoryReindexResult,
	HistorySearchResult,
	HistoryShowResult,
} from "./client.js";
import {
	conversationRecallTool,
	runConversationRecall,
} from "./conversation-recall.js";
import { getHistory } from "./history.js";
import { historyControlRoutes, historyRoutes } from "./routes.js";

const historyModule: KotaModule = {
	name: "history",
	version: "1.0.0",
	description:
		"Conversation recall — search and read past conversations",
	dependencies: ["rendering"],
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
		const store = getHistory();
		ctx.registerProvider(HISTORY_PROVIDER_TOKEN, store);
		ctx.registerProvider(
			CAPABILITY_READINESS_PROVIDER_TYPE,
			createHistoryReadinessSource(store),
		);
	},

	routes: () => historyRoutes(),
	controlRoutes: () => historyControlRoutes(),

	localClient: () => {
		const handler: HistoryClient = {
			async list(filter) {
				return { conversations: getHistoryProvider().list(filter) };
			},
			async show(id) {
				const data = getHistoryProvider().load(id);
				return data ? { found: true, data } : { found: false };
			},
			async delete(id) {
				return getHistoryProvider().remove(id)
					? { ok: true }
					: { ok: false, reason: "not_found" };
			},
			async search(query, filter) {
				const provider = getHistoryProvider();
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
			async reindex() {
				return getHistoryProvider().reindex();
			},
		};
		return { history: handler };
	},

	daemonClient: (link) => ({ history: buildHistoryDaemonHandler(link) }),
};

/**
 * Daemon-side `HistoryClient` backed by the typed `DaemonTransport`. Calls
 * the same `/history`, `/history/:id`, `/history/reindex`, and
 * `/api/history/search` HTTP routes the history module registers through
 * `historyControlRoutes` and `historyRoutes`. The transport surface owns
 * the bearer token, base URL, and timeout policy — this factory only
 * encodes the wire shape.
 *
 * The two-stem route layout (`/history*` for list/show/delete/reindex,
 * `/api/history/search` for search) matches today's daemon contract.
 *
 * `list(filter)` builds the optional `search` / `limit` / `cwd` / `source`
 * URLSearchParams shape (omitting the query string entirely when no key is
 * set) and issues `GET /history${query}` through `requestStrict<T>`. The
 * daemon route emits `{ conversations: ConversationRecord[] }`; the factory
 * passes that decode shape through unchanged.
 *
 * `show(id)` issues `GET /history/:id` through `request<T>`, collapsing a
 * `null` (404) into `{ found: false }` and a non-null `ConversationData`
 * into `{ found: true, data }`. The id runs through `encodeURIComponent`.
 *
 * `delete(id)` issues `DELETE /history/:id` through `request<T>`, collapsing
 * `null` (404) into `{ ok: false, reason: "not_found" }` and a non-null
 * `{ deleted: id }` envelope into `{ ok: true }`. The id runs through
 * `encodeURIComponent`. The control route was reshaped from a `204` success
 * to `200 + { deleted: id }` to match the knowledge / approvals / secrets
 * delete precedent.
 *
 * `search(query, filter)` builds the same `URLSearchParams` shape today's
 * `searchHistoryHttp` built (`q`, optional `cwd`, `source`, `semantic=true`,
 * `limit`) and issues `GET /api/history/search?...` through
 * `requestStrict<T>`. The daemon route emits the discriminated union
 * directly.
 *
 * `reindex()` issues `POST /history/reindex` through `requestStrict<T>` and
 * returns the provider's `ReindexResult` verbatim.
 */
function buildHistoryDaemonHandler(link: DaemonTransport): HistoryClient {
	return {
		list: async (filter): Promise<HistoryListResult> => {
			const params = new URLSearchParams();
			if (filter?.search) params.set("search", filter.search);
			if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
			if (filter?.cwd) params.set("cwd", filter.cwd);
			if (filter?.source) params.set("source", filter.source);
			const query = params.toString() ? `?${params.toString()}` : "";
			return link.requestStrict<HistoryListResult>(
				"GET",
				`/history${query}`,
			);
		},
		show: async (id): Promise<HistoryShowResult> => {
			const data = await link.request<ConversationData>(
				"GET",
				`/history/${encodeURIComponent(id)}`,
			);
			return data ? { found: true, data } : { found: false };
		},
		delete: async (id): Promise<HistoryDeleteResult> => {
			const result = await link.request<{ deleted: string }>(
				"DELETE",
				`/history/${encodeURIComponent(id)}`,
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
			return link.requestStrict<HistorySearchResult>(
				"GET",
				`/api/history/search?${params.toString()}`,
			);
		},
		reindex: async (): Promise<HistoryReindexResult> => {
			return link.requestStrict<HistoryReindexResult>(
				"POST",
				"/history/reindex",
			);
		},
	};
}

export default historyModule;
