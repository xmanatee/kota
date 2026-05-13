/**
 * Knowledge module — file-based structured data layer.
 *
 * Owns the file-based KnowledgeStore implementation and registers it as the
 * `default` knowledge provider. Contributes the `knowledge` tool in the
 * `management` group, the `kota knowledge` operator CLI commands, and the
 * `/api/knowledge` HTTP routes.
 *
 * Storage: .kota/data/ (project) and ~/.kota/data/ (global).
 */


import { Command } from "commander";
import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import type { KotaModule, ModuleRuntimeContext } from "#core/modules/module-types.js";
import {
	getKnowledgeProvider,
	KNOWLEDGE_PROVIDER_TOKEN,
} from "#core/modules/provider-registry.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { localWriteEffect } from "#core/tools/effect.js";
import { createKnowledgeReadinessSource } from "./capability-readiness.js";
import { registerKnowledgeCommands } from "./cli.js";
import type {
	KnowledgeAddResult,
	KnowledgeClient,
	KnowledgeDeleteResult,
	KnowledgeListResult,
	KnowledgeReindexResult,
	KnowledgeSearchResult,
	KnowledgeShowResult,
} from "./client.js";
import { knowledgeTool, runKnowledge } from "./knowledge.js";
import {
	createKnowledgeProjectStores,
	type KnowledgeProjectStores,
} from "./project-scope.js";
import { knowledgeRoutes } from "./routes.js";
import { KnowledgeStore } from "./store.js";

const knowledgeModule: KotaModule = {
	name: "knowledge",
	version: "1.0.0",
	description:
		"Structured knowledge base — markdown files with YAML front matter",
	dependencies: ["rendering"],
	tools: [
		{
			tool: knowledgeTool,
			runner: runKnowledge,
			group: "management",
			effect: localWriteEffect(),
		},
	],
	skills: [{ name: "knowledge", promptPath: "src/modules/knowledge/knowledge.md" }],

	onLoad: (ctx: ModuleRuntimeContext) => {
		const store = new KnowledgeStore(ctx.cwd);
		ctx.registerProvider(KNOWLEDGE_PROVIDER_TOKEN, store);
		ctx.registerProvider(
			CAPABILITY_READINESS_PROVIDER_TYPE,
			createKnowledgeReadinessSource(store),
		);
	},

	localClient: (ctx) => {
		const projectStores = createKnowledgeProjectStores(ctx.cwd, () =>
			getKnowledgeProvider(),
		);
		const handler: KnowledgeClient = {
			async list(filter) {
				const provider = resolveKnowledgeProvider(projectStores, filter?.projectId);
				const entries = provider.list({
					tag: filter?.tag,
					type: filter?.type,
					status: filter?.status,
					scope: filter?.scope,
				});
				return { entries };
			},
			async show(id, project) {
				const provider = resolveKnowledgeProvider(projectStores, project?.projectId);
				const entry = provider.read(id);
				if (!entry) return { found: false };
				return { found: true, entry };
			},
			async search(query, filter) {
				const provider = resolveKnowledgeProvider(projectStores, filter?.projectId);
				const limit = filter?.limit ?? 20;
				const filters = {
					tag: filter?.tag,
					type: filter?.type,
					status: filter?.status,
					scope: filter?.scope,
				};
				if (filter?.semantic) {
					if (!provider.supportsSemanticSearch()) {
						return { ok: false, reason: "semantic_unavailable" };
					}
					const entries = await provider.semanticSearch(query, limit, filters);
					return { ok: true, entries };
				}
				const entries = provider.search(query, filters).slice(0, limit);
				return { ok: true, entries };
			},
			async add(options) {
				const provider = resolveKnowledgeProvider(projectStores, options.projectId);
				const id = provider.create({
					title: options.title,
					content: options.content,
					...(options.type !== undefined && { type: options.type }),
					...(options.tags !== undefined && { tags: options.tags }),
					...(options.status !== undefined && { status: options.status }),
					...(options.scope !== undefined && { scope: options.scope }),
					...(options.meta !== undefined && { meta: options.meta }),
				});
				return { id };
			},
			async delete(id, project) {
				const provider = resolveKnowledgeProvider(projectStores, project?.projectId);
				const ok = provider.delete(id);
				return ok ? { ok: true } : { ok: false, reason: "not_found" };
			},
			async reindex(project) {
				const provider = resolveKnowledgeProvider(projectStores, project?.projectId);
				return provider.reindex();
			},
		};
		return { knowledge: handler };
	},

	daemonClient: (link) => ({ knowledge: buildKnowledgeDaemonHandler(link) }),

	commands: (ctx) => {
		const root = new Command("__root__");
		registerKnowledgeCommands(root, ctx);
		return root.commands as Command[];
	},

	routes: (ctx) =>
		knowledgeRoutes(
			createKnowledgeProjectStores(ctx.cwd, () => getKnowledgeProvider()),
		),
};

