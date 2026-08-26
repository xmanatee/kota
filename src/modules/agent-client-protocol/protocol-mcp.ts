import { isAbsolute } from "node:path";
import { invalidParams, unsupportedFeature } from "./protocol-errors.js";
import { isJsonObject, type JsonObject, type JsonValue } from "./protocol-json-rpc.js";

const ACP_MCP_STDIO_FIELDS = new Set(["type", "name", "command", "args", "env"]);
const ACP_MCP_HTTP_FIELDS = new Set(["type", "name", "url", "headers"]);
const ACP_MCP_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export function rejectUnsupportedMcpServers(params: JsonObject): void {
  const mcpServers = params.mcpServers;
  if (!Array.isArray(mcpServers)) throw invalidParams("mcpServers must be an array");
  if (mcpServers.length === 0) return;
  for (const [index, raw] of mcpServers.entries()) rejectUnsupportedMcpServer(raw, index);
}

function rejectUnsupportedMcpServer(value: JsonValue, index: number): void {
  if (!isJsonObject(value)) throw invalidParams(`mcpServers[${index}] must be an object`);
  const type = value.type;
  if (type === undefined || type === "stdio") {
    validateUnsupportedStdioMcpServer(value, index);
    throw unsupportedFeature(
      "mcpServers.stdio",
      "ACP stdio MCP handoff is not supported by this adapter; configure MCP servers in scope config",
    );
  }
  if (type === "http") {
    validateUnsupportedHttpMcpServer(value, index);
    throw unsupportedFeature(
      "mcpServers.http",
      "ACP HTTP MCP handoff is not supported by this adapter",
    );
  }
  if (type === "sse") {
    validateUnsupportedHttpMcpServer(value, index);
    throw unsupportedFeature(
      "mcpServers.sse",
      "ACP SSE MCP handoff is not supported by this adapter",
    );
  }
  throw invalidParams(`mcpServers[${index}].type must be "stdio", "http", or "sse"`);
}

function validateUnsupportedStdioMcpServer(value: JsonObject, index: number): void {
  rejectUnknownFields(value, ACP_MCP_STDIO_FIELDS, `mcpServers[${index}]`);
  decodeMcpServerName(value.name, `mcpServers[${index}].name`);
  decodeAbsoluteCommand(value.command, `mcpServers[${index}].command`);
  decodeRequiredStringArray(value.args, `mcpServers[${index}].args`);
  decodeOptionalNameValueArray(value.env, `mcpServers[${index}].env`);
}

function validateUnsupportedHttpMcpServer(value: JsonObject, index: number): void {
  rejectUnknownFields(value, ACP_MCP_HTTP_FIELDS, `mcpServers[${index}]`);
  decodeMcpServerName(value.name, `mcpServers[${index}].name`);
  decodeAbsoluteUrl(value.url, `mcpServers[${index}].url`);
  decodeRequiredNameValueArray(value.headers, `mcpServers[${index}].headers`);
}

export function rejectUnknownFields(
  value: JsonObject,
  allowed: Set<string>,
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length === 0) return;
  throw invalidParams(
    `${label} has unexpected field${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")}`,
  );
}

function decodeMcpServerName(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidParams(`${label} must be a non-empty string`);
  }
  if (!ACP_MCP_NAME_PATTERN.test(value) || value.includes("__")) {
    throw invalidParams(`${label} must contain only letters, numbers, dots, underscores, or hyphens`);
  }
  return value;
}

function decodeAbsoluteCommand(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidParams(`${label} must be a non-empty string`);
  }
  if (!isAbsolute(value)) throw invalidParams(`${label} must be an absolute path`);
  return value;
}

function decodeRequiredStringArray(value: JsonValue | undefined, label: string): string[] {
  if (!Array.isArray(value)) throw invalidParams(`${label} must be an array of strings`);
  return value.map((entry, index) => {
    if (typeof entry !== "string") throw invalidParams(`${label}[${index}] must be a string`);
    return entry;
  });
}

function decodeOptionalNameValueArray(
  value: JsonValue | undefined,
  label: string,
): Record<string, string> | undefined {
  return value === undefined ? undefined : decodeRequiredNameValueArray(value, label);
}

function decodeRequiredNameValueArray(
  value: JsonValue | undefined,
  label: string,
): Record<string, string> {
  if (!Array.isArray(value)) {
    throw invalidParams(`${label} must be an array of name/value objects`);
  }
  const out: Record<string, string> = {};
  for (const [index, entry] of value.entries()) {
    if (!isJsonObject(entry)) throw invalidParams(`${label}[${index}] must be an object`);
    rejectUnknownFields(entry, new Set(["name", "value"]), `${label}[${index}]`);
    const name = entry.name;
    const entryValue = entry.value;
    if (typeof name !== "string" || name.length === 0) {
      throw invalidParams(`${label}[${index}].name must be a non-empty string`);
    }
    if (Object.hasOwn(out, name)) {
      throw invalidParams(`${label}[${index}].name duplicates "${name}"`);
    }
    if (typeof entryValue !== "string") {
      throw invalidParams(`${label}[${index}].value must be a string`);
    }
    Object.defineProperty(out, name, {
      value: entryValue,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return out;
}

function decodeAbsoluteUrl(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidParams(`${label} must be a non-empty string`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidParams(`${label} must be an absolute URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw invalidParams(`${label} must use http or https`);
  }
  return value;
}
