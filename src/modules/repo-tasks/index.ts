/**
 * Repo-tasks module — owns KOTA's task-queue domain.
 *
 * Ships the `kota task` CLI subcommands, the `/api/tasks` HTTP routes, and the
 * domain model (state constants, path helpers, queue snapshot, task-status
 * response shape) in `repo-tasks-domain.ts`.
 */

import { Command } from "commander";
import type { KotaModule } from "#core/modules/module-types.js";
import { registerTaskCommands } from "./cli.js";
import { taskRoutes } from "./routes.js";

const repoTasksModule: KotaModule = {
	name: "repo-tasks",
	version: "1.0.0",
	description: "Operator CLI for the KOTA repo task queue",

	commands: () => {
		const root = new Command("__root__");
		registerTaskCommands(root);
		return root.commands as Command[];
	},

	routes: () => taskRoutes(),
};

export default repoTasksModule;
