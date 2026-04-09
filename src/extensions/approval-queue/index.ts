/**
 * Approval-queue extension — operator CLI for managing the tool-call approval queue.
 *
 * Owns the `kota approval` subcommands. The underlying ApprovalQueue state lives
 * in src/approval-queue.ts which is shared with core tool-runner and workflow code.
 */

import { Command } from "commander";
import type { KotaExtension } from "../../extension-types.js";
import { registerApprovalCommands } from "./cli.js";

const approvalQueueModule: KotaExtension = {
	name: "approval-queue",
	version: "1.0.0",
	description: "Operator CLI for the tool-call approval queue",

	commands: () => {
		const root = new Command("__root__");
		registerApprovalCommands(root);
		return root.commands as Command[];
	},
};

export default approvalQueueModule;
