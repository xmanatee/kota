/**
 * Capability readiness types — kept in sync with the daemon's
 * `CapabilityReadiness` shape (see
 * `src/core/daemon/capability-readiness.ts`).
 */
export type CapabilityStatus = "ready" | "unavailable" | "init_failed";

export type CapabilityReadiness = {
  id: string;
  moduleName: string;
  status: CapabilityStatus;
  reason?: string;
  message?: string;
  meta?: Record<string, string | number | boolean>;
};

export type CapabilityReadinessSummary = {
  ready: number;
  unavailable: number;
  init_failed: number;
};

export type CapabilityReadinessResponse = {
  capabilities: CapabilityReadiness[];
  summary: CapabilityReadinessSummary;
};

/** Stable capability id every client agrees on for the embedded dashboard. */
export const DASHBOARD_CAPABILITY_ID = "dashboard";
/** Stable capability id the daemon registers for workflow triggering. */
export const WORKFLOW_TRIGGER_CAPABILITY_ID = "workflow.trigger";

/**
 * Identity payload — kept in sync with the daemon's `ClientIdentity`
 * shape (see `src/core/daemon/client-identity.ts`).
 */
export type ClientDashboardAvailability =
  | { available: true; path: string }
  | { available: false; reason: string; message?: string };

/**
 * Mirror of the daemon's `ProjectRegistryProjection`. Clients render the
 * project selector against this shape; the singular `projectName` /
 * `projectDir` on `ClientIdentity` describe the default project.
 */
export type ProjectRegistryEntry = {
  projectId: string;
  projectDir: string;
  displayName: string;
};

export type ProjectRegistryProjection = {
  defaultProjectId: string;
  projects: ProjectRegistryEntry[];
};

export type ScopeRegistryEntry = {
  scopeId: string;
  displayName: string;
  parentScopeId?: string;
  directoryRoot?: string;
};

export type ScopeRegistryProjection = {
  rootScopeId: string;
  defaultScopeId: string;
  scopes: ScopeRegistryEntry[];
};

export type { ScopePolicyRouteResponse } from "../../../conformance/decoders";
export * from "./client-interaction-types";
export * from "./workflow-types";
import type { WorkflowLiveStatus } from "./workflow-types";

export type ClientIdentity = {
  projectName: string;
  projectDir: string;
  projects: ProjectRegistryProjection;
  daemonVersion: string;
  pid: number;
  startedAt: string;
  dashboard: ClientDashboardAvailability;
};

/**
 * Typed wire-shape every project-scoped control-API route returns when
 * `?projectId=` is set to a value that does not match a configured
 * project. Mirrors `UnknownProjectError` in
 * `src/core/daemon/daemon-control-types.ts`.
 */
export type UnknownProjectError = {
  error: "Unknown project";
  reason: "unknown_project";
  projectId: string;
};

/**
 * Daemon error envelope shared by every thin-client decoder. Mirrors
 * the typed shape `parseDaemonClientErrorBody` returns.
 */
export type DaemonClientErrorBody = {
  error?: string;
  code?: string;
  reason?: string;
  message?: string;
  raw?: string;
};

export type DaemonTaskDetail = {
  id: string;
  title: string;
  priority: string;
  area: string;
  summary: string;
  body: string;
};

export type DaemonTaskStatusResponse = {
  counts: {
    inbox: number;
    ready: number;
    backlog: number;
    doing: number;
    blocked: number;
  };
  tasks: {
    doing: DaemonTaskDetail[];
    ready: DaemonTaskDetail[];
    backlog: DaemonTaskDetail[];
    blocked: DaemonTaskDetail[];
  };
};

export type AutonomyMode = "passive" | "supervised" | "autonomous";

export type InteractiveSession = {
  id: string;
  scopeId: string;
  projectId: string;
  createdAt: string;
  lastActive: number;
  autonomyMode: AutonomyMode;
  source?: "daemon" | "serve";
};

export type ConversationRecord = {
  id: string;
  title?: string;
  createdAt: string;
  messageCount: number;
};

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string | Array<{ type: string; text?: string }>;
};

export type ConversationData = {
  id: string;
  messages: ConversationMessage[];
};

export type PendingApproval = {
  id: string;
  scopeId: string;
  tool: string;
  input: Record<string, unknown>;
  review:
    | {
        status: "available";
        input: Record<string, unknown>;
        context?: string;
        digest: string;
      }
    | { status: "unavailable"; reason: "input_unavailable" };
  risk: string;
  reason: string;
  source?: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected" | "expired";
  approvalNote?: string;
};

export type OwnerQuestionStatus =
  | "pending"
  | "answered"
  | "dismissed"
  | "expired";

export type PendingOwnerQuestion = {
  id: string;
  seq: number;
  context: string;
  question: string;
  reason: string;
  source: string;
  createdAt: string;
  status: OwnerQuestionStatus;
  proposedAnswers?: string[];
  resolvedAt?: string;
  answer?: string;
  dismissalReason?: string;
  timeoutMs?: number;
  defaultResolution?: "dismiss" | "answer";
  defaultAnswer?: string;
  resolutionSource?: string;
};

export type HealthStatus = {
  status: string;
  version: string;
  uptimeMs: number;
  components: {
    scheduler: string;
    modules: string;
    moduleHealthChecks?: Record<string, { status: string; message?: string }>;
  };
};

export type DaemonLiveStatus = {
  running: boolean;
  startedAt: string;
  workflow: WorkflowLiveStatus;
  sessions: InteractiveSession[];
};

export type ModuleInfo = {
  name: string;
  version: string;
  description: string;
  health?: { status: string; message?: string };
};

export type MemoryEntry = {
  id: string;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
};

export type AuditEntry = {
  id: string;
  timestamp: string;
  tool: string;
  risk: "safe" | "moderate" | "dangerous";
  policy: "allow" | "confirm" | "deny" | "queue";
  input?: Record<string, unknown>;
  runId?: string;
};

export type ScheduleEntry = {
  id: string;
  description: string;
  triggerAt: string;
  repeatLabel?: string;
};

export type CostSummary = {
  totalCostUsd: number;
  workflows: Array<{ workflow: string; costUsd: number }>;
};
