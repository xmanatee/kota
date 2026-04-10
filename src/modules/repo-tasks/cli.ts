import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Command } from "commander";
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "#root/frontmatter.js";
import {
	getRepoInboxDir,
	getRepoTasksDir,
	REPO_INBOX_DIR,
	REPO_TASK_STATES,
	type RepoTaskState,
} from "#core/data/repo-tasks.js";

const OPEN_STATES: RepoTaskState[] = ["backlog", "ready", "doing", "blocked"];
const TERMINAL_STATES: RepoTaskState[] = ["done", "dropped"];

type TaskEntry = {
	id: string;
	priority: string;
	title: string;
	state: RepoTaskState;
};

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

export function findTask(
	tasksDir: string,
	id: string,
): { path: string; state: RepoTaskState; content: string } | null {
	for (const state of REPO_TASK_STATES) {
		const filePath = join(tasksDir, state, `${id}.md`);
		if (existsSync(filePath)) {
			return { path: filePath, state, content: readFileSync(filePath, "utf-8") };
		}
	}
	return null;
}

export function slugify(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, "")
		.trim()
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.slice(0, 50);
}

type GcResult = {
	archived: string[];
	deleted: string[];
};

export function gcTerminalTasks(
	projectDir: string,
	opts: { days?: number; delete?: boolean; dryRun?: boolean } = {},
): GcResult {
	const days = opts.days ?? 30;
	const deleteMode = opts.delete ?? false;
	const dryRun = opts.dryRun ?? false;
	const tasksDir = getRepoTasksDir(projectDir);
	const archiveDir = join(projectDir, ".kota", "task-archive");
	const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	const archived: string[] = [];
	const deleted: string[] = [];

	for (const state of TERMINAL_STATES) {
		const dir = join(tasksDir, state);
		let files: string[];
		try {
			files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "AGENTS.md");
		} catch {
			continue;
		}
		for (const file of files) {
			const filePath = join(dir, file);
			let updatedAt: Date | null = null;
			try {
				const content = readFileSync(filePath, "utf-8");
				const { attrs } = parseFlatFrontMatter(content);
				const raw = attrs.updated_at;
				if (raw) updatedAt = new Date(String(raw));
			} catch {
				continue;
			}
			if (!updatedAt || Number.isNaN(updatedAt.getTime()) || updatedAt >= cutoff) continue;
			if (deleteMode) {
				if (!dryRun) rmSync(filePath);
				deleted.push(file);
			} else {
				if (!dryRun) {
					mkdirSync(archiveDir, { recursive: true });
					renameSync(filePath, join(archiveDir, file));
				}
				archived.push(file);
			}
		}
	}

	return { archived, deleted };
}

export function registerTaskCommands(program: Command): void {
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
		.action((opts: { state?: string }) => {
			const tasksDir = getRepoTasksDir(process.cwd());
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

			const tasks = listTasksForStates(tasksDir, states);
			if (tasks.length === 0) {
				console.log("No tasks found.");
				return;
			}

			const idWidth = Math.max(...tasks.map((t) => t.id.length), 4);
			const prioWidth = 4;
			const stateWidth = Math.max(...tasks.map((t) => t.state.length), 5);
			console.log(
				`${"ID".padEnd(idWidth)}  ${"Pri".padEnd(prioWidth)}  ${"State".padEnd(stateWidth)}  Title`,
			);
			console.log("-".repeat(idWidth + prioWidth + stateWidth + 12));
			for (const t of tasks) {
				console.log(
					`${t.id.padEnd(idWidth)}  ${t.priority.padEnd(prioWidth)}  ${t.state.padEnd(stateWidth)}  ${t.title}`,
				);
			}
		});

	taskCmd
		.command("show <id>")
		.description("Print the full content of a normalized task")
		.action((id: string) => {
			const found = findTask(getRepoTasksDir(process.cwd()), id);
			if (!found) {
				console.error(`Task "${id}" not found.`);
				process.exit(1);
			}
			process.stdout.write(found.content);
			if (!found.content.endsWith("\n")) console.log();
		});

	taskCmd
		.command("move <id> <state>")
		.description("Move a normalized task to the target state, updating status frontmatter")
		.action((id: string, targetState: string) => {
			if (!REPO_TASK_STATES.includes(targetState as RepoTaskState)) {
				console.error(`Unknown state "${targetState}". Valid: ${REPO_TASK_STATES.join(", ")}`);
				process.exit(1);
			}
			const tasksDir = getRepoTasksDir(process.cwd());
			const found = findTask(tasksDir, id);
			if (!found) {
				console.error(`Task "${id}" not found.`);
				process.exit(1);
			}
			if (found.state === targetState) {
				console.log(`Task "${id}" is already in "${targetState}".`);
				return;
			}

			const dstPath = join(tasksDir, targetState, `${id}.md`);
			const { attrs, body } = parseFlatFrontMatter(found.content);
			attrs.status = targetState;
			attrs.updated_at = new Date().toISOString();
			const updated = serializeFlatFrontMatter(attrs, body);

			execSync(`git mv "${found.path}" "${dstPath}"`, { cwd: process.cwd() });
			writeFileSync(dstPath, updated, "utf-8");
			execSync(`git add "${dstPath}"`, { cwd: process.cwd() });

			console.log(`Moved "${id}" from "${found.state}" to "${targetState}".`);
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
		.action((opts: { days?: string; delete?: boolean; dryRun?: boolean }) => {
			const days = opts.days != null ? Number.parseInt(opts.days, 10) : 30;
			if (Number.isNaN(days) || days <= 0) {
				console.error("--days must be a positive number");
				process.exit(1);
			}
			const result = gcTerminalTasks(process.cwd(), {
				days,
				delete: opts.delete,
				dryRun: opts.dryRun,
			});
			const affected = opts.delete ? result.deleted : result.archived;
			if (affected.length === 0) {
				console.log("Nothing to archive.");
				return;
			}
			const verb = opts.dryRun
				? opts.delete ? "Would delete" : "Would archive"
				: opts.delete ? "Deleted" : "Archived";
			console.log(`${verb} ${affected.length} task${affected.length === 1 ? "" : "s"}:`);
			for (const f of affected) {
				console.log(`  ${f}`);
			}
			if (opts.dryRun) console.log("\n(dry run — nothing was changed)");
		});

	taskCmd
		.command("capture <title>")
		.description("Create a quick inbox capture under data/inbox")
		.action((title: string) => {
			const slug = slugify(title);
			if (!slug) {
				console.error("Title produced an empty slug. Use a more descriptive title.");
				process.exit(1);
			}

			const id = `task-${slug}`;
			const inboxDir = getRepoInboxDir(process.cwd());
			mkdirSync(inboxDir, { recursive: true });
			const filePath = join(inboxDir, `${id}.md`);

			if (existsSync(filePath)) {
				console.error(`Inbox file "${id}.md" already exists.`);
				process.exit(1);
			}

			writeFileSync(filePath, `# ${title}\n`, "utf-8");
			console.log(`Created inbox capture "${id}" in ${REPO_INBOX_DIR}.`);
		});
}
