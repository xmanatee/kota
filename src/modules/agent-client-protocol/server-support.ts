import {
  type AcpDaemonClient,
  type AcpDaemonSession,
  type AcpProject,
  type AcpProjectList,
  resolveAcpProject,
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

export function resolveProjectForCwd(
  projects: AcpProjectList,
  cwd: string,
): AcpProject {
  const project = resolveAcpProject(projects, cwd);
  if (project) return project;
  throw new AcpProtocolError(
    -32602,
    "cwd must match a daemon-configured project root",
    { code: "invalid_params", field: "cwd" },
  );
}
