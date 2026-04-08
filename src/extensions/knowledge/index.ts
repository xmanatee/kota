/**
 * Knowledge extension — file-based structured data layer.
 *
 * Registers the `knowledge` tool in the `management` group.
 * Storage: .kota/data/ (project) and ~/.kota/data/ (global).
 */

import type { KotaExtension } from "../../extension-types.js";
import { knowledgeTool, runKnowledge } from "./knowledge.js";

const knowledgeModule: KotaExtension = {
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
	skills: [{ name: "knowledge", promptPath: "src/extensions/skills/knowledge.md" }],
};

export default knowledgeModule;
