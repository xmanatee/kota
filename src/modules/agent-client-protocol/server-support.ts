import {
  type AcpDaemonClient,
  type AcpDaemonSession,
  type AcpScope,
  type AcpScopeList,
  resolveAcpScope,
} from "./daemon-adapter.js";
import { AcpProtocolError, type JsonObject } from "./protocol.js";

export type WritableProtocolStream = {
  write(chunk: string): boolean | void;
};

export type AcpServerOptions = {
  output: WritableProtocolStream;
  error: WritableProtocolStream;
  daemonFactory: () => AcpDaemonClient | null;
};

export function acpSessionInfo(session: AcpDaemonSession): JsonObject {
  return {
    sessionId: session.sessionId,
    cwd: session.cwd,
    title: session.title,
    updatedAt: session.updatedAt,
    _meta: session.metadata,
  };
}

export function normalizeAcpError(err: Error | AcpProtocolError | string): AcpProtocolError {
  if (err instanceof AcpProtocolError) return err;
  return new AcpProtocolError(
    -32603,
    err instanceof Error ? err.message : String(err),
    { code: "internal_error" },
  );
}

export function resolveScopeForCwd(
  scopes: AcpScopeList,
  cwd: string,
): AcpScope {
  const scope = resolveAcpScope(scopes, cwd);
  if (scope) return scope;
  throw new AcpProtocolError(
    -32602,
    "cwd must match a daemon-configured scope root",
    { code: "invalid_params", field: "cwd" },
  );
}
