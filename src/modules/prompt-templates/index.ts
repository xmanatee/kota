import type { KotaModule, ToolDef } from "#core/modules/module-types.js";
import { promptTool, runPromptTemplate } from "./prompt.js";

const tools: ToolDef[] = [
	{
		tool: promptTool,
		runner: runPromptTemplate,
		risk: "safe",
		kind: "discovery",
		group: "management",
	},
];

const promptTemplatesModule: KotaModule = {
	name: "prompt-templates",
	version: "1.0.0",
	description: "Prompt template management: load, render, and create markdown prompt files",
	tools,
};

export default promptTemplatesModule;
