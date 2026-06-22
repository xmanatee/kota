import type { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { buildRequiredInheritedSubprocessEnv } from "#core/modules/subprocess-env.js";
import { writeTerminalStderr } from "#core/modules/terminal-renderer.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { generatedProgressToken } from "./client-decode-utils.js";
import { McpClientHttpRuntime } from "./client-http-runtime.js";
import type {
  JsonRpcNotification,
  JsonRpcParams,
  JsonRpcRequest,
  JsonRpcResult,
  McpInitializeResult,
  McpProgressToken,
  McpRequestProgressOptions,
} from "./client-protocol.js";
import {
  CONNECT_TIMEOUT,
  mcpProtocolSupports,
} from "./client-protocol.js";

function buildMcpStdioSubprocessEnv(
  transportEnv: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  return withProtectedGitBareRepositoryEnv({
    ...buildRequiredInheritedSubprocessEnv(),
    ...(transportEnv ?? {}),
  });
}

export abstract class McpClientStdioRuntime extends McpClientHttpRuntime {
  protected abstract initializeServer(): Promise<McpInitializeResult>;

  protected async connectStdio(): Promise<McpInitializeResult> {
    if (this.transport.type !== "stdio") {
      throw new Error(`MCP server "${this.serverName}" is not a stdio transport`);
    }
    this.proc = spawn(this.transport.command, this.transport.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: buildMcpStdioSubprocessEnv(this.transport.env),
    });

    this.proc.on("error", (err) => {
      this.rejectAll(new Error(`MCP server "${this.serverName}" failed: ${err.message}`));
      this.connected = false;
    });

    this.proc.on("exit", (code) => {
      this.rejectAll(new Error(`MCP server "${this.serverName}" exited with code ${code}`));
      this.connected = false;
    });

    this.proc.stdin?.on("error", () => {});
    this.proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (!text) return;
      writeTerminalStderr(
        `[mcp:${this.serverName}] ${this.redactSensitiveErrorMessage(text)}\n`,
      );
    });

    this.rl = createInterface({ input: this.proc.stdout! });
    this.rl.on("line", (line) => this.handleLine(line));

    const result = await this.initializeServer();
    this.notify("notifications/initialized");
    return result;
  }

  protected async closeStdio(): Promise<void> {
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
      if (proc.stdin?.writable) {
        const id = this.nextId++;
        const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method: "shutdown" };
        proc.stdin.write(`${JSON.stringify(msg)}\n`);
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        const exitMsg: JsonRpcNotification = { jsonrpc: "2.0", method: "exit" };
        proc.stdin.write(`${JSON.stringify(exitMsg)}\n`);
      }
    } catch {
      // Server may not support graceful shutdown.
    }

    proc.kill("SIGTERM");
    this.killTimer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Process may have already exited.
      }
      this.killTimer = null;
    }, 3_000);

    proc.on("exit", () => {
      if (!this.killTimer) return;
      clearTimeout(this.killTimer);
      this.killTimer = null;
    });
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
    if (
      progress &&
      this.protocolVersion !== null &&
      mcpProtocolSupports(this.protocolVersion, "requestMetadata")
    ) {
      progressToken = progress.token ?? generatedProgressToken(id);
    }
    const requestParams = this.paramsWithProtocolMetadata(params, progressToken);
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
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.proc?.stdin?.write(`${JSON.stringify(msg)}\n`);
    });
  }

  protected openStdioListChangedSubscription(): void {
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
        _meta: this.protocolRequestMeta(),
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
