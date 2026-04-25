/**
 * Approval-queue module — owns the ApprovalQueue state and operator CLI
 * for managing the tool-call approval queue.
 *
 * Owns the `kota approval` subcommands and the underlying ApprovalQueue
 * class used by core tool-runner and workflow code.
 */

import { Command } from "commander";
import { loadConfig } from "#core/config/config.js";
import { getApprovalQueue } from "#core/daemon/approval-queue.js";
import type { KotaModule } from "#core/modules/module-types.js";
import type { ApprovalsClient } from "#core/server/kota-client.js";
import { registerApprovalCommands } from "./cli.js";
import { approvalControlRoutes, approvalRoutes } from "./routes.js";

export type { ApprovalStatus, PendingApproval } from "#core/daemon/approval-queue.js";
export { ApprovalQueue, getApprovalQueue, resetApprovalQueue } from "#core/daemon/approval-queue.js";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

const approvalQueueModule: KotaModule = {
	name: "approval-queue",
	version: "1.0.0",
	description: "Approval queue state and operator CLI for tool-call approvals",
	dependencies: ["rendering"],

	commands: (ctx) => {
		const root = new Command("__root__");
		registerApprovalCommands(root, ctx);
		return root.commands as Command[];
	},

	routes: () => approvalRoutes(),
	controlRoutes: () => approvalControlRoutes(),

	localClient: () => {
		const handler: ApprovalsClient = {
			async list(filter) {
				const config = loadConfig();
				const ttlMs = config.approvalTtlMs ?? DEFAULT_TTL_MS;
				const queue = getApprovalQueue();
				queue.expireStale(ttlMs);
				const status = filter?.status;
				if (status === undefined) return { approvals: queue.list("pending") };
				if (status === "all") return { approvals: queue.list() };
				return { approvals: queue.list(status) };
			},
			async approve(id, note) {
				const item = getApprovalQueue().approve(id, note);
				return item ? { ok: true, approval: item } : { ok: false, reason: "not_found" };
			},
			async reject(id, reason) {
				const item = getApprovalQueue().reject(id, reason);
				return item ? { ok: true, approval: item } : { ok: false, reason: "not_found" };
			},
		};
		return { approvals: handler };
	},
};

export default approvalQueueModule;
