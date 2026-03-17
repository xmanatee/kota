/**
 * Knowledge module — file-based structured data layer.
 *
 * Registers the `knowledge` tool in the `management` group.
 * Storage: .kota/data/ (project) and ~/.kota/data/ (global).
 */

import type { KotaModule } from "../module-types.js";
import { knowledgeTool, runKnowledge } from "../tools/knowledge.js";

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
};

export default knowledgeModule;
