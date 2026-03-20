import type { IncomingMessage, ServerResponse } from "node:http";
import { type ApprovalQueue, getApprovalQueue } from "../approval-queue.js";
import { jsonResponse, readBody } from "./session-pool.js";

export function handleListApprovals(res: ServerResponse, queue: ApprovalQueue = getApprovalQueue()): void {
	jsonResponse(res, 200, { approvals: queue.list("pending") });
}

export function handleApproveApproval(
	res: ServerResponse,
	id: string,
	queue: ApprovalQueue = getApprovalQueue(),
): void {
	const item = queue.approve(id);
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
	queue: ApprovalQueue = getApprovalQueue(),
): Promise<void> {
	let reason: string | undefined;
	try {
		const body = await readBody(req);
		reason = typeof body.reason === "string" ? body.reason : undefined;
	} catch {
		// reason is optional
	}
	const item = queue.reject(id, reason);
	if (!item) {
		jsonResponse(res, 404, { error: "Approval not found or not pending" });
		return;
	}
	jsonResponse(res, 200, { approval: item });
}
