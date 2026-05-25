import type { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { McpAuthorizationError, McpConnectionError } from "./client-auth-types.js";
import {
  generatedProgressToken,
  isUnsupportedProtocolVersionError,
} from "./client-decode-utils.js";
import { McpClientHttpRuntime } from "./client-http-runtime.js";
import {
  decodeDiscoverResult,
  decodeInitializeResult,
} from "./client-initialize-decoders.js";
import type {
  JsonRpcNotification,
  JsonRpcParams,
  JsonRpcRequest,
  JsonRpcResult,
  McpInitializeResult,
  McpProgressToken,
  McpProtocolVersion,
  McpRequestProgressOptions,
} from "./client-protocol.js";
import {
  CONNECT_TIMEOUT,
  KOTA_MCP_CLIENT_INFO,
  MCP_DRAFT_PROTOCOL_VERSION,
  MCP_LEGACY_PROTOCOL_VERSION,
} from "./client-protocol.js";

export abstract class McpClientConnection extends McpClientHttpRuntime {
  /** Connect the configured transport and complete the MCP handshake. */
  async connect(): Promise<void> {
    if (this.connected) {
      throw new Error(`MCP server "${this.serverName}" is already connected`);
    }
    if (this.connecting) {
      throw new Error(`MCP server "${this.serverName}" is already connecting`);
    }
    if (this.closing) {
      throw new Error(`MCP server "${this.serverName}" is closed`);
    }

    this.connecting = true;
    try {
      if (this.transport.type === "http") {
        await this.connectHttp();
      } else {
        await this.connectStdio();
      }
    } finally {
      this.connecting = false;
    }
  }

  protected async connectStdio(): Promise<void> {
    if (this.transport.type !== "stdio") return;
    this.proc = spawn(this.transport.command, this.transport.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(this.transport.env ?? {}) },
    });

    this.proc.on("error", (err) => {
      this.rejectAll(new Error(`MCP server "${this.serverName}" failed: ${err.message}`));
      this.connected = false;
    });

    this.proc.on("exit", (code) => {
      this.rejectAll(new Error(`MCP server "${this.serverName}" exited with code ${code}`));
      this.connected = false;
    });

    // Absorb stdin write errors (server may have exited)
    this.proc.stdin?.on("error", () => {});

    // Capture stderr for diagnostics but don't block
    this.proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.error(`[mcp:${this.serverName}] ${text}`);
    });

    this.rl = createInterface({ input: this.proc.stdout! });
    this.rl.on("line", (line) => this.handleLine(line));

    const result = await this.initializeServer();

    // Send initialized notification
    this.notify("notifications/initialized");

    // close() may have been called during the handshake await
    if (this.closing) {
      throw new Error(`MCP server "${this.serverName}" was closed during connection`);
    }

    if (result.serverInfo?.name) {
      this.serverName = result.serverInfo.name;
    }
    this.warnDeprecatedServerCapabilities(result);
    this.protocolVersion = result.protocolVersion;
    this.toolResultContract = result.protocolVersion === MCP_DRAFT_PROTOCOL_VERSION
      ? "draft-tool-result"
      : "legacy-content";
    this.toolsSupported = result.toolsSupported;
    this.toolsListChanged = result.toolsListChanged;
    this.resourcesSupported = result.resourcesSupported;
    this.resourcesListChanged = result.resourcesListChanged;
    this.promptsSupported = result.promptsSupported;
    this.promptsListChanged = result.promptsListChanged;
    this.tasksSupported = result.tasksSupported;
    this.skillsSupported = result.skillsSupported;
    this.connected = true;
    if (
      result.protocolVersion === MCP_DRAFT_PROTOCOL_VERSION &&
      (this.toolsListChanged || this.resourcesListChanged || this.promptsListChanged)
    ) {
      this.openListChangedSubscription();
    }
  }

  protected async connectHttp(): Promise<void> {
    this.protocolVersion = MCP_DRAFT_PROTOCOL_VERSION;
    this.toolResultContract = "draft-tool-result";
    let result: McpInitializeResult;
    try {
      result = decodeDiscoverResult(await this.request("server/discover"));
    } catch (err) {
      if (err instanceof McpConnectionError || err instanceof McpAuthorizationError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw this.requestErrorForMethod("server/discover", message);
    }

    if (this.closing) {
      throw new Error(`MCP server "${this.serverName}" was closed during connection`);
    }

    if (result.serverInfo?.name) {
      this.serverName = result.serverInfo.name;
    }
    this.warnDeprecatedServerCapabilities(result);
    this.protocolVersion = result.protocolVersion;
    this.toolResultContract = "draft-tool-result";
    this.toolsSupported = result.toolsSupported;
    this.toolsListChanged = result.toolsListChanged;
    this.resourcesSupported = result.resourcesSupported;
    this.resourcesListChanged = result.resourcesListChanged;
    this.promptsSupported = result.promptsSupported;
    this.promptsListChanged = result.promptsListChanged;
    this.tasksSupported = result.tasksSupported;
    this.skillsSupported = result.skillsSupported;
    this.connected = true;
    if (this.toolsListChanged || this.resourcesListChanged || this.promptsListChanged) {
      this.openListChangedSubscription();
    }
  }


  /** Gracefully shut down the server. */
  async close(): Promise<void> {
    if (this.transport.type === "http") {
      if (this.closing) return;
      this.closing = true;
      this.connected = false;
      this.httpListSubscriptionAbort?.abort();
      this.httpListSubscriptionAbort = null;
      this.streamingRequestIds.clear();
      this.clearAllProgress();
      this.toolListSubscriptionId = null;
      this.toolListChangedHandlers.clear();
      this.resourceListChangedHandlers.clear();
      this.promptListChangedHandlers.clear();
      return;
    }
    if (!this.proc || this.closing) return;
    this.closing = true;
    this.connected = false;
    this.rejectAll(new Error(`MCP server "${this.serverName}" is closing`));
    this.streamingRequestIds.clear();
    this.clearAllProgress();
    this.toolListSubscriptionId = null;
    this.toolListChangedHandlers.clear();
    this.resourceListChangedHandlers.clear();
    this.promptListChangedHandlers.clear();

    const proc = this.proc;
    this.proc = null;
    this.rl?.close();
    this.rl = null;

    try {
      // Attempt graceful shutdown if stdin is still writable
      if (proc.stdin?.writable) {
        const id = this.nextId++;
        const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method: "shutdown" };
        proc.stdin.write(`${JSON.stringify(msg)}\n`);
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        const exitMsg: JsonRpcNotification = { jsonrpc: "2.0", method: "exit" };
        proc.stdin.write(`${JSON.stringify(exitMsg)}\n`);
      }
    } catch {
      // Server may not support graceful shutdown
    }

    proc.kill("SIGTERM");
    this.killTimer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already dead */ }
      this.killTimer = null;
    }, 3_000);

    // Cancel the SIGKILL timer if the process exits promptly
    proc.on("exit", () => {
      if (this.killTimer) {
        clearTimeout(this.killTimer);
        this.killTimer = null;
      }
    });
  }


  protected async initializeServer(): Promise<McpInitializeResult> {
    try {
      return await this.requestInitialize(MCP_DRAFT_PROTOCOL_VERSION);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (!isUnsupportedProtocolVersionError(error)) throw err;
      return await this.requestInitialize(MCP_LEGACY_PROTOCOL_VERSION);
    }
  }

  protected async requestInitialize(
    protocolVersion: McpProtocolVersion,
  ): Promise<McpInitializeResult> {
    const result = await this.request("initialize", {
      protocolVersion,
      capabilities: this.clientCapabilitiesForProtocol(protocolVersion),
      clientInfo: KOTA_MCP_CLIENT_INFO,
    });
    return decodeInitializeResult(result);
  }

  protected request(
    method: string,
    params?: JsonRpcParams,
    timeout = CONNECT_TIMEOUT,
    progress?: McpRequestProgressOptions,
  ): Promise<JsonRpcResult> {
    if (this.transport.type === "http") {
      return this.httpRequest(method, params, timeout, progress);
    }
    return this.stdioRequest(method, params, timeout, progress);
  }

  protected stdioRequest(
    method: string,
    params?: JsonRpcParams,
    timeout = CONNECT_TIMEOUT,
    progress?: McpRequestProgressOptions,
  ): Promise<JsonRpcResult> {
    if (!this.proc?.stdin?.writable) {
      return Promise.reject(
        new Error(`MCP server "${this.serverName}" is not connected`),
      );
    }

    const id = this.nextId++;
    let progressToken: McpProgressToken | undefined;
    if (progress && this.protocolVersion === MCP_DRAFT_PROTOCOL_VERSION) {
      progressToken = progress.token ?? generatedProgressToken(id);
    }
    const requestParams = this.paramsWithDraftMetadata(params, progressToken);
    const msg: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(requestParams && { params: requestParams }),
    };

    return new Promise((resolve, reject) => {
      if (progress && progressToken !== undefined) {
        try {
          this.trackProgressRequest(id, progressToken, progress);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
      }
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.clearProgressForRequest(id);
        reject(new Error(`MCP request "${method}" timed out after ${timeout}ms`));
      }, timeout);

      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      this.proc?.stdin?.write(`${JSON.stringify(msg)}\n`);
    });
  }


  protected openListChangedSubscription(): void {
    if (this.transport.type === "http") {
      this.openHttpListChangedSubscription();
      return;
    }
    if (!this.proc?.stdin?.writable || this.toolListSubscriptionId !== null) return;
    const id = this.nextId++;
    this.toolListSubscriptionId = id;
    this.streamingRequestIds.add(id);
    const notifications = {
      ...(this.toolsListChanged ? { toolsListChanged: true } : {}),
      ...(this.resourcesListChanged ? { resourcesListChanged: true } : {}),
      ...(this.promptsListChanged ? { promptsListChanged: true } : {}),
    };
    const msg: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method: "subscriptions/listen",
      params: {
        _meta: this.draftRequestMeta(),
        notifications,
      },
    };
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
  }


  protected notify(method: string, params?: JsonRpcNotification["params"]): void {
    if (!this.proc?.stdin?.writable) return;
    const msg: JsonRpcNotification = { jsonrpc: "2.0", method, ...(params && { params }) };
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  protected rejectAll(error: Error): void {
    for (const { reject } of this.pending.values()) {
      reject(error);
    }
    this.pending.clear();
    this.clearAllProgress();
  }

}
