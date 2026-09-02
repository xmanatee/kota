/**
 * HTTP handlers for the daemon-owned chat session surface.
 *
 * Owns active chat-turn routes. Session creation, approval review, request
 * parsing, and SSE framing live in focused siblings.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import { type AgentEvent, NullTransport } from "#core/loop/transport.js";
import { type AutonomyMode, isAutonomyMode } from "#core/tools/autonomy-mode.js";
import { AgentBackoffAdmissionError } from "#core/workflow/agent-backoff.js";
import { classifyThrownAgentError } from "#core/workflow/steps/step-executor-retry.js";
import type { WorkflowAgentBackoffSignal } from "#core/workflow/trigger-types.js";
import { createDaemonChatClientApprovalResolver } from "./daemon-chat-approvals.js";
import type { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import type {
  DaemonChatPool,
  DaemonChatStreamPayload,
} from "./daemon-chat-pool.js";
import { rejectPendingClientApprovals } from "./daemon-chat-pool.js";
import { readChatBody } from "./daemon-chat-request.js";
import {
  closeDaemonChatSubscribers,
  publishDaemonChatSse,
  writeDaemonChatSse,
} from "./daemon-chat-stream.js";
import type { DaemonAgentAttemptBoundary } from "./daemon-control-options.js";
import { jsonResponse } from "./daemon-control-utils.js";

export { handleResolveDaemonChatApproval } from "./daemon-chat-approvals.js";
export { readChatBody } from "./daemon-chat-request.js";
export {
  type DaemonChatConversationResolver,
  handleCreateDaemonSession,
} from "./daemon-chat-session-create.js";

/**
 * PATCH /sessions/:id — change the autonomy mode of a running session.
 *
 * Daemon-owned sessions are mutated in place; serve-registered sessions only
 * have advisory metadata in the daemon, so we report serveOwned so the caller
 * knows to drive the authoritative update against the owning serve process.
 */
export async function handlePatchDaemonSession(
  pool: DaemonChatPool | null,
  setOnHandle: (id: string, mode: AutonomyMode) => { ok: boolean; notFound?: boolean; serveOwned?: boolean },
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
): Promise<void> {
  let body: KotaJsonObject;
  try {
    body = await readChatBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: (err as Error).message });
    return;
  }

  const raw = body.autonomy_mode;
  if (raw === undefined) {
    jsonResponse(res, 400, { error: "autonomy_mode is required" });
    return;
  }
  if (!isAutonomyMode(raw)) {
    jsonResponse(res, 400, { error: "autonomy_mode must be one of: passive, supervised, autonomous" });
    return;
  }
  const mode: AutonomyMode = raw;

  if (pool?.setAutonomyMode(sessionId, mode)) {
    const handleResult = setOnHandle(sessionId, mode);
    jsonResponse(res, 200, {
      session_id: sessionId,
      autonomy_mode: mode,
      source: "daemon",
      ...(handleResult.ok ? {} : { registryUpdated: false }),
    });
    return;
  }

  const handleResult = setOnHandle(sessionId, mode);
  if (handleResult.notFound) {
    jsonResponse(res, 404, { error: "Session not found" });
    return;
  }
  jsonResponse(res, 200, {
    session_id: sessionId,
    autonomy_mode: mode,
    source: "serve",
    serveOwned: handleResult.serveOwned === true,
  });
}

