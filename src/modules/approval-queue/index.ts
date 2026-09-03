/**
 * Approval-queue module — owns the ApprovalQueue state and operator CLI
 * for managing the tool-call approval queue.
 *
 * Owns the `kota approval` subcommands and the underlying ApprovalQueue
 * class used by core tool-runner and workflow code.
 */

import { Command } from "commander";
import type { PendingApproval } from "#core/daemon/approval-queue.js";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import type { KotaModule } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import {
	appendScopeSelector,
	encodeQueryParams,
	scopeSelectorQuery,
} from "#core/server/scope-selector.js";
import { registerApprovalCommands } from "./cli.js";
import type {
	ApprovalApproveResult,
	ApprovalListFilter,
	ApprovalRejectResult,
	ApprovalResolutionProjection,
	ApprovalScopeSelection,
	ApprovalsClient,
	ApprovalsListResult,
} from "./client.js";
import { buildLocalApprovalsClient } from "./local-client.js";
import { approvalControlRoutes, approvalRoutes } from "./routes.js";
import { approvalUiSurfaceSource } from "./ui-surface.js";

export type {
	ApprovalClockPort,
	ApprovalPersistencePort,
	ApprovalStatus,
	PendingApproval,
	StoredApproval,
} from "#core/daemon/approval-queue.js";
export { ApprovalQueue, getApprovalQueue, resetApprovalQueue } from "#core/daemon/approval-queue.js";

function approvalListPath(filter?: ApprovalListFilter): string {
	const params = new URLSearchParams();
	if (filter?.status) params.set("status", filter.status);
	appendScopeSelector(params, filter);
	const query = encodeQueryParams(params);
	return query ? `/approvals?${query}` : "/approvals";
}

function approvalScopeQuery(scopeSelector?: ApprovalScopeSelection): string {
	return scopeSelectorQuery(scopeSelector);
}

const approvalQueueModule: KotaModule = {
	name: "approval-queue",
	version: "1.0.0",
	description: "Approval queue state and operator CLI for tool calls and workflow gates",
	dependencies: ["rendering"],
	uiSurfaces: [approvalUiSurfaceSource],

	commands: (ctx) => {
		const root = new Command("__root__");
		registerApprovalCommands(root, ctx);
		return root.commands as Command[];
	},

	routes: () => approvalRoutes(),
	controlRoutes: (ctx) =>
		approvalControlRoutes(() => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE)),

	localClient: () => ({ approvals: buildLocalApprovalsClient() }),

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
 * `{ ok: false, reason: "not_found" }` to keep the typed mutation result
 * intact across the daemon-up branch. A 400 invalid-id response stays
 * distinct as `{ ok: false, reason: "invalid_id" }`. Successful approvals
 * carry a required resolution distinguishing redacted tool execution from a
 * non-executable workflow-gate approval.
 */
function buildApprovalsDaemonHandler(link: DaemonTransport): ApprovalsClient {
	return {
		list: async (filter): Promise<ApprovalsListResult> => {
			return link.requestStrict<ApprovalsListResult>(
				"GET",
				approvalListPath(filter),
			);
		},
		approve: async (id, reviewDigest, note, scopeSelector): Promise<ApprovalApproveResult> => {
			return mutateApproval(
				link,
				`/approvals/${encodeURIComponent(id)}/approve${approvalScopeQuery(scopeSelector)}`,
				{ reviewDigest, note },
				"approve",
			);
		},
		reject: async (id, reason, scopeSelector): Promise<ApprovalRejectResult> => {
			return mutateApproval(
				link,
				`/approvals/${encodeURIComponent(id)}/reject${approvalScopeQuery(scopeSelector)}`,
				{ reason },
				"reject",
			);
		},
	};
}

type ApprovalRouteErrorBody = {
	error?: string;
	reason?: string;
	scopeId?: string;
};

async function mutateApproval(
	link: DaemonTransport,
	path: string,
	body: { reviewDigest: string; note?: string } | { reason?: string },
	mutation: "approve",
): Promise<ApprovalApproveResult>;
async function mutateApproval(
	link: DaemonTransport,
	path: string,
	body: { reviewDigest: string; note?: string } | { reason?: string },
	mutation: "reject",
): Promise<ApprovalRejectResult>;
async function mutateApproval(
	link: DaemonTransport,
	path: string,
	body: { reviewDigest: string; note?: string } | { reason?: string },
	mutation: "approve" | "reject",
): Promise<ApprovalApproveResult | ApprovalRejectResult> {
	const res = await link.fetchRaw(path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (res.status === 404) {
		const errBody = await readApprovalRouteError(res);
		if (errBody?.reason === "unknown_scope" && errBody.scopeId) {
			throw new Error(`Unknown scope: ${errBody.scopeId}`);
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
		if (errBody?.reason === "approval_review_digest_mismatch") {
			return { ok: false, reason: "review_mismatch" };
		}
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
		approval?: PendingApproval;
		resolution?: ApprovalResolutionProjection;
	};
	if (
		data.approval === undefined
		|| (
			data.approval.kind !== "tool_call"
			&& data.approval.kind !== "workflow_gate"
		)
	) {
		throw new Error("Daemon returned an invalid approval kind");
	}
	if (mutation === "reject") {
		return { ok: true, approval: data.approval };
	}
	if (
		data.resolution === undefined
		|| !approvalResolutionMatchesKind(data.approval, data.resolution)
	) {
		throw new Error("Daemon returned an invalid approval resolution");
	}
	return { ok: true, approval: data.approval, resolution: data.resolution };
}

function approvalResolutionMatchesKind(
	approval: PendingApproval,
	resolution: ApprovalResolutionProjection,
): boolean {
	if (approval.kind === "workflow_gate") {
		return resolution.kind === "workflow_gate_approved";
	}
	return resolution.kind === "tool_execution"
		&& (
			resolution.execution.status === "succeeded"
			|| resolution.execution.status === "failed"
		)
		&& resolution.execution.output.redacted === true
		&& resolution.execution.output.reason === "tool-io";
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
