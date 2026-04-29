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
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import {
	getKnowledgeProvider,
	KNOWLEDGE_PROVIDER_TOKEN,
} from "#core/modules/provider-registry.js";
import type { KnowledgeClient } from "#core/server/kota-client.js";
import { createKnowledgeReadinessSource } from "./capability-readiness.js";
import { registerKnowledgeCommands } from "./cli.js";
import { knowledgeTool, runKnowledge } from "./knowledge.js";
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
			risk: "moderate",
			kind: "action",
		},
	],
	skills: [{ name: "knowledge", promptPath: "src/modules/knowledge/knowledge.md" }],

	onLoad: (ctx: ModuleContext) => {
		const store = new KnowledgeStore(ctx.cwd);
		ctx.registerProvider(KNOWLEDGE_PROVIDER_TOKEN, store);
		ctx.registerProvider(
			CAPABILITY_READINESS_PROVIDER_TYPE,
			createKnowledgeReadinessSource(store),
		);
	},

	localClient: () => {
		const handler: KnowledgeClient = {
			async list(filter) {
				const provider = getKnowledgeProvider();
				const entries = provider.list({
					tag: filter?.tag,
					type: filter?.type,
					status: filter?.status,
					scope: filter?.scope,
				});
				return { entries };
			},
			async show(id) {
				const provider = getKnowledgeProvider();
				const entry = provider.read(id);
				if (!entry) return { found: false };
				return { found: true, entry };
			},
			async search(query, filter) {
				const provider = getKnowledgeProvider();
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
				const provider = getKnowledgeProvider();
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
			async delete(id) {
				const provider = getKnowledgeProvider();
				const ok = provider.delete(id);
				return ok ? { ok: true } : { ok: false, reason: "not_found" };
			},
			async reindex() {
				const provider = getKnowledgeProvider();
				return provider.reindex();
			},
		};
		return { knowledge: handler };
	},

	commands: (ctx) => {
		const root = new Command("__root__");
		registerKnowledgeCommands(root, ctx);
		return root.commands as Command[];
	},

	routes: () => knowledgeRoutes(),
};

export default knowledgeModule;
