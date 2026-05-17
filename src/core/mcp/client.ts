import { type ChildProcess, spawn } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type {
  KotaJsonObject,
  KotaJsonValue,
  KotaMcpAnnotations,
  KotaMcpBlobResourceContents,
  KotaMcpIcon,
  KotaMcpPreservedContent,
  KotaMcpResourceContents,
  KotaMcpTextResourceContents,
  KotaToolInputSchema,
  KotaToolOutputSchema,
} from "#core/agent-harness/message-protocol.js";
import type { ToolResultBlock } from "#core/tools/tool-result.js";

export type McpToolSchema = {
  name: string;
  description?: string;
  inputSchema: KotaToolInputSchema;
  outputSchema?: KotaToolOutputSchema;
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

type McpResultKind = "tools/call" | "tools/list";

export type McpToolTextContent = {
  type: "text";
  text: string;
  annotations?: KotaMcpAnnotations;
  _meta?: KotaJsonObject;
};

export type McpToolImageContent = {
  type: "image";
  data: string;
  mimeType: string;
  annotations?: KotaMcpAnnotations;
  _meta?: KotaJsonObject;
};

export type McpToolContentBlock =
  | McpToolTextContent
  | McpToolImageContent
  | KotaMcpPreservedContent;

export type McpCallToolResult = {
  content: McpToolContentBlock[];
  text: string;
  blocks: ToolResultBlock[];
  structuredContent?: KotaJsonObject;
  _meta?: KotaJsonObject;
  isError?: boolean;
};

const CONNECT_TIMEOUT = 10_000;
const CALL_TIMEOUT = 120_000;

function isJsonValue(value: JsonRpcResponse["result"]): value is KotaJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value).every(isJsonValue);
}

function isJsonObject(value: JsonRpcResponse["result"]): value is KotaJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformedMcpResult(kind: McpResultKind, label: string, expected: string): Error {
  return new Error(`Malformed MCP ${kind} result: ${label} must be ${expected}`);
}

function requireJsonObject(
  value: JsonRpcResponse["result"],
  label: string,
  kind: McpResultKind = "tools/call",
): KotaJsonObject {
  if (!isJsonObject(value)) {
    throw malformedMcpResult(kind, label, "an object");
  }
  return value;
}

function requireString(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): string {
  if (typeof value !== "string") {
    throw malformedMcpResult(kind, label, "a string");
  }
  return value;
}

function optionalString(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw malformedMcpResult(kind, label, "a string");
  }
  return value;
}

function optionalNumber(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number") {
    throw malformedMcpResult(kind, label, "a number");
  }
  return value;
}

function optionalBoolean(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw malformedMcpResult(kind, label, "a boolean");
  }
  return value;
}

function optionalStringArray(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw malformedMcpResult(kind, label, "a string array");
  }
  return value;
}

function optionalJsonObject(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): KotaJsonObject | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) {
    throw malformedMcpResult(kind, label, "an object");
  }
  return value;
}

function decodeToolObjectSchema(
  value: KotaJsonValue | undefined,
  label: string,
): KotaToolInputSchema {
  const object = optionalJsonObject(value, label, "tools/list");
  if (!object) {
    throw malformedMcpResult("tools/list", label, "an object");
  }
  const type = requireString(object.type, `${label}.type`, "tools/list");
  if (type !== "object") {
    throw new Error(`Malformed MCP tools/list result: ${label}.type must be "object"`);
  }
  const properties = optionalJsonObject(
    object.properties,
    `${label}.properties`,
    "tools/list",
  ) ?? {};
  const required = optionalStringArray(
    object.required,
    `${label}.required`,
    "tools/list",
  );
  return {
    ...object,
    type: "object",
    properties,
    ...(required !== undefined ? { required } : {}),
  };
}

function decodeToolDefinition(value: KotaJsonValue, index: number): McpToolSchema {
  const label = `tools[${index}]`;
  const object = optionalJsonObject(value, label, "tools/list");
  if (!object) {
    throw malformedMcpResult("tools/list", label, "an object");
  }
  const outputSchema = object.outputSchema === undefined
    ? undefined
    : decodeToolObjectSchema(object.outputSchema, `${label}.outputSchema`);
  return {
    name: requireString(object.name, `${label}.name`, "tools/list"),
    ...(object.description !== undefined
      ? { description: optionalString(object.description, `${label}.description`, "tools/list") }
      : {}),
    inputSchema: decodeToolObjectSchema(object.inputSchema, `${label}.inputSchema`),
    ...(outputSchema ? { outputSchema } : {}),
  };
}

