/**
 * Guardrails-audit extension — operator CLI for querying the guardrail audit trail.
 *
 * Owns the `kota audit` subcommands. The underlying AuditStore state lives
 * in src/guardrails-audit.ts which is shared with core tool-runner and loop code.
 */

import { Command } from "commander";
import type { KotaExtension } from "../../extension-types.js";
import { registerAuditCommands } from "./cli.js";

const guardrailsAuditModule: KotaExtension = {
	name: "guardrails-audit",
	version: "1.0.0",
	description: "Operator CLI for the guardrail audit trail",

	commands: () => {
		const root = new Command("__root__");
		registerAuditCommands(root);
		return root.commands as Command[];
	},
};

export default guardrailsAuditModule;
