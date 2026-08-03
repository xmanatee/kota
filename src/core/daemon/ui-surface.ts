export const UI_SURFACE_PROTOCOL_VERSION = "ui.surface.v1";

export type UiProtocolVersion = typeof UI_SURFACE_PROTOCOL_VERSION;
export type UiIntent = "Status" | "Inbox" | "Work" | "Knowledge" | "Setup";
export type UiRole = "neutral" | "info" | "success" | "warn" | "error" | "muted";
export type UiActionEffect = "read" | "write" | "external";
export type UiActionMethod = "GET" | "POST" | "PATCH" | "DELETE";
export type UiCapabilityScope = "read" | "control";
export type UiConditionStatus = "ready" | "unavailable" | "init_failed";
export type UiSetupState = "ready" | "missing" | "pending" | "expired" | "revoked" | "unknown" | "unavailable";
export type UiReadinessState = "ready" | "disabled" | "needs-setup";
export type UiFieldInput = "text" | "multiline" | "secret" | "number" | "boolean" | "select" | "path" | "url";
export type UiConfirmationRisk = "low" | "medium" | "high";
export type UiLinkTargetKind = "surface" | "session" | "daemon-route" | "external-url";
export type UiLogLevel = "debug" | "info" | "warn" | "error";
export type UiLogStreamSourceKind = "sse";

export type UiAttachmentPoint =
  | { kind: "root" }
  | { kind: "intent"; intent: UiIntent }
  | { kind: "surface"; surfaceId: string };

export type UiCondition =
  | { kind: "capability"; capabilityId: string; status: UiConditionStatus }
  | { kind: "setup"; moduleName: string; requirementId: string; state: UiSetupState }
  | { kind: "scope"; scopeId: string };

export type UiPermission =
  | { kind: "capability-scope"; scope: UiCapabilityScope }
  | { kind: "effect"; effect: UiActionEffect };

export type UiJsonPrimitive = string | number | boolean | null;
export type UiJsonValue = UiJsonPrimitive | UiJsonValue[] | { readonly [key: string]: UiJsonValue };

export type UiObjectJsonSchema = {
  type: "object";
  title?: string;
  description?: string;
  properties: { readonly [key: string]: UiJsonSchema };
  required?: readonly string[];
  additionalProperties?: boolean;
};

export type UiJsonSchema =
  | {
      type: "string";
      title?: string;
      description?: string;
      enum?: readonly string[];
      default?: string;
      format?: "secret-reference" | "path" | "url";
    }
  | {
      type: "number" | "integer";
      title?: string;
      description?: string;
      default?: number;
      minimum?: number;
      maximum?: number;
    }
  | {
      type: "boolean";
      title?: string;
      description?: string;
      default?: boolean;
    }
  | {
      type: "array";
      title?: string;
      description?: string;
      items: UiJsonSchema;
    }
  | UiObjectJsonSchema;

export type UiActionOperation =
  | { kind: "daemon-route"; method: UiActionMethod; path: string }
  | { kind: "client-namespace"; namespace: string; method: string };

export type UiConfirmation =
  | { mode: "none" }
  | {
      mode: "required";
      title: string;
      detail: string;
      confirmLabel: string;
      risk: UiConfirmationRisk;
    };

export type UiActionReadiness =
  | { state: "ready"; message?: string }
  | { state: "disabled"; reason: string; message: string }
  | { state: "needs-setup"; moduleName: string; requirementId: string; message: string };

export type UiActionParameterSpec = {
  schema: UiObjectJsonSchema;
  fields: readonly UiFormField[];
};

export type UiActionResultSpec = {
  success: { message: string; schema?: UiJsonSchema };
  errors: readonly { reason: string; message: string; schema?: UiJsonSchema }[];
};

export type UiAction = {
  surfaceId: string;
  actionId: string;
  scopeId: string;
  label: string;
  effect: UiActionEffect;
  operation: UiActionOperation;
  parameters?: UiActionParameterSpec;
  confirmation: UiConfirmation;
  readiness: UiActionReadiness;
  result: UiActionResultSpec;
  conditions?: readonly UiCondition[];
  permissions?: readonly UiPermission[];
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
  cells: readonly { columnId: string; value: string; role?: UiRole }[];
  action?: UiAction;
};

export type UiFieldOption = {
  label: string;
  value: string;
};

export type UiLinkTarget =
  | { kind: "surface"; surfaceId: string }
  | { kind: "session"; sessionId: string }
  | { kind: "daemon-route"; path: string }
  | { kind: "external-url"; url: string };

export type UiTab = {
  id: string;
  label: string;
  nodes: readonly UiNode[];
};

export type UiLogEntry = {
  timestamp: string;
  level: UiLogLevel;
  message: string;
  source?: string;
};

export type UiLogStreamSource = {
  kind: "sse";
  path: string;
  eventTypes: readonly string[];
};

export type UiFormField = {
  id: string;
  label: string;
  input: UiFieldInput;
  required: boolean;
  options?: readonly UiFieldOption[];
  schema?: UiJsonSchema;
};

export type UiNode =
  | { kind: "navigation"; label: string; items: readonly { surfaceId: string; label: string }[] }
  | { kind: "status-summary"; entries: readonly UiStatusEntry[] }
  | { kind: "metrics"; title: string; metrics: readonly UiMetric[] }
  | { kind: "text"; title: string; body: string; role?: UiRole }
  | { kind: "link"; label: string; target: UiLinkTarget; role?: UiRole }
  | { kind: "tabs"; title: string; activeTabId: string; tabs: readonly UiTab[] }
  | { kind: "list"; title: string; items: readonly UiListItem[] }
  | { kind: "table"; title: string; columns: readonly UiTableColumn[]; rows: readonly UiTableRow[] }
  | { kind: "detail"; title: string; body: string }
  | { kind: "progress"; label: string; value: number; max: number; role: UiRole }
  | { kind: "log"; title: string; entries: readonly UiLogEntry[] }
  | { kind: "log-stream"; title: string; streamId: string; source: UiLogStreamSource; entries: readonly UiLogEntry[] }
  | { kind: "form"; title: string; fields: readonly UiFormField[]; submit: UiAction }
  | { kind: "action-list"; title: string; actions: readonly UiAction[] }
  | { kind: "command"; action: UiAction }
  | { kind: "empty"; title: string; detail: string; action: UiAction }
  | { kind: "error"; title: string; detail: string; action: UiAction };

export type UiSurface = {
  protocolVersion: UiProtocolVersion;
  surfaceId: string;
  extensionId: string;
  title: string;
  intent: UiIntent;
  scopeId: string;
  attachmentPoint: UiAttachmentPoint;
  order: number;
  refreshEvents?: readonly string[];
  conditions?: readonly UiCondition[];
  permissions?: readonly UiPermission[];
  nodes: readonly UiNode[];
  actions: readonly UiAction[];
};

export type UiSurfaceBundle = {
  protocolVersion: UiProtocolVersion;
  surfaces: readonly UiSurface[];
};

export {
  assembleValidatedUiSurfaceBundle as buildUiSurfaceBundle,
  UiSurfaceValidationError,
  validateUiSurfaceBundle,
} from "./ui-surface-validation.js";
