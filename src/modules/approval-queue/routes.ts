import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type ApprovalQueue,
	type ApprovalStatus,
	getApprovalQueue,
	type PendingApproval,
} from "#core/daemon/approval-queue.js";
import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import type {
	ControlRouteRegistration,
	RouteRegistration,
} from "#core/modules/module-types.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import {
	type DaemonTransport,
	getDaemonTransport,
} from "#core/server/daemon-transport.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";

const VALID_STATUSES: readonly (ApprovalStatus | "all")[] = [
	"all",
	"pending",
	"approved",
	"rejected",
	"expired",
];

function readStatusFilter(req: IncomingMessage): ApprovalStatus | "all" | undefined {
	const status = new URL(req.url ?? "", "http://localhost").searchParams.get("status");
	if (status === null) return undefined;
	if ((VALID_STATUSES as readonly string[]).includes(status)) {
		return status as ApprovalStatus | "all";
	}
	return undefined;
}

function readProjectId(req: IncomingMessage): string | undefined {
	const projectId = new URL(req.url ?? "", "http://localhost").searchParams.get("projectId");
	return projectId && projectId.trim() !== "" ? projectId : undefined;
}

function approvalQuery(
	status?: ApprovalStatus | "all",
	projectId?: string,
): string {
	const params = new URLSearchParams();
	if (status) params.set("status", status);
	if (projectId) params.set("projectId", projectId);
	const query = params.toString();
	return query ? `?${query}` : "";
}

function projectQuery(projectId?: string): string {
	if (!projectId) return "";
	const params = new URLSearchParams();
	params.set("projectId", projectId);
	return `?${params.toString()}`;
}

function resolveApprovalQueue(
	res: ServerResponse,
	queue?: ApprovalQueue,
	projectId?: string,
): ApprovalQueue | null {
	if (queue) return queue;
	const projectScope = getProviderRegistry()?.get(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE);
	if (!projectScope) return getApprovalQueue();
	const resolved = projectScope.resolveProjectRuntime(projectId);
	if (!resolved.ok) {
		jsonResponse(res, 404, resolved.error);
		return null;
	}
	return resolved.runtime.approvalQueue;
}

function listApprovalsLocal(
	queue: ApprovalQueue,
	status?: ApprovalStatus | "all",
): { approvals: PendingApproval[] } {
	if (status === undefined) return { approvals: queue.list("pending") };
	if (status === "all") return { approvals: queue.list() };
	return { approvals: queue.list(status) };
}

function approveApprovalLocal(
	queue: ApprovalQueue,
	id: string,
	note?: string,
): PendingApproval | null {
	return queue.approve(id, note);
}

function rejectApprovalLocal(
	queue: ApprovalQueue,
	id: string,
	reason?: string,
): PendingApproval | null {
	return queue.reject(id, reason);
}

function approveAllApprovalsLocal(
	queue: ApprovalQueue,
	note?: string,
): { approvals: PendingApproval[]; count: number } {
	const items = queue.approveAll(note);
	return { approvals: items, count: items.length };
}

function rejectAllApprovalsLocal(
	queue: ApprovalQueue,
	reason?: string,
): { approvals: PendingApproval[]; count: number } {
	const items = queue.rejectAll(reason);
	return { approvals: items, count: items.length };
}

async function readOptionalStringField(
	req: IncomingMessage,
	field: "note" | "reason",
): Promise<string | undefined> {
	try {
		const body = await readBody(req);
		const value = body[field];
		return typeof value === "string" ? value : undefined;
	} catch {
		return undefined;
	}
}

