import type { IncomingMessage } from "node:http";
import {
  A2A_LEGACY_PROTOCOL_VERSION as A2A_IMPLICIT_PROTOCOL_VERSION,
  methodNotFound,
} from "./protocol.js";
import {
  isPushNotificationRpcMethod,
  type PushNotificationRpcMethod,
} from "./push-notification-rpc.js";

const A2A_VERSION_QUERY_PARAMETER = "A2A-Version";

export type CanonicalMethod =
  | "SendMessage"
  | "SendStreamingMessage"
  | "GetTask"
  | "ListTasks"
  | "CancelTask"
  | "SubscribeToTask"
  | PushNotificationRpcMethod;

export function requestedA2AProtocolVersion(req: IncomingMessage): string {
  const headerVersion = firstHeaderValue(req.headers["a2a-version"]);
  if (headerVersion !== null) return normalizeRequestedA2AVersion(headerVersion);

  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const queryVersion = url.searchParams.get(A2A_VERSION_QUERY_PARAMETER);
  if (queryVersion !== null) return normalizeRequestedA2AVersion(queryVersion);

  return A2A_IMPLICIT_PROTOCOL_VERSION;
}

export function isStreamingMethod(method: string): boolean {
  return method === "SendStreamingMessage" || method === "SubscribeToTask";
}

export function canonicalMethod(method: string): CanonicalMethod {
  if (method === "SendMessage") return "SendMessage";
  if (method === "SendStreamingMessage") {
    return "SendStreamingMessage";
  }
  if (method === "GetTask") return "GetTask";
  if (method === "ListTasks") return "ListTasks";
  if (method === "CancelTask") return "CancelTask";
  if (method === "SubscribeToTask") {
    return "SubscribeToTask";
  }
  if (isPushNotificationRpcMethod(method)) return method;
  throw methodNotFound(method);
}

function normalizeRequestedA2AVersion(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : A2A_IMPLICIT_PROTOCOL_VERSION;
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
