import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { registerApprovalApproveCommands } from "./cli-approve.js";
import { registerApprovalReadCommands } from "./cli-list-history.js";
import { registerApprovalRejectCommands } from "./cli-reject.js";

export function registerApprovalCommands(program: Command, ctx: ModuleContext): void {
	const approval = program
		.command("approval")
		.description("Manage the tool-call approval queue");
	registerApprovalReadCommands(approval, ctx);
	registerApprovalApproveCommands(approval, ctx);
	registerApprovalRejectCommands(approval, ctx);
}
