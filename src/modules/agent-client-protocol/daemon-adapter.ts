import { resolve } from "node:path";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type {
  AcpMcpServers,
  AcpPermissionDecision,
} from "./protocol.js";
import {
  AcpProtocolError,
  agentMessageUpdate,
  agentThoughtUpdate,
  isJsonObject,
  type JsonObject,
  type JsonValue,
  sessionAlreadyLive,
  sessionNotFound,
} from "./protocol.js";

export type AcpProject = {
  projectId: string;
  projectDir: string;
  displayName: string;
};

export type AcpProjectList = {
  projects: AcpProject[];
  defaultProjectId: string;
  activeProjectId: string | null;
};

export type AcpPromptUpdate = JsonObject;

export type AcpDaemonPermissionRequest = {
  approvalId: string;
  toolUseId: string;
  tool: string;
  input: JsonObject;
  risk: string;
  reason: string;
  timeoutMs: number;
};

export type AcpDaemonPermissionDecision = AcpPermissionDecision;

export type AcpDaemonSession = {
  sessionId: string;
  cwd: string;
  title: string;
  updatedAt: string;
  live: boolean;
  metadata: JsonObject;
};

export type PromptSessionArgs = {
  sessionId: string;
  prompt: string;
  signal: AbortSignal;
  onUpdate: (update: AcpPromptUpdate) => void;
  requestPermission?: (
    request: AcpDaemonPermissionRequest,
  ) => Promise<AcpDaemonPermissionDecision>;
};

export type PromptSessionResult = {
  stopReason: "end_turn";
};

export interface AcpDaemonClient {
  listProjects(): Promise<AcpProjectList>;
  createSession(project: AcpProject, mcpServers: AcpMcpServers): Promise<{ sessionId: string }>;
  listSessions(project: AcpProject): Promise<AcpDaemonSession[]>;
  resumeSession(project: AcpProject, sessionId: string, mcpServers: AcpMcpServers): Promise<{ sessionId: string }>;
  promptSession(args: PromptSessionArgs): Promise<PromptSessionResult>;
  cancelSession(sessionId: string): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
}

export class AcpPromptCancelledError extends Error {
  constructor() {
    super("ACP prompt cancelled");
    this.name = "AcpPromptCancelledError";
  }
}

type ProjectsWireBody = {
  projects: AcpProject[];
  defaultProjectId: string;
  activeProjectId?: string | null;
};

type CreateSessionWireBody = {
  session_id?: string;
  error?: string;
};

type SessionListWireEntry = {
  id?: string;
  createdAt?: string;
  lastActive?: number;
  source?: "daemon" | "serve";
  busy?: boolean;
  projectId?: string;
  conversationId?: string;
  mcpServerNames?: string[];
};

type SessionListWireBody = {
  sessions?: SessionListWireEntry[];
};

type SessionBindingWireEntry = {
  sessionId?: string;
  projectId?: string;
  conversationId?: string;
  createdAt?: string;
  lastActiveAt?: string;
};

type SessionBindingsWireBody = {
  bindings?: SessionBindingWireEntry[];
};

export class HttpAcpDaemonClient implements AcpDaemonClient {
  constructor(
    private readonly transport: DaemonTransport,
    private readonly autonomyMode: AutonomyMode = "supervised",
  ) {}

  async listProjects(): Promise<AcpProjectList> {
    const res = await this.transport.fetchRaw("/projects", {
      method: "GET",
      headers: this.transport.authHeaders(),
    });
    if (!res.ok) {
      throw daemonHttpError(res.status, await responseErrorMessage(res));
    }
    const body = (await res.json()) as ProjectsWireBody;
    return {
      projects: body.projects,
      defaultProjectId: body.defaultProjectId,
      activeProjectId: body.activeProjectId ?? null,
    };
  }

