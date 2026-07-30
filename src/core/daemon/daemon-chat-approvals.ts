import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import { cloneEvidenceJsonObject } from "#core/evidence/policy.js";
import {
  type ToolApprovalDecision,
  type ToolApprovalRequest,
  type ToolApprovalResolver,
  ToolApprovalTimeoutError,
} from "#core/tools/tool-runner.js";
import {
  type ApprovalReviewBinding,
  createApprovalReviewDescriptor,
} from "./approval-review-descriptor.js";
import type {
  DaemonChatPendingClientApproval,
  DaemonChatPool,
  DaemonChatSession,
} from "./daemon-chat-pool.js";
import { readChatBody } from "./daemon-chat-request.js";
import { publishDaemonChatSse } from "./daemon-chat-stream.js";
import { jsonResponse } from "./daemon-control-utils.js";

const DEFAULT_CLIENT_APPROVAL_TIMEOUT_MS = 120_000;

type PendingReviewBinding = {
  matchesReceipt(receipt: string): boolean;
};

const pendingReviewBindings = new WeakMap<
  DaemonChatPendingClientApproval,
  PendingReviewBinding
>();

export async function handleResolveDaemonChatApproval(
  pool: DaemonChatPool,
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  approvalId: string,
): Promise<void> {
  const session = pool.get(sessionId);
  if (!session) {
    jsonResponse(res, 404, { error: "Session not found" });
    return;
  }
  const pending = session.pendingClientApprovals.get(approvalId);
  if (!pending) {
    jsonResponse(res, 404, { error: "Client approval request not found" });
    return;
  }

	let body: KotaJsonObject;
  try {
    body = await readChatBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: (err as Error).message });
    return;
  }

  const decoded = decodeClientApprovalDecision(body);
  if (!decoded.ok) {
    jsonResponse(res, 400, { error: decoded.error });
    return;
  }
  if (decoded.decision.outcome === "allow") {
    const binding = pendingReviewBindings.get(pending);
    if (
      !("reviewDigest" in decoded)
      || !binding
      || !binding.matchesReceipt(decoded.reviewDigest)
    ) {
      jsonResponse(res, 409, { error: "approval review receipt does not match the pending operation" });
      return;
    }
  }
  pending.resolve(decoded.decision);
  res.writeHead(204);
  res.end();
}

type DecodedClientApprovalDecision =
  | { ok: true; decision: { outcome: "allow" }; reviewDigest: string }
  | { ok: true; decision: Exclude<ToolApprovalDecision, { outcome: "allow" }> }
  | { ok: false; error: string };

function decodeClientApprovalDecision(body: KotaJsonObject): DecodedClientApprovalDecision {
  const known = new Set(["outcome", "message", "review_digest"]);
  const unknown = Object.keys(body).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `approval response has unexpected field${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")}`,
    };
  }
  if (body.outcome === "allow") {
    if (typeof body.review_digest !== "string" || !/^[a-f0-9]{64}$/.test(body.review_digest)) {
      return { ok: false, error: "allow approval response requires a valid review_digest" };
    }
    return {
      ok: true,
      decision: { outcome: "allow" },
      reviewDigest: body.review_digest,
    };
  }
  if (body.outcome === "deny") {
    if (typeof body.message !== "string" || body.message.length === 0) {
      return { ok: false, error: "deny approval response requires a non-empty message" };
    }
    return { ok: true, decision: { outcome: "deny", message: body.message } };
  }
  if (body.outcome === "cancelled") {
    if (typeof body.message !== "string" || body.message.length === 0) {
      return { ok: false, error: "cancelled approval response requires a non-empty message" };
    }
    return { ok: true, decision: { outcome: "cancelled", message: body.message } };
  }
  return { ok: false, error: 'approval response outcome must be "allow", "deny", or "cancelled"' };
}

export function createDaemonChatClientApprovalResolver(
  session: DaemonChatSession,
  res: ServerResponse,
): ToolApprovalResolver {
  return (request) =>
    new Promise<ToolApprovalDecision>((resolve, reject) => {
      const approvalId = request.id;
      if (session.pendingClientApprovals.has(approvalId)) {
        reject(new Error(`Duplicate client approval request id ${approvalId}`));
        return;
      }

      const approvalBinding: ApprovalReviewBinding = {
        id: approvalId,
        tool: request.toolName,
        scopeId: session.projectId,
        risk: request.risk,
        reason: request.reason,
        sessionId: session.id,
      };
      const review = createApprovalReviewDescriptor(
        approvalBinding,
        request.input,
        request.context,
      );
      const executionDigest = digestExecutionInput(request.input);
      let settled = false;
      const timeoutMs = approvalTimeoutMs(request);
      const cleanup = (): void => {
        session.pendingClientApprovals.delete(approvalId);
        clearTimeout(timeout);
        request.signal?.removeEventListener("abort", onAbort);
      };
      const settle = (decision: ToolApprovalDecision): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(decision);
      };
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onAbort = (): void => fail(new Error("Client approval request aborted"));
      const timeout = setTimeout(() => {
        fail(new ToolApprovalTimeoutError(`Client approval request ${approvalId} timed out`));
      }, timeoutMs);
      timeout.unref();

      request.signal?.addEventListener("abort", onAbort, { once: true });
      if (request.signal?.aborted) {
        fail(new Error("Client approval request aborted"));
        return;
      }
      const pending = { resolve: settle, reject: fail };
      pendingReviewBindings.set(pending, {
        matchesReceipt: (receipt) =>
          receipt === review.digest
          && digestExecutionInput(request.input) === executionDigest
          && createApprovalReviewDescriptor(
            approvalBinding,
            request.input,
            request.context,
          ).digest === review.digest,
      });
      session.pendingClientApprovals.set(approvalId, pending);
      publishDaemonChatSse(session, res, "approval_request", {
        session_id: session.id,
        approval_id: approvalId,
        tool_use_id: request.toolUseId,
        tool: request.toolName,
        risk: request.risk,
        reason: request.reason,
        input: review.input,
        timeout_ms: timeoutMs,
        ...(review.context !== undefined ? { context: review.context } : {}),
        review_digest: review.digest,
      });
    });
}

function approvalTimeoutMs(request: ToolApprovalRequest): number {
  if (
    request.timeoutMs !== undefined
    && Number.isFinite(request.timeoutMs)
    && request.timeoutMs > 0
  ) {
    return Math.min(request.timeoutMs, 30 * 60 * 1000);
  }
  return DEFAULT_CLIENT_APPROVAL_TIMEOUT_MS;
}

function digestExecutionInput(input: ToolApprovalRequest["input"]): string {
  return createHash("sha256")
    .update(JSON.stringify(cloneEvidenceJsonObject(input)))
    .digest("hex");
}
