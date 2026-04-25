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
import { getRepoTasksDir } from "./repo-tasks-domain.js";
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
		};
		return { tasks: handler };
	},
};

export default repoTasksModule;
