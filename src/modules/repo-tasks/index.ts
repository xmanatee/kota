/**
 * Repo-tasks module — owns KOTA's task-queue domain.
 *
 * Ships the `kota task` CLI subcommands, the `/api/tasks` HTTP routes, and the
 * domain model (state constants, path helpers, queue snapshot, task-status
 * response shape) in `repo-tasks-domain.ts`.
 */

import { Command } from "commander";
import type { KotaModule } from "#core/modules/module-types.js";
import type {
	RepoTaskListEntry,
	RepoTaskState,
	RepoTasksClient,
} from "#core/server/kota-client.js";
import { listTasksForStates, registerTaskCommands } from "./cli.js";
import { getRepoTasksDir, moveTaskById } from "./repo-tasks-domain.js";
import {
	captureInboxTask,
	createNormalizedTask,
	gcTerminalTasks,
	showTask,
} from "./repo-tasks-operations.js";
import { taskRoutes } from "./routes.js";

const REPO_TASK_OPEN_STATES: RepoTaskState[] = [
	"backlog",
	"ready",
	"doing",
	"blocked",
];

const repoTasksModule: KotaModule = {
	name: "repo-tasks",
	version: "1.0.0",
	description: "Operator CLI for the KOTA repo task queue",
	dependencies: ["rendering"],

	commands: (ctx) => {
		const root = new Command("__root__");
		registerTaskCommands(root, ctx);
		return root.commands as Command[];
	},

	routes: () => taskRoutes(),

	localClient: (ctx) => {
		const handler: RepoTasksClient = {
			async list(states) {
				const tasksDir = getRepoTasksDir(ctx.cwd);
				const wanted = states && states.length > 0 ? states : REPO_TASK_OPEN_STATES;
				const tasks: RepoTaskListEntry[] = listTasksForStates(tasksDir, wanted);
				return { tasks };
			},
			async show(id) {
				return showTask(ctx.cwd, id);
			},
			async move(id, toState) {
				try {
					const result = moveTaskById(ctx.cwd, id, toState);
					return {
						ok: true,
						id: result.id,
						fromState: result.fromState,
						toState: result.toState,
						path: result.path,
						previousPath: result.previousPath,
					};
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					if (/not found/i.test(message)) {
						return { ok: false, reason: "not_found" };
					}
					if (/already in/i.test(message)) {
						return { ok: false, reason: "already_in_state", state: toState };
					}
					throw err;
				}
			},
			async create(options) {
				return createNormalizedTask(ctx.cwd, options);
			},
			async capture(title) {
				return captureInboxTask(ctx.cwd, title);
			},
			async gc(options) {
				return gcTerminalTasks(ctx.cwd, options ?? {});
			},
		};
		return { tasks: handler };
	},
};

export default repoTasksModule;
