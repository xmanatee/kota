import { daemonProtocolError } from "./daemon-adapter-errors.js";
import {
  type AcpDaemonPermissionDecision,
  type AcpDaemonPermissionRequest,
  AcpPromptCancelledError,
} from "./daemon-adapter-types.js";
import {
  AcpProtocolError,
  agentMessageUpdate,
  agentThoughtUpdate,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "./protocol.js";

export type SseEvent = { event: string; data: string };

export type MappedSseEvent =
  | { kind: "update"; update: JsonObject }
  | { kind: "approval"; request: AcpDaemonPermissionRequest }
  | { kind: "done"; text: string }
  | { kind: "error"; message: string }
  | { kind: "ignore" };

export async function* readSseEvents(
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
  return data.length === 0 ? null : { event, data: data.join("\n") };
}

export function mapDaemonSseEvent(sessionId: string, event: SseEvent): MappedSseEvent {
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
  if (!isJsonObject(data.input)) {
    throw daemonProtocolError("Daemon approval request input must be an object");
  }
  const context = optionalStringField(data, "context");
  const reviewDigest = optionalReviewDigest(data.review_digest);
  return {
    approvalId: requiredString(stringField(data, "approval_id") ?? undefined, "approval.approval_id"),
    toolUseId: requiredString(stringField(data, "tool_use_id") ?? undefined, "approval.tool_use_id"),
    tool: requiredString(stringField(data, "tool") ?? undefined, "approval.tool"),
    input: data.input,
    risk: requiredString(stringField(data, "risk") ?? undefined, "approval.risk"),
    reason: requiredString(stringField(data, "reason") ?? undefined, "approval.reason"),
    timeoutMs: requiredPositiveNumber(data.timeout_ms, "approval.timeout_ms"),
    ...(context !== undefined ? { context } : {}),
    ...(reviewDigest !== undefined ? { reviewDigest } : {}),
  };
}

export function permissionDecisionBody(
  decision: AcpDaemonPermissionDecision,
  reviewDigest?: string,
): JsonObject {
  if (decision.outcome === "allow") {
    return {
      outcome: "allow",
      ...(reviewDigest !== undefined ? { review_digest: reviewDigest } : {}),
    };
  }
  return { outcome: decision.outcome, message: decision.message };
}

function requiredPositiveNumber(value: JsonValue | undefined, field: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  throw daemonProtocolError(`Daemon response field ${field} must be a positive number`);
}

function optionalStringField(obj: JsonObject, key: string): string | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  throw daemonProtocolError(`Daemon response field approval.${key} must be a string`);
}

function optionalReviewDigest(value: JsonValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) return value;
  throw daemonProtocolError("Daemon response field approval.review_digest must be a sha256 digest");
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
  return typeof obj[key] === "string" ? obj[key] : null;
}

function requiredString(value: string | undefined, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw daemonProtocolError(`Daemon response field ${field} must be a non-empty string`);
}
