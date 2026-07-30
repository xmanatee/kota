import {
  ACP_RESOURCE_NOT_FOUND,
  ACP_UNSUPPORTED,
  AcpProtocolError,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_METHOD_NOT_FOUND,
} from "./protocol-json-rpc.js";

export function invalidParams(message: string): AcpProtocolError {
  return new AcpProtocolError(JSON_RPC_INVALID_PARAMS, message, { code: "invalid_params" });
}

export function methodNotFound(method: string): AcpProtocolError {
  return new AcpProtocolError(
    JSON_RPC_METHOD_NOT_FOUND,
    `Unsupported ACP method: ${method}`,
    { code: "unsupported_method", method },
  );
}

export function unsupportedFeature(feature: string, message: string): AcpProtocolError {
  return new AcpProtocolError(
    ACP_UNSUPPORTED,
    message,
    { code: "unsupported_feature", feature },
  );
}

export function notInitialized(): AcpProtocolError {
  return new AcpProtocolError(
    ACP_UNSUPPORTED,
    "ACP connection is not initialized for protocol version 1",
    { code: "not_initialized" },
  );
}

export function daemonUnavailable(): AcpProtocolError {
  return new AcpProtocolError(
    JSON_RPC_INTERNAL_ERROR,
    "KOTA daemon is not reachable",
    { code: "daemon_unavailable" },
  );
}

export function sessionNotFound(sessionId: string): AcpProtocolError {
  return new AcpProtocolError(
    ACP_RESOURCE_NOT_FOUND,
    "Session not found",
    { code: "session_not_found", sessionId },
  );
}

export function sessionBusy(sessionId: string): AcpProtocolError {
  return new AcpProtocolError(
    ACP_UNSUPPORTED,
    "Session is already processing a prompt",
    { code: "session_busy", sessionId },
  );
}

export function sessionAlreadyLive(sessionId: string): AcpProtocolError {
  return new AcpProtocolError(
    ACP_UNSUPPORTED,
    "Session is already active on this ACP connection",
    { code: "session_already_live", sessionId },
  );
}
