import {
  type AcpDaemonClient,
  type AcpDaemonPermissionDecision,
  type AcpDaemonPermissionRequest,
  type AcpDaemonSession,
  AcpPromptCancelledError,
  resolveAcpProject,
} from "./daemon-adapter.js";
import {
  ACP_PROTOCOL_VERSION,
  AcpProtocolError,
  agentMessageUpdate,
  daemonUnavailable,
  decodeInitializeParams,
  decodeJsonRpcIncoming,
  decodeListSessionParams,
  decodeNewSessionParams,
  decodePermissionResponse,
  decodePromptParams,
  decodeResumeSessionParams,
  decodeSessionIdParams,
  initializeResponse,
  type JsonObject,
  type JsonRpcId,
  type JsonRpcIncoming,
  type JsonValue,
  makeJsonRpcError,
  makeJsonRpcRequest,
  makeJsonRpcResponse,
  methodNotFound,
  notInitialized,
  parseJsonLine,
  permissionRequestParams,
  sessionAlreadyLive,
  sessionBusy,
  sessionNotFound,
} from "./protocol.js";

export type WritableProtocolStream = {
  write(chunk: string): boolean | void;
};

export type AcpServerOptions = {
  output: WritableProtocolStream;
  error: WritableProtocolStream;
  daemonFactory: () => AcpDaemonClient | null;
};

type ActivePrompt = {
  id: JsonRpcId;
  controller: AbortController;
  cancelled: boolean;
};

type PendingPeerRequest = {
  resolve(value: JsonValue | undefined): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
  abort(): void;
};

const PEER_PERMISSION_TIMEOUT_MS = 120_000;

export class AgentClientProtocolServer {
  private initialized = false;
  private readonly sessions = new Set<string>();
  private readonly activePrompts = new Map<string, ActivePrompt>();
  private readonly pendingPeerRequests = new Map<JsonRpcId, PendingPeerRequest>();
  private nextPeerRequestId = 1;

  constructor(private readonly options: AcpServerOptions) {}

  async handleLine(line: string): Promise<void> {
    const parsed = parseJsonLine(line);
    if (!parsed.ok) {
      this.write(makeJsonRpcError(null, parsed.error.rpcCode, parsed.error.message, parsed.error.data));
      return;
    }

    const decoded = decodeJsonRpcIncoming(parsed.value);
    if (!decoded.ok) {
      this.write(makeJsonRpcError(null, decoded.error.rpcCode, decoded.error.message, decoded.error.data));
      return;
    }
    await this.handleIncoming(decoded.value);
  }

  async close(): Promise<void> {
    const daemon = this.options.daemonFactory();
    for (const active of this.activePrompts.values()) {
      active.cancelled = true;
      active.controller.abort();
    }
    if (daemon) {
      await Promise.allSettled([...this.activePrompts.keys()].map((id) => daemon.cancelSession(id)));
    }
    for (const pending of this.pendingPeerRequests.values()) {
      pending.abort();
    }
    this.pendingPeerRequests.clear();
    this.activePrompts.clear();
    this.sessions.clear();
  }

  private async handleIncoming(message: JsonRpcIncoming): Promise<void> {
    if (message.kind === "response") {
      this.handlePeerResponse(message);
      return;
    }
    if (message.kind === "malformed_response") {
      this.handleMalformedPeerResponse(message);
      return;
    }
    if (message.kind === "notification") {
      await this.handleNotification(message.method, message.params);
      return;
    }
    try {
      const result = await this.handleRequest(message);
      this.write(makeJsonRpcResponse(message.id, result));
    } catch (err) {
      const error = err instanceof Error
        ? normalizeAcpError(err)
        : normalizeAcpError(String(err));
      this.write(makeJsonRpcError(message.id, error.rpcCode, error.message, error.data));
    }
  }

