/**
 * Approval-queue module — owns the ApprovalQueue state and operator CLI
 * for managing the tool-call approval queue.
 *
 * Owns the `kota approval` subcommands and the underlying ApprovalQueue
 * class used by core tool-runner and workflow code.
 */

import { Command } from "commander";
import type { KotaModule } from "#core/modules/module-types.js";
import { registerApprovalCommands } from "./cli.js";
import { approvalControlRoutes, approvalRoutes } from "./routes.js";

export type { ApprovalStatus, PendingApproval } from "#core/daemon/approval-queue.js";
export { ApprovalQueue, getApprovalQueue, resetApprovalQueue } from "#core/daemon/approval-queue.js";

const approvalQueueModule: KotaModule = {
	name: "approval-queue",
	version: "1.0.0",
	description: "Approval queue state and operator CLI for tool-call approvals",
	dependencies: ["rendering"],

	commands: () => {
		const root = new Command("__root__");
		registerApprovalCommands(root);
		return root.commands as Command[];
	},

	routes: () => approvalRoutes(),
	controlRoutes: () => approvalControlRoutes(),
};

export default approvalQueueModule;
