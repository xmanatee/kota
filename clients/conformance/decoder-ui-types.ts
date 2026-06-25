import type { KnownLiteral } from './decoder-common';
import type { SetupState } from './decoder-setup';

// MARK: - Shared UI surfaces

export const UI_PROTOCOL_VERSIONS = ["ui.surface.v1"] as const;
export const UI_INTENTS = ["Status", "Inbox", "Work", "Knowledge", "Setup"] as const;
export const UI_ROLES = ["neutral", "info", "success", "warn", "error", "muted"] as const;
export const UI_ACTION_EFFECTS = ["read", "write", "external"] as const;
export const UI_ACTION_METHODS = ["GET", "POST", "PATCH", "DELETE"] as const;
export const UI_OPERATION_KINDS = ["daemon-route", "client-namespace"] as const;
export const UI_CONFIRMATION_MODES = ["none", "required"] as const;
export const UI_CONFIRMATION_RISKS = ["low", "medium", "high"] as const;
export const UI_READINESS_STATES = ["ready", "disabled", "needs-setup"] as const;
export const UI_ATTACHMENT_KINDS = ["root", "intent", "surface"] as const;
export const UI_CONDITION_KINDS = ["capability", "setup", "scope"] as const;
export const UI_CONDITION_STATUSES = ["ready", "unavailable", "init_failed"] as const;
export const UI_PERMISSION_KINDS = ["capability-scope", "effect"] as const;
export const UI_CAPABILITY_SCOPES = ["read", "control"] as const;
export const UI_LINK_TARGET_KINDS = ["surface", "daemon-route", "external-url"] as const;
export const UI_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export const UI_LOG_STREAM_SOURCE_KINDS = ["sse"] as const;
export const UI_NODE_KINDS = [
  "navigation",
  "status-summary",
  "metrics",
  "text",
  "link",
  "tabs",
  "list",
  "table",
  "detail",
  "progress",
  "log",
  "log-stream",
  "form",
  "action-list",
  "command",
  "empty",
  "error",
] as const;
export const UI_FIELD_INPUTS = ["text", "secret", "number", "boolean", "select", "path", "url"] as const;
export const UI_SCHEMA_TYPES = ["string", "number", "integer", "boolean", "array", "object"] as const;
export const UI_SCHEMA_FORMATS = ["secret-reference", "path", "url"] as const;

export type UiRole = KnownLiteral<typeof UI_ROLES>;
export type UiJsonSchema = {
  type: KnownLiteral<typeof UI_SCHEMA_TYPES>;
  title?: string;
  description?: string;
  enum?: string[];
  default?: string | number | boolean;
  format?: KnownLiteral<typeof UI_SCHEMA_FORMATS>;
  minimum?: number;
  maximum?: number;
  items?: UiJsonSchema;
  properties?: Record<string, UiJsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
};

export type UiAttachmentPoint =
  | { kind: "root" }
  | { kind: "intent"; intent: KnownLiteral<typeof UI_INTENTS> }
  | { kind: "surface"; surfaceId: string };

export type UiCondition =
  | { kind: "capability"; capabilityId: string; status: KnownLiteral<typeof UI_CONDITION_STATUSES> }
  | { kind: "setup"; moduleName: string; requirementId: string; state: SetupState }
  | { kind: "scope"; scopeId: string };

export type UiPermission =
  | { kind: "capability-scope"; scope: KnownLiteral<typeof UI_CAPABILITY_SCOPES> }
  | { kind: "effect"; effect: KnownLiteral<typeof UI_ACTION_EFFECTS> };

export type UiActionOperation =
  | { kind: "daemon-route"; method: KnownLiteral<typeof UI_ACTION_METHODS>; path: string }
  | { kind: "client-namespace"; namespace: string; method: string };

export type UiConfirmation =
  | { mode: "none" }
  | {
      mode: "required";
      title: string;
      detail: string;
      confirmLabel: string;
      risk: KnownLiteral<typeof UI_CONFIRMATION_RISKS>;
    };

export type UiActionReadiness =
  | { state: "ready"; message?: string }
  | { state: "disabled"; reason: string; message: string }
  | { state: "needs-setup"; moduleName: string; requirementId: string; message: string };

