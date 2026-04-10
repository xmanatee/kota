/**
 * Knowledge module — file-based structured data layer.
 *
 * Registers the `knowledge` tool in the `management` group and the `kota knowledge`
 * operator CLI commands.
 * Storage: .kota/data/ (project) and ~/.kota/data/ (global).
 */

import { Command } from "commander";
import type { KotaModule } from "../../core/modules/module-types.js";
import { registerKnowledgeCommands } from "./cli.js";
import { knowledgeTool, runKnowledge } from "./knowledge.js";
import { knowledgeRoutes } from "./routes.js";

const knowledgeModule: KotaModule = {
	name: "knowledge",
	version: "1.0.0",
	description:
		"Structured knowledge base — markdown files with YAML front matter",
	tools: [
		{
			tool: knowledgeTool,
			runner: runKnowledge,
			group: "management",
		},
	],
	skills: [{ name: "knowledge", promptPath: "src/modules/knowledge/knowledge.md" }],

	commands: () => {
		const root = new Command("__root__");
		registerKnowledgeCommands(root);
		return root.commands as Command[];
	},

	routes: () => knowledgeRoutes(),
};

export default knowledgeModule;
