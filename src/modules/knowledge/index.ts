import { Command } from "commander";
import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import type { KotaModule, ModuleRuntimeContext } from "#core/modules/module-types.js";
import { KNOWLEDGE_PROVIDER_TOKEN } from "#core/modules/provider-registry.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { localWriteEffect } from "#core/tools/effect.js";
import { createKnowledgeDaemonClient } from "#root/client/kota-client.generated.js";
import { createKnowledgeReadinessSource } from "./capability-readiness.js";
import { registerKnowledgeCommands } from "./cli.js";
import type {
	KnowledgeClient,
	KnowledgeListResult,
} from "./client.js";
import { knowledgeTool, runKnowledge } from "./knowledge.js";
import {
	deleteKnowledge,
	listKnowledge,
	reindexKnowledge,
	searchKnowledge,
	showKnowledge,
} from "./operations.js";
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
				return listKnowledge(provider, filter);
			},
			async show(id, scopeSelector) {
				const provider = resolveKnowledgeProvider(scopeStores, scopeSelector?.scopeId);
				return showKnowledge(provider, id);
			},
			async search(query, filter) {
				const provider = resolveKnowledgeProvider(scopeStores, filter?.scopeId);
				return searchKnowledge(provider, query, filter);
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
				return deleteKnowledge(provider, id);
			},
			async reindex(scopeSelector) {
				const provider = resolveKnowledgeProvider(scopeStores, scopeSelector?.scopeId);
				return reindexKnowledge(provider);
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
	return createKnowledgeDaemonClient(link, {
		show: async (id, scopeSelector) => {
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
		delete: async (id, scopeSelector) => {
			const query = scopeQuery(scopeSelector?.scopeId);
			const result = await requestNullableKnowledgeRoute<{ deleted: string }>(
				link,
				"DELETE",
				`/api/knowledge/${encodeURIComponent(id)}${query}`,
			);
			return result ? { ok: true } : { ok: false, reason: "not_found" };
		},
	});
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
