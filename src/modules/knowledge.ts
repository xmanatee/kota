/**
 * Knowledge module — file-based structured data layer.
 *
 * Registers the `knowledge` tool in the `management` group.
 * Storage: .kota/data/ (project) and ~/.kota/data/ (global).
 */

import type { KotaExtension } from "../extension-types.js";
import { knowledgeTool, runKnowledge } from "../tools/knowledge.js";

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
	promptSection: () =>
		"Structured knowledge entries as markdown files with YAML front matter. " +
		"Use for research findings, decisions with rationale, reference material, and plans. " +
		"Supports types, tags, status, and full-text search. " +
		"Prefer knowledge over memory for substantial, structured entries.",
};

export default knowledgeModule;
