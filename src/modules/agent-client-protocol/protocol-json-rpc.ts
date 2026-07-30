export type JsonScalar = string | number | boolean | null;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue | undefined };
export type JsonValue = JsonScalar | JsonArray | JsonObject;
export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  kind: "request";
  id: JsonRpcId;
  method: string;
  params?: JsonValue;
};

export type JsonRpcNotification = {
  kind: "notification";
  method: string;
  params?: JsonValue;
};

export type JsonRpcPeerResponse = {
  kind: "response";
  id: JsonRpcId;
  result?: JsonValue;
  error?: JsonObject;
};

export type JsonRpcMalformedPeerResponse = {
  kind: "malformed_response";
  id: JsonRpcId;
  error: AcpProtocolError;
};

export type JsonRpcIncoming =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcPeerResponse
  | JsonRpcMalformedPeerResponse;

export type Decoded<T> =
  | { ok: true; value: T }
  | { ok: false; error: AcpProtocolError };

export const JSON_RPC_PARSE_ERROR = -32700;
export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_INTERNAL_ERROR = -32603;
export const ACP_RESOURCE_NOT_FOUND = -32002;
export const ACP_UNSUPPORTED = -32099;

export class AcpProtocolError extends Error {
  readonly rpcCode: number;
  readonly data: JsonObject;

  constructor(rpcCode: number, message: string, data: JsonObject = {}) {
    super(message);
    this.name = "AcpProtocolError";
    this.rpcCode = rpcCode;
    this.data = data;
  }
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonLine(line: string): Decoded<JsonValue> {
  try {
    return { ok: true, value: JSON.parse(line) as JsonValue };
  } catch {
    return {
      ok: false,
      error: new AcpProtocolError(
        JSON_RPC_PARSE_ERROR,
        "Parse error",
        { code: "parse_error" },
      ),
    };
  }
}

function isJsonRpcId(value: JsonValue | undefined): value is JsonRpcId {
  return value === null || typeof value === "string" || typeof value === "number";
}

export function decodeJsonRpcIncoming(value: JsonValue): Decoded<JsonRpcIncoming> {
  if (!isJsonObject(value)) return invalidRequest("JSON-RPC message must be an object");
  if (value.jsonrpc !== "2.0") return invalidRequest('jsonrpc must be "2.0"');
  const method = value.method;
  if (typeof method !== "string") {
    if (method === undefined && Object.hasOwn(value, "id")) return decodePeerResponse(value);
    if (Object.hasOwn(value, "id") && (Object.hasOwn(value, "result") || Object.hasOwn(value, "error"))) {
      return decodePeerResponse(value);
    }
    return invalidRequest("method must be a string");
  }
  const idValue = value.id;
  if (!Object.hasOwn(value, "id")) {
    return { ok: true, value: { kind: "notification", method, params: value.params } };
  }
  if (!isJsonRpcId(idValue)) return invalidRequest("id must be a string, number, or null");
  return { ok: true, value: { kind: "request", id: idValue, method, params: value.params } };
}

function invalidRequest(message: string): Decoded<JsonRpcIncoming> {
  return {
    ok: false,
    error: new AcpProtocolError(
      JSON_RPC_INVALID_REQUEST,
      message,
      { code: "invalid_request" },
    ),
  };
}

function decodePeerResponse(value: JsonObject): Decoded<JsonRpcIncoming> {
  const id = value.id;
  if (!isJsonRpcId(id)) return invalidRequest("response id must be a string, number, or null");
  if (!Object.hasOwn(value, "result") && !Object.hasOwn(value, "error")) {
    return malformedPeerResponse(id, "response must include result or error");
  }
  if (Object.hasOwn(value, "result") && Object.hasOwn(value, "error")) {
    return malformedPeerResponse(id, "response cannot include both result and error");
  }
  const response: JsonRpcPeerResponse = { kind: "response", id };
  if (Object.hasOwn(value, "result")) response.result = value.result;
  if (Object.hasOwn(value, "error")) {
    if (!isJsonObject(value.error)) {
      return malformedPeerResponse(id, "response error must be an object");
    }
    response.error = value.error;
  }
  return { ok: true, value: response };
}

function malformedPeerResponse(id: JsonRpcId, message: string): Decoded<JsonRpcIncoming> {
  return {
    ok: true,
    value: {
      kind: "malformed_response",
      id,
      error: new AcpProtocolError(
        JSON_RPC_INVALID_REQUEST,
        message,
        { code: "malformed_response" },
      ),
    },
  };
}

export function makeJsonRpcResponse(id: JsonRpcId, result: JsonValue): JsonObject {
  return { jsonrpc: "2.0", id, result };
}

export function makeJsonRpcRequest(id: JsonRpcId, method: string, params: JsonObject): JsonObject {
  return { jsonrpc: "2.0", id, method, params };
}

export function makeJsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data: JsonObject = {},
): JsonObject {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

export function makeJsonRpcNotification(method: string, params: JsonObject): JsonObject {
  return { jsonrpc: "2.0", method, params };
}