/**
 * Daemon-side `KnowledgeClient` backed by the typed `DaemonTransport`. Calls
 * the same `/api/knowledge`, `/api/knowledge/:id`, `/api/knowledge/search`,
 * and `/api/knowledge/reindex` HTTP routes the knowledge module registers
 * through `knowledgeRoutes`. The transport surface owns the bearer token,
 * base URL, and timeout policy — this factory only encodes the wire shape.
 *
 * `list(filter)` builds the optional `tag` / `type` / `status` / `scope`
 * URLSearchParams shape (omitting the query string entirely when no key is
 * set) and issues `GET /api/knowledge${query}` through `requestStrict<T>`.
 * The daemon route emits `{ entries: KnowledgeEntry[] }`; the factory
 * passes that decode shape through unchanged.
 *
 * `show(id)` issues `GET /api/knowledge/:id` through `request<T>`,
 * collapsing a `null` (404) into `{ found: false }` and a non-null entry
 * into `{ found: true, entry }`. The id runs through `encodeURIComponent`.
 *
 * `search(query, filter)` builds the same `URLSearchParams` shape today's
 * `searchKnowledgeHttp` built (`q`, optional `tag`, `type`, `status`,
 * `scope`, `semantic=true`, `limit`) and issues
 * `GET /api/knowledge/search?...` through `requestStrict<T>`. The daemon
 * route emits the discriminated union directly.
 *
 * `add(options)` issues `POST /api/knowledge` with the full
 * `KnowledgeAddOptions` body through `requestStrict<T>` and returns
 * `{ id }`.
 *
 * `delete(id)` issues `DELETE /api/knowledge/:id` through `request<T>`,
 * collapsing `null` (404 or transport silence) into
 * `{ ok: false, reason: "not_found" }` and a non-null result into
 * `{ ok: true }`. The id runs through `encodeURIComponent`.
 *
 * `reindex()` issues `POST /api/knowledge/reindex` through
 * `requestStrict<T>` and returns the provider's `ReindexResult` verbatim.
 */
function buildKnowledgeDaemonHandler(link: DaemonTransport): KnowledgeClient {
	return {
		list: async (filter): Promise<KnowledgeListResult> => {
			const params = new URLSearchParams();
			if (filter?.tag) params.set("tag", filter.tag);
			if (filter?.type) params.set("type", filter.type);
			if (filter?.status) params.set("status", filter.status);
			if (filter?.scope) params.set("scope", filter.scope);
			if (filter?.projectId) params.set("projectId", filter.projectId);
			const query = params.toString() ? `?${params.toString()}` : "";
			return link.requestStrict<KnowledgeListResult>(
				"GET",
				`/api/knowledge${query}`,
			);
		},
		show: async (id, project): Promise<KnowledgeShowResult> => {
			const query = projectQuery(project?.projectId);
			const entry = await requestNullableKnowledgeRoute<
				KnowledgeListResult["entries"][number]
			>(
				link,
				"GET",
				`/api/knowledge/${encodeURIComponent(id)}${query}`,
			);
			return entry ? { found: true, entry } : { found: false };
		},
		search: async (query, filter): Promise<KnowledgeSearchResult> => {
			const params = new URLSearchParams();
			params.set("q", query);
			if (filter?.tag) params.set("tag", filter.tag);
			if (filter?.type) params.set("type", filter.type);
			if (filter?.status) params.set("status", filter.status);
			if (filter?.scope) params.set("scope", filter.scope);
			if (filter?.semantic) params.set("semantic", "true");
			if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
			if (filter?.projectId) params.set("projectId", filter.projectId);
			return link.requestStrict<KnowledgeSearchResult>(
				"GET",
				`/api/knowledge/search?${params.toString()}`,
			);
		},
		add: async (options): Promise<KnowledgeAddResult> => {
			const { projectId, ...body } = options;
			const query = projectQuery(projectId);
			const result = await link.requestStrict<{ id: string }>(
				"POST",
				`/api/knowledge${query}`,
				body,
			);
			return { id: result.id };
		},
		delete: async (id, project): Promise<KnowledgeDeleteResult> => {
			const query = projectQuery(project?.projectId);
			const result = await requestNullableKnowledgeRoute<{ deleted: string }>(
				link,
				"DELETE",
				`/api/knowledge/${encodeURIComponent(id)}${query}`,
			);
			return result ? { ok: true } : { ok: false, reason: "not_found" };
		},
		reindex: async (project): Promise<KnowledgeReindexResult> => {
			const query = projectQuery(project?.projectId);
			return link.requestStrict<KnowledgeReindexResult>(
				"POST",
				`/api/knowledge/reindex${query}`,
			);
		},
	};
}

type KnowledgeRouteErrorBody = {
	error?: string;
	reason?: string;
	projectId?: string;
};

async function requestNullableKnowledgeRoute<T>(
	link: DaemonTransport,
	method: string,
	path: string,
): Promise<T | null> {
	const res = await link.fetchRaw(path, { method });
	if (res.status === 404) {
		const body = await readKnowledgeRouteError(res);
		if (body?.reason === "unknown_project" && body.projectId) {
			throw new Error(`Unknown project: ${body.projectId}`);
		}
		return null;
	}
	if (!res.ok) {
		const body = await readKnowledgeRouteError(res);
		throw new Error(body?.error ?? `HTTP ${res.status}`);
	}
	if (res.status === 204) return null;
	return (await res.json()) as T;
}

async function readKnowledgeRouteError(
	res: Response,
): Promise<KnowledgeRouteErrorBody | null> {
	try {
		const parsed = (await res.json()) as KnowledgeRouteErrorBody;
		return typeof parsed === "object" && parsed !== null ? parsed : null;
	} catch {
		return null;
	}
}

function resolveKnowledgeProvider(
	projectStores: KnowledgeProjectStores,
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

export default knowledgeModule;
