import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import type {
	RepoTaskState as ContractRepoTaskState,
	RepoTaskPriority,
	RepoTaskSearchFilter,
} from "#core/server/kota-client.js";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import {
	blank,
	type LineNode,
	line,
	plain,
	span,
	stack,
} from "#modules/rendering/primitives.js";
import { print, TerminalTransport } from "#modules/rendering/transport.js";
import { renderRepoTaskSearchPlain } from "./render.js";
import {
	REPO_INBOX_DIR,
	REPO_TASK_STATES,
	type RepoTaskState,
} from "./repo-tasks-domain.js";

const OPEN_STATES: RepoTaskState[] = ["backlog", "ready", "doing", "blocked"];
const ALLOWED_PRIORITIES: readonly RepoTaskPriority[] = ["p0", "p1", "p2", "p3"];

function isRepoTaskPriority(value: string): value is RepoTaskPriority {
	return (ALLOWED_PRIORITIES as readonly string[]).includes(value);
}

let stderrRenderer: TerminalTransport | null = null;
function stderrTransport(): TerminalTransport {
	if (!stderrRenderer) stderrRenderer = new TerminalTransport({ stream: process.stderr });
	return stderrRenderer;
}

function collectStates(value: string, previous: RepoTaskState[]): RepoTaskState[] {
	if (!REPO_TASK_STATES.includes(value as RepoTaskState)) {
		console.error(`Unknown state "${value}". Valid: ${REPO_TASK_STATES.join(", ")}`);
		process.exit(1);
	}
	return [...previous, value as RepoTaskState];
}

type TaskEntry = {
	id: string;
	priority: string;
	title: string;
	state: RepoTaskState;
};

/**
 * Read the on-disk normalized tasks for the given states. Used by both the
 * local-side `tasks.list` handler and the CLI's table renderer.
 */
