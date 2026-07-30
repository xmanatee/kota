import type { IncomingMessage, ServerResponse } from "node:http";
import { projectApprovalForClient } from "#core/daemon/approval-queue.js";
import type {
	ControlRouteRegistration,
	RouteRegistration,
} from "#core/modules/module-types.js";
import { getDaemonTransport } from "#core/server/daemon-transport.js";
import { jsonResponse } from "#core/server/session-pool.js";
import {
	writeApproveAllApprovalsMutation,
	writeApproveApprovalMutation,
} from "./route-approval-execution.js";
import {
	handleApproveAllApprovals,
	handleApproveApproval,
	handleListApprovals,
	handleRejectAllApprovals,
	handleRejectApproval,
} from "./route-handlers.js";
import {
	listApprovalsLocal,
	readApprovalBatchDecisionBody,
	readApprovalDecisionBody,
	readOptionalStringField,
	readProjectId,
	readStatusFilter,
	rejectAllApprovalsLocal,
	rejectApprovalLocal,
	rejectMalformedApprovalId,
	resolveApprovalQueue,
} from "./route-helpers.js";

export function approvalRoutes(): RouteRegistration[] {
	return [
		{
			method: "GET",
			path: "/api/approvals",
			handler: (req, res) => {
				const projectId = readProjectId(req, res);
				if (projectId === null) return;
				return handleListApprovals(
					res,
					getDaemonTransport(),
					undefined,
					readStatusFilter(req),
					projectId,
				);
			},
		},
		{
			method: "POST",
			path: "/api/approvals/approve-all",
			handler: (req, res) => {
				const projectId = readProjectId(req, res);
				if (projectId === null) return;
				return handleApproveAllApprovals(
					req,
					res,
					getDaemonTransport(),
					undefined,
					projectId,
				);
			},
		},
		{
			method: "POST",
			path: "/api/approvals/reject-all",
			handler: (req, res) => {
				const projectId = readProjectId(req, res);
				if (projectId === null) return;
				return handleRejectAllApprovals(
					req,
					res,
					getDaemonTransport(),
					undefined,
					projectId,
				);
			},
		},
		{
			method: "POST",
			path: "/api/approvals/:id/approve",
			handler: (req, res, params) => {
				const projectId = readProjectId(req, res);
				if (projectId === null) return;
				return handleApproveApproval(
					req,
					res,
					params.id,
					getDaemonTransport(),
					undefined,
					projectId,
				);
			},
		},
		{
			method: "POST",
			path: "/api/approvals/:id/reject",
			handler: (req, res, params) => {
				const projectId = readProjectId(req, res);
				if (projectId === null) return;
				return handleRejectApproval(
					req,
					res,
					params.id,
					getDaemonTransport(),
					undefined,
					projectId,
				);
			},
		},
	];
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

async function handleListApprovalsControl(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const projectId = readProjectId(req, res);
	if (projectId === null) return;
	const queue = resolveApprovalQueue(res, undefined, projectId);
	if (!queue) return;
	jsonResponse(res, 200, listApprovalsLocal(queue.queue, readStatusFilter(req)));
}

async function handleApproveApprovalControl(
	req: IncomingMessage,
	res: ServerResponse,
	params: Record<string, string>,
): Promise<void> {
	if (rejectMalformedApprovalId(res, params.id)) return;
	const decision = await readApprovalDecisionBody(req, res);
	if (!decision.ok) return;
	const projectId = readProjectId(req, res);
	if (projectId === null) return;
	const queue = resolveApprovalQueue(res, undefined, projectId);
	if (!queue) return;
	await writeApproveApprovalMutation(
		res,
		queue.queue,
		params.id,
		decision.reviewDigest,
		decision.note,
		queue.executionContext,
	);
}

async function handleRejectApprovalControl(
	req: IncomingMessage,
	res: ServerResponse,
	params: Record<string, string>,
): Promise<void> {
	if (rejectMalformedApprovalId(res, params.id)) return;
	const reason = await readOptionalStringField(req, res, "reason");
	if (!reason.ok) return;
	const projectId = readProjectId(req, res);
	if (projectId === null) return;
	const queue = resolveApprovalQueue(res, undefined, projectId);
	if (!queue) return;
	const item = rejectApprovalLocal(queue.queue, params.id, reason.value);
	if (!item) {
		jsonResponse(res, 404, { error: "Approval not found or not pending" });
		return;
	}
	jsonResponse(res, 200, { approval: projectApprovalForClient(item) });
}

async function handleApproveAllApprovalsControl(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const decision = await readApprovalBatchDecisionBody(req, res);
	if (!decision.ok) return;
	const projectId = readProjectId(req, res);
	if (projectId === null) return;
	const queue = resolveApprovalQueue(res, undefined, projectId);
	if (!queue) return;
	await writeApproveAllApprovalsMutation(
		res,
		queue.queue,
		decision.reviews,
		decision.note,
		queue.executionContext,
	);
}

async function handleRejectAllApprovalsControl(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const reason = await readOptionalStringField(req, res, "reason");
	if (!reason.ok) return;
	const projectId = readProjectId(req, res);
	if (projectId === null) return;
	const queue = resolveApprovalQueue(res, undefined, projectId);
	if (!queue) return;
	jsonResponse(res, 200, rejectAllApprovalsLocal(queue.queue, reason.value));
}
