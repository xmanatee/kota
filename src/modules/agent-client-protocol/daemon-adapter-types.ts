import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { AcpPermissionDecision, JsonObject } from "./protocol.js";

export type AcpProject = {
  projectId: string;
  projectDir: string;
  displayName: string;
};

export type AcpProjectList = {
  projects: AcpProject[];
  defaultProjectId: string;
  activeProjectId: string | null;
};

export type AcpPromptUpdate = JsonObject;

export type AcpDaemonPermissionRequest = {
  approvalId: string;
  toolUseId: string;
  tool: string;
  input: JsonObject;
  risk: string;
  reason: string;
  timeoutMs: number;
  context?: string;
  reviewDigest?: string;
};

export type AcpDaemonPermissionDecision = AcpPermissionDecision;

export type AcpDaemonSession = {
  sessionId: string;
  cwd: string;
  title: string;
  updatedAt: string;
  live: boolean;
  metadata: JsonObject;
};

export type PromptSessionArgs = {
  sessionId: string;
  prompt: string;
  signal: AbortSignal;
  onUpdate: (update: AcpPromptUpdate) => void;
  requestPermission?: (
    request: AcpDaemonPermissionRequest,
  ) => Promise<AcpDaemonPermissionDecision>;
};

export type PromptSessionResult = { stopReason: "end_turn" };

export interface AcpDaemonClient {
  listProjects(): Promise<AcpProjectList>;
  createSession(project: AcpProject): Promise<{ sessionId: string }>;
  listSessions(project: AcpProject): Promise<AcpDaemonSession[]>;
  resumeSession(project: AcpProject, sessionId: string): Promise<{ sessionId: string }>;
  promptSession(args: PromptSessionArgs): Promise<PromptSessionResult>;
  cancelSession(sessionId: string): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
}

export class AcpPromptCancelledError extends Error {
  constructor() {
    super("ACP prompt cancelled");
    this.name = "AcpPromptCancelledError";
  }
}

export type ProjectsWireBody = {
  projects: AcpProject[];
  defaultProjectId: string;
  activeProjectId?: string | null;
};

export type CreateSessionWireBody = { session_id?: string; error?: string };

export type SessionListWireEntry = {
  id?: string;
  createdAt?: string;
  lastActive?: number;
  source?: "daemon" | "serve";
  busy?: boolean;
  projectId?: string;
  conversationId?: string;
};

export type SessionListWireBody = { sessions?: SessionListWireEntry[] };

export type SessionBindingWireEntry = {
  sessionId?: string;
  projectId?: string;
  conversationId?: string;
  createdAt?: string;
  lastActiveAt?: string;
};

export type SessionBindingsWireBody = { bindings?: SessionBindingWireEntry[] };

export type HttpAcpDaemonClientOptions = {
  transport: DaemonTransport;
  autonomyMode: AutonomyMode;
};
