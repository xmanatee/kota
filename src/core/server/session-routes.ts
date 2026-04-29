import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentSession } from "#core/loop/loop.js";
import { NullTransport, type Transport } from "#core/loop/transport.js";
import { type AutonomyMode, isAutonomyMode } from "#core/tools/autonomy-mode.js";
import {
  jsonResponse,
  type ManagedSession,
  readBody,
  type SessionPool,
  SseTransport,
  setCors,
} from "./session-pool.js";

function resolveAutonomyMode(
  body: Record<string, unknown>,
  resolveDefault: () => AutonomyMode,
): { ok: true; mode: AutonomyMode } | { ok: false; error: string } {
  const raw = body.autonomy_mode;
  if (raw !== undefined) {
    if (!isAutonomyMode(raw)) {
      return { ok: false, error: "autonomy_mode must be one of: passive, supervised, autonomous" };
    }
    return { ok: true, mode: raw };
  }
  try {
    return { ok: true, mode: resolveDefault() };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function handleKotaChat(res: ServerResponse, session: ManagedSession, message: string): Promise<void> {
  setCors(res);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const sse = new SseTransport(res);
  session.proxy.target = sse;
  sse.send("session", { session_id: session.id });
  try {
    const result = await session.agent.send(message);
    sse.send("done", { session_id: session.id, result });
  } catch (err) {
    sse.send("error", { message: (err as Error).message });
  } finally {
    session.proxy.target = new NullTransport();
    session.busy = false;
    session.lastActive = Date.now();
    sse.end();
  }
}

export async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  pool: SessionPool,
  makeAgent: (transport: Transport, autonomyMode: AutonomyMode) => AgentSession,
  resolveDefaultAutonomyMode: () => AutonomyMode,
  onSessionCreate?: (id: string) => void,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: (err as Error).message });
    return;
  }

  const message = body.message as string | undefined;
  if (!message || typeof message !== "string") {
    jsonResponse(res, 400, { error: "message must be a non-empty string" });
    return;
  }

  const modeResult = resolveAutonomyMode(body, resolveDefaultAutonomyMode);
  if (!modeResult.ok) {
    jsonResponse(res, 400, { error: modeResult.error });
    return;
  }

  let session: ManagedSession;
  const sessionId = body.session_id as string | undefined;
  if (sessionId) {
    const existing = pool.get(sessionId);
    if (!existing) {
      jsonResponse(res, 404, { error: "Session not found" });
      return;
    }
    session = existing;
  } else {
    try {
      session = pool.create((t) => makeAgent(t, modeResult.mode));
      onSessionCreate?.(session.id);
    } catch (err) {
      jsonResponse(res, 503, { error: (err as Error).message });
      return;
    }
  }

  if (session.busy) {
    jsonResponse(res, 409, { error: "Session is busy processing another request" });
    return;
  }
  session.busy = true;

  await handleKotaChat(res, session, message);
}

export function handleListSessions(res: ServerResponse, pool: SessionPool): void {
  jsonResponse(res, 200, { sessions: pool.list() });
}

export async function handleCreateSession(
  req: IncomingMessage,
  res: ServerResponse,
  pool: SessionPool,
  makeAgent: (transport: Transport, autonomyMode: AutonomyMode) => AgentSession,
  resolveDefaultAutonomyMode: () => AutonomyMode,
  onSessionCreate?: (id: string) => void,
): Promise<string | null> {
  let body: Record<string, unknown> = {};
  try {
    body = await readBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: (err as Error).message });
    return null;
  }

  const modeResult = resolveAutonomyMode(body, resolveDefaultAutonomyMode);
  if (!modeResult.ok) {
    jsonResponse(res, 400, { error: modeResult.error });
    return null;
  }

  try {
    const session = pool.create((t) => makeAgent(t, modeResult.mode));
    onSessionCreate?.(session.id);
    jsonResponse(res, 201, { session_id: session.id, autonomy_mode: modeResult.mode });
    return session.id;
  } catch (err) {
    jsonResponse(res, 503, { error: (err as Error).message });
    return null;
  }
}

export async function handlePatchSession(
  req: IncomingMessage,
  res: ServerResponse,
  pool: SessionPool,
  sessionId: string,
): Promise<void> {
  const session = pool.get(sessionId);
  if (!session) {
    jsonResponse(res, 404, { error: "Session not found" });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
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

  session.agent.setAutonomyMode(raw);
  jsonResponse(res, 200, { session_id: sessionId, autonomy_mode: raw });
}

export function handleDeleteSession(res: ServerResponse, pool: SessionPool, sessionId: string): void {
  const deleted = pool.delete(sessionId);
  if (deleted) {
    res.writeHead(204);
    res.end();
  } else {
    jsonResponse(res, 404, { error: "Session not found" });
  }
}
