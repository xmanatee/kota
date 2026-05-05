/**
 * Approval-queue module — owns the ApprovalQueue state and operator CLI
 * for managing the tool-call approval queue.
 *
 * Owns the `kota approval` subcommands and the underlying ApprovalQueue
 * class used by core tool-runner and workflow code.
 */

import { Command } from "commander";
import { loadConfig } from "#core/config/config.js";
import type { PendingApproval } from "#core/daemon/approval-queue.js";
import { getApprovalQueue } from "#core/daemon/approval-queue.js";
import type { KotaModule } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { registerApprovalCommands } from "./cli.js";
import type {
	ApprovalMutateResult,
	ApprovalsClient,
	ApprovalsListResult,
} from "./client.js";
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

	daemonClient: (link) => ({ approvals: buildApprovalsDaemonHandler(link) }),
};

/**
 * Daemon-side `ApprovalsClient` backed by the typed `DaemonTransport`. Calls
 * the same `/approvals`, `/approvals/:id/approve`, and
 * `/approvals/:id/reject` HTTP routes the approval-queue module registers
 * through `approvalControlRoutes`. The transport surface owns the bearer
 * token, base URL, and timeout policy — this factory only encodes the wire
 * shape.
 *
 * `list()` omits the `?status=` query string when the caller does not
 * supply `filter.status`; the daemon route's `readStatusFilter` defaults to
 * `pending` when no query is present, matching the local handler. The two
 * mutations preserve `encodeURIComponent(id)` so embedded slashes,
 * percents, or spaces in the approval id continue to round-trip safely;
 * a `null` (404) result collapses into
 * `{ ok: false, reason: "not_found" }` to keep `ApprovalMutateResult`
 * intact across the daemon-up branch.
 */
function buildApprovalsDaemonHandler(link: DaemonTransport): ApprovalsClient {
	return {
		list: async (filter): Promise<ApprovalsListResult> => {
			const path = filter?.status
				? `/approvals?status=${encodeURIComponent(filter.status)}`
				: "/approvals";
			return link.requestStrict<ApprovalsListResult>("GET", path);
		},
		approve: async (id, note): Promise<ApprovalMutateResult> => {
			const result = await link.request<{ approval: PendingApproval }>(
				"POST",
				`/approvals/${encodeURIComponent(id)}/approve`,
				{ note },
			);
			return result
				? { ok: true, approval: result.approval }
				: { ok: false, reason: "not_found" };
		},
		reject: async (id, reason): Promise<ApprovalMutateResult> => {
			const result = await link.request<{ approval: PendingApproval }>(
				"POST",
				`/approvals/${encodeURIComponent(id)}/reject`,
				{ reason },
			);
			return result
				? { ok: true, approval: result.approval }
				: { ok: false, reason: "not_found" };
		},
	};
}

export default approvalQueueModule;
