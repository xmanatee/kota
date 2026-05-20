/** MCP prompt catalog backed by KOTA built-ins and project prompt templates. */

import type { KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import {
	PromptStore,
	type PromptTemplateMeta,
	PromptTemplateParseError,
} from "#modules/prompt-templates/prompt-template.js";

export type McpPromptArgument = {
	name: string;
	description: string;
	required?: boolean;
};

export type McpPrompt = {
	name: string;
	description: string;
	arguments?: McpPromptArgument[];
};

export type McpPromptMessage = {
	role: "user" | "assistant";
	content: { type: "text"; text: string };
};

export type McpGetPromptResult = {
	description: string;
	messages: McpPromptMessage[];
};

export type McpPromptListPage = {
	prompts: McpPrompt[];
	nextCursor?: string;
};

export type McpPromptCatalogError = {
	ok: false;
	code: number;
	message: string;
};

export type McpPromptCatalogResult<T> =
	| { ok: true; result: T }
	| McpPromptCatalogError;

export const PROMPT_LIST_PAGE_SIZE = 50;

export const KOTA_PROMPTS: McpPrompt[] = [
	{
		name: "kota-create-task",
		description: "Draft a new KOTA task file in the correct frontmatter format.",
		arguments: [
			{ name: "title", description: "Short task title", required: true },
			{ name: "area", description: "Task area (e.g. runtime, operator-ux)", required: false },
			{ name: "priority", description: "Priority: p1, p2, or p3", required: false },
		],
	},
	{
		name: "kota-trigger-workflow",
		description: "Trigger a KOTA workflow by name with an optional JSON payload.",
		arguments: [
			{ name: "workflow", description: "Name of the workflow to trigger", required: true },
			{ name: "payload", description: "Optional JSON payload for the trigger", required: false },
		],
	},
	{
		name: "kota-summarize-run",
		description: "Summarize a KOTA workflow run in plain language.",
		arguments: [
			{
				name: "run_id",
				description: "The run ID to summarize (e.g. 2026-03-31T11-58-51-088Z-builder-pohafg)",
				required: true,
			},
		],
	},
];

const BUILT_IN_PROMPT_NAMES = new Set(KOTA_PROMPTS.map((p) => p.name));

function clonePrompt(prompt: McpPrompt): McpPrompt {
	return {
		name: prompt.name,
		description: prompt.description,
		...(prompt.arguments !== undefined && {
			arguments: prompt.arguments.map((arg) => ({ ...arg })),
		}),
	};
}

function projectTemplateToPrompt(template: PromptTemplateMeta): McpPrompt {
	const args = (template.variables ?? []).map((variable) => ({
		name: variable,
		description: `Template variable: ${variable}`,
		required: true,
	}));
	return {
		name: template.name,
		description: template.description ?? `Project prompt template: ${template.name}`,
		arguments: args,
	};
}

function invalidPromptTemplateFile(err: PromptTemplateParseError): McpPromptCatalogError {
	return {
		ok: false,
		code: -32602,
		message: err.message,
	};
}

function discoverProjectPromptStore(projectDir: string): McpPromptCatalogResult<PromptStore> {
	const store = new PromptStore(projectDir);
	try {
		store.discover();
	} catch (err) {
		if (err instanceof PromptTemplateParseError) return invalidPromptTemplateFile(err);
		throw err;
	}
	return { ok: true, result: store };
}

function listProjectTemplatePrompts(projectDir: string): McpPromptCatalogResult<McpPrompt[]> {
	const store = discoverProjectPromptStore(projectDir);
	if (!store.ok) return store;
	const prompts = store.result.list()
		.filter((template) => !BUILT_IN_PROMPT_NAMES.has(template.name))
		.sort((a, b) => a.name.localeCompare(b.name))
		.map(projectTemplateToPrompt);
	return { ok: true, result: prompts };
}

export function listPromptCatalog(projectDir: string): McpPromptCatalogResult<McpPrompt[]> {
	const projectPrompts = listProjectTemplatePrompts(projectDir);
	if (!projectPrompts.ok) return projectPrompts;
	return { ok: true, result: [
		...KOTA_PROMPTS.map(clonePrompt),
		...projectPrompts.result,
	] };
}

export function getPromptCatalogSignature(projectDir: string): string {
	const catalog = listPromptCatalog(projectDir);
	if (!catalog.ok) {
		return JSON.stringify({ error: catalog.message });
	}
	return JSON.stringify(catalog.result);
}

function decodeCursor(cursor: KotaJsonValue | undefined): McpPromptCatalogResult<number> {
	if (cursor === undefined) return { ok: true, result: 0 };
	if (typeof cursor !== "string" || !/^(0|[1-9]\d*)$/.test(cursor)) {
		return {
			ok: false,
			code: -32602,
			message: "Invalid cursor: expected a non-negative integer string",
		};
	}
	const offset = Number.parseInt(cursor, 10);
	if (!Number.isSafeInteger(offset)) {
		return {
			ok: false,
			code: -32602,
			message: "Invalid cursor: value is outside the supported range",
		};
	}
	return { ok: true, result: offset };
}

export function listPromptCatalogPage(
	projectDir: string,
	cursor: KotaJsonValue | undefined,
): McpPromptCatalogResult<McpPromptListPage> {
	const decoded = decodeCursor(cursor);
	if (!decoded.ok) return decoded;
	const offset = decoded.result;
	const catalog = listPromptCatalog(projectDir);
	if (!catalog.ok) return catalog;
	const prompts = catalog.result;
	if (offset > prompts.length) {
		return {
			ok: false,
			code: -32602,
			message: "Invalid cursor: value is outside the prompt catalog",
		};
	}
	const page = prompts.slice(offset, offset + PROMPT_LIST_PAGE_SIZE);
	const nextOffset = offset + page.length;
	return {
		ok: true,
		result: {
			prompts: page,
			...(nextOffset < prompts.length && { nextCursor: String(nextOffset) }),
		},
	};
}

function renderBuiltInPrompt(
	name: string,
	args: Record<string, string>,
): McpGetPromptResult | null {
	switch (name) {
		case "kota-create-task":
			return renderCreateTask(args);
		case "kota-trigger-workflow":
			return renderTriggerWorkflow(args);
		case "kota-summarize-run":
			return renderSummarizeRun(args);
		default:
			return null;
	}
}

/** Render a prompt into a messages array given its arguments. */
export function renderPrompt(
	projectDir: string,
	name: string,
	args: Record<string, string>,
): McpPromptCatalogResult<McpGetPromptResult> {
	const builtIn = renderBuiltInPrompt(name, args);
	if (builtIn) return { ok: true, result: builtIn };

	const store = discoverProjectPromptStore(projectDir);
	if (!store.ok) return store;
	const template = store.result.get(name);
	if (!template) {
		return {
			ok: false,
			code: -32602,
			message: `Unknown prompt: ${name}`,
		};
	}
	const rendered = store.result.render(name, args);
	if (!rendered) {
		return {
			ok: false,
			code: -32603,
			message: `Failed to render prompt: ${name}`,
		};
	}
	const unresolved = rendered.missing.length > 0
		? `\n\nUnresolved template variables: ${rendered.missing.join(", ")}`
		: "";
	return {
		ok: true,
		result: {
			description: template.description ?? `Project prompt template: ${template.name}`,
			messages: [
				{
					role: "user",
					content: { type: "text", text: rendered.content + unresolved },
				},
			],
		},
	};
}

function renderCreateTask(args: Record<string, string>): McpGetPromptResult {
	const title = args.title ?? "<task title>";
	const area = args.area ?? "<area>";
	const priority = args.priority ?? "p3";

	const text = `Create a quick KOTA inbox capture at \`data/inbox/<kebab-id>.md\`.

If the idea is still rough, a short plain-text note is acceptable. If it is already clear enough to normalize later, use this structure:

\`\`\`markdown
# ${title}

Priority: ${priority}
Area: ${area}

<one-line description>

<any useful notes, links, or context>
\`\`\``;

	return {
		description: "Draft a new KOTA inbox capture",
		messages: [{ role: "user", content: { type: "text", text } }],
	};
}

function renderTriggerWorkflow(args: Record<string, string>): McpGetPromptResult {
	const workflow = args.workflow ?? "<workflow-name>";
	const payload = args.payload;
	const payloadPart = payload ? ` '${payload}'` : "";

	const text = `Trigger the KOTA workflow \`${workflow}\` by running:

\`\`\`sh
kota workflow trigger ${workflow}${payloadPart}
\`\`\`

Confirm the run started with:

\`\`\`sh
kota workflow list
\`\`\``;

	return {
		description: `Trigger workflow: ${workflow}`,
		messages: [{ role: "user", content: { type: "text", text } }],
	};
}

function renderSummarizeRun(args: Record<string, string>): McpGetPromptResult {
	const runId = args.run_id ?? "<run-id>";

	const text = `Summarize the KOTA workflow run \`${runId}\` in plain language.

Read the run artifacts from \`.kota/runs/${runId}/\` and describe:
- Which workflow ran and what task it worked on
- What changes were made (files modified, tests run, commits staged)
- Whether the run succeeded or failed, and why
- Any notable issues or follow-ups`;

	return {
		description: `Summarize run: ${runId}`,
		messages: [{ role: "user", content: { type: "text", text } }],
	};
}
