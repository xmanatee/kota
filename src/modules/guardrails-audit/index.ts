/**
 * Guardrails-audit module — owns the guardrail audit trail.
 *
 * Initializes the audit store, subscribes to `guardrail.assessed` events from
 * tool-runner, and writes entries to `.kota/audit.jsonl`. Also provides the
 * `kota audit` CLI subcommands.
 */

import { Command } from "commander";
import type { Policy, RiskLevel } from "../../guardrails.js";
import type { KotaModule } from "../../module-types.js";
import { registerAuditCommands } from "./cli.js";
import { initAuditStore, resetAuditStore } from "./store.js";

const guardrailsAuditModule: KotaModule = {
	name: "guardrails-audit",
	version: "1.0.0",
	description: "Guardrail audit trail — logs all tool assessments to .kota/audit.jsonl",

	commands: (_ctx) => {
		const root = new Command("__root__");
		registerAuditCommands(root);
		return root.commands as Command[];
	},

	onLoad(ctx) {
		const store = initAuditStore(ctx.cwd);
		ctx.events.subscribe("guardrail.assessed", (payload) => {
			const { tool, risk, policy, reason, session } = payload as {
				tool: string;
				risk: string;
				policy: string;
				reason: string;
				session?: string;
			};
			store.record({ tool, risk: risk as RiskLevel, policy: policy as Policy, reason }, session);
		});
	},

	onUnload() {
		resetAuditStore();
	},
};

export default guardrailsAuditModule;
