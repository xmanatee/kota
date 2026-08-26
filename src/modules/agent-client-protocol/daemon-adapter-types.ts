import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { AcpPermissionDecision, JsonObject } from "./protocol.js";

export type AcpScope = {
  scopeId: string;
  scopeRoot: string;
  displayName: string;
};

export type AcpScopeList = {
  scopes: AcpScope[];
  defaultScopeId: string;
  activeScopeId: string | null;
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
  listScopes(): Promise<AcpScopeList>;
  createSession(scope: AcpScope): Promise<{ sessionId: string }>;
  listSessions(scope: AcpScope): Promise<AcpDaemonSession[]>;
  resumeSession(scope: AcpScope, sessionId: string): Promise<{ sessionId: string }>;
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

export type ScopesWireBody = {
  rootScopeId: string;
  scopes: Array<{
    scopeId: string;
    displayName: string;
    parentScopeId?: string;
    directoryRoot?: string;
  }>;
  defaultScopeId: string;
  activeScopeId?: string | null;
};

export type CreateSessionWireBody = { session_id?: string; error?: string };

export type SessionListWireEntry = {
  id?: string;
  createdAt?: string;
  lastActive?: number;
  source?: "daemon" | "serve";
  busy?: boolean;
  scopeId?: string;
  conversationId?: string;
};

export type SessionListWireBody = { sessions?: SessionListWireEntry[] };

export type SessionBindingWireEntry = {
  sessionId?: string;
  scopeId?: string;
  conversationId?: string;
  createdAt?: string;
  lastActiveAt?: string;
};

export type SessionBindingsWireBody = { bindings?: SessionBindingWireEntry[] };

export type HttpAcpDaemonClientOptions = {
  transport: DaemonTransport;
  autonomyMode: AutonomyMode;
};