function decodeListToolsResult(value: JsonRpcResponse["result"]): McpToolSchema[] {
  const object = requireJsonObject(value, "result", "tools/list");
  const tools = object.tools;
  if (!Array.isArray(tools)) {
    throw malformedMcpResult("tools/list", "tools", "an array");
  }
  return tools.map(decodeToolDefinition);
}

function decodeAnnotations(
  value: KotaJsonValue | undefined,
  label: string,
): KotaMcpAnnotations | undefined {
  const object = optionalJsonObject(value, label);
  if (!object) return undefined;
  const audience = optionalStringArray(object.audience, `${label}.audience`);
  if (audience?.some((role) => role !== "user" && role !== "assistant")) {
    throw new Error(
      `Malformed MCP tools/call result: ${label}.audience must contain user or assistant`,
    );
  }
  const priority = optionalNumber(object.priority, `${label}.priority`);
  const lastModified = optionalString(object.lastModified, `${label}.lastModified`);
  return {
    ...(audience ? { audience: audience as Array<"user" | "assistant"> } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(lastModified !== undefined ? { lastModified } : {}),
  };
}

function decodeTextResourceContents(
  object: KotaJsonObject,
  label: string,
): KotaMcpTextResourceContents {
  const mimeType = optionalString(object.mimeType, `${label}.mimeType`);
  const meta = optionalJsonObject(object._meta, `${label}._meta`);
  return {
    uri: requireString(object.uri, `${label}.uri`),
    ...(mimeType !== undefined ? { mimeType } : {}),
    text: requireString(object.text, `${label}.text`),
    ...(meta ? { _meta: meta } : {}),
  };
}

function decodeBlobResourceContents(
  object: KotaJsonObject,
  label: string,
): KotaMcpBlobResourceContents {
  const mimeType = optionalString(object.mimeType, `${label}.mimeType`);
  const meta = optionalJsonObject(object._meta, `${label}._meta`);
  return {
    uri: requireString(object.uri, `${label}.uri`),
    ...(mimeType !== undefined ? { mimeType } : {}),
    blob: requireString(object.blob, `${label}.blob`),
    ...(meta ? { _meta: meta } : {}),
  };
}

function decodeResourceContents(
  value: KotaJsonValue | undefined,
  label: string,
): KotaMcpResourceContents {
  const object = optionalJsonObject(value, label);
  if (!object) {
    throw new Error(`Malformed MCP tools/call result: ${label} must be an object`);
  }
  if (typeof object.text === "string") return decodeTextResourceContents(object, label);
  if (typeof object.blob === "string") return decodeBlobResourceContents(object, label);
  throw new Error(`Malformed MCP tools/call result: ${label} must include text or blob`);
}

function decodeIcons(value: KotaJsonValue | undefined, label: string): KotaMcpIcon[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`Malformed MCP tools/call result: ${label} must be an array`);
  }
  return value.map((entry, index) => {
    const object = optionalJsonObject(entry, `${label}[${index}]`);
    if (!object) {
      throw new Error(`Malformed MCP tools/call result: ${label}[${index}] must be an object`);
    }
    const mimeType = optionalString(object.mimeType, `${label}[${index}].mimeType`);
    const sizes = optionalStringArray(object.sizes, `${label}[${index}].sizes`);
    const theme = optionalString(object.theme, `${label}[${index}].theme`);
    if (theme !== undefined && theme !== "light" && theme !== "dark") {
      throw new Error(
        `Malformed MCP tools/call result: ${label}[${index}].theme must be light or dark`,
      );
    }
    return {
      src: requireString(object.src, `${label}[${index}].src`),
      ...(mimeType !== undefined ? { mimeType } : {}),
      ...(sizes !== undefined ? { sizes } : {}),
      ...(theme !== undefined ? { theme: theme as "light" | "dark" } : {}),
    };
  });
}

