import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
	type ColumnsNode,
	columns,
	line,
	plain,
	type SemanticRole,
	span,
	stack,
} from "#modules/rendering/primitives.js";
import { print, printToStderr, writeJson, writeStdout } from "#modules/rendering/transport.js";
import type {
	RepoTaskState as ContractRepoTaskState,
	RepoTaskPriority,
	RepoTaskSearchFilter,
} from "./client.js";
import { renderRepoTaskSearchPlain } from "./render.js";
import {
	REPO_INBOX_DIR,
	REPO_TASK_STATES,
	type RepoTaskState,
} from "./repo-tasks-domain.js";

const ALLOWED_PRIORITIES: readonly RepoTaskPriority[] = ["p0", "p1", "p2", "p3"];

function isRepoTaskPriority(value: string): value is RepoTaskPriority {
	return (ALLOWED_PRIORITIES as readonly string[]).includes(value);
}

function collectStates(value: string, previous: RepoTaskState[]): RepoTaskState[] {
	if (!REPO_TASK_STATES.includes(value as RepoTaskState)) {
		printToStderr(line(span(`Unknown state "${value}". Valid: ${REPO_TASK_STATES.join(", ")}`, "error")));
		process.exit(1);
	}
	return [...previous, value as RepoTaskState];
}

export function registerTaskCommands(program: Command, ctx: ModuleContext): void {
	const taskCmd = program
		.command("task")
		.description("Inspect and manage the repo task queue");

	taskCmd
		.command("list")
		.description("List normalized tasks in the queue")
		.option(
			"-s, --state <state>",
			"Filter by state (open|blocked|done|dropped)",
		)
		.action(async (opts: { state?: string }) => {
			let states: RepoTaskState[] | undefined;
			if (opts.state) {
				if (!REPO_TASK_STATES.includes(opts.state as RepoTaskState)) {
					printToStderr(line(span(`Unknown state "${opts.state}". Valid: ${REPO_TASK_STATES.join(", ")}`, "error")));
					process.exit(1);
				}
				states = [opts.state as RepoTaskState];
			}

			const result = await ctx.client.tasks.list(states);
			if (result.tasks.length === 0) {
				print(line(plain("No tasks found.")));
				return;
			}

			print(buildTaskListNode(result.tasks));
		});

	taskCmd
		.command("show <id>")
		.description("Print the full content of a normalized task")
		.action(async (id: string) => {
			const result = await ctx.client.tasks.show(id);
			if (!result.found) {
				printToStderr(line(span(`Task "${id}" not found.`, "error")));
				process.exit(1);
			}
			writeStdout(result.content);
			if (!result.content.endsWith("\n")) writeStdout("\n");
		});

	taskCmd
		.command("move <id> <state>")
		.description("Move a normalized task to the target state, updating status frontmatter")
		.action(async (id: string, targetState: string) => {
			if (!REPO_TASK_STATES.includes(targetState as RepoTaskState)) {
				printToStderr(line(span(`Unknown state "${targetState}". Valid: ${REPO_TASK_STATES.join(", ")}`, "error")));
				process.exit(1);
			}
			const result = await ctx.client.tasks.move(id, targetState as RepoTaskState);
			if (result.ok) {
				print(line(
					plain("Moved "),
					span(`"${id}"`, "accent"),
					plain(` from "${result.fromState}" to `),
					span(`"${result.toState}"`, "success"),
					plain("."),
				));
				return;
			}
			if (result.reason === "already_in_state") {
				print(line(plain(`Task "${id}" is already in "${targetState}".`)));
				return;
			}
			if (result.reason === "invalid_id") {
				printToStderr(line(span(`Invalid task id "${id}".`, "error")));
				process.exit(1);
			}
			printToStderr(line(span(`Task "${id}" not found in any state directory`, "error")));
			process.exit(1);
		});

	taskCmd
		.command("create <title>")
		.description("Create a normalized task file with the recommended intent scaffold")
		.option("-p, --priority <priority>", "Priority: p0, p1, p2, p3", "p2")
		.option("-s, --state <state>", "Initial state (open or blocked)", "open")
		.action(async (title: string, opts: { priority: string; state: string }) => {
			if (!isRepoTaskPriority(opts.priority)) {
				printToStderr(line(span(`Invalid priority "${opts.priority}". Must be p0, p1, p2, or p3.`, "error")));
				process.exit(1);
			}
			if (opts.state !== "open" && opts.state !== "blocked") {
				printToStderr(line(span(`Unknown active state "${opts.state}". Valid: open, blocked`, "error")));
				process.exit(1);
			}
			const result = await ctx.client.tasks.create({
				title,
				priority: opts.priority,
				state: opts.state,
			});
			if (!result.ok) {
				printToStderr(line(span(result.message ?? `Failed to create task: ${result.reason}`, "error")));
				process.exit(1);
			}
			print(stack(
				line(
					plain("Created task "),
					span(`"${result.id}"`, "accent"),
					plain(" in data/tasks/. Edit the file to fill in sections."),
				),
				line(span(result.path, "muted")),
			));
		});

	taskCmd
		.command("search <query>")
		.description(
			"Search the task queue by intent (semantic by default; --keyword forces substring ranking).",
		)
		.option("-n, --limit <n>", "Max hits to show", "20")
		.option(
			"-s, --state <state>",
			"Restrict to one state (open|blocked|done|dropped). Repeatable.",
			collectStates,
			[] as RepoTaskState[],
		)
		.option("--keyword", "Use keyword/substring ranking instead of semantic")
		.option("--no-semantic", "Alias for --keyword")
		.option("--json", "Emit the structured { ok, tasks | reason } payload as JSON")
		.action(
			async (
				query: string,
				opts: {
					limit: string;
					state: RepoTaskState[];
					keyword?: boolean;
					semantic?: boolean;
					json?: boolean;
				},
			) => {
				const trimmed = query.trim();
				if (!trimmed) {
					printToStderr(line(span("Usage: kota task search <query>", "warn")));
					process.exit(1);
				}
				const limit = Number.parseInt(opts.limit, 10);
				if (!Number.isFinite(limit) || limit <= 0) {
					printToStderr(line(span(`Error: --limit must be a positive integer, got "${opts.limit}"`, "error")));
					process.exit(1);
				}
				const semantic = !(opts.keyword === true || opts.semantic === false);
				const filter: RepoTaskSearchFilter = { semantic, limit };
				if (opts.state.length > 0) filter.states = opts.state as ContractRepoTaskState[];
				const result = await ctx.client.tasks.search(trimmed, filter);

				if (opts.json) {
					writeJson(result);
					if (!result.ok) process.exit(1);
					return;
				}

				if (!result.ok) {
					printToStderr(line(span(
						"Semantic task search requires an embedding-backed repo-tasks provider. " +
							"Configure `providers.repo-tasks` to `tasks-semantic` or pass --keyword.",
						"error",
					)));
					process.exit(1);
				}

				if (result.tasks.length === 0) {
					print(line(plain("No matching tasks.")));
					return;
				}

				print(line(plain(renderRepoTaskSearchPlain(result.tasks))));
			},
		);

	taskCmd
		.command("reindex")
			.description(
				"Rebuild the semantic search index for all repo tasks. " +
					"Reports when no embedding provider is configured.",
		)
		.action(async () => {
			const result = await ctx.client.tasks.reindex();
				if (!result.ok) {
				print(line(plain(
					"Semantic search not configured — nothing to reindex. " +
						"Set `providers.repo-tasks` to an embedding-capable provider to enable.",
				)));
				return;
			}
			const failedRole = result.failed > 0 ? "error" : "muted";
			print(line(
				plain("Reindexed "),
				span(String(result.indexed), "success"),
				plain(" task(s) ("),
				span(`${result.failed} failed`, failedRole),
				plain(")."),
			));
			if (result.failed > 0) process.exit(1);
		});

	taskCmd
		.command("capture <title>")
		.description("Create a quick inbox capture under data/inbox")
		.action(async (title: string) => {
			const result = await ctx.client.tasks.capture(title);
			if (!result.ok) {
				printToStderr(line(span(result.message ?? `Failed to capture: ${result.reason}`, "error")));
				process.exit(1);
			}
			print(line(
				plain("Created inbox capture "),
				span(`"${result.id}"`, "accent"),
				plain(` in ${REPO_INBOX_DIR}.`),
			));
		});
}

