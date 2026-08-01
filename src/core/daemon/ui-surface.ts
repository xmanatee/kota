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
export type UiFieldInput = "text" | "secret" | "number" | "boolean" | "select" | "path" | "url";
export type UiConfirmationRisk = "low" | "medium" | "high";
export type UiLinkTargetKind = "surface" | "daemon-route" | "external-url";
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
  conditions?: readonly UiCondition[];
  permissions?: readonly UiPermission[];
  nodes: readonly UiNode[];
  actions: readonly UiAction[];
};

export type UiSurfaceBundle = {
  protocolVersion: UiProtocolVersion;
  surfaces: readonly UiSurface[];
};

export class UiSurfaceValidationError extends Error {
  constructor(readonly errors: readonly string[]) {
    super(errors.join("\n"));
    this.name = "UiSurfaceValidationError";
  }
}

const ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const CLIENT_MEMBER_PATTERN = /^[a-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/;
const UI_INTENTS = ["Status", "Inbox", "Work", "Knowledge", "Setup"] as const;
const UI_ROLES = ["neutral", "info", "success", "warn", "error", "muted"] as const;
const UI_ACTION_EFFECTS = ["read", "write", "external"] as const;
const UI_ACTION_METHODS = ["GET", "POST", "PATCH", "DELETE"] as const;
const UI_CAPABILITY_SCOPES = ["read", "control"] as const;
const UI_CONDITION_STATUSES = ["ready", "unavailable", "init_failed"] as const;
const UI_SETUP_STATES = ["ready", "missing", "pending", "expired", "revoked", "unknown", "unavailable"] as const;
const UI_READINESS_STATES = ["ready", "disabled", "needs-setup"] as const;
const UI_FIELD_INPUTS = ["text", "secret", "number", "boolean", "select", "path", "url"] as const;
const UI_CONFIRMATION_RISKS = ["low", "medium", "high"] as const;
const UI_LINK_TARGET_KINDS = ["surface", "daemon-route", "external-url"] as const;
const UI_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
const UI_LOG_STREAM_SOURCE_KINDS = ["sse"] as const;
const UI_ATTACHMENT_KINDS = ["root", "intent", "surface"] as const;
const UI_CONDITION_KINDS = ["capability", "setup", "scope"] as const;
const UI_PERMISSION_KINDS = ["capability-scope", "effect"] as const;
const UI_OPERATION_KINDS = ["daemon-route", "client-namespace"] as const;
const UI_CONFIRMATION_MODES = ["none", "required"] as const;
const UI_NODE_KINDS = [
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
const UI_SCHEMA_TYPES = ["string", "number", "integer", "boolean", "array", "object"] as const;
const UI_SCHEMA_FORMATS = ["secret-reference", "path", "url"] as const;

function formatValue(value: string): string {
  return JSON.stringify(value) ?? String(value);
}

function errorIf(condition: boolean, errors: string[], message: string): void {
  if (condition) errors.push(message);
}

function validateKnown<T extends string>(
  value: string,
  allowed: readonly T[],
  label: string,
  errors: string[],
): value is T {
  const valid = allowed.includes(value as T);
  errorIf(!valid, errors, `${label} ${formatValue(value)} must be one of ${allowed.join(", ")}`);
  return valid;
}

function validateOptionalKnown<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  label: string,
  errors: string[],
): void {
  if (value !== undefined) validateKnown(value, allowed, label, errors);
}

function validateId(value: string, label: string, errors: string[]): void {
  errorIf(typeof value !== "string" || !ID_PATTERN.test(value), errors, `${label} ${formatValue(value)} must match ${ID_PATTERN.source}`);
}

function validateClientMember(value: string, label: string, errors: string[]): void {
  errorIf(typeof value !== "string" || !CLIENT_MEMBER_PATTERN.test(value), errors, `${label} ${formatValue(value)} must match ${CLIENT_MEMBER_PATTERN.source}`);
}

function validateUnique(value: string, seen: Set<string>, label: string, errors: string[]): void {
  errorIf(seen.has(value), errors, `duplicate ${label} "${value}"`);
  seen.add(value);
}

function validateSchema(schema: UiJsonSchema, label: string, errors: string[]): void {
  if (!validateKnown(schema.type, UI_SCHEMA_TYPES, `${label}.type`, errors)) return;
  if (schema.type === "object") {
    const propertyIds = new Set<string>();
    for (const key of Object.keys(schema.properties)) {
      validateUnique(key, propertyIds, `${label} property`, errors);
      validateSchema(schema.properties[key]!, `${label}.${key}`, errors);
    }
    for (const required of schema.required ?? []) {
      errorIf(!propertyIds.has(required), errors, `${label} requires unknown property "${required}"`);
    }
    return;
  }
  if (schema.type === "array") {
    validateSchema(schema.items, `${label}.items`, errors);
    return;
  }
  if (schema.type === "string") {
    errorIf(schema.enum !== undefined && schema.enum.length === 0, errors, `${label} enum must not be empty`);
    validateOptionalKnown(schema.format, UI_SCHEMA_FORMATS, `${label}.format`, errors);
  }
}

function validateConditions(conditions: readonly UiCondition[] | undefined, label: string, errors: string[]): void {
  const seen = new Set<string>();
  for (const condition of conditions ?? []) {
    const kind = condition.kind;
    if (!validateKnown(kind, UI_CONDITION_KINDS, `${label} condition.kind`, errors)) continue;
    if (kind === "capability") {
      validateUnique(`capability:${condition.capabilityId}:${condition.status}`, seen, `${label} condition`, errors);
      validateId(condition.capabilityId, `${label} capabilityId`, errors);
      validateKnown(condition.status, UI_CONDITION_STATUSES, `${label} capability status`, errors);
      continue;
    }
    if (kind === "setup") {
      validateUnique(`setup:${condition.moduleName}:${condition.requirementId}:${condition.state}`, seen, `${label} condition`, errors);
      validateId(condition.moduleName, `${label} setup moduleName`, errors);
      validateId(condition.requirementId, `${label} setup requirementId`, errors);
      validateKnown(condition.state, UI_SETUP_STATES, `${label} setup state`, errors);
      continue;
    }
    validateUnique(`scope:${condition.scopeId}`, seen, `${label} condition`, errors);
  }
}

function validatePermissions(permissions: readonly UiPermission[] | undefined, label: string, errors: string[]): void {
  const seen = new Set<string>();
  for (const permission of permissions ?? []) {
    const kind = permission.kind;
    if (!validateKnown(kind, UI_PERMISSION_KINDS, `${label} permission.kind`, errors)) continue;
    if (kind === "capability-scope") {
      validateUnique(`capability-scope:${permission.scope}`, seen, `${label} permission`, errors);
      validateKnown(permission.scope, UI_CAPABILITY_SCOPES, `${label} permission.scope`, errors);
      continue;
    }
    validateUnique(`effect:${permission.effect}`, seen, `${label} permission`, errors);
    validateKnown(permission.effect, UI_ACTION_EFFECTS, `${label} permission.effect`, errors);
  }
}

function validateAttachmentPoint(
  attachmentPoint: UiAttachmentPoint,
  surfaceIds: ReadonlySet<string>,
  surfaceId: string,
  errors: string[],
): void {
  const kind = attachmentPoint.kind;
  if (!validateKnown(kind, UI_ATTACHMENT_KINDS, `surface ${surfaceId}.attachmentPoint.kind`, errors)) return;
  if (kind === "intent") {
    validateKnown(attachmentPoint.intent, UI_INTENTS, `surface ${surfaceId}.attachmentPoint.intent`, errors);
    return;
  }
  if (kind === "surface") {
    errorIf(
      !surfaceIds.has(attachmentPoint.surfaceId),
      errors,
      `surface "${surfaceId}" attaches to unknown surface "${attachmentPoint.surfaceId}"`,
    );
  }
}

function validateFormField(field: UiFormField, label: string, errors: string[]): void {
  validateKnown(field.input, UI_FIELD_INPUTS, `${label}.input`, errors);
  if (field.input === "select") {
    errorIf(!field.options || field.options.length === 0, errors, `${label} select needs options`);
  }
  if (field.schema) validateSchema(field.schema, `${label}.schema`, errors);
}

function validateUrl(value: string, label: string, errors: string[]): void {
  try {
    new URL(value);
  } catch {
    errors.push(`${label} must be an absolute URL`);
  }
}

function validateLinkTarget(target: UiLinkTarget, label: string, errors: string[]): void {
  const kind = target.kind;
  if (!validateKnown(kind, UI_LINK_TARGET_KINDS, `${label}.kind`, errors)) return;
  if (kind === "surface") {
    validateId(target.surfaceId, `${label}.surfaceId`, errors);
    return;
  }
  if (kind === "daemon-route") {
    errorIf(!target.path.startsWith("/"), errors, `${label}.path must start with /`);
    return;
  }
  validateUrl(target.url, `${label}.url`, errors);
}

function validateLogEntry(entry: UiLogEntry, label: string, errors: string[]): void {
  validateKnown(entry.level, UI_LOG_LEVELS, `${label}.level`, errors);
  errorIf(entry.timestamp.trim() === "", errors, `${label}.timestamp must not be empty`);
  errorIf(entry.message.trim() === "", errors, `${label}.message must not be empty`);
}

function validateLogStreamSource(source: UiLogStreamSource, label: string, errors: string[]): void {
  const kind = source.kind;
  if (!validateKnown(kind, UI_LOG_STREAM_SOURCE_KINDS, `${label}.kind`, errors)) return;
  errorIf(!source.path.startsWith("/"), errors, `${label}.path must start with /`);
  errorIf(source.eventTypes.length === 0, errors, `${label}.eventTypes must not be empty`);
  for (const eventType of source.eventTypes) validateId(eventType, `${label}.eventTypes`, errors);
}

function validateActionOperation(operation: UiActionOperation, label: string, errors: string[]): void {
  const kind = operation.kind;
  if (!validateKnown(kind, UI_OPERATION_KINDS, `${label}.kind`, errors)) return;
  if (kind === "daemon-route") {
    validateKnown(operation.method, UI_ACTION_METHODS, `${label}.method`, errors);
    errorIf(!operation.path.startsWith("/"), errors, `${label}.path must start with /`);
  } else {
    validateClientMember(operation.namespace, `${label}.namespace`, errors);
    validateClientMember(operation.method, `${label}.method`, errors);
  }
}

function validateConfirmation(confirmation: UiConfirmation, label: string, errors: string[]): void {
  const mode = confirmation.mode;
  if (!validateKnown(mode, UI_CONFIRMATION_MODES, `${label}.mode`, errors)) return;
  if (mode === "required") {
    errorIf(confirmation.title.trim() === "", errors, `${label}.title must not be empty`);
    errorIf(confirmation.detail.trim() === "", errors, `${label}.detail must not be empty`);
    errorIf(confirmation.confirmLabel.trim() === "", errors, `${label}.confirmLabel must not be empty`);
    validateKnown(confirmation.risk, UI_CONFIRMATION_RISKS, `${label}.risk`, errors);
  }
}

function validateReadiness(readiness: UiActionReadiness, label: string, errors: string[]): void {
  const state = readiness.state;
  if (!validateKnown(state, UI_READINESS_STATES, `${label}.state`, errors)) return;
  if (state === "disabled") {
    validateId(readiness.reason, `${label}.reason`, errors);
    errorIf(readiness.message.trim() === "", errors, `${label}.message must not be empty`);
  }
  if (state === "needs-setup") {
    validateId(readiness.moduleName, `${label}.moduleName`, errors);
    validateId(readiness.requirementId, `${label}.requirementId`, errors);
    errorIf(readiness.message.trim() === "", errors, `${label}.message must not be empty`);
  }
}

function validateAction(action: UiAction, label: string, errors: string[]): void {
  validateId(action.surfaceId, `${label}.surfaceId`, errors);
  validateId(action.actionId, `${label}.actionId`, errors);
  validateKnown(action.effect, UI_ACTION_EFFECTS, `${label}.effect`, errors);
  validateActionOperation(action.operation, `${label}.operation`, errors);
  if (action.parameters) {
    validateSchema(action.parameters.schema, `${label}.parameters.schema`, errors);
    const fieldIds = new Set<string>();
    for (const field of action.parameters.fields) {
      validateUnique(field.id, fieldIds, `${label} field id`, errors);
      validateFormField(field, `${label}.parameters.fields.${field.id}`, errors);
      errorIf(
        action.parameters.schema.properties[field.id] === undefined,
        errors,
        `${label}.parameters.fields references missing schema property "${field.id}"`,
      );
    }
    for (const required of action.parameters.schema.required ?? []) {
      errorIf(
        !fieldIds.has(required),
        errors,
        `${label}.parameters.schema requires "${required}" but no matching field is declared`,
      );
    }
  }
  validateConfirmation(action.confirmation, `${label}.confirmation`, errors);
  validateReadiness(action.readiness, `${label}.readiness`, errors);
  errorIf(action.result.success.message.trim() === "", errors, `${label}.result.success.message must not be empty`);
  validateSchema(action.result.success.schema ?? { type: "object", properties: {} }, `${label}.result.success.schema`, errors);
  const errorReasons = new Set<string>();
  for (const outcome of action.result.errors) {
    validateId(outcome.reason, `${label}.result.errors.reason`, errors);
    validateUnique(outcome.reason, errorReasons, `${label} result error reason`, errors);
    errorIf(outcome.message.trim() === "", errors, `${label}.result.errors.${outcome.reason}.message must not be empty`);
    if (outcome.schema) validateSchema(outcome.schema, `${label}.result.errors.${outcome.reason}.schema`, errors);
  }
  validateConditions(action.conditions, label, errors);
  validatePermissions(action.permissions, label, errors);
}

function collectNodeActions(node: UiNode): readonly UiAction[] {
  switch (node.kind) {
    case "tabs":
      return [];
    case "list":
      return node.items.flatMap((item) => item.action ? [item.action] : []);
    case "table":
      return node.rows.flatMap((row) => row.action ? [row.action] : []);
    case "form":
      return [node.submit];
    case "action-list":
      return node.actions;
    case "command":
    case "empty":
    case "error":
      return [node.action];
    default:
      return [];
  }
}

function validateNode(node: UiNode, label: string, errors: string[]): void {
  const kind = node.kind;
  if (!validateKnown(kind, UI_NODE_KINDS, `${label}.kind`, errors)) return;
  switch (kind) {
    case "navigation":
      for (const item of node.items) validateId(item.surfaceId, `${label}.items.surfaceId`, errors);
      break;
    case "status-summary":
      for (const entry of node.entries) validateKnown(entry.role, UI_ROLES, `${label}.entries.role`, errors);
      break;
    case "metrics":
      for (const metric of node.metrics) validateKnown(metric.role, UI_ROLES, `${label}.metrics.role`, errors);
      break;
    case "text":
      validateOptionalKnown(node.role, UI_ROLES, `${label}.role`, errors);
      break;
    case "link":
      validateLinkTarget(node.target, `${label}.target`, errors);
      validateOptionalKnown(node.role, UI_ROLES, `${label}.role`, errors);
      break;
    case "tabs": {
      const tabs = new Set<string>();
      for (const tab of node.tabs) {
        validateId(tab.id, `${label}.tabs.id`, errors);
        validateUnique(tab.id, tabs, `${label} tab id`, errors);
        for (const child of tab.nodes) validateNode(child, `${label}.tabs.${tab.id} node ${child.kind}`, errors);
      }
      errorIf(!tabs.has(node.activeTabId), errors, `${label}.activeTabId references unknown tab "${node.activeTabId}"`);
      break;
    }
    case "list":
      for (const item of node.items) validateKnown(item.role, UI_ROLES, `${label}.items.role`, errors);
      break;
    case "table": {
      const columns = new Set<string>();
      for (const column of node.columns) {
        validateId(column.id, `${label}.columns.id`, errors);
        validateUnique(column.id, columns, `${label} column id`, errors);
        validateOptionalKnown(column.role, UI_ROLES, `${label}.columns.${column.id}.role`, errors);
      }
      for (const row of node.rows) {
        for (const cell of row.cells) {
          errorIf(!columns.has(cell.columnId), errors, `${label} row "${row.id}" references unknown column "${cell.columnId}"`);
          validateOptionalKnown(cell.role, UI_ROLES, `${label}.rows.${row.id}.cells.${cell.columnId}.role`, errors);
        }
      }
      break;
    }
    case "detail":
      break;
    case "progress":
      errorIf(node.max <= 0, errors, `${label}.max must be positive`);
      errorIf(node.value < 0 || node.value > node.max, errors, `${label}.value must be between 0 and max`);
      validateKnown(node.role, UI_ROLES, `${label}.role`, errors);
      break;
    case "log":
      for (const [index, entry] of node.entries.entries()) validateLogEntry(entry, `${label}.entries.${index}`, errors);
      break;
    case "log-stream":
      validateId(node.streamId, `${label}.streamId`, errors);
      validateLogStreamSource(node.source, `${label}.source`, errors);
      for (const [index, entry] of node.entries.entries()) validateLogEntry(entry, `${label}.entries.${index}`, errors);
      break;
    case "form": {
      const fields = new Set<string>();
      for (const field of node.fields) {
        validateUnique(field.id, fields, `${label} field id`, errors);
        validateFormField(field, `${label}.fields.${field.id}`, errors);
      }
      break;
    }
    case "action-list":
    case "command":
    case "empty":
    case "error":
      break;
  }
  for (const action of collectNodeActions(node)) validateAction(action, `${label}.${action.actionId}`, errors);
}

export function validateUiSurfaceBundle(bundle: UiSurfaceBundle): UiSurfaceBundle {
  const errors: string[] = [];
  errorIf(bundle.protocolVersion !== UI_SURFACE_PROTOCOL_VERSION, errors, `protocolVersion must be ${UI_SURFACE_PROTOCOL_VERSION}`);
  const surfaceIds = new Set<string>();
  const extensionIds = new Set<string>();
  const actionIds = new Set<string>();

  for (const surface of bundle.surfaces) {
    validateId(surface.surfaceId, "surfaceId", errors);
    validateId(surface.extensionId, "extensionId", errors);
    validateKnown(surface.intent, UI_INTENTS, `surface ${surface.surfaceId}.intent`, errors);
    validateUnique(surface.surfaceId, surfaceIds, "surfaceId", errors);
    validateUnique(surface.extensionId, extensionIds, "extensionId", errors);
  }

  for (const surface of bundle.surfaces) {
    validateAttachmentPoint(surface.attachmentPoint, surfaceIds, surface.surfaceId, errors);
    validateConditions(surface.conditions, `surface ${surface.surfaceId}`, errors);
    validatePermissions(surface.permissions, `surface ${surface.surfaceId}`, errors);
    for (const node of surface.nodes) validateNode(node, `surface ${surface.surfaceId} node ${node.kind}`, errors);
    for (const action of surface.actions) {
      errorIf(action.surfaceId !== surface.surfaceId, errors, `action "${action.actionId}" belongs to "${action.surfaceId}" but is listed on "${surface.surfaceId}"`);
      validateUnique(`${surface.surfaceId}:${action.actionId}`, actionIds, "actionId", errors);
      validateAction(action, `surface ${surface.surfaceId} action ${action.actionId}`, errors);
    }
  }

  if (errors.length > 0) throw new UiSurfaceValidationError(errors);
  return bundle;
}

export function buildUiSurfaceBundle(surfaces: readonly UiSurface[]): UiSurfaceBundle {
  return validateUiSurfaceBundle({
    protocolVersion: UI_SURFACE_PROTOCOL_VERSION,
    surfaces: [...surfaces].sort((a, b) => a.order - b.order || a.surfaceId.localeCompare(b.surfaceId)),
  });
}
