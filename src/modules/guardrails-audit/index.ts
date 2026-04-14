/**
 * Guardrails-audit module — owns the guardrail audit trail.
 *
 * Initializes the audit store, subscribes to `guardrail.assessed` events from
 * tool-runner, and writes entries to `.kota/audit.jsonl`. Also provides the
 * `kota audit` CLI subcommands.
 */

import { Command } from "commander";
import type { KotaModule, ToolDef } from "#core/modules/module-types.js";
import { initAuditStore, resetAuditStore } from "#core/tools/audit-store.js";
import type { Policy, RiskLevel } from "#core/tools/guardrails.js";
import { auditTool, runAudit } from "./audit-tool.js";
import { registerAuditCommands } from "./cli.js";
import { handleListAudit } from "./routes.js";

const tools: ToolDef[] = [
	{
		tool: auditTool,
		runner: runAudit,
		risk: "safe",
		kind: "action",
		group: "management",
	},
];

const guardrailsAuditModule: KotaModule = {
	name: "guardrails-audit",
	version: "1.0.0",
	description: "Guardrail audit trail — logs all tool assessments to .kota/audit.jsonl",

	tools,

	commands: (_ctx) => {
		const root = new Command("__root__");
		registerAuditCommands(root);
		return root.commands as Command[];
	},

	routes: () => [
		{ method: "GET", path: "/api/audit", handler: handleListAudit },
	],

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
