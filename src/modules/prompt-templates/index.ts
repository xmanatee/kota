import type { KotaModule, ToolDef } from "#core/modules/module-types.js";
import { setPromptResolver } from "#core/tools/delegate-config.js";
import { legacyEffect } from "#core/tools/effect.js";
import { promptTool, runPromptTemplate } from "./prompt.js";
import { PromptStore } from "./prompt-template.js";

function resolvePromptTemplate(
	name: string,
	vars: Record<string, string>,
	cwd?: string,
): { content?: string; error?: string } {
	const store = new PromptStore(cwd || process.cwd());
	store.discover();
	const tpl = store.get(name);
	if (!tpl) {
		const available = store.list();
		const hint = available.length > 0
			? ` Available: ${available.map((t) => t.name).join(", ")}`
			: " No templates found in .kota/prompts/.";
		return { error: `Error: prompt template "${name}" not found.${hint}` };
	}
	const result = store.render(name, vars);
	if (!result) return { error: `Error: failed to render template "${name}".` };
	const warn = result.missing.length > 0
		? `\n\nNote: unresolved template variables: ${result.missing.join(", ")}`
		: "";
	return { content: result.content + warn };
}

const tools: ToolDef[] = [
	{
		tool: promptTool,
		runner: runPromptTemplate,
		effect: legacyEffect({ risk: "safe", kind: "discovery" }),
		group: "management",
	},
];

const promptTemplatesModule: KotaModule = {
	name: "prompt-templates",
	version: "1.0.0",
	description: "Prompt template management: load, render, and create markdown prompt files",
	tools,
	onLoad: () => {
		setPromptResolver(resolvePromptTemplate);
	},
};

export default promptTemplatesModule;