  async createSession(project: AcpProject, mcpServers: AcpMcpServers): Promise<{ sessionId: string }> {
    const query = new URLSearchParams({ projectId: project.projectId });
    const res = await this.transport.fetchRaw(`/sessions?${query.toString()}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.transport.authHeaders(),
      },
      body: JSON.stringify({
        autonomy_mode: this.autonomyMode,
        mcp_servers: mcpServers,
      }),
    });
    if (!res.ok) {
      throw daemonHttpError(res.status, await responseErrorMessage(res));
    }
    const body = (await res.json()) as CreateSessionWireBody;
    if (!body.session_id) {
      throw new AcpProtocolError(
        -32603,
        "Daemon session response did not include a session id",
        { code: "daemon_protocol_error" },
      );
    }
    return { sessionId: body.session_id };
  }

  async listSessions(project: AcpProject): Promise<AcpDaemonSession[]> {
    const live = await this.listLiveSessions(project);
    const liveIds = new Set(live.map((session) => session.sessionId));
    const bindings = await this.listPersistedSessionBindings(project);
    return [...live, ...bindings.filter((session) => !liveIds.has(session.sessionId))]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async resumeSession(
    project: AcpProject,
    sessionId: string,
    mcpServers: AcpMcpServers,
  ): Promise<{ sessionId: string }> {
    const query = new URLSearchParams({ projectId: project.projectId });
    const res = await this.transport.fetchRaw(`/sessions?${query.toString()}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.transport.authHeaders(),
      },
      body: JSON.stringify({
        autonomy_mode: this.autonomyMode,
        session_id: sessionId,
        mcp_servers: mcpServers,
      }),
    });
    if (!res.ok) {
      if (res.status === 404) throw sessionNotFound(sessionId);
      if (res.status === 409) throw sessionAlreadyLive(sessionId);
      throw daemonHttpError(res.status, await responseErrorMessage(res));
    }
    const body = (await res.json()) as CreateSessionWireBody;
    if (body.session_id !== sessionId) {
      throw new AcpProtocolError(
        -32603,
        "Daemon resume response did not match the requested session id",
        { code: "daemon_protocol_error" },
      );
    }
    return { sessionId: body.session_id };
  }

  async promptSession(args: PromptSessionArgs): Promise<PromptSessionResult> {
    let res: Response;
    try {
      res = await this.transport.fetchRaw(
        `/sessions/${encodeURIComponent(args.sessionId)}/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...this.transport.authHeaders(),
          },
          body: JSON.stringify({ message: args.prompt, client_approval: true }),
          signal: args.signal,
        },
      );
    } catch (err) {
      if (args.signal.aborted) throw new AcpPromptCancelledError();
      throw err;
    }

    if (!res.ok) {
      if (res.status === 404) throw sessionNotFound(args.sessionId);
      throw daemonHttpError(res.status, await responseErrorMessage(res));
    }

    let emittedText = false;
    let finalText = "";
    for await (const event of readSseEvents(res, args.signal)) {
      const mapped = mapDaemonSseEvent(args.sessionId, event);
      if (mapped.kind === "update") {
        emittedText = true;
        args.onUpdate(mapped.update);
      } else if (mapped.kind === "approval") {
        if (!args.requestPermission) {
          throw new AcpProtocolError(-32603, "Daemon requested client approval but no ACP permission bridge is active", {
            code: "permission_bridge_unavailable",
          });
        }
        let decision: AcpDaemonPermissionDecision;
        try {
          decision = await args.requestPermission(mapped.request);
        } catch (err) {
          if (!args.signal.aborted) {
            await this.resolvePermission(
              args.sessionId,
              mapped.request.approvalId,
              {
                outcome: "cancelled",
                message: err instanceof Error ? err.message : String(err),
              },
            );
          }
          throw err;
        }
        await this.resolvePermission(args.sessionId, mapped.request.approvalId, decision);
      } else if (mapped.kind === "done") {
        finalText = mapped.text;
      } else if (mapped.kind === "error") {
        throw new AcpProtocolError(-32603, mapped.message, { code: "daemon_agent_error" });
      }
    }

    if (!emittedText && finalText.length > 0) {
      args.onUpdate(agentMessageUpdate(args.sessionId, finalText));
    }
    return { stopReason: "end_turn" };
  }

  async cancelSession(sessionId: string): Promise<void> {
    const res = await this.transport.fetchRaw(
      `/sessions/${encodeURIComponent(sessionId)}/cancel`,
      {
        method: "POST",
        headers: this.transport.authHeaders(),
      },
    );
    if (!res.ok && res.status !== 404) {
      throw daemonHttpError(res.status, await responseErrorMessage(res));
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.deleteSession(sessionId);
  }

  private async deleteSession(sessionId: string): Promise<void> {
    const res = await this.transport.fetchRaw(
      `/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "DELETE",
        headers: this.transport.authHeaders(),
      },
    );
    if (!res.ok && res.status !== 404) {
      throw daemonHttpError(res.status, await responseErrorMessage(res));
    }
  }

  private async resolvePermission(
    sessionId: string,
    approvalId: string,
    decision: AcpDaemonPermissionDecision,
  ): Promise<void> {
    const res = await this.transport.fetchRaw(
      `/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.transport.authHeaders(),
        },
        body: JSON.stringify(permissionDecisionBody(decision)),
      },
    );
    if (!res.ok) {
      throw daemonHttpError(res.status, await responseErrorMessage(res));
    }
  }

  private async listLiveSessions(project: AcpProject): Promise<AcpDaemonSession[]> {
    const query = new URLSearchParams({ projectId: project.projectId });
    const res = await this.transport.fetchRaw(`/sessions?${query.toString()}`, {
      method: "GET",
      headers: this.transport.authHeaders(),
    });
    if (!res.ok) {
      throw daemonHttpError(res.status, await responseErrorMessage(res));
    }
    const body = (await res.json()) as SessionListWireBody;
    const entries = body.sessions;
    if (!Array.isArray(entries)) {
      throw daemonProtocolError("Daemon session list response did not include sessions");
    }
    return entries
      .filter((entry) => entry.source === "daemon")
      .map((entry) => mapLiveSession(project, entry));
  }

  private async listPersistedSessionBindings(project: AcpProject): Promise<AcpDaemonSession[]> {
    const query = new URLSearchParams({ projectId: project.projectId });
    const res = await this.transport.fetchRaw(`/sessions/bindings?${query.toString()}`, {
      method: "GET",
      headers: this.transport.authHeaders(),
    });
    if (!res.ok) {
      throw daemonHttpError(res.status, await responseErrorMessage(res));
    }
    const body = (await res.json()) as SessionBindingsWireBody;
    const bindings = body.bindings;
    if (!Array.isArray(bindings)) {
      throw daemonProtocolError("Daemon session bindings response did not include bindings");
    }
    return bindings.map((entry) => mapBindingSession(project, entry));
  }
}

export function resolveAcpProject(
  projects: AcpProjectList,
  cwd: string,
): AcpProject | null {
  const wanted = resolve(cwd);
  return projects.projects.find((project) => resolve(project.projectDir) === wanted) ?? null;
}

type SseEvent = {
  event: string;
  data: string;
};

type MappedSseEvent =
  | { kind: "update"; update: JsonObject }
  | { kind: "approval"; request: AcpDaemonPermissionRequest }
  | { kind: "done"; text: string }
  | { kind: "error"; message: string }
  | { kind: "ignore" };

async function* readSseEvents(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<SseEvent> {
  if (!response.body) {
    throw new AcpProtocolError(-32603, "Daemon chat response was empty", {
      code: "daemon_protocol_error",
    });
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal.aborted) throw new AcpPromptCancelledError();
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const parsed = parseSseFrame(frame);
        if (parsed) yield parsed;
      }
    }
    if (buffer.trim().length > 0) {
      const parsed = parseSseFrame(buffer);
      if (parsed) yield parsed;
    }
  } catch (err) {
    if (signal.aborted) throw new AcpPromptCancelledError();
    throw err;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be closed.
    }
  }
}

function parseSseFrame(frame: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trimStart());
    }
  }
  if (data.length === 0) return null;
  return { event, data: data.join("\n") };
}

function mapDaemonSseEvent(sessionId: string, event: SseEvent): MappedSseEvent {
  const data = parseDaemonEventData(event.data);
  if (event.event === "text") {
    const text = stringField(data, "content");
    return text ? { kind: "update", update: agentMessageUpdate(sessionId, text) } : { kind: "ignore" };
  }
  if (event.event === "thinking") {
    const text = stringField(data, "content");
    return text ? { kind: "update", update: agentThoughtUpdate(sessionId, text) } : { kind: "ignore" };
  }
  if (event.event === "progress") {
    const text = stringField(data, "content");
    return text ? { kind: "update", update: agentMessageUpdate(sessionId, text) } : { kind: "ignore" };
  }
  if (event.event === "status") {
    const text = stringField(data, "message");
    return text ? { kind: "update", update: agentMessageUpdate(sessionId, text) } : { kind: "ignore" };
  }
  if (event.event === "error") {
    return { kind: "error", message: stringField(data, "message") ?? "Agent session failed" };
  }
  if (event.event === "approval_request") {
    return { kind: "approval", request: decodeApprovalRequest(data) };
  }
  if (event.event === "done") {
    return { kind: "done", text: stringField(data, "result") ?? "" };
  }
  return { kind: "ignore" };
}

function decodeApprovalRequest(data: JsonObject): AcpDaemonPermissionRequest {
  const input = data.input;
  if (!isJsonObject(input)) {
    throw daemonProtocolError("Daemon approval request input must be an object");
  }
  return {
    approvalId: requiredString(stringField(data, "approval_id") ?? undefined, "approval.approval_id"),
    toolUseId: requiredString(stringField(data, "tool_use_id") ?? undefined, "approval.tool_use_id"),
    tool: requiredString(stringField(data, "tool") ?? undefined, "approval.tool"),
    input,
    risk: requiredString(stringField(data, "risk") ?? undefined, "approval.risk"),
    reason: requiredString(stringField(data, "reason") ?? undefined, "approval.reason"),
    timeoutMs: requiredPositiveNumber(data.timeout_ms, "approval.timeout_ms"),
  };
}

function requiredPositiveNumber(value: JsonValue | undefined, field: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  throw daemonProtocolError(`Daemon response field ${field} must be a positive number`);
}

function permissionDecisionBody(decision: AcpDaemonPermissionDecision): JsonObject {
  if (decision.outcome === "allow") return { outcome: "allow" };
  return {
    outcome: decision.outcome,
    message: decision.message,
  };
}

function parseDaemonEventData(data: string): JsonObject {
  try {
    const parsed = JSON.parse(data) as JsonValue;
    return isJsonObject(parsed) ? parsed : {};
  } catch {
    throw new AcpProtocolError(-32603, "Daemon sent malformed SSE data", {
      code: "daemon_protocol_error",
    });
  }
}

function stringField(obj: JsonObject, key: string): string | null {
  const value = obj[key];
  return typeof value === "string" ? value : null;
}

function mapLiveSession(project: AcpProject, entry: SessionListWireEntry): AcpDaemonSession {
  const sessionId = requiredString(entry.id, "session.id");
  const createdAt = requiredString(entry.createdAt, "session.createdAt");
  const updatedAt = isoFromEpochMillis(entry.lastActive, createdAt, "session.lastActive");
  return {
    sessionId,
    cwd: project.projectDir,
    title: `KOTA session ${sessionId}`,
    updatedAt,
    live: true,
    metadata: {
      source: "daemon",
      projectId: entry.projectId ?? project.projectId,
      ...(entry.conversationId ? { conversationId: entry.conversationId } : {}),
      ...(Array.isArray(entry.mcpServerNames) ? { mcpServerNames: entry.mcpServerNames } : {}),
      busy: entry.busy === true,
    },
  };
}

function mapBindingSession(project: AcpProject, entry: SessionBindingWireEntry): AcpDaemonSession {
  const sessionId = requiredString(entry.sessionId, "binding.sessionId");
  const createdAt = requiredString(entry.createdAt, "binding.createdAt");
  const updatedAt = requiredString(entry.lastActiveAt, "binding.lastActiveAt");
  return {
    sessionId,
    cwd: project.projectDir,
    title: `KOTA session ${sessionId}`,
    updatedAt,
    live: false,
    metadata: {
      source: "daemon-binding",
      projectId: entry.projectId ?? project.projectId,
      conversationId: requiredString(entry.conversationId, "binding.conversationId"),
      createdAt,
      resumable: true,
    },
  };
}

function requiredString(value: string | undefined, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw daemonProtocolError(`Daemon response field ${field} must be a non-empty string`);
}

function isoFromEpochMillis(value: number | undefined, fallbackIso: string, field: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (!Number.isNaN(new Date(fallbackIso).getTime())) return fallbackIso;
  throw daemonProtocolError(`Daemon response field ${field} must be a finite epoch millisecond number`);
}

async function responseErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (typeof body.error === "string" && body.error.length > 0) return body.error;
  } catch {
    // Non-JSON error bodies collapse to the HTTP status below.
  }
  return `HTTP ${res.status}`;
}

function daemonHttpError(status: number, message: string): AcpProtocolError {
  if (status === 404) return new AcpProtocolError(-32002, message, { code: "daemon_not_found" });
  if (status === 503) return new AcpProtocolError(-32603, message, { code: "daemon_unavailable" });
  return new AcpProtocolError(-32603, message, { code: "daemon_http_error", status });
}

function daemonProtocolError(message: string): AcpProtocolError {
  return new AcpProtocolError(-32603, message, { code: "daemon_protocol_error" });
}
