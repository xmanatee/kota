/**
 * HTTP handlers for the daemon-owned chat session surface.
 *
 * Owns request body parsing, SSE framing, and the four route handlers
 * (POST /sessions, PATCH /sessions/:id, POST /sessions/:id/chat,
 * DELETE /sessions/:id) that wire the pool and bindings store into the
 * daemon control routes. The pool itself lives in `daemon-chat-pool.ts`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { KotaJsonObject, KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import { type AgentEvent, NullTransport } from "#core/loop/transport.js";
import type { McpServerConfig } from "#core/mcp/manager.js";
import { isSensitiveToolInputKey } from "#core/tools/approval-redaction.js";
import { type AutonomyMode, isAutonomyMode } from "#core/tools/autonomy-mode.js";
import {
  type ToolApprovalDecision,
  type ToolApprovalRequest,
  type ToolApprovalResolver,
  ToolApprovalTimeoutError,
} from "#core/tools/tool-runner.js";
import type { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import type {
  DaemonChatMakeAgent,
  DaemonChatPool,
  DaemonChatSession,
  DaemonChatStreamPayload,
} from "./daemon-chat-pool.js";
import { rejectPendingClientApprovals } from "./daemon-chat-pool.js";
import { jsonResponse } from "./daemon-control-utils.js";
import type { ProjectId } from "./project-registry.js";

/** Read the HTTP request body as a parsed JSON object (max 1MB). */
export function readChatBody(req: IncomingMessage): Promise<KotaJsonObject> {
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
        resolve(text ? (JSON.parse(text) as KotaJsonObject) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/** Write a single SSE frame to the response. */
function writeSse(res: ServerResponse, eventName: string, data: DaemonChatStreamPayload): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

function publishSessionSse(
  session: DaemonChatSession,
  res: ServerResponse,
  eventName: string,
  data: DaemonChatStreamPayload,
): void {
  writeSse(res, eventName, data);
  for (const subscriber of session.subscribers) {
    subscriber.write(eventName, data);
  }
}

function closeSessionSubscribers(session: DaemonChatSession): void {
  for (const subscriber of session.subscribers) {
    subscriber.close();
  }
  session.subscribers.clear();
}

/**
 * Context needed to resolve the conversationId for a new or woken session.
 * Exists so the HTTP handler stays focused on protocol shape and defers
 * history lookups / conversation creation to the daemon host.
 */
export type DaemonChatConversationResolver = {
  /** True iff a conversation exists in history for this id. */
  conversationExists(conversationId: string, projectId: ProjectId): boolean;
  /** Create a new conversation record and return its id. */
  createConversation(mode: AutonomyMode, projectId: ProjectId): string;
};

/** POST /sessions — create a new daemon-owned session, optionally waking a prior one. */
export async function handleCreateDaemonSession(
  pool: DaemonChatPool,
  bindings: DaemonChatBindingStore,
  req: IncomingMessage,
  res: ServerResponse,
  makeAgent: DaemonChatMakeAgent,
  defaultAutonomyMode: AutonomyMode | undefined,
  projectId: ProjectId,
  resolver: DaemonChatConversationResolver,
): Promise<void> {
  let body: KotaJsonObject;
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
  let mcpServers: Record<string, McpServerConfig>;
  try {
    mcpServers = decodeDaemonMcpServers(body.mcp_servers);
  } catch (err) {
    jsonResponse(res, 400, { error: (err as Error).message });
    return;
  }

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
    if (binding.projectId !== projectId) {
      jsonResponse(res, 409, {
        error: `Session ${requestedSessionId} is bound to project ${binding.projectId}, not ${projectId}`,
      });
      return;
    }
    if (requestedConversationId && requestedConversationId !== binding.conversationId) {
      jsonResponse(res, 409, {
        error: `Session ${requestedSessionId} is bound to ${binding.conversationId}, not ${requestedConversationId}`,
      });
      return;
    }
    if (!resolver.conversationExists(binding.conversationId, projectId)) {
      jsonResponse(res, 404, {
        error: `Bound conversation ${binding.conversationId} not found in history`,
      });
      return;
    }
    wakeSessionId = requestedSessionId;
    conversationId = binding.conversationId;
  } else if (requestedConversationId) {
    if (!resolver.conversationExists(requestedConversationId, projectId)) {
      jsonResponse(res, 404, { error: `Conversation ${requestedConversationId} not found in history` });
      return;
    }
    const existingBinding = bindings.getByConversation(requestedConversationId);
    if (existingBinding) {
      if (existingBinding.projectId !== projectId) {
        jsonResponse(res, 409, {
          error: `Conversation ${requestedConversationId} is bound to project ${existingBinding.projectId}, not ${projectId}`,
        });
        return;
      }
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
    try {
      conversationId = resolver.createConversation(mode, projectId);
    } catch (err) {
      jsonResponse(res, 503, { error: (err as Error).message });
      return;
    }
  }

  try {
    const session = pool.create(makeAgent, mode, conversationId, {
      projectId,
      ...(wakeSessionId !== undefined ? { sessionId: wakeSessionId } : {}),
      mcpServers,
    });
    bindings.put(session.id, session.conversationId, session.projectId);
    jsonResponse(res, 201, {
      session_id: session.id,
      autonomy_mode: mode,
      project_id: session.projectId,
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
    emit(event: AgentEvent) {
      if (res.writableEnded) return;
      publishSessionSse(session, res, event.type, event);
    },
  };

  session.proxy.target = sseTransport;
  const previousClientApprovalResolver = session.agent.clientApprovalResolver;
  if (clientApprovalEnabled) {
    session.agent.setClientApprovalResolver(createDaemonChatClientApprovalResolver(session, res));
  }
  publishSessionSse(session, res, "session", { session_id: session.id });

  try {
    const result = await session.agent.send(message);
    publishSessionSse(session, res, "done", { session_id: session.id, result });
  } catch (err) {
    publishSessionSse(session, res, "error", { message: (err as Error).message });
  } finally {
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
    closeSessionSubscribers(session);
    if (!res.writableEnded) res.end();
  }
}

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
  pending.resolve(decoded.decision);
  res.writeHead(204);
  res.end();
}

type DecodedClientApprovalDecision =
  | { ok: true; decision: ToolApprovalDecision }
  | { ok: false; error: string };

function decodeClientApprovalDecision(body: KotaJsonObject): DecodedClientApprovalDecision {
  const unknown = Object.keys(body).filter((key) => key !== "outcome" && key !== "message");
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `approval response has unexpected field${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")}`,
    };
  }
  if (body.outcome === "allow") return { ok: true, decision: { outcome: "allow" } };
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

const DEFAULT_CLIENT_APPROVAL_TIMEOUT_MS = 120_000;
type ClientApprovalInput = ToolApprovalRequest["input"];
type ClientApprovalInputValue = ClientApprovalInput[string];

function createDaemonChatClientApprovalResolver(
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
      const onAbort = (): void => {
        fail(new Error("Client approval request aborted"));
      };
      const timeout = setTimeout(() => {
        fail(new ToolApprovalTimeoutError(`Client approval request ${approvalId} timed out`));
      }, timeoutMs);
      timeout.unref();

      request.signal?.addEventListener("abort", onAbort, { once: true });
      if (request.signal?.aborted) {
        fail(new Error("Client approval request aborted"));
        return;
      }
      session.pendingClientApprovals.set(approvalId, {
        resolve: settle,
        reject: fail,
      });
      publishSessionSse(session, res, "approval_request", {
        session_id: session.id,
        approval_id: approvalId,
        tool_use_id: request.toolUseId,
        tool: request.toolName,
        risk: request.risk,
        reason: request.reason,
        input: redactSensitiveInput(request.input),
        timeout_ms: timeoutMs,
        ...(request.context !== undefined ? { context: request.context } : {}),
      });
    });
}

