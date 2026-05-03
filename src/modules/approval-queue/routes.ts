import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type ApprovalQueue,
	type ApprovalStatus,
	getApprovalQueue,
	type PendingApproval,
} from "#core/daemon/approval-queue.js";
import type {
	ControlRouteRegistration,
	RouteRegistration,
} from "#core/modules/module-types.js";
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
	queue: ApprovalQueue = getApprovalQueue(),
	status?: ApprovalStatus | "all",
): Promise<void> {
	if (link) {
		const query = status ? `?status=${encodeURIComponent(status)}` : "";
		const result = await link.request<{ approvals: PendingApproval[] }>(
			"GET",
			`/approvals${query}`,
		);
		if (result) {
			jsonResponse(res, 200, result);
			return;
		}
	}
	jsonResponse(res, 200, listApprovalsLocal(queue, status));
}

export async function handleApproveApproval(
	req: IncomingMessage,
	res: ServerResponse,
	id: string,
	link: DaemonTransport | null = null,
	queue: ApprovalQueue = getApprovalQueue(),
): Promise<void> {
	const note = await readOptionalStringField(req, "note");

	if (link) {
		const result = await link.request<{ approval: PendingApproval }>(
			"POST",
			`/approvals/${encodeURIComponent(id)}/approve`,
			{ note },
		);
		if (result) {
			jsonResponse(res, 200, result);
			return;
		}
	}
	const item = approveApprovalLocal(queue, id, note);
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
	queue: ApprovalQueue = getApprovalQueue(),
): Promise<void> {
	const reason = await readOptionalStringField(req, "reason");

	if (link) {
		const result = await link.request<{ approval: PendingApproval }>(
			"POST",
			`/approvals/${encodeURIComponent(id)}/reject`,
			{ reason },
		);
		if (result) {
			jsonResponse(res, 200, result);
			return;
		}
	}
	const item = rejectApprovalLocal(queue, id, reason);
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
	queue: ApprovalQueue = getApprovalQueue(),
): Promise<void> {
	const note = await readOptionalStringField(req, "note");

	if (link) {
		const result = await link.request<{ approvals: PendingApproval[]; count: number }>(
			"POST",
			"/approvals/approve-all",
			{ note },
		);
		if (result) {
			jsonResponse(res, 200, result);
			return;
		}
	}
	jsonResponse(res, 200, approveAllApprovalsLocal(queue, note));
}

export async function handleRejectAllApprovals(
	req: IncomingMessage,
	res: ServerResponse,
	link: DaemonTransport | null = null,
	queue: ApprovalQueue = getApprovalQueue(),
): Promise<void> {
	const reason = await readOptionalStringField(req, "reason");

	if (link) {
		const result = await link.request<{ approvals: PendingApproval[]; count: number }>(
			"POST",
			"/approvals/reject-all",
			{ reason },
		);
		if (result) {
			jsonResponse(res, 200, result);
			return;
		}
	}
	jsonResponse(res, 200, rejectAllApprovalsLocal(queue, reason));
}


export function approvalRoutes(): RouteRegistration[] {
	return [
		{
			method: "GET",
			path: "/api/approvals",
			handler: (req, res) =>
				handleListApprovals(res, getDaemonTransport(), undefined, readStatusFilter(req)),
		},
		{
			method: "POST",
			path: "/api/approvals/approve-all",
			handler: (req, res) => handleApproveAllApprovals(req, res, getDaemonTransport()),
		},
		{
			method: "POST",
			path: "/api/approvals/reject-all",
			handler: (req, res) => handleRejectAllApprovals(req, res, getDaemonTransport()),
		},
		{
			method: "POST",
			path: "/api/approvals/:id/approve",
			handler: (req, res, params) =>
				handleApproveApproval(req, res, params.id, getDaemonTransport()),
		},
		{
			method: "POST",
			path: "/api/approvals/:id/reject",
			handler: (req, res, params) =>
				handleRejectApproval(req, res, params.id, getDaemonTransport()),
		},
	];
}

async function handleListApprovalsControl(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	jsonResponse(res, 200, listApprovalsLocal(getApprovalQueue(), readStatusFilter(req)));
}

async function handleApproveApprovalControl(
	req: IncomingMessage,
	res: ServerResponse,
	params: Record<string, string>,
): Promise<void> {
	const note = await readOptionalStringField(req, "note");
	const item = approveApprovalLocal(getApprovalQueue(), params.id, note);
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
	const item = rejectApprovalLocal(getApprovalQueue(), params.id, reason);
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
	jsonResponse(res, 200, approveAllApprovalsLocal(getApprovalQueue(), note));
}

async function handleRejectAllApprovalsControl(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const reason = await readOptionalStringField(req, "reason");
	jsonResponse(res, 200, rejectAllApprovalsLocal(getApprovalQueue(), reason));
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
