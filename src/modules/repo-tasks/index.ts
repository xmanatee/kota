/**
 * Repo-tasks extension — operator CLI for managing the KOTA task queue.
 *
 * Owns the `kota task` subcommands. The underlying RepoTask types and state
 * constants live in src/repo-tasks.ts which is shared with workflow code.
 */

import { Command } from "commander";
import type { KotaExtension } from "../../extension-types.js";
import { registerTaskCommands } from "./cli.js";

const repoTasksModule: KotaExtension = {
	name: "repo-tasks",
	version: "1.0.0",
	description: "Operator CLI for the KOTA repo task queue",

	commands: () => {
		const root = new Command("__root__");
		registerTaskCommands(root);
		return root.commands as Command[];
	},
};

export default repoTasksModule;