  private async handleNotification(method: string, params: JsonValue | undefined): Promise<void> {
    if (method !== "session/cancel") return;
    try {
      const { sessionId } = decodeSessionIdParams(params, method);
      await this.cancelPrompt(sessionId);
    } catch (err) {
      this.options.error.write(
        `ACP notification ignored: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  private async handleRequest(message: Extract<JsonRpcIncoming, { kind: "request" }>): Promise<JsonObject> {
    if (message.method === "initialize") {
      const params = decodeInitializeParams(message.params);
      this.initialized = params.protocolVersion === ACP_PROTOCOL_VERSION;
      return initializeResponse();
    }
    if (!this.initialized) throw notInitialized();

    if (message.method === "session/new") {
      return await this.createSession(message.params);
    }
    if (message.method === "session/list") {
      return await this.listSessions(message.params);
    }
    if (message.method === "session/resume") {
      return await this.resumeSession(message.params);
    }
    if (message.method === "session/prompt") {
      return await this.promptSession(message.id, message.params);
    }
    if (message.method === "session/cancel") {
      const { sessionId } = decodeSessionIdParams(message.params, message.method);
      await this.cancelPrompt(sessionId);
      return {};
    }
    if (message.method === "session/close") {
      const { sessionId } = decodeSessionIdParams(message.params, message.method);
      await this.closeSession(sessionId);
      return {};
    }
    throw methodNotFound(message.method);
  }

  private async createSession(paramsValue: JsonValue | undefined): Promise<JsonObject> {
    const params = decodeNewSessionParams(paramsValue);
    const daemon = this.options.daemonFactory();
    if (!daemon) throw daemonUnavailable();

    const projects = await daemon.listProjects();
    const project = resolveAcpProject(projects, params.cwd);
    if (!project) {
      throw new AcpProtocolError(
        -32602,
        "cwd must match a daemon-configured project root",
        { code: "invalid_params", field: "cwd" },
      );
    }
    const session = await daemon.createSession(project);
    this.sessions.add(session.sessionId);
    return { sessionId: session.sessionId };
  }

  private async listSessions(paramsValue: JsonValue | undefined): Promise<JsonObject> {
    const params = decodeListSessionParams(paramsValue);
    const daemon = this.options.daemonFactory();
    if (!daemon) throw daemonUnavailable();

    const projects = await daemon.listProjects();
    const selectedProjects = params.cwd === undefined
      ? projects.projects
      : [this.resolveProjectForCwd(projects, params.cwd)];
    const sessions = (
      await Promise.all(selectedProjects.map((project) => daemon.listSessions(project)))
    ).flat();
    return {
      sessions: sessions
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(acpSessionInfo),
    };
  }

  private async resumeSession(paramsValue: JsonValue | undefined): Promise<JsonObject> {
    const params = decodeResumeSessionParams(paramsValue);
    if (this.sessions.has(params.sessionId)) throw sessionAlreadyLive(params.sessionId);

    const daemon = this.options.daemonFactory();
    if (!daemon) throw daemonUnavailable();

    const projects = await daemon.listProjects();
    const project = this.resolveProjectForCwd(projects, params.cwd);
    const known = (await daemon.listSessions(project))
      .find((session) => session.sessionId === params.sessionId);
    if (!known) throw sessionNotFound(params.sessionId);
    if (!known.live) {
      await daemon.resumeSession(project, params.sessionId);
    }
    this.sessions.add(params.sessionId);
    return {};
  }

  private async promptSession(id: JsonRpcId, paramsValue: JsonValue | undefined): Promise<JsonObject> {
    const params = decodePromptParams(paramsValue);
    if (!this.sessions.has(params.sessionId)) throw sessionNotFound(params.sessionId);
    if (this.activePrompts.has(params.sessionId)) throw sessionBusy(params.sessionId);

    const daemon = this.options.daemonFactory();
    if (!daemon) throw daemonUnavailable();

    const active: ActivePrompt = {
      id,
      controller: new AbortController(),
      cancelled: false,
    };
    this.activePrompts.set(params.sessionId, active);

    try {
      await daemon.promptSession({
        sessionId: params.sessionId,
        prompt: params.text,
        signal: active.controller.signal,
        onUpdate: (update) => this.write(update),
        requestPermission: (request) =>
          this.requestClientPermission(params.sessionId, request, active.controller.signal),
      });
      return { stopReason: "end_turn" };
    } catch (err) {
      if (active.cancelled || err instanceof AcpPromptCancelledError) {
        this.write(agentMessageUpdate(params.sessionId, "Prompt cancelled."));
        return { stopReason: "cancelled" };
      }
      throw err;
    } finally {
      this.activePrompts.delete(params.sessionId);
    }
  }

  private async cancelPrompt(sessionId: string): Promise<void> {
    const active = this.activePrompts.get(sessionId);
    if (!active) return;
    active.cancelled = true;
    active.controller.abort();
    const daemon = this.options.daemonFactory();
    if (daemon) await daemon.cancelSession(sessionId);
  }

  private async closeSession(sessionId: string): Promise<void> {
    const active = this.activePrompts.get(sessionId);
    if (active) {
      active.cancelled = true;
      active.controller.abort();
    }
    const daemon = this.options.daemonFactory();
    if (daemon) await daemon.closeSession(sessionId);
    this.sessions.delete(sessionId);
  }

  private write(message: JsonObject): void {
    this.options.output.write(`${JSON.stringify(message)}\n`);
  }

  private async requestClientPermission(
    sessionId: string,
    request: AcpDaemonPermissionRequest,
    signal: AbortSignal,
  ): Promise<AcpDaemonPermissionDecision> {
    const result = await this.sendPeerRequest(
      "session/request_permission",
      permissionRequestParams({
        sessionId,
        approvalId: request.approvalId,
        toolUseId: request.toolUseId,
        toolName: request.tool,
        input: request.input,
        risk: request.risk,
        reason: request.reason,
        timeoutMs: request.timeoutMs,
      }),
      signal,
      request.timeoutMs,
    );
    return decodePermissionResponse(result);
  }

  private sendPeerRequest(
    method: string,
    params: JsonObject,
    signal: AbortSignal,
    timeoutMs = PEER_PERMISSION_TIMEOUT_MS,
  ): Promise<JsonValue | undefined> {
    const id = this.nextPeerRequestId++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        this.pendingPeerRequests.delete(id);
      };
      const finish = (value: JsonValue | undefined): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const abort = (): void => {
        fail(new AcpPromptCancelledError());
      };
      const timeout = setTimeout(() => {
        fail(new AcpProtocolError(
          -32603,
          `ACP peer request timed out: ${method}`,
          { code: "peer_request_timeout", method },
        ));
      }, Math.min(timeoutMs, PEER_PERMISSION_TIMEOUT_MS));
      timeout.unref();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      this.pendingPeerRequests.set(id, {
        resolve: finish,
        reject: fail,
        timeout,
        abort,
      });
      this.write(makeJsonRpcRequest(id, method, params));
    });
  }

  private handlePeerResponse(message: Extract<JsonRpcIncoming, { kind: "response" }>): void {
    const pending = this.pendingPeerRequests.get(message.id);
    if (!pending) {
      this.options.error.write(`ACP peer response ignored: no pending request for id ${String(message.id)}\n`);
      return;
    }
    if (message.error) {
      pending.reject(peerResponseError(message.error));
      return;
    }
    pending.resolve(message.result);
  }

  private handleMalformedPeerResponse(message: Extract<JsonRpcIncoming, { kind: "malformed_response" }>): void {
    const pending = this.pendingPeerRequests.get(message.id);
    if (!pending) {
      this.options.error.write(
        `ACP malformed peer response ignored: no pending request for id ${String(message.id)}: ${message.error.message}\n`,
      );
      return;
    }
    pending.reject(message.error);
  }

  private resolveProjectForCwd(
    projects: Awaited<ReturnType<AcpDaemonClient["listProjects"]>>,
    cwd: string,
  ) {
    const project = resolveAcpProject(projects, cwd);
    if (!project) {
      throw new AcpProtocolError(
        -32602,
        "cwd must match a daemon-configured project root",
        { code: "invalid_params", field: "cwd" },
      );
    }
    return project;
  }
}

function acpSessionInfo(session: AcpDaemonSession): JsonObject {
  return {
    sessionId: session.sessionId,
    cwd: session.cwd,
    title: session.title,
    updatedAt: session.updatedAt,
    _meta: session.metadata,
  };
}

function normalizeAcpError(err: Error | AcpProtocolError | string): AcpProtocolError {
  if (err instanceof AcpProtocolError) return err;
  const message = errorMessage(err);
  return new AcpProtocolError(-32603, message, { code: "internal_error" });
}

function peerResponseError(error: JsonObject): AcpProtocolError {
  const code = typeof error.code === "number" ? error.code : -32603;
  const message = typeof error.message === "string" && error.message.length > 0
    ? error.message
    : "ACP peer request failed";
  const data = isJsonData(error.data) ? error.data : { code: "peer_request_failed" };
  return new AcpProtocolError(code, message, data);
}

function isJsonData(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(err: Error | string): string {
  return err instanceof Error ? err.message : String(err);
}
