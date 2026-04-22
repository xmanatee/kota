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

	commands: () => {
		const root = new Command("__root__");
		registerKnowledgeCommands(root);
		return root.commands as Command[];
	},

	routes: () => knowledgeRoutes(),
};

export default knowledgeModule;