export async function handleListApprovals(
	res: ServerResponse,
	link: DaemonTransport | null = null,
	queue?: ApprovalQueue,
	status?: ApprovalStatus | "all",
	projectId?: string,
): Promise<void> {
	if (link) {
		const result = await link.request<{ approvals: PendingApproval[] }>(
			"GET",
			`/approvals${approvalQuery(status, projectId)}`,
		);
		if (result) {
			jsonResponse(res, 200, result);
			return;
		}
	}
	const resolvedQueue = resolveApprovalQueue(res, queue, projectId);
	if (!resolvedQueue) return;
	jsonResponse(res, 200, listApprovalsLocal(resolvedQueue, status));
}

export async function handleApproveApproval(
	req: IncomingMessage,
	res: ServerResponse,
	id: string,
	link: DaemonTransport | null = null,
	queue?: ApprovalQueue,
	projectId?: string,
): Promise<void> {
	const note = await readOptionalStringField(req, "note");

	if (link) {
		const result = await link.request<{ approval: PendingApproval }>(
			"POST",
			`/approvals/${encodeURIComponent(id)}/approve${projectQuery(projectId)}`,
			{ note },
		);
		if (result) {
			jsonResponse(res, 200, result);
			return;
		}
	}
	const resolvedQueue = resolveApprovalQueue(res, queue, projectId);
	if (!resolvedQueue) return;
	const item = approveApprovalLocal(resolvedQueue, id, note);
	if (!item) {
		jsonResponse(res, 404, { error: "Approval not found or not pending" });
		return;
	}
	jsonResponse(res, 200, { approval: item });
}

export async function handleRejectApproval(
	req: IncomingMessage,
	res: ServerResponse,
	id: string,
	link: DaemonTransport | null = null,
	queue?: ApprovalQueue,
	projectId?: string,
): Promise<void> {
	const reason = await readOptionalStringField(req, "reason");

	if (link) {
		const result = await link.request<{ approval: PendingApproval }>(
			"POST",
			`/approvals/${encodeURIComponent(id)}/reject${projectQuery(projectId)}`,
			{ reason },
		);
		if (result) {
			jsonResponse(res, 200, result);
			return;
		}
	}
	const resolvedQueue = resolveApprovalQueue(res, queue, projectId);
	if (!resolvedQueue) return;
	const item = rejectApprovalLocal(resolvedQueue, id, reason);
	if (!item) {
		jsonResponse(res, 404, { error: "Approval not found or not pending" });
		return;
	}
	jsonResponse(res, 200, { approval: item });
}

export async function handleApproveAllApprovals(
	req: IncomingMessage,
	res: ServerResponse,
	link: DaemonTransport | null = null,
	queue?: ApprovalQueue,
	projectId?: string,
): Promise<void> {
	const note = await readOptionalStringField(req, "note");

	if (link) {
		const result = await link.request<{ approvals: PendingApproval[]; count: number }>(
			"POST",
			`/approvals/approve-all${projectQuery(projectId)}`,
			{ note },
		);
		if (result) {
			jsonResponse(res, 200, result);
			return;
		}
	}
	const resolvedQueue = resolveApprovalQueue(res, queue, projectId);
	if (!resolvedQueue) return;
	jsonResponse(res, 200, approveAllApprovalsLocal(resolvedQueue, note));
}

export async function handleRejectAllApprovals(
	req: IncomingMessage,
	res: ServerResponse,
	link: DaemonTransport | null = null,
	queue?: ApprovalQueue,
	projectId?: string,
): Promise<void> {
	const reason = await readOptionalStringField(req, "reason");

	if (link) {
		const result = await link.request<{ approvals: PendingApproval[]; count: number }>(
			"POST",
			`/approvals/reject-all${projectQuery(projectId)}`,
			{ reason },
		);
		if (result) {
			jsonResponse(res, 200, result);
			return;
		}
	}
	const resolvedQueue = resolveApprovalQueue(res, queue, projectId);
	if (!resolvedQueue) return;
	jsonResponse(res, 200, rejectAllApprovalsLocal(resolvedQueue, reason));
}


