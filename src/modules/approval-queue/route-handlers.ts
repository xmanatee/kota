import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type ApprovalClientProjection,
	type ApprovalQueue,
	type ApprovalStatus,
	projectApprovalForClient,
} from "#core/daemon/approval-queue.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { jsonResponse } from "#core/server/session-pool.js";
import {
	writeApproveAllApprovalsMutation,
	writeApproveApprovalMutation,
} from "./route-approval-execution.js";
import {
	approvalQuery,
	listApprovalsLocal,
	projectQuery,
	proxyApprovalMutation,
	readApprovalBatchDecisionBody,
	readApprovalDecisionBody,
	readOptionalStringField,
	rejectAllApprovalsLocal,
	rejectApprovalLocal,
	rejectMalformedApprovalId,
	resolveApprovalQueue,
} from "./route-helpers.js";

export async function handleListApprovals(
	res: ServerResponse,
	link: DaemonTransport | null = null,
	queue?: ApprovalQueue,
	status?: ApprovalStatus | "all",
	projectId?: string,
): Promise<void> {
	if (link) {
		const result = await link.request<{ approvals: ApprovalClientProjection[] }>(
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
	jsonResponse(res, 200, listApprovalsLocal(resolvedQueue.queue, status));
}

export async function handleApproveApproval(
	req: IncomingMessage,
	res: ServerResponse,
	id: string,
	link: DaemonTransport | null = null,
	queue?: ApprovalQueue,
	projectId?: string,
): Promise<void> {
	if (rejectMalformedApprovalId(res, id)) return;
	const decision = await readApprovalDecisionBody(req, res);
	if (!decision.ok) return;

	if (link) {
		await proxyApprovalMutation(
			res,
			link,
			`/approvals/${encodeURIComponent(id)}/approve${projectQuery(projectId)}`,
			{
				reviewDigest: decision.reviewDigest,
				...(decision.note !== undefined ? { note: decision.note } : {}),
			},
		);
		return;
	}
	const resolvedQueue = resolveApprovalQueue(res, queue, projectId);
	if (!resolvedQueue) return;
	await writeApproveApprovalMutation(
		res,
		resolvedQueue.queue,
		id,
		decision.reviewDigest,
		decision.note,
		resolvedQueue.executionContext,
	);
}

export async function handleRejectApproval(
	req: IncomingMessage,
	res: ServerResponse,
	id: string,
	link: DaemonTransport | null = null,
	queue?: ApprovalQueue,
	projectId?: string,
): Promise<void> {
	if (rejectMalformedApprovalId(res, id)) return;
	const reason = await readOptionalStringField(req, res, "reason");
	if (!reason.ok) return;

	if (link) {
		await proxyApprovalMutation(
			res,
			link,
			`/approvals/${encodeURIComponent(id)}/reject${projectQuery(projectId)}`,
			reason.value === undefined ? {} : { reason: reason.value },
		);
		return;
	}
	const resolvedQueue = resolveApprovalQueue(res, queue, projectId);
	if (!resolvedQueue) return;
	const item = rejectApprovalLocal(resolvedQueue.queue, id, reason.value);
	if (!item) {
		jsonResponse(res, 404, { error: "Approval not found or not pending" });
		return;
	}
	jsonResponse(res, 200, { approval: projectApprovalForClient(item) });
}

export async function handleApproveAllApprovals(
	req: IncomingMessage,
	res: ServerResponse,
	link: DaemonTransport | null = null,
	queue?: ApprovalQueue,
	projectId?: string,
): Promise<void> {
	const decision = await readApprovalBatchDecisionBody(req, res);
	if (!decision.ok) return;

	if (link) {
		await proxyApprovalMutation(
			res,
			link,
			`/approvals/approve-all${projectQuery(projectId)}`,
			{
				reviews: decision.reviews,
				...(decision.note !== undefined ? { note: decision.note } : {}),
			},
		);
		return;
	}
	const resolvedQueue = resolveApprovalQueue(res, queue, projectId);
	if (!resolvedQueue) return;
	await writeApproveAllApprovalsMutation(
		res,
		resolvedQueue.queue,
		decision.reviews,
		decision.note,
		resolvedQueue.executionContext,
	);
}

export async function handleRejectAllApprovals(
	req: IncomingMessage,
	res: ServerResponse,
	link: DaemonTransport | null = null,
	queue?: ApprovalQueue,
	projectId?: string,
): Promise<void> {
	const reason = await readOptionalStringField(req, res, "reason");
	if (!reason.ok) return;

	if (link) {
		await proxyApprovalMutation(
			res,
			link,
			`/approvals/reject-all${projectQuery(projectId)}`,
			reason.value === undefined ? {} : { reason: reason.value },
		);
		return;
	}
	const resolvedQueue = resolveApprovalQueue(res, queue, projectId);
	if (!resolvedQueue) return;
	jsonResponse(res, 200, rejectAllApprovalsLocal(resolvedQueue.queue, reason.value));
}
