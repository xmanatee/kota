/**
 * HTTP handlers for the daemon-owned chat session surface.
 *
 * Owns request body parsing, SSE framing, and the four route handlers
 * (POST /sessions, PATCH /sessions/:id, POST /sessions/:id/chat,
 * DELETE /sessions/:id) that wire the pool and bindings store into the
 * daemon control routes. The pool itself lives in `daemon-chat-pool.ts`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { NullTransport } from "#core/loop/transport.js";
import { type AutonomyMode, isAutonomyMode } from "#core/tools/autonomy-mode.js";
import type { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import type { DaemonChatMakeAgent, DaemonChatPool } from "./daemon-chat-pool.js";
import { jsonResponse } from "./daemon-control-utils.js";

/** Read the HTTP request body as a parsed JSON object (max 1MB). */
export function readChatBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_BODY = 1024 * 1024;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf-8");
        resolve(text ? (JSON.parse(text) as Record<string, unknown>) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/** Write a single SSE frame to the response. */
function writeSse(res: ServerResponse, eventName: string, data: unknown): void {
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Context needed to resolve the conversationId for a new or woken session.
 * Exists so the HTTP handler stays focused on protocol shape and defers
 * history lookups / conversation creation to the daemon host.
 */
export type DaemonChatConversationResolver = {
  /** True iff a conversation exists in history for this id. */
  conversationExists(conversationId: string): boolean;
  /** Create a new conversation record and return its id. */
  createConversation(mode: AutonomyMode): string;
};

/** POST /sessions — create a new daemon-owned session, optionally waking a prior one. */
export async function handleCreateDaemonSession(
  pool: DaemonChatPool,
  bindings: DaemonChatBindingStore,
  req: IncomingMessage,
  res: ServerResponse,
  makeAgent: DaemonChatMakeAgent,
  defaultAutonomyMode: AutonomyMode | undefined,
  resolver: DaemonChatConversationResolver,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readChatBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: (err as Error).message });
    return;
  }

  const raw = body.autonomy_mode;
  let mode = defaultAutonomyMode;
  if (raw !== undefined) {
    if (!isAutonomyMode(raw)) {
      jsonResponse(res, 400, { error: "autonomy_mode must be one of: passive, supervised, autonomous" });
      return;
    }
    mode = raw;
  }
  if (mode === undefined) {
    jsonResponse(res, 400, { error: "autonomy_mode is required because no default autonomy mode is configured" });
    return;
  }

  const requestedSessionId = typeof body.session_id === "string" ? body.session_id : undefined;
  const requestedConversationId = typeof body.conversation_id === "string" ? body.conversation_id : undefined;

  let wakeSessionId: string | undefined;
  let conversationId: string | undefined;

  if (requestedSessionId) {
    const live = pool.get(requestedSessionId);
    if (live) {
      jsonResponse(res, 409, {
        error: "Session already live",
        session_id: live.id,
        conversation_id: live.conversationId,
      });
      return;
    }
    const binding = bindings.getBySession(requestedSessionId);
    if (!binding) {
      jsonResponse(res, 404, { error: `No binding for session ${requestedSessionId}` });
      return;
    }
    if (requestedConversationId && requestedConversationId !== binding.conversationId) {
      jsonResponse(res, 409, {
        error: `Session ${requestedSessionId} is bound to ${binding.conversationId}, not ${requestedConversationId}`,
      });
      return;
    }
    if (!resolver.conversationExists(binding.conversationId)) {
      jsonResponse(res, 404, {
        error: `Bound conversation ${binding.conversationId} not found in history`,
      });
      return;
    }
    wakeSessionId = requestedSessionId;
    conversationId = binding.conversationId;
  } else if (requestedConversationId) {
    if (!resolver.conversationExists(requestedConversationId)) {
      jsonResponse(res, 404, { error: `Conversation ${requestedConversationId} not found in history` });
      return;
    }
    const existingBinding = bindings.getByConversation(requestedConversationId);
    if (existingBinding) {
      const live = pool.get(existingBinding.sessionId);
      if (live) {
        jsonResponse(res, 409, {
          error: "Session already live for this conversation",
          session_id: live.id,
          conversation_id: live.conversationId,
        });
        return;
      }
      wakeSessionId = existingBinding.sessionId;
    }
    conversationId = requestedConversationId;
  } else {
    conversationId = resolver.createConversation(mode);
  }

  try {
    const session = pool.create(makeAgent, mode, conversationId, wakeSessionId);
    bindings.put(session.id, session.conversationId);
    jsonResponse(res, 201, {
      session_id: session.id,
      autonomy_mode: mode,
      conversation_id: session.conversationId,
    });
  } catch (err) {
    jsonResponse(res, 503, { error: (err as Error).message });
  }
}

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
  let body: Record<string, unknown>;
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
): Promise<void> {
  const session = pool.get(sessionId);
  if (!session) {
    jsonResponse(res, 404, { error: "Session not found" });
    return;
  }

  let body: Record<string, unknown>;
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

  if (session.busy) {
    jsonResponse(res, 409, { error: "Session is busy processing another request" });
    return;
  }
  session.busy = true;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const sseTransport = {
    emit(event: import("#core/loop/transport.js").AgentEvent) {
      if (res.writableEnded) return;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    },
  };

  session.proxy.target = sseTransport;
  writeSse(res, "session", { session_id: session.id });

  try {
    const result = await session.agent.send(message);
    writeSse(res, "done", { session_id: session.id, result });
  } catch (err) {
    writeSse(res, "error", { message: (err as Error).message });
  } finally {
    session.proxy.target = new NullTransport();
    session.busy = false;
    session.lastActive = Date.now();
    if (!res.writableEnded) res.end();
  }
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