export type UiAction = {
  surfaceId: string;
  actionId: string;
  scopeId: string;
  label: string;
  effect: KnownLiteral<typeof UI_ACTION_EFFECTS>;
  operation: UiActionOperation;
  parameters?: {
    schema: UiJsonSchema & { type: "object" };
    fields: UiFormField[];
  };
  confirmation: UiConfirmation;
  readiness: UiActionReadiness;
  result: {
    success: { message: string; schema?: UiJsonSchema };
    errors: Array<{ reason: string; message: string; schema?: UiJsonSchema }>;
  };
  conditions?: UiCondition[];
  permissions?: UiPermission[];
};

export type UiStatusEntry = {
  label: string;
  value: string;
  role: UiRole;
};

export type UiMetric = {
  label: string;
  value: string;
  unit?: string;
  role: UiRole;
};

export type UiListItem = {
  id: string;
  title: string;
  detail: string;
  role: UiRole;
  action?: UiAction;
};

export type UiTableColumn = {
  id: string;
  label: string;
  role?: UiRole;
};

export type UiTableRow = {
  id: string;
  cells: Array<{ columnId: string; value: string; role?: UiRole }>;
  action?: UiAction;
};

export type UiFormField = {
  id: string;
  label: string;
  input: KnownLiteral<typeof UI_FIELD_INPUTS>;
  required: boolean;
  options?: Array<{ label: string; value: string }>;
  schema?: UiJsonSchema;
};

export type UiLinkTarget =
  | { kind: "surface"; surfaceId: string }
  | { kind: "daemon-route"; path: string }
  | { kind: "external-url"; url: string };

export type UiTab = {
  id: string;
  label: string;
  nodes: UiNode[];
};

export type UiLogEntry = {
  timestamp: string;
  level: KnownLiteral<typeof UI_LOG_LEVELS>;
  message: string;
  source?: string;
};

export type UiLogStreamSource = {
  kind: KnownLiteral<typeof UI_LOG_STREAM_SOURCE_KINDS>;
  path: string;
  eventTypes: string[];
};

export type UiNode =
  | { kind: "navigation"; label: string; items: Array<{ surfaceId: string; label: string }> }
  | { kind: "status-summary"; entries: UiStatusEntry[] }
  | { kind: "metrics"; title: string; metrics: UiMetric[] }
  | { kind: "text"; title: string; body: string; role?: UiRole }
  | { kind: "link"; label: string; target: UiLinkTarget; role?: UiRole }
  | { kind: "tabs"; title: string; activeTabId: string; tabs: UiTab[] }
  | { kind: "list"; title: string; items: UiListItem[] }
  | { kind: "table"; title: string; columns: UiTableColumn[]; rows: UiTableRow[] }
  | { kind: "detail"; title: string; body: string }
  | { kind: "progress"; label: string; value: number; max: number; role: UiRole }
  | { kind: "log"; title: string; entries: UiLogEntry[] }
  | { kind: "log-stream"; title: string; streamId: string; source: UiLogStreamSource; entries: UiLogEntry[] }
  | { kind: "form"; title: string; fields: UiFormField[]; submit: UiAction }
  | { kind: "action-list"; title: string; actions: UiAction[] }
  | { kind: "command"; action: UiAction }
  | { kind: "empty"; title: string; detail: string; action: UiAction }
  | { kind: "error"; title: string; detail: string; action: UiAction };

export type UiSurface = {
  protocolVersion: KnownLiteral<typeof UI_PROTOCOL_VERSIONS>;
  surfaceId: string;
  extensionId: string;
  title: string;
  intent: KnownLiteral<typeof UI_INTENTS>;
  scopeId: string;
  attachmentPoint: UiAttachmentPoint;
  order: number;
  conditions?: UiCondition[];
  permissions?: UiPermission[];
  nodes: UiNode[];
  actions: UiAction[];
};

export type UiSurfaceBundle = {
  protocolVersion: KnownLiteral<typeof UI_PROTOCOL_VERSIONS>;
  surfaces: UiSurface[];
};
