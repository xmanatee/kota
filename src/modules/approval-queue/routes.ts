import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteRegistration } from "../../core/modules/module-types.js";
import { DaemonControlClient } from "../../core/server/daemon-client.js";
import { jsonResponse, readBody } from "../../core/server/session-pool.js";
import { type ApprovalQueue, getApprovalQueue } from "../../core/daemon/approval-queue.js";

export async function handleApproveAllApprovals(
  req: IncomingMessage,
  res: ServerResponse,
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
    const result = await client.approveAllApprovals(note);
    if (result) {
      jsonResponse(res, 200, result);
      return;
    }
  }
  const items = queue.approveAll(note);
  jsonResponse(res, 200, { approvals: items, count: items.length });
}

export async function handleRejectAllApprovals(
  req: IncomingMessage,
  res: ServerResponse,
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
    const result = await client.rejectAllApprovals(reason);
    if (result) {
      jsonResponse(res, 200, result);
      return;
    }
  }
  const items = queue.rejectAll(reason);
  jsonResponse(res, 200, { approvals: items, count: items.length });
}

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

const APPROVAL_ACTION_PATTERN = /^\/api\/approvals\/([^/]+)\/(approve|reject)$/;

export function approvalRoutes(): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/approvals",
      handler: (_req, res) => handleListApprovals(res, DaemonControlClient.fromStateDir()),
    },
    {
      method: "POST",
      path: "/api/approvals/approve-all",
      handler: (req, res) => handleApproveAllApprovals(req, res, DaemonControlClient.fromStateDir()),
    },
    {
      method: "POST",
      path: "/api/approvals/reject-all",
      handler: (req, res) => handleRejectAllApprovals(req, res, DaemonControlClient.fromStateDir()),
    },
    {
      method: "POST",
      path: "/api/approvals/",
      pathPattern: APPROVAL_ACTION_PATTERN,
      handler: (req, res) => {
        const match = new URL(req.url!, "http://localhost").pathname.match(APPROVAL_ACTION_PATTERN);
        const id = match![1];
        const action = match![2];
        if (action === "approve") {
          return handleApproveApproval(req, res, id, DaemonControlClient.fromStateDir());
        }
        return handleRejectApproval(req, res, id, DaemonControlClient.fromStateDir());
      },
    },
  ];
}
