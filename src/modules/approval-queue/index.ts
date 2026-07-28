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
import {
	defaultApprovalPendingTtlMs,
	getApprovalQueue,
	isApprovalId,
} from "#core/daemon/approval-queue.js";
import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import type { KotaModule } from "#core/modules/module-types.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import {
	appendScopeSelector,
	encodeQueryParams,
	type ScopeSelector,
	scopeSelectorQuery,
	selectedScopeSelectorId,
} from "#core/server/scope-selector.js";
import { registerApprovalCommands } from "./cli.js";
import type {
	ApprovalExecutionProjection,
	ApprovalListFilter,
	ApprovalMutateResult,
	ApprovalProjectScope,
	ApprovalsClient,
	ApprovalsListResult,
} from "./client.js";
import { approvalControlRoutes, approvalRoutes } from "./routes.js";

export type { ApprovalStatus, PendingApproval } from "#core/daemon/approval-queue.js";
export { ApprovalQueue, getApprovalQueue, resetApprovalQueue } from "#core/daemon/approval-queue.js";

function resolveLocalApprovalQueue(selector?: ScopeSelector): ApprovalQueue {
	const projectScope = getProviderRegistry()?.get(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE);
	const projectId = selectedScopeSelectorId(selector);
	if (!projectScope) {
		if (projectId) throw new Error(`Unknown project: ${projectId}`);
		return getApprovalQueue();
	}
	const resolved = projectScope.resolveProjectRuntime(projectId);
	if (!resolved.ok) {
		throw new Error(`Unknown project: ${resolved.error.projectId}`);
	}
	return resolved.runtime.approvalQueue;
}

function approvalListPath(filter?: ApprovalListFilter): string {
	const params = new URLSearchParams();
	if (filter?.status) params.set("status", filter.status);
	appendScopeSelector(params, filter);
	const query = encodeQueryParams(params);
	return query ? `/approvals?${query}` : "/approvals";
}

function approvalProjectQuery(project?: ApprovalProjectScope): string {
	return scopeSelectorQuery(project);
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
				const ttlMs = config.approvalTtlMs ?? defaultApprovalPendingTtlMs();
				const queue = resolveLocalApprovalQueue(filter);
				queue.expireStale(ttlMs);
				const status = filter?.status;
				if (status === undefined) return { approvals: queue.list("pending") };
				if (status === "all") return { approvals: queue.list() };
				return { approvals: queue.list(status) };
			},
			async approve(id, note, project) {
				if (!isApprovalId(id)) return { ok: false, reason: "invalid_id" };
				const queue = resolveLocalApprovalQueue(project);
				const selection = queue.getExecutionSnapshot(id);
				if (!selection.ok) return { ok: false, reason: selection.reason };
				const result = queue.approveForExecution(selection.snapshot.descriptor, note);
				if (result.ok) return { ok: true, approval: result.approval };
				if (result.reason === "descriptor_mismatch") {
					throw new Error(`Approval ${id} changed after it was selected for execution`);
				}
				return { ok: false, reason: result.reason };
			},
			async reject(id, reason, project) {
				if (!isApprovalId(id)) return { ok: false, reason: "invalid_id" };
				const item = resolveLocalApprovalQueue(project).reject(id, reason);
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
 * mutations preserve `encodeURIComponent(id)` on the URL boundary; malformed
 * decoded IDs are rejected by the route. A `null` (404) result collapses into
 * `{ ok: false, reason: "not_found" }` to keep `ApprovalMutateResult`
 * intact across the daemon-up branch. A 400 invalid-id response stays
 * distinct as `{ ok: false, reason: "invalid_id" }`. A daemon approval can
 * include redacted execution status when the daemon executed the tool before
 * returning.
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
	if (res.status === 400) {
		const errBody = await readApprovalRouteError(res);
		if (errBody?.reason === "invalid_approval_id") {
			return { ok: false, reason: "invalid_id" };
		}
		throw new Error(errBody?.error ?? "Invalid approval request");
	}
	if (res.status === 409) {
		const errBody = await readApprovalRouteError(res);
		if (errBody?.reason === "approval_input_unavailable") {
			return { ok: false, reason: "input_unavailable" };
		}
		if (errBody?.reason === "approval_scope_mismatch") {
			return { ok: false, reason: "scope_mismatch" };
		}
		throw new Error(errBody?.error ?? "Approval cannot be executed");
	}
	if (!res.ok) {
		const errBody = await readApprovalRouteError(res);
		throw new Error(errBody?.error ?? `HTTP ${res.status}`);
	}
	const data = (await res.json()) as {
		approval: PendingApproval;
		execution?: ApprovalExecutionProjection;
	};
	return {
		ok: true,
		approval: data.approval,
		...(data.execution !== undefined ? { execution: data.execution } : {}),
	};
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