function approvalTimeoutMs(request: ToolApprovalRequest): number {
  if (
    request.timeoutMs !== undefined &&
    Number.isFinite(request.timeoutMs) &&
    request.timeoutMs > 0
  ) {
    return Math.min(request.timeoutMs, 30 * 60 * 1000);
  }
  return DEFAULT_CLIENT_APPROVAL_TIMEOUT_MS;
}

function redactSensitiveInput(input: ClientApprovalInput): ClientApprovalInput {
  const out: ClientApprovalInput = {};
  for (const [childKey, childValue] of Object.entries(input)) {
    out[childKey] = redactSensitiveValue(childValue, childKey);
  }
  return out;
}

function redactSensitiveValue(value: ClientApprovalInputValue, key = ""): ClientApprovalInputValue {
  if (isSensitiveToolInputKey(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((entry) => redactSensitiveValue(entry));
  if (!isRecordObject(value)) return value;
  const out: ClientApprovalInput = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = redactSensitiveValue(childValue, childKey);
  }
  return out;
}

function isRecordObject(value: ClientApprovalInputValue): value is ClientApprovalInput {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DAEMON_MCP_STDIO_FIELDS = new Set(["type", "command", "args", "env"]);
const DAEMON_MCP_HTTP_FIELDS = new Set(["type", "url", "headers"]);

function isJsonObject(value: KotaJsonValue | undefined): value is KotaJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeDaemonMcpServers(
  value: KotaJsonValue | undefined,
): Record<string, McpServerConfig> {
  if (value === undefined) return {};
  if (!isJsonObject(value)) {
    throw new Error("mcp_servers must be an object");
  }
  const out: Record<string, McpServerConfig> = {};
  for (const [name, config] of Object.entries(value)) {
    if (name.length === 0) throw new Error("mcp_servers keys must be non-empty");
    out[name] = decodeDaemonMcpServer(name, config);
  }
  return out;
}

function decodeDaemonMcpServer(name: string, value: KotaJsonValue): McpServerConfig {
  if (!isJsonObject(value)) {
    throw new Error(`mcp_servers.${name} must be an object`);
  }
  const type = value.type;
  if (type === undefined || type === "stdio") {
    rejectUnknownMcpFields(name, value, DAEMON_MCP_STDIO_FIELDS);
    return {
      type: "stdio",
      command: requiredString(value.command, `mcp_servers.${name}.command`),
      ...(value.args !== undefined ? { args: stringArray(value.args, `mcp_servers.${name}.args`) } : {}),
      ...(value.env !== undefined ? { env: stringRecord(value.env, `mcp_servers.${name}.env`) } : {}),
    };
  }
  if (type === "http") {
    rejectUnknownMcpFields(name, value, DAEMON_MCP_HTTP_FIELDS);
    return {
      type: "http",
      url: requiredString(value.url, `mcp_servers.${name}.url`),
      ...(value.headers !== undefined ? { headers: stringRecord(value.headers, `mcp_servers.${name}.headers`) } : {}),
    };
  }
  throw new Error(`mcp_servers.${name}.type must be stdio or http`);
}

function rejectUnknownMcpFields(
  name: string,
  value: KotaJsonObject,
  allowed: Set<string>,
): void {
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length > 0) {
    throw new Error(
      `mcp_servers.${name} has unexpected field${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")}`,
    );
  }
}

function requiredString(value: KotaJsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function stringArray(value: KotaJsonValue, label: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return [...value];
}

function stringRecord(value: KotaJsonValue, label: string): Record<string, string> {
  if (!isJsonObject(value)) {
    throw new Error(`${label} must be an object with string values`);
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      throw new Error(`${label}.${key} must be a string`);
    }
    out[key] = entry;
  }
  return out;
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
      writeSse(res, eventName, data);
    },
    close(): void {
      if (!res.writableEnded) res.end();
    },
  };
  session.subscribers.add(subscriber);
  writeSse(res, "session", { session_id: session.id });
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
