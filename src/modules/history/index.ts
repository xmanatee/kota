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
import { getProjectHistoryStore } from "./history.js";
import {
	createHistoryProjectStores,
	type HistoryProjectStores,
} from "./project-scope.js";
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
		const store = getProjectHistoryStore(ctx.cwd);
		ctx.registerProvider(HISTORY_PROVIDER_TOKEN, store);
		ctx.registerProvider(
			CAPABILITY_READINESS_PROVIDER_TYPE,
			createHistoryReadinessSource(store),
		);
	},

	routes: (ctx) =>
		historyRoutes(
			createHistoryProjectStores(ctx.cwd, () => getHistoryProvider()),
		),
	controlRoutes: (ctx) =>
		historyControlRoutes(
			createHistoryProjectStores(ctx.cwd, () => getHistoryProvider()),
		),

	localClient: (ctx) => {
		const projectStores = createHistoryProjectStores(ctx.cwd, () =>
			getHistoryProvider(),
		);
		const handler: HistoryClient = {
			async list(filter) {
				const provider = resolveHistoryProvider(projectStores, filter?.projectId);
				return { conversations: provider.list(filter) };
			},
			async show(id, project) {
				const provider = resolveHistoryProvider(projectStores, project?.projectId);
				const data = provider.load(id);
				return data ? { found: true, data } : { found: false };
			},
			async delete(id, project) {
				const provider = resolveHistoryProvider(projectStores, project?.projectId);
				return provider.remove(id)
					? { ok: true }
					: { ok: false, reason: "not_found" };
			},
			async search(query, filter) {
				const provider = resolveHistoryProvider(projectStores, filter?.projectId);
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
			async reindex(project) {
				const provider = resolveHistoryProvider(projectStores, project?.projectId);
				return provider.reindex();
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
 * `list(filter)` builds the optional `search` / `limit` / `cwd` / `source` /
 * `projectId` URLSearchParams shape (omitting the query string entirely when
 * no key is set) and issues `GET /history${query}` through
 * `requestStrict<T>`. The daemon route emits
 * `{ conversations: ConversationRecord[] }`; the factory passes that decode
 * shape through unchanged.
 *
 * `show(id)` issues `GET /history/:id` through `fetchRaw`, collapsing a 404
 * missing conversation into `{ found: false }`, throwing the typed
 * unknown-project route error, and returning `{ found: true, data }` for a
 * non-null `ConversationData`. The id runs through `encodeURIComponent`.
 *
 * `delete(id)` issues `DELETE /history/:id` through `fetchRaw`, collapsing a
 * 404 missing conversation into `{ ok: false, reason: "not_found" }`,
 * throwing the typed unknown-project route error, and collapsing a non-null
 * `{ deleted: id }` envelope into `{ ok: true }`. The id runs through
 * `encodeURIComponent`. The control route was reshaped from a `204` success
 * to `200 + { deleted: id }` to match the knowledge / approvals / secrets
 * delete precedent.
 *
 * `search(query, filter)` builds the same `URLSearchParams` shape today's
 * `searchHistoryHttp` built (`q`, optional `cwd`, `source`, `semantic=true`,
 * `limit`, `projectId`) and issues `GET /api/history/search?...` through
 * `requestStrict<T>`. The daemon route emits the discriminated union
 * directly.
 *
 * `reindex()` issues `POST /history/reindex` through `requestStrict<T>`,
 * optionally scoped by `projectId`, and returns the provider's
 * `ReindexResult` verbatim.
 */
function buildHistoryDaemonHandler(link: DaemonTransport): HistoryClient {
	return {
		list: async (filter): Promise<HistoryListResult> => {
			const params = new URLSearchParams();
			if (filter?.search) params.set("search", filter.search);
			if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
			if (filter?.cwd) params.set("cwd", filter.cwd);
			if (filter?.source) params.set("source", filter.source);
			if (filter?.projectId) params.set("projectId", filter.projectId);
			const query = params.toString() ? `?${params.toString()}` : "";
			return link.requestStrict<HistoryListResult>(
				"GET",
				`/history${query}`,
			);
		},
		show: async (id, project): Promise<HistoryShowResult> => {
			const query = projectQuery(project?.projectId);
			const data = await requestNullableHistoryRoute<ConversationData>(
				link,
				"GET",
				`/history/${encodeURIComponent(id)}${query}`,
			);
			return data ? { found: true, data } : { found: false };
		},
		delete: async (id, project): Promise<HistoryDeleteResult> => {
			const query = projectQuery(project?.projectId);
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
			if (filter?.projectId) params.set("projectId", filter.projectId);
			return link.requestStrict<HistorySearchResult>(
				"GET",
				`/api/history/search?${params.toString()}`,
			);
		},
		reindex: async (project): Promise<HistoryReindexResult> => {
			const query = projectQuery(project?.projectId);
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
	projectId?: string;
};

async function requestNullableHistoryRoute<T>(
	link: DaemonTransport,
	method: string,
	path: string,
): Promise<T | null> {
	const res = await link.fetchRaw(path, { method });
	if (res.status === 404) {
		const body = await readHistoryRouteError(res);
		if (body?.reason === "unknown_project" && body.projectId) {
			throw new Error(`Unknown project: ${body.projectId}`);
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
	projectStores: HistoryProjectStores,
	projectId: string | undefined,
) {
	const resolved = projectStores.resolve(projectId);
	if (!resolved.ok) {
		throw new Error(`Unknown project: ${resolved.error.projectId}`);
	}
	return resolved.store;
}

function projectQuery(projectId: string | undefined): string {
	if (!projectId) return "";
	const params = new URLSearchParams();
	params.set("projectId", projectId);
	return `?${params.toString()}`;
}

export default historyModule;
