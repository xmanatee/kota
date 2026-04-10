/**
 * Approval-queue module — owns the ApprovalQueue state and operator CLI
 * for managing the tool-call approval queue.
 *
 * Owns the `kota approval` subcommands and the underlying ApprovalQueue
 * class used by core tool-runner and workflow code.
 */

import { Command } from "commander";
import type { KotaModule } from "../../core/modules/module-types.js";
import { registerApprovalCommands } from "./cli.js";
import { approvalRoutes } from "./routes.js";

export type { ApprovalStatus, PendingApproval } from "./queue.js";
export { ApprovalQueue, getApprovalQueue, resetApprovalQueue } from "./queue.js";

const approvalQueueModule: KotaModule = {
	name: "approval-queue",
	version: "1.0.0",
	description: "Approval queue state and operator CLI for tool-call approvals",

	commands: () => {
		const root = new Command("__root__");
		registerApprovalCommands(root);
		return root.commands as Command[];
	},

	routes: () => approvalRoutes(),
};

export default approvalQueueModule;
