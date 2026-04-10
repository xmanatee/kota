/**
 * Repo-tasks module — operator CLI for managing the KOTA task queue.
 *
 * Owns the `kota task` subcommands. The underlying RepoTask types and state
 * constants live in repo-tasks.ts, co-located in this module.
 */

import { Command } from "commander";
import type { KotaModule } from "../../core/modules/module-types.js";
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