export function approvalRoutes(): RouteRegistration[] {
	return [
		{
			method: "GET",
			path: "/api/approvals",
			handler: (req, res) =>
				handleListApprovals(
					res,
					getDaemonTransport(),
					undefined,
					readStatusFilter(req),
					readProjectId(req),
				),
		},
		{
			method: "POST",
			path: "/api/approvals/approve-all",
			handler: (req, res) =>
				handleApproveAllApprovals(
					req,
					res,
					getDaemonTransport(),
					undefined,
					readProjectId(req),
				),
		},
		{
			method: "POST",
			path: "/api/approvals/reject-all",
			handler: (req, res) =>
				handleRejectAllApprovals(
					req,
					res,
					getDaemonTransport(),
					undefined,
					readProjectId(req),
				),
		},
		{
			method: "POST",
			path: "/api/approvals/:id/approve",
			handler: (req, res, params) =>
				handleApproveApproval(
					req,
					res,
					params.id,
					getDaemonTransport(),
					undefined,
					readProjectId(req),
				),
		},
		{
			method: "POST",
			path: "/api/approvals/:id/reject",
			handler: (req, res, params) =>
				handleRejectApproval(
					req,
					res,
					params.id,
					getDaemonTransport(),
					undefined,
					readProjectId(req),
				),
		},
	];
}

async function handleListApprovalsControl(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const queue = resolveApprovalQueue(res, undefined, readProjectId(req));
	if (!queue) return;
	jsonResponse(res, 200, listApprovalsLocal(queue, readStatusFilter(req)));
}

async function handleApproveApprovalControl(
	req: IncomingMessage,
	res: ServerResponse,
	params: Record<string, string>,
): Promise<void> {
	const note = await readOptionalStringField(req, "note");
	const queue = resolveApprovalQueue(res, undefined, readProjectId(req));
	if (!queue) return;
	const item = approveApprovalLocal(queue, params.id, note);
	if (!item) {
		jsonResponse(res, 404, { error: "Approval not found or not pending" });
		return;
	}
	jsonResponse(res, 200, { approval: item });
}

async function handleRejectApprovalControl(
	req: IncomingMessage,
	res: ServerResponse,
	params: Record<string, string>,
): Promise<void> {
	const reason = await readOptionalStringField(req, "reason");
	const queue = resolveApprovalQueue(res, undefined, readProjectId(req));
	if (!queue) return;
	const item = rejectApprovalLocal(queue, params.id, reason);
	if (!item) {
		jsonResponse(res, 404, { error: "Approval not found or not pending" });
		return;
	}
	jsonResponse(res, 200, { approval: item });
}

async function handleApproveAllApprovalsControl(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const note = await readOptionalStringField(req, "note");
	const queue = resolveApprovalQueue(res, undefined, readProjectId(req));
	if (!queue) return;
	jsonResponse(res, 200, approveAllApprovalsLocal(queue, note));
}

async function handleRejectAllApprovalsControl(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const reason = await readOptionalStringField(req, "reason");
	const queue = resolveApprovalQueue(res, undefined, readProjectId(req));
	if (!queue) return;
	jsonResponse(res, 200, rejectAllApprovalsLocal(queue, reason));
}

export function approvalControlRoutes(): ControlRouteRegistration[] {
	return [
		{
			method: "GET",
			path: "/approvals",
			capabilityScope: "read",
			handler: handleListApprovalsControl,
		},
		{
			method: "POST",
			path: "/approvals/approve-all",
			capabilityScope: "control",
			handler: handleApproveAllApprovalsControl,
		},
		{
			method: "POST",
			path: "/approvals/reject-all",
			capabilityScope: "control",
			handler: handleRejectAllApprovalsControl,
		},
		{
			method: "POST",
			path: "/approvals/:id/approve",
			capabilityScope: "control",
			handler: handleApproveApprovalControl,
		},
		{
			method: "POST",
			path: "/approvals/:id/reject",
			capabilityScope: "control",
			handler: handleRejectApprovalControl,
		},
	];
}
