/** Static MCP prompt definitions for the KOTA MCP server. */

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

const PROMPT_NAMES = new Set(KOTA_PROMPTS.map((p) => p.name));

export function isKnownPrompt(name: string): boolean {
	return PROMPT_NAMES.has(name);
}

/** Render a prompt into a messages array given its arguments. */
export function renderPrompt(
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
