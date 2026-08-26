import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import {
	blank,
	type ColumnsNode,
	columns,
	type LineNode,
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
	listRepoTaskDependencyWaits,
	REPO_INBOX_DIR,
	REPO_TASK_STATES,
	type RepoTaskState,
} from "./repo-tasks-domain.js";

const OPEN_STATES: RepoTaskState[] = ["backlog", "ready", "doing", "blocked"];
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

type TaskEntry = {
	id: string;
	priority: string;
	title: string;
	state: RepoTaskState;
	waitingOnTasks: string[];
};

/**
 * Read the on-disk normalized tasks for the given states. Used by both the
 * local-side `tasks.list` handler and the CLI's table renderer.
 */
export function listTasksForStates(tasksDir: string, states: RepoTaskState[]): TaskEntry[] {
	const results: TaskEntry[] = [];
	const projectDir = dirname(dirname(tasksDir));
	const waitingById = new Map(
		listRepoTaskDependencyWaits(projectDir, states).map((wait) => [
			wait.id,
			wait.waitingOn,
		]),
	);
	for (const state of states) {
		const dir = join(tasksDir, state);
		let files: string[];
		try {
			files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "AGENTS.md");
		} catch {
			continue;
		}
		for (const file of files) {
			try {
				const content = readFileSync(join(dir, file), "utf-8");
				const { attrs } = parseFlatFrontMatter(content);
				results.push({
					id: String(attrs.id || basename(file, ".md")),
					priority: String(attrs.priority || ""),
					title: String(attrs.title || "(no title)"),
					state,
					waitingOnTasks: waitingById.get(String(attrs.id || basename(file, ".md"))) ?? [],
				});
			} catch {
				results.push({
					id: basename(file, ".md"),
					priority: "",
					title: "(unreadable)",
					state,
					waitingOnTasks: [],
				});
			}
		}
	}
	return results;
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
			"Filter by state (backlog|ready|doing|blocked|done|dropped)",
		)
		.action(async (opts: { state?: string }) => {
			let states: RepoTaskState[];
			if (opts.state) {
				if (!REPO_TASK_STATES.includes(opts.state as RepoTaskState)) {
					printToStderr(line(span(`Unknown state "${opts.state}". Valid: ${REPO_TASK_STATES.join(", ")}`, "error")));
					process.exit(1);
				}
				states = [opts.state as RepoTaskState];
			} else {
				states = OPEN_STATES;
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
		.command("gc")
		.description(
			"Remove terminal tasks (done, dropped) older than a threshold.\n\n" +
			"  Removed tasks remain available in Git history. Only done and dropped tasks are eligible.",
		)
		.option("--days <n>", "Remove tasks older than N days (default: 30)")
		.option("--dry-run", "Print what would be done without mutating anything")
		.action(async (opts: { days?: string; dryRun?: boolean }) => {
			const days = opts.days != null ? Number.parseInt(opts.days, 10) : 30;
			if (Number.isNaN(days) || days <= 0) {
				printToStderr(line(span("--days must be a positive number", "error")));
				process.exit(1);
			}
			const result = await ctx.client.tasks.gc({
				days,
				...(opts.dryRun !== undefined && { dryRun: opts.dryRun }),
			});
			const affected = result.removed;
			if (affected.length === 0) {
				print(line(plain("Nothing to remove.")));
				return;
			}
			const verb = opts.dryRun
				? "Would remove"
				: "Removed";
			const header: LineNode = line(plain(
				`${verb} ${affected.length} task${affected.length === 1 ? "" : "s"}:`,
			));
			const rows: LineNode[] = affected.map((f) => line(plain(`  ${f}`)));
			print(stack(header, ...rows));
			if (opts.dryRun) {
				print(stack(blank(), line(span("(dry run — nothing was changed)", "muted"))));
			}
		});

	taskCmd
		.command("create <title>")
		.description("Create a normalized task file with the recommended intent scaffold")
		.option("-p, --priority <priority>", "Priority: p0, p1, p2, p3", "p2")
		.option("-a, --area <area>", "Area (e.g. core, architecture, modules)", "core")
		.option("-s, --state <state>", "Initial state directory", "backlog")
		.option("--summary <summary>", "One-line summary")
		.action(async (title: string, opts: { priority: string; area: string; state: string; summary?: string }) => {
			if (!isRepoTaskPriority(opts.priority)) {
				printToStderr(line(span(`Invalid priority "${opts.priority}". Must be p0, p1, p2, or p3.`, "error")));
				process.exit(1);
			}
			if (!REPO_TASK_STATES.includes(opts.state as RepoTaskState)) {
				printToStderr(line(span(`Unknown state "${opts.state}". Valid: ${REPO_TASK_STATES.join(", ")}`, "error")));
				process.exit(1);
			}
			const result = await ctx.client.tasks.create({
				title,
				priority: opts.priority,
				area: opts.area,
				state: opts.state as RepoTaskState,
				...(opts.summary !== undefined && { summary: opts.summary }),
			});
			if (!result.ok) {
				printToStderr(line(span(result.message ?? `Failed to create task: ${result.reason}`, "error")));
				process.exit(1);
			}
			print(stack(
				line(
					plain("Created task "),
					span(`"${result.id}"`, "accent"),
					plain(` in ${opts.state}/. Edit the file to fill in sections.`),
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
			"Restrict to one state (backlog|ready|doing|blocked|done|dropped). Repeatable.",
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
				"No-op when no embedding provider is configured.",
		)
		.action(async () => {
			const result = await ctx.client.tasks.reindex();
			if (result.skipped) {
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
		priority: string;
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
				{ spans: [{ text: t.priority, role: priorityRole(t.priority) }] },
				{ spans: [{ text: t.state, role: stateRole(t.state) }] },
				{ spans: [{ text: t.title }] },
				{ spans: [{ text: t.waitingOnTasks.join(", "), role: "warn" }] },
			],
		})),
	);
}

function priorityRole(priority: string): SemanticRole {
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
		case "doing":
			return "accent";
		case "ready":
			return "success";
		case "blocked":
			return "warn";
		default:
			return "muted";
	}
}