/** POST /sessions/:id/chat — stream an agent response via SSE. */
export async function handleDaemonChat(
  pool: DaemonChatPool,
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  agentAttemptBoundary?: DaemonAgentAttemptBoundary,
): Promise<void> {
  const session = pool.get(sessionId);
  if (!session) {
    jsonResponse(res, 404, { error: "Session not found" });
    return;
  }

  let body: KotaJsonObject;
  try {
    body = await readChatBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: (err as Error).message });
    return;
  }

  const message = body.message as string | undefined;
  if (!message || typeof message !== "string") {
    jsonResponse(res, 400, { error: "message must be a non-empty string" });
    return;
  }
  const clientApprovalEnabled = body.client_approval === true;
  const agentBackoffMode = body.agent_backoff;
  if (agentBackoffMode !== undefined && agentBackoffMode !== "fleet") {
    jsonResponse(res, 400, { error: "agent_backoff must be fleet when provided" });
    return;
  }
  if (agentBackoffMode === "fleet" && agentAttemptBoundary === undefined) {
    jsonResponse(res, 503, { error: "Fleet agent-attempt boundary is unavailable" });
    return;
  }

  if (session.busy) {
    jsonResponse(res, 409, { error: "Session is busy processing another request" });
    return;
  }
  const attemptAbortController = agentBackoffMode === "fleet"
    ? new AbortController()
    : undefined;
  let releaseAttempt: (() => void) | undefined;
  if (attemptAbortController !== undefined) {
    try {
      releaseAttempt = agentAttemptBoundary!.registerAttempt(
        attemptAbortController,
        session.scopeId,
      );
    } catch (error) {
      jsonResponse(res, 409, {
        error: error instanceof Error ? error.message : String(error),
        reason: "agent_backoff",
      });
      return;
    }
  }
  const cancelBackedOffAttempt = () => {
    const reason = attemptAbortController?.signal.reason;
    session.agent.cancelActiveTurn(
      reason instanceof Error ? reason : new Error("Agent attempt backed off"),
    );
  };
  attemptAbortController?.signal.addEventListener(
    "abort",
    cancelBackedOffAttempt,
    { once: true },
  );
  session.busy = true;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const sseTransport = {
    emit(event: AgentEvent) {
      if (res.writableEnded) return;
      publishDaemonChatSse(session, res, event.type, event);
    },
  };

  session.proxy.target = sseTransport;
  const previousClientApprovalResolver = session.agent.clientApprovalResolver;
  if (clientApprovalEnabled) {
    session.agent.setClientApprovalResolver(createDaemonChatClientApprovalResolver(session, res));
  }
  publishDaemonChatSse(session, res, "session", { session_id: session.id });

  try {
    const result = await session.agent.send(message);
    if (agentBackoffMode === "fleet" && result.trim().length === 0) {
      const signal: WorkflowAgentBackoffSignal = {
        kind: "output_contract",
        reason: "Fleet one-shot agent review returned successful empty output",
      };
      const backoff = agentAttemptBoundary!.applyIncident(
        signal,
        session.scopeId,
      );
      throw new AgentBackoffAdmissionError(backoff, signal);
    }
    publishDaemonChatSse(session, res, "done", { session_id: session.id, result });
  } catch (err) {
    let reportedError = attemptAbortController?.signal.reason instanceof
        AgentBackoffAdmissionError
      ? attemptAbortController.signal.reason
      : err;
    if (
      agentBackoffMode === "fleet" &&
      !(reportedError instanceof AgentBackoffAdmissionError)
    ) {
      const classification = classifyThrownAgentError(reportedError);
      if (classification !== null) {
        const signal: WorkflowAgentBackoffSignal = {
          kind: classification.kind,
          reason: `Fleet one-shot agent review failed: ${
            reportedError instanceof Error
              ? reportedError.message
              : String(reportedError)
          }`,
          ...(classification.retryAt === undefined
            ? {}
            : { retryAt: classification.retryAt }),
        };
        const backoff = agentAttemptBoundary!.applyIncident(
          signal,
          session.scopeId,
        );
        reportedError = new AgentBackoffAdmissionError(backoff, signal);
      }
    }
    publishDaemonChatSse(session, res, "error", {
      message: reportedError instanceof Error
        ? reportedError.message
        : String(reportedError),
    });
  } finally {
    releaseAttempt?.();
    attemptAbortController?.signal.removeEventListener(
      "abort",
      cancelBackedOffAttempt,
    );
    rejectPendingClientApprovals(
      session,
      new Error("Daemon chat turn ended before client approval resolved"),
    );
    if (clientApprovalEnabled) {
      session.agent.setClientApprovalResolver(previousClientApprovalResolver);
    }
    session.proxy.target = new NullTransport();
    session.busy = false;
    session.lastActive = Date.now();
    closeDaemonChatSubscribers(session);
    if (!res.writableEnded) res.end();
  }
}

/** GET /sessions/:id/events - subscribe to the active daemon chat turn. */
export function handleDaemonChatEvents(
  pool: DaemonChatPool,
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
): void {
  const session = pool.get(sessionId);
  if (!session) {
    jsonResponse(res, 404, { error: "Session not found" });
    return;
  }
  if (!session.busy) {
    jsonResponse(res, 409, { error: "Session is not active" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const subscriber = {
    write(eventName: string, data: DaemonChatStreamPayload): void {
      writeDaemonChatSse(res, eventName, data);
    },
    close(): void {
      if (!res.writableEnded) res.end();
    },
  };
  session.subscribers.add(subscriber);
  writeDaemonChatSse(res, "session", { session_id: session.id });
  req.on("close", () => {
    session.subscribers.delete(subscriber);
  });
}

/** POST /sessions/:id/cancel — abort the active turn without closing the session. */
export function cancelDaemonSessionTurn(
  pool: DaemonChatPool,
  id: string,
): boolean {
  return pool.cancelActiveTurn(id);
}

/** DELETE /sessions/:id — close a daemon-owned session. Returns true if found. */
export function deleteDaemonSession(
  pool: DaemonChatPool,
  id: string,
  bindings?: DaemonChatBindingStore,
): boolean {
  const removed = pool.delete(id);
  if (removed) bindings?.delete(id);
  return removed;
}
