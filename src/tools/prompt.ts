import type Anthropic from "@anthropic-ai/sdk";
import type { ToolRegistration, ToolResult } from "./index.js";
import { PromptStore } from "./prompt-template.js";

let store: PromptStore | null = null;

function getStore(): PromptStore {
	if (!store) {
		store = new PromptStore(process.cwd());
		store.discover();
	}
	return store;
}

/** Reset store (for testing). */
export function resetPromptStore(): void {
	store = null;
}

/** Set a custom store (for testing). */
export function setPromptStore(s: PromptStore): void {
	store = s;
}

export const promptTool: Anthropic.Tool = {
	name: "prompt_template",
	description:
		"Manage reusable prompt templates stored as markdown files with YAML front matter. " +
		"Templates support {{variable}} substitution. " +
		"Actions: list (show available), get (load one), render (with variables), create (new template).",
	input_schema: {
		type: "object" as const,
		properties: {
			action: {
				type: "string",
				enum: ["list", "get", "render", "create"],
				description:
					"list: show available templates. " +
					"get: load a template by name. " +
					"render: render a template with variable substitution. " +
					"create: create a new template file.",
			},
			name: {
				type: "string",
				description: "Template name (required for get, render, create).",
			},
			variables: {
				type: "object",
				description:
					"Key-value pairs for template variable substitution (for render action).",
			},
			description: {
				type: "string",
				description: "Template description (for create action).",
			},
			body: {
				type: "string",
				description: "Template body with {{variable}} placeholders (for create action).",
			},
			tags: {
				type: "array",
				items: { type: "string" },
				description: "Tags for categorization (for create action).",
			},
		},
		required: ["action"],
	},
};

export async function runPromptTemplate(
	input: Record<string, unknown>,
): Promise<ToolResult> {
	const action = input.action as string;
	const s = getStore();

	switch (action) {
		case "list": {
			s.discover();
			const templates = s.list();
			if (templates.length === 0) {
				return {
					content:
						"No prompt templates found. Create templates in .kota/prompts/ as .md files with YAML front matter.",
				};
			}
			const lines = templates.map((t) => {
				const vars = t.variables?.length ? ` (vars: ${t.variables.join(", ")})` : "";
				const tags = t.tags?.length ? ` [${t.tags.join(", ")}]` : "";
				return `- **${t.name}**${vars}${tags}: ${t.description || "(no description)"}`;
			});
			return { content: `${templates.length} templates:\n${lines.join("\n")}` };
		}

		case "get": {
			const name = input.name as string;
			if (!name) return { content: "name is required for get action.", is_error: true };
			s.discover();
			const tpl = s.get(name);
			if (!tpl) {
				return { content: `Template "${name}" not found.`, is_error: true };
			}
			const meta = [
				`name: ${tpl.name}`,
				tpl.description ? `description: ${tpl.description}` : null,
				tpl.variables?.length ? `variables: ${tpl.variables.join(", ")}` : null,
				tpl.tags?.length ? `tags: ${tpl.tags.join(", ")}` : null,
			]
				.filter(Boolean)
				.join("\n");
			return { content: `## ${tpl.name}\n${meta}\n\n---\n${tpl.body}` };
		}

		case "render": {
			const name = input.name as string;
			if (!name) return { content: "name is required for render action.", is_error: true };
			s.discover();
			const vars = (input.variables as Record<string, string>) || {};
			const result = s.render(name, vars);
			if (!result) {
				return { content: `Template "${name}" not found.`, is_error: true };
			}
			const warn =
				result.missing.length > 0
					? `\n\n⚠ Unresolved variables: ${result.missing.join(", ")}`
					: "";
			return { content: result.content + warn };
		}

		case "create": {
			const name = input.name as string;
			const body = input.body as string;
			if (!name || !body) {
				return {
					content: "name and body are required for create action.",
					is_error: true,
				};
			}
			const filePath = s.create(
				{
					name,
					description: (input.description as string) || undefined,
					variables: (input.variables as string[]) || undefined,
					tags: (input.tags as string[]) || undefined,
				},
				body,
			);
			return { content: `Created template "${name}" at ${filePath}` };
		}

		default:
			return {
				content: `Unknown action: ${action}. Valid: list, get, render, create`,
				is_error: true,
			};
	}
}

export const registration: ToolRegistration = {
	tool: promptTool,
	runner: runPromptTemplate,
	risk: "safe" as const,
	group: "management",
};
