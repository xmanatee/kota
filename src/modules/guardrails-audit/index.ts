/**
 * Guardrails-audit module — owns the guardrail audit trail.
 *
 * Initializes the audit store, subscribes to `guardrail.assessed` events from
 * tool-runner, and writes entries to `.kota/audit.jsonl`. Also provides the
 * `kota audit` CLI subcommands and the `audit` KotaClient namespace.
 *
 * The audit namespace is fully module-owned: types live in `./client.ts`,
 * the daemon HTTP route lives in `./audit-control-routes.ts`,
 * `localClient(ctx)` exposes the in-process handler, and `daemonClient(link)`
 * exposes the daemon-up handler that calls the same route through the typed
 * `DaemonTransport`.
 */


import { Command } from "commander";
import type { KotaModule, ToolDef } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { initAuditStore, resetAuditStore } from "#core/tools/audit-store.js";
import { readOnlyDaemonEffect } from "#core/tools/effect.js";
import type { Policy, RiskLevel } from "#core/tools/guardrails.js";
import { auditControlRoutes } from "./audit-control-routes.js";
import { listAuditEntries } from "./audit-operations.js";
import { auditTool, runAudit } from "./audit-tool.js";
import { registerAuditCommands } from "./cli.js";
import type {
	AuditClient,
	AuditListFilter,
	AuditListResult,
} from "./client.js";
import { handleListAudit } from "./routes.js";

const tools: ToolDef[] = [
	{
		tool: auditTool,
		runner: runAudit,
		effect: readOnlyDaemonEffect(),
		group: "management",
	},
];

/**
 * Daemon-side `AuditClient` backed by the typed `DaemonTransport`. Calls the
 * same `/audit` HTTP route the daemon registers through
 * `auditControlRoutes(ctx)`. The transport surface owns the bearer token,
 * base URL, and timeout policy — this factory only encodes the wire shape.
 *
 * Query-string serialization mirrors the route's `parseFilter` byte-for-byte
 * so daemon-up callers exercise the same parsing path as direct HTTP
 * clients.
 */
function buildAuditDaemonHandler(link: DaemonTransport): AuditClient {
	return {
		list: async (filter?: AuditListFilter): Promise<AuditListResult> => {
			const params = new URLSearchParams();
			if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
			if (filter?.tool) params.set("tool", filter.tool);
			if (filter?.risk) params.set("risk", filter.risk);
			if (filter?.policy) params.set("policy", filter.policy);
			if (filter?.since) params.set("since", filter.since);
			if (filter?.session) params.set("session", filter.session);
			const query = params.toString() ? `?${params.toString()}` : "";
			return link.requestStrict<AuditListResult>("GET", `/audit${query}`);
		},
	};
}

const guardrailsAuditModule: KotaModule = {
	name: "guardrails-audit",
	version: "1.0.0",
	description: "Guardrail audit trail — logs all tool assessments to .kota/audit.jsonl",
	dependencies: ["rendering"],

	tools,

	commands: (ctx) => {
		const root = new Command("__root__");
		registerAuditCommands(root, ctx);
		return root.commands as Command[];
	},

	routes: () => [
		{ method: "GET", path: "/api/audit", handler: handleListAudit },
	],

	controlRoutes: (ctx) => auditControlRoutes(ctx),

	localClient: (ctx) => {
		const audit: AuditClient = {
			async list(filter) {
				return listAuditEntries(ctx, filter);
			},
		};
		return { audit };
	},

	daemonClient: (link) => ({ audit: buildAuditDaemonHandler(link) }),

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
