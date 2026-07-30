import { daemonProtocolError } from "./daemon-adapter-errors.js";
import type {
  AcpDaemonSession,
  AcpProject,
  SessionBindingWireEntry,
  SessionListWireEntry,
} from "./daemon-adapter-types.js";

export function mapLiveSession(
  project: AcpProject,
  entry: SessionListWireEntry,
): AcpDaemonSession {
  const sessionId = requiredString(entry.id, "session.id");
  const createdAt = requiredString(entry.createdAt, "session.createdAt");
  const updatedAt = isoFromEpochMillis(entry.lastActive, createdAt, "session.lastActive");
  return {
    sessionId,
    cwd: project.projectDir,
    title: `KOTA session ${sessionId}`,
    updatedAt,
    live: true,
    metadata: {
      source: "daemon",
      projectId: entry.projectId ?? project.projectId,
      ...(entry.conversationId ? { conversationId: entry.conversationId } : {}),
      busy: entry.busy === true,
    },
  };
}

export function mapBindingSession(
  project: AcpProject,
  entry: SessionBindingWireEntry,
): AcpDaemonSession {
  const sessionId = requiredString(entry.sessionId, "binding.sessionId");
  const createdAt = requiredString(entry.createdAt, "binding.createdAt");
  return {
    sessionId,
    cwd: project.projectDir,
    title: `KOTA session ${sessionId}`,
    updatedAt: requiredString(entry.lastActiveAt, "binding.lastActiveAt"),
    live: false,
    metadata: {
      source: "daemon-binding",
      projectId: entry.projectId ?? project.projectId,
      conversationId: requiredString(entry.conversationId, "binding.conversationId"),
      createdAt,
      resumable: true,
    },
  };
}

export function requiredString(value: string | undefined, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw daemonProtocolError(`Daemon response field ${field} must be a non-empty string`);
}

function isoFromEpochMillis(
  value: number | undefined,
  fallbackIso: string,
  field: string,
): string {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (!Number.isNaN(new Date(fallbackIso).getTime())) return fallbackIso;
  throw daemonProtocolError(
    `Daemon response field ${field} must be a finite epoch millisecond number`,
  );
}
