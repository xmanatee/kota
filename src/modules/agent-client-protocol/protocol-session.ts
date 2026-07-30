import { isAbsolute } from "node:path";
import { invalidParams, unsupportedFeature } from "./protocol-errors.js";
import {
  isJsonObject,
  type JsonObject,
  type JsonValue,
  makeJsonRpcNotification,
} from "./protocol-json-rpc.js";
import { rejectUnsupportedMcpServers } from "./protocol-mcp.js";

export const ACP_PROTOCOL_VERSION = 1;
export const ACP_AGENT_NAME = "kota";
export const ACP_AGENT_TITLE = "KOTA";
export const ACP_AGENT_VERSION = "0.1.0";

export function initializeResponse(): JsonObject {
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    agentCapabilities: {
      loadSession: false,
      promptCapabilities: { image: false, audio: false, embeddedContext: false },
      mcpCapabilities: { http: false, sse: false },
      sessionCapabilities: { close: {}, list: {}, resume: {} },
    },
    agentInfo: {
      name: ACP_AGENT_NAME,
      title: ACP_AGENT_TITLE,
      version: ACP_AGENT_VERSION,
    },
    authMethods: [],
  };
}

export type InitializeParams = { protocolVersion: number };

export function decodeInitializeParams(params: JsonValue | undefined): InitializeParams {
  if (!isJsonObject(params)) throw invalidParams("initialize params must be an object");
  const version = params.protocolVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw invalidParams("protocolVersion must be a positive integer");
  }
  return { protocolVersion: version };
}

export type NewSessionParams = { cwd: string };

export function decodeNewSessionParams(params: JsonValue | undefined): NewSessionParams {
  const obj = objectParams(params, "session/new");
  const cwd = decodeAbsoluteCwd(obj.cwd);
  rejectUnsupportedMcpServers(obj);
  return { cwd };
}

export type ListSessionParams = { cwd?: string };

export function decodeListSessionParams(params: JsonValue | undefined): ListSessionParams {
  if (params === undefined) return {};
  const obj = objectParams(params, "session/list");
  if (obj.cursor !== undefined) {
    throw unsupportedFeature(
      "session/list.cursor",
      "ACP session list pagination is not supported by this adapter",
    );
  }
  return obj.cwd === undefined ? {} : { cwd: decodeAbsoluteCwd(obj.cwd) };
}

export type ResumeSessionParams = { cwd: string; sessionId: string };

export function decodeResumeSessionParams(params: JsonValue | undefined): ResumeSessionParams {
  const obj = objectParams(params, "session/resume");
  const cwd = decodeAbsoluteCwd(obj.cwd);
  const sessionId = obj.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw invalidParams("sessionId must be a non-empty string");
  }
  rejectUnsupportedMcpServers(obj);
  return { cwd, sessionId };
}

export type PromptParams = { sessionId: string; text: string };

export function decodePromptParams(params: JsonValue | undefined): PromptParams {
  if (!isJsonObject(params)) throw invalidParams("session/prompt params must be an object");
  const sessionId = params.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw invalidParams("sessionId must be a non-empty string");
  }
  if (!Array.isArray(params.prompt)) {
    throw invalidParams("prompt must be an array of content blocks");
  }
  const text = params.prompt.map(contentBlockToPromptText).join("\n\n").trim();
  if (text.length === 0) {
    throw invalidParams("prompt must contain at least one text or resource_link block");
  }
  return { sessionId, text };
}

export type SessionIdParams = { sessionId: string };

export function decodeSessionIdParams(
  params: JsonValue | undefined,
  method: string,
): SessionIdParams {
  const obj = objectParams(params, method);
  const sessionId = obj.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw invalidParams("sessionId must be a non-empty string");
  }
  return { sessionId };
}

function objectParams(params: JsonValue | undefined, method: string): JsonObject {
  if (!isJsonObject(params)) throw invalidParams(`${method} params must be an object`);
  return params;
}

function decodeAbsoluteCwd(value: JsonValue | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidParams("cwd must be a non-empty string");
  }
  if (!isAbsolute(value)) throw invalidParams("cwd must be an absolute path");
  return value;
}

function contentBlockToPromptText(block: JsonValue): string {
  if (!isJsonObject(block)) throw invalidParams("content block must be an object");
  const type = block.type;
  if (type === "text") {
    if (typeof block.text !== "string") {
      throw invalidParams("text content block requires string text");
    }
    return block.text;
  }
  if (type === "resource_link") {
    if (typeof block.uri !== "string" || typeof block.name !== "string") {
      throw invalidParams("resource_link content block requires string uri and name");
    }
    const title = typeof block.title === "string" ? block.title : block.name;
    const description = typeof block.description === "string" ? `\n${block.description}` : "";
    return `Resource link: ${title}\n${block.uri}${description}`;
  }
  const label = typeof type === "string" ? type : "unknown";
  throw unsupportedFeature(
    `prompt.${label}`,
    `Prompt content block type "${label}" is not supported`,
  );
}

export function agentMessageUpdate(sessionId: string, text: string): JsonObject {
  return sessionUpdate(sessionId, {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  });
}

export function agentThoughtUpdate(sessionId: string, text: string): JsonObject {
  return sessionUpdate(sessionId, {
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text },
  });
}

export function sessionUpdate(sessionId: string, update: JsonObject): JsonObject {
  return makeJsonRpcNotification("session/update", { sessionId, update });
}
