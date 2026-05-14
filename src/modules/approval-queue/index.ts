/**
 * Approval-queue module — owns the ApprovalQueue state and operator CLI
 * for managing the tool-call approval queue.
 *
 * Owns the `kota approval` subcommands and the underlying ApprovalQueue
 * class used by core tool-runner and workflow code.
 */

import { Command } from "commander";
import { loadConfig } from "#core/config/config.js";
import type { ApprovalQueue, PendingApproval } from "#core/daemon/approval-queue.js";
import { getApprovalQueue } from "#core/daemon/approval-queue.js";
import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import type { KotaModule } from "#core/modules/module-types.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { registerApprovalCommands } from "./cli.js";
import type {
	ApprovalMutateResult,
	ApprovalProjectScope,
	ApprovalsClient,
	ApprovalsListResult,
} from "./client.js";
import { approvalControlRoutes, approvalRoutes } from "./routes.js";

export type { ApprovalStatus, PendingApproval } from "#core/daemon/approval-queue.js";
export { ApprovalQueue, getApprovalQueue, resetApprovalQueue } from "#core/daemon/approval-queue.js";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function resolveLocalApprovalQueue(projectId?: string): ApprovalQueue {
	const projectScope = getProviderRegistry()?.get(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE);
	if (!projectScope) return getApprovalQueue();
	const resolved = projectScope.resolveProjectRuntime(projectId);
	if (!resolved.ok) {
		throw new Error(`Unknown project: ${resolved.error.projectId}`);
	}
	return resolved.runtime.approvalQueue;
}

function approvalListPath(filter?: { status?: string; projectId?: string }): string {
	const params: string[] = [];
	if (filter?.status) params.push(`status=${encodeURIComponent(filter.status)}`);
	if (filter?.projectId) params.push(`projectId=${encodeURIComponent(filter.projectId)}`);
	const query = params.join("&");
	return query ? `/approvals?${query}` : "/approvals";
}

function approvalProjectQuery(project?: ApprovalProjectScope): string {
	if (!project?.projectId) return "";
	const params = new URLSearchParams();
	params.set("projectId", project.projectId);
	return `?${params.toString()}`;
}

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
				const queue = resolveLocalApprovalQueue(filter?.projectId);
				queue.expireStale(ttlMs);
				const status = filter?.status;
				if (status === undefined) return { approvals: queue.list("pending") };
				if (status === "all") return { approvals: queue.list() };
				return { approvals: queue.list(status) };
			},
			async approve(id, note, project) {
				const item = resolveLocalApprovalQueue(project?.projectId).approve(id, note);
				return item ? { ok: true, approval: item } : { ok: false, reason: "not_found" };
			},
			async reject(id, reason, project) {
				const item = resolveLocalApprovalQueue(project?.projectId).reject(id, reason);
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
			return link.requestStrict<ApprovalsListResult>(
				"GET",
				approvalListPath(filter),
			);
		},
		approve: async (id, note, project): Promise<ApprovalMutateResult> => {
			return mutateApproval(
				link,
				`/approvals/${encodeURIComponent(id)}/approve${approvalProjectQuery(project)}`,
				{ note },
			);
		},
		reject: async (id, reason, project): Promise<ApprovalMutateResult> => {
			return mutateApproval(
				link,
				`/approvals/${encodeURIComponent(id)}/reject${approvalProjectQuery(project)}`,
				{ reason },
			);
		},
	};
}

type ApprovalRouteErrorBody = {
	error?: string;
	reason?: string;
	projectId?: string;
};

async function mutateApproval(
	link: DaemonTransport,
	path: string,
	body: { note?: string } | { reason?: string },
): Promise<ApprovalMutateResult> {
	const res = await link.fetchRaw(path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (res.status === 404) {
		const errBody = await readApprovalRouteError(res);
		if (errBody?.reason === "unknown_project" && errBody.projectId) {
			throw new Error(`Unknown project: ${errBody.projectId}`);
		}
		return { ok: false, reason: "not_found" };
	}
	if (!res.ok) {
		const errBody = await readApprovalRouteError(res);
		throw new Error(errBody?.error ?? `HTTP ${res.status}`);
	}
	const data = (await res.json()) as { approval: PendingApproval };
	return { ok: true, approval: data.approval };
}

async function readApprovalRouteError(
	res: Response,
): Promise<ApprovalRouteErrorBody | null> {
	try {
		const parsed = (await res.json()) as ApprovalRouteErrorBody;
		return typeof parsed === "object" && parsed !== null ? parsed : null;
	} catch {
		return null;
	}
}

export default approvalQueueModule;
