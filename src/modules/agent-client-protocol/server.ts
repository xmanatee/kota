import {
  type AcpDaemonClient,
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
  decodeNewSessionParams,
  decodePromptParams,
  decodeSessionIdParams,
  initializeResponse,
  type JsonObject,
  type JsonRpcId,
  type JsonRpcIncoming,
  type JsonValue,
  makeJsonRpcError,
  makeJsonRpcResponse,
  methodNotFound,
  notInitialized,
  parseJsonLine,
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

export class AgentClientProtocolServer {
  private initialized = false;
  private readonly sessions = new Set<string>();
  private readonly activePrompts = new Map<string, ActivePrompt>();

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
      await Promise.allSettled([...this.sessions].map((id) => daemon.closeSession(id)));
    }
    this.sessions.clear();
  }

  private async handleIncoming(message: JsonRpcIncoming): Promise<void> {
    if (message.kind === "response") return;
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
}

function normalizeAcpError(err: Error | AcpProtocolError | string): AcpProtocolError {
  if (err instanceof AcpProtocolError) return err;
  const message = errorMessage(err);
  return new AcpProtocolError(-32603, message, { code: "internal_error" });
}

function errorMessage(err: Error | string): string {
  return err instanceof Error ? err.message : String(err);
}
