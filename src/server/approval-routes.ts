import type { IncomingMessage, ServerResponse } from "node:http";
import { type ApprovalQueue, getApprovalQueue } from "../approval-queue.js";
import type { DaemonControlClient } from "./daemon-client.js";
import { jsonResponse, readBody } from "./session-pool.js";

export async function handleListApprovals(
  res: ServerResponse,
  client: DaemonControlClient | null = null,
  queue: ApprovalQueue = getApprovalQueue(),
): Promise<void> {
  if (client) {
    const result = await client.listApprovals();
    if (result) {
      jsonResponse(res, 200, result);
      return;
    }
  }
  jsonResponse(res, 200, { approvals: queue.list("pending") });
}

export async function handleApproveApproval(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  client: DaemonControlClient | null = null,
  queue: ApprovalQueue = getApprovalQueue(),
): Promise<void> {
  let note: string | undefined;
  try {
    const body = await readBody(req);
    note = typeof body.note === "string" ? body.note : undefined;
  } catch {
    // note is optional
  }

  if (client) {
    const result = await client.approveApproval(id, note);
    if (result) {
      jsonResponse(res, 200, result);
      return;
    }
  }
  const item = queue.approve(id, note);
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
  client: DaemonControlClient | null = null,
  queue: ApprovalQueue = getApprovalQueue(),
): Promise<void> {
  let reason: string | undefined;
  try {
    const body = await readBody(req);
    reason = typeof body.reason === "string" ? body.reason : undefined;
  } catch {
    // reason is optional
  }

  if (client) {
    const result = await client.rejectApproval(id, reason);
    if (result) {
      jsonResponse(res, 200, result);
      return;
    }
  }
  const item = queue.reject(id, reason);
  if (!item) {
    jsonResponse(res, 404, { error: "Approval not found or not pending" });
    return;
  }
  jsonResponse(res, 200, { approval: item });
}