export function buildTaskListNode(
	tasks: {
		id: string;
		priority: RepoTaskPriority | null;
		state: RepoTaskState;
		title: string;
		waitingOnTasks: string[];
	}[],
): ColumnsNode {
	return columns(
		[
			{ header: "ID", role: "accent" },
			{ header: "Pri", minWidth: 3 },
			{ header: "State", minWidth: 5 },
			{ header: "Title", maxWidth: 60 },
			{ header: "Waiting On", maxWidth: 42 },
		],
		tasks.map((t) => ({
			cells: [
				{ spans: [{ text: t.id, role: "accent" }] },
				{ spans: [{ text: t.priority ?? "—", role: priorityRole(t.priority) }] },
				{ spans: [{ text: t.state, role: stateRole(t.state) }] },
				{ spans: [{ text: t.title }] },
				{ spans: [{ text: t.waitingOnTasks.join(", "), role: "warn" }] },
			],
		})),
	);
}

function priorityRole(priority: RepoTaskPriority | null): SemanticRole {
	switch (priority) {
		case "p0":
			return "error";
		case "p1":
			return "warn";
		case "p2":
			return "info";
		default:
			return "muted";
	}
}

function stateRole(state: RepoTaskState): SemanticRole {
	switch (state) {
		case "open":
			return "success";
		case "blocked":
			return "warn";
		default:
			return "muted";
	}
}
