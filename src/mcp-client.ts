import { type ChildProcess, spawn } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

export type McpToolSchema = {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
};

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

const CONNECT_TIMEOUT = 10_000;
const CALL_TIMEOUT = 120_000;

/**
 * Lightweight MCP client using JSON-RPC 2.0 over stdio.
 * Handles the MCP lifecycle: initialize → list tools → call tools → close.
 */
export class McpClient {
  private proc: ChildProcess | null = null;
  private rl: Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private connected = false;
  private serverName: string;

  constructor(
    private command: string,
    private args: string[] = [],
    private env: Record<string, string> = {},
    name?: string,
  ) {
    this.serverName = name || command;
  }

  getName(): string {
    return this.serverName;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Spawn the server process and complete the MCP handshake. */
  async connect(): Promise<void> {
    this.proc = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.env },
    });

    this.proc.on("error", (err) => {
      this.rejectAll(new Error(`MCP server "${this.serverName}" failed: ${err.message}`));
      this.connected = false;
    });

    this.proc.on("exit", (code) => {
      this.rejectAll(new Error(`MCP server "${this.serverName}" exited with code ${code}`));
      this.connected = false;
    });

    // Capture stderr for diagnostics but don't block
    this.proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.error(`[mcp:${this.serverName}] ${text}`);
    });

    this.rl = createInterface({ input: this.proc.stdout! });
    this.rl.on("line", (line) => this.handleLine(line));

    // Initialize handshake
    const result = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "kota", version: "0.1.0" },
    }) as { protocolVersion: string; capabilities: unknown; serverInfo?: { name?: string } };

    // Send initialized notification
    this.notify("notifications/initialized");

    if (result.serverInfo?.name) {
      this.serverName = result.serverInfo.name;
    }
    this.connected = true;
  }

  /** List available tools from the server. */
  async listTools(): Promise<McpToolSchema[]> {
    const result = await this.request("tools/list") as { tools: McpToolSchema[] };
    return result.tools || [];
  }

  /** Call a tool on the server. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: string; isError?: boolean }> {
    const result = await this.request("tools/call", { name, arguments: args }, CALL_TIMEOUT) as {
      content: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };

    const text = (result.content || [])
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n");

    return { content: text || "(no output)", isError: result.isError };
  }

  /** Gracefully shut down the server. */
  async close(): Promise<void> {
    if (!this.proc) return;
    try {
      await this.request("shutdown", undefined, 5_000);
      this.notify("exit");
    } catch {
      // Server may not support graceful shutdown
    }
    this.proc.kill("SIGTERM");
    setTimeout(() => this.proc?.kill("SIGKILL"), 3_000);
    this.rl?.close();
    this.proc = null;
    this.rl = null;
    this.connected = false;
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line) as JsonRpcResponse;
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) {
          reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
        } else {
          resolve(msg.result);
        }
      }
      // Notifications from server (no id) are silently ignored
    } catch {
      // Non-JSON lines (e.g. server startup messages) are ignored
    }
  }

  private request(
    method: string,
    params?: Record<string, unknown>,
    timeout = CONNECT_TIMEOUT,
  ): Promise<unknown> {
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, ...(params && { params }) };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${timeout}ms`));
      }, timeout);

      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      this.proc?.stdin?.write(`${JSON.stringify(msg)}\n`);
    });
  }

  private notify(method: string, params?: Record<string, unknown>): void {
    const msg: JsonRpcNotification = { jsonrpc: "2.0", method, ...(params && { params }) };
    this.proc?.stdin?.write(`${JSON.stringify(msg)}\n`);
  }

  private rejectAll(error: Error): void {
    for (const { reject } of this.pending.values()) {
      reject(error);
    }
    this.pending.clear();
  }
}
