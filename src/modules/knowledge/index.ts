import { Command } from "commander";
import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import type { KotaModule, ModuleRuntimeContext } from "#core/modules/module-types.js";
import { KNOWLEDGE_PROVIDER_TOKEN } from "#core/modules/provider-registry.js";
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
import { knowledgeRoutes } from "./routes.js";
import {
	createKnowledgeScopeStores,
	type KnowledgeScopeStores,
} from "./scope.js";
import { KnowledgeStore } from "./store.js";
import { knowledgeUiSurfaceSource } from "./ui-surface.js";

const knowledgeModule: KotaModule = {
	name: "knowledge",
	version: "1.0.0",
	description:
		"Structured knowledge base — markdown files with YAML front matter",
	dependencies: ["rendering"],
	uiSurfaces: [knowledgeUiSurfaceSource],
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
		const scopeStores = createKnowledgeScopeStores(ctx.cwd, () => {
			const provider = ctx.getProvider(KNOWLEDGE_PROVIDER_TOKEN);
			if (!provider) throw new Error("knowledge provider is not registered");
			return provider;
		}, () => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE));
		const handler: KnowledgeClient = {
			async list(filter) {
				const provider = resolveKnowledgeProvider(scopeStores, filter?.scopeId);
				const entries = provider.list({
					tag: filter?.tag,
					type: filter?.type,
					status: filter?.status,
					scope: filter?.scope,
				});
				return { entries };
			},
			async show(id, scopeSelector) {
				const provider = resolveKnowledgeProvider(scopeStores, scopeSelector?.scopeId);
				const entry = provider.read(id);
				if (!entry) return { found: false };
				return { found: true, entry };
			},
			async search(query, filter) {
				const provider = resolveKnowledgeProvider(scopeStores, filter?.scopeId);
				const limit = filter?.limit ?? 20;
				const filters = {
					tag: filter?.tag,
					type: filter?.type,
					status: filter?.status,
					scope: filter?.scope,
				};
				if (filter?.semantic) {
					const semanticSearch = provider.semanticSearchCapability;
					if (!semanticSearch) {
						return { ok: false, reason: "semantic_unavailable" };
					}
					const entries = await semanticSearch.semanticSearch(query, limit, filters);
					return { ok: true, entries };
				}
				const entries = provider.search(query, filters).slice(0, limit);
				return { ok: true, entries };
			},
			async add(options) {
				const provider = resolveKnowledgeProvider(scopeStores, options.scopeId);
				const id = provider.create({
					title: options.title,
					content: options.content,
					...(options.type !== undefined && { type: options.type }),
					...(options.tags !== undefined && { tags: options.tags }),
					...(options.status !== undefined && { status: options.status }),
					...(options.scope !== undefined && { scope: options.scope }),
					...(options.meta !== undefined && { meta: options.meta }),
					...(options.provenance !== undefined && {
						provenance: options.provenance,
					}),
					...(options.freshness !== undefined && {
						freshness: options.freshness,
					}),
				});
				return { id };
			},
			async delete(id, scopeSelector) {
				const provider = resolveKnowledgeProvider(scopeStores, scopeSelector?.scopeId);
				const ok = provider.delete(id);
				return ok ? { ok: true } : { ok: false, reason: "not_found" };
			},
			async reindex(scopeSelector) {
				const provider = resolveKnowledgeProvider(scopeStores, scopeSelector?.scopeId);
				const semanticSearch = provider.semanticSearchCapability;
				if (!semanticSearch) return { ok: false, reason: "semantic_unavailable" };
				return { ok: true, ...await semanticSearch.reindex() };
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
		knowledgeRoutes(createKnowledgeScopeStores(ctx.cwd, () => {
			const provider = ctx.getProvider(KNOWLEDGE_PROVIDER_TOKEN);
			if (!provider) throw new Error("knowledge provider is not registered");
			return provider;
		}, () => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE))),
};

function buildKnowledgeDaemonHandler(link: DaemonTransport): KnowledgeClient {
	return {
		list: async (filter): Promise<KnowledgeListResult> => {
			const params = new URLSearchParams();
			if (filter?.tag) params.set("tag", filter.tag);
			if (filter?.type) params.set("type", filter.type);
			if (filter?.status) params.set("status", filter.status);
			if (filter?.scope) params.set("scope", filter.scope);
			if (filter?.scopeId) params.set("scopeId", filter.scopeId);
			const query = params.toString() ? `?${params.toString()}` : "";
			return link.requestStrict<KnowledgeListResult>(
				"GET",
				`/api/knowledge${query}`,
			);
		},
		show: async (id, scopeSelector): Promise<KnowledgeShowResult> => {
			const query = scopeQuery(scopeSelector?.scopeId);
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
			if (filter?.scopeId) params.set("scopeId", filter.scopeId);
			return link.requestStrict<KnowledgeSearchResult>(
				"GET",
				`/api/knowledge/search?${params.toString()}`,
			);
		},
		add: async (options): Promise<KnowledgeAddResult> => {
			const { scopeId, ...body } = options;
			const query = scopeQuery(scopeId);
			const result = await link.requestStrict<{ id: string }>(
				"POST",
				`/api/knowledge${query}`,
				body,
			);
			return { id: result.id };
		},
		delete: async (id, scopeSelector): Promise<KnowledgeDeleteResult> => {
			const query = scopeQuery(scopeSelector?.scopeId);
			const result = await requestNullableKnowledgeRoute<{ deleted: string }>(
				link,
				"DELETE",
				`/api/knowledge/${encodeURIComponent(id)}${query}`,
			);
			return result ? { ok: true } : { ok: false, reason: "not_found" };
		},
		reindex: async (scopeSelector): Promise<KnowledgeReindexResult> => {
			const query = scopeQuery(scopeSelector?.scopeId);
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
	scopeId?: string;
};

async function requestNullableKnowledgeRoute<T>(
	link: DaemonTransport,
	method: string,
	path: string,
): Promise<T | null> {
	const res = await link.fetchRaw(path, { method });
	if (res.status === 404) {
		const body = await readKnowledgeRouteError(res);
		if (body?.reason === "unknown_scope" && body.scopeId) {
			throw new Error(`Unknown scope: ${body.scopeId}`);
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
	scopeStores: KnowledgeScopeStores,
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

export default knowledgeModule;
