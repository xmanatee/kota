import type { IncomingMessage, ServerResponse } from "node:http";
import type { DaemonControlHandle } from "./daemon-control-types.js";
import { jsonResponse, readBody } from "./daemon-control-utils.js";

export function handleListApprovals(handle: DaemonControlHandle, res: ServerResponse): void {
  jsonResponse(res, 200, { approvals: handle.listApprovals() });
}

export function handleApproveApproval(
  handle: DaemonControlHandle,
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): void {
  readBody(req)
    .then((buf) => {
      let note: string | undefined;
      try {
        const body = JSON.parse(buf.toString()) as Record<string, unknown>;
        note = typeof body.note === "string" ? body.note : undefined;
      } catch {
        // note is optional
      }
      const item = handle.approveApproval(params.id, note);
      if (!item) {
        jsonResponse(res, 404, { error: "Approval not found or not pending" });
        return;
      }
      jsonResponse(res, 200, { approval: item });
    })
    .catch(() => jsonResponse(res, 500, { error: "Internal error" }));
}

export function handleRejectApproval(
  handle: DaemonControlHandle,
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): void {
  readBody(req)
    .then((buf) => {
      let reason: string | undefined;
      try {
        const body = JSON.parse(buf.toString()) as Record<string, unknown>;
        reason = typeof body.reason === "string" ? body.reason : undefined;
      } catch {
        // reason is optional
      }
      const item = handle.rejectApproval(params.id, reason);
      if (!item) {
        jsonResponse(res, 404, { error: "Approval not found or not pending" });
        return;
      }
      jsonResponse(res, 200, { approval: item });
    })
    .catch(() => jsonResponse(res, 500, { error: "Internal error" }));
}
