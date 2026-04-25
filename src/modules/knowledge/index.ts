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
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { getKnowledgeProvider } from "#core/modules/provider-registry.js";
import type { KnowledgeClient } from "#core/server/kota-client.js";
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
		ctx.registerProvider("knowledge", new KnowledgeStore(ctx.cwd));
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