export function listTasksForStates(tasksDir: string, states: RepoTaskState[]): TaskEntry[] {
	const results: TaskEntry[] = [];
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
				});
			} catch {
				results.push({ id: basename(file, ".md"), priority: "", title: "(unreadable)", state });
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
					console.error(`Unknown state "${opts.state}". Valid: ${REPO_TASK_STATES.join(", ")}`);
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

			print(stack(...buildTaskListLines(result.tasks)));
		});

	taskCmd
		.command("show <id>")
		.description("Print the full content of a normalized task")
		.action(async (id: string) => {
			const result = await ctx.client.tasks.show(id);
			if (!result.found) {
				console.error(`Task "${id}" not found.`);
				process.exit(1);
			}
			process.stdout.write(result.content);
			if (!result.content.endsWith("\n")) process.stdout.write("\n");
		});

	taskCmd
		.command("move <id> <state>")
		.description("Move a normalized task to the target state, updating status frontmatter")
		.action(async (id: string, targetState: string) => {
			if (!REPO_TASK_STATES.includes(targetState as RepoTaskState)) {
				console.error(`Unknown state "${targetState}". Valid: ${REPO_TASK_STATES.join(", ")}`);
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
			console.error(`Task "${id}" not found in any state directory`);
			process.exit(1);
		});

	taskCmd
		.command("gc")
		.description(
			"Archive or delete terminal tasks (done, dropped) older than a threshold.\n\n" +
			"  Tasks are moved to .kota/task-archive/ by default. Pass --delete to remove\n" +
			"  them permanently. Only done and dropped tasks are eligible.",
		)
		.option("--days <n>", "Archive tasks older than N days (default: 30)")
		.option("--delete", "Permanently delete instead of archiving")
		.option("--dry-run", "Print what would be done without mutating anything")
		.action(async (opts: { days?: string; delete?: boolean; dryRun?: boolean }) => {
			const days = opts.days != null ? Number.parseInt(opts.days, 10) : 30;
			if (Number.isNaN(days) || days <= 0) {
				console.error("--days must be a positive number");
				process.exit(1);
			}
			const result = await ctx.client.tasks.gc({
				days,
				...(opts.delete !== undefined && { delete: opts.delete }),
				...(opts.dryRun !== undefined && { dryRun: opts.dryRun }),
			});
			const affected = opts.delete ? result.deleted : result.archived;
			if (affected.length === 0) {
				print(line(plain("Nothing to archive.")));
				return;
			}
			const verb = opts.dryRun
				? opts.delete ? "Would delete" : "Would archive"
				: opts.delete ? "Deleted" : "Archived";
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
		.description("Create a normalized task file with all required structure")
		.option("-p, --priority <priority>", "Priority: p0, p1, p2, p3", "p2")
		.option("-a, --area <area>", "Area (e.g. core, architecture, modules)", "core")
		.option("-s, --state <state>", "Initial state directory", "backlog")
		.option("--summary <summary>", "One-line summary")
		.action(async (title: string, opts: { priority: string; area: string; state: string; summary?: string }) => {
			if (!isRepoTaskPriority(opts.priority)) {
				console.error(`Invalid priority "${opts.priority}". Must be p0, p1, p2, or p3.`);
				process.exit(1);
			}
			if (!REPO_TASK_STATES.includes(opts.state as RepoTaskState)) {
				console.error(`Unknown state "${opts.state}". Valid: ${REPO_TASK_STATES.join(", ")}`);
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
				console.error(result.message ?? `Failed to create task: ${result.reason}`);
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
					stderrTransport().write(line(span("Usage: kota task search <query>", "warn")));
					process.exit(1);
				}
				const limit = Number.parseInt(opts.limit, 10);
				if (!Number.isFinite(limit) || limit <= 0) {
					stderrTransport().write(
						line(span(`Error: --limit must be a positive integer, got "${opts.limit}"`, "error")),
					);
					process.exit(1);
				}
				const semantic = !(opts.keyword === true || opts.semantic === false);
				const filter: RepoTaskSearchFilter = { semantic, limit };
				if (opts.state.length > 0) filter.states = opts.state as ContractRepoTaskState[];
				const result = await ctx.client.tasks.search(trimmed, filter);

				if (opts.json) {
					process.stdout.write(`${JSON.stringify(result)}\n`);
					if (!result.ok) process.exit(1);
					return;
				}

				if (!result.ok) {
					stderrTransport().write(line(span(
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
				console.error(result.message ?? `Failed to capture: ${result.reason}`);
				process.exit(1);
			}
			print(line(
				plain("Created inbox capture "),
				span(`"${result.id}"`, "accent"),
				plain(` in ${REPO_INBOX_DIR}.`),
			));
		});
}

export function buildTaskListLines(
	tasks: { id: string; priority: string; state: RepoTaskState; title: string }[],
): LineNode[] {
	const idWidth = Math.max(...tasks.map((t) => t.id.length), 4);
	const prioWidth = 4;
	const stateWidth = Math.max(...tasks.map((t) => t.state.length), 5);
	const header = line(span(
		`${"ID".padEnd(idWidth)}  ${"Pri".padEnd(prioWidth)}  ${"State".padEnd(stateWidth)}  Title`,
		"muted",
		true,
	));
	const rule = line(span("-".repeat(idWidth + prioWidth + stateWidth + 12), "muted"));
	const rows: LineNode[] = tasks.map((t) => line(
		plain(`${t.id.padEnd(idWidth)}  `),
		span(t.priority.padEnd(prioWidth), priorityRole(t.priority)),
		plain("  "),
		span(t.state.padEnd(stateWidth), stateRole(t.state)),
		plain(`  ${t.title}`),
	));
	return [header, rule, ...rows];
}

function priorityRole(priority: string): "error" | "warn" | "info" | "muted" {
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

function stateRole(state: RepoTaskState): "success" | "warn" | "accent" | "muted" {
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