function decodeMcpContentBlock(
  value: KotaJsonValue,
  index: number,
): McpToolContentBlock {
  const label = `content[${index}]`;
  const object = optionalJsonObject(value, label);
  if (!object) {
    throw new Error(`Malformed MCP tools/call result: ${label} must be an object`);
  }
  const type = requireString(object.type, `${label}.type`);
  const annotations = decodeAnnotations(object.annotations, `${label}.annotations`);
  const meta = optionalJsonObject(object._meta, `${label}._meta`);
  switch (type) {
    case "text":
      return {
        type: "text",
        text: requireString(object.text, `${label}.text`),
        ...(annotations ? { annotations } : {}),
        ...(meta ? { _meta: meta } : {}),
      };
    case "image":
      return {
        type: "image",
        data: requireString(object.data, `${label}.data`),
        mimeType: requireString(object.mimeType, `${label}.mimeType`),
        ...(annotations ? { annotations } : {}),
        ...(meta ? { _meta: meta } : {}),
      };
    case "audio":
      return {
        type: "audio",
        data: requireString(object.data, `${label}.data`),
        mimeType: requireString(object.mimeType, `${label}.mimeType`),
        ...(annotations ? { annotations } : {}),
        ...(meta ? { _meta: meta } : {}),
      };
    case "resource":
      return {
        type: "resource",
        resource: decodeResourceContents(object.resource, `${label}.resource`),
        ...(annotations ? { annotations } : {}),
        ...(meta ? { _meta: meta } : {}),
      };
    case "resource_link": {
      const icons = decodeIcons(object.icons, `${label}.icons`);
      const title = optionalString(object.title, `${label}.title`);
      const description = optionalString(object.description, `${label}.description`);
      const mimeType = optionalString(object.mimeType, `${label}.mimeType`);
      const size = optionalNumber(object.size, `${label}.size`);
      return {
        type: "resource_link",
        uri: requireString(object.uri, `${label}.uri`),
        name: requireString(object.name, `${label}.name`),
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(mimeType !== undefined ? { mimeType } : {}),
        ...(size !== undefined ? { size } : {}),
        ...(icons ? { icons } : {}),
        ...(annotations ? { annotations } : {}),
        ...(meta ? { _meta: meta } : {}),
      };
    }
    default:
      return { type: "unknown", mcpType: type, raw: object };
  }
}

function decodeContent(value: KotaJsonValue | undefined): McpToolContentBlock[] {
  if (!Array.isArray(value)) {
    throw new Error("Malformed MCP tools/call result: content must be an array");
  }
  return value.map(decodeMcpContentBlock);
}

function toResultText(content: McpToolContentBlock[]): string {
  const text = content
    .filter((block): block is McpToolTextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return text || "(no output)";
}

function toToolResultBlock(block: McpToolContentBlock): ToolResultBlock {
  if (block.type === "text") {
    return {
      type: "text",
      text: block.text,
      ...(block.annotations ? { annotations: block.annotations } : {}),
      ...(block._meta ? { _meta: block._meta } : {}),
    };
  }
  if (block.type === "image") {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: block.mimeType,
        data: block.data,
      },
      ...(block.annotations ? { annotations: block.annotations } : {}),
      ...(block._meta ? { _meta: block._meta } : {}),
    };
  }
  return { type: "mcp_content", content: block };
}

function decodeCallToolResult(value: JsonRpcResponse["result"]): McpCallToolResult {
  const object = requireJsonObject(value, "result");
  const content = decodeContent(object.content);
  if (
    object.structuredContent !== undefined &&
    !isJsonValue(object.structuredContent)
  ) {
    throw new Error("Malformed MCP tools/call result: structuredContent must be JSON");
  }
  const structuredContent = optionalJsonObject(
    object.structuredContent,
    "structuredContent",
  );
  const meta = optionalJsonObject(object._meta, "_meta");
  const isError = optionalBoolean(object.isError, "isError");
  return {
    content,
    text: toResultText(content),
    blocks: content.map(toToolResultBlock),
    ...(structuredContent ? { structuredContent } : {}),
    ...(meta ? { _meta: meta } : {}),
    ...(isError !== undefined ? { isError } : {}),
  };
}

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
  private connecting = false;
  private closing = false;
  private killTimer: ReturnType<typeof setTimeout> | null = null;
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

      // Absorb stdin write errors (server may have exited)
      this.proc.stdin?.on("error", () => {});

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

      // close() may have been called during the handshake await
      if (this.closing) {
        throw new Error(`MCP server "${this.serverName}" was closed during connection`);
      }

      if (result.serverInfo?.name) {
        this.serverName = result.serverInfo.name;
      }
      this.connected = true;
    } finally {
      this.connecting = false;
    }
  }

  /** List available tools from the server. */
  async listTools(): Promise<McpToolSchema[]> {
    const result = await this.request("tools/list");
    return decodeListToolsResult(result);
  }

  /** Call a tool on the server. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpCallToolResult> {
    const result = await this.request("tools/call", { name, arguments: args }, CALL_TIMEOUT);
    return decodeCallToolResult(result);
  }

  /** Gracefully shut down the server. */
  async close(): Promise<void> {
    if (!this.proc || this.closing) return;
    this.closing = true;
    this.connected = false;
    this.rejectAll(new Error(`MCP server "${this.serverName}" is closing`));

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
    if (!this.proc?.stdin?.writable) {
      return Promise.reject(
        new Error(`MCP server "${this.serverName}" is not connected`),
      );
    }

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
    if (!this.proc?.stdin?.writable) return;
    const msg: JsonRpcNotification = { jsonrpc: "2.0", method, ...(params && { params }) };
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  private rejectAll(error: Error): void {
    for (const { reject } of this.pending.values()) {
      reject(error);
    }
    this.pending.clear();
  }
}
