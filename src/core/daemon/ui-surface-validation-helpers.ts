import type {
  UiAttachmentPoint,
  UiCondition,
  UiFormField,
  UiJsonSchema,
  UiLinkTarget,
  UiLogEntry,
  UiLogStreamSource,
  UiPermission,
} from "./ui-surface.js";

const ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const CLIENT_MEMBER_PATTERN = /^[a-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/;
export const UI_INTENTS = ["Status", "Inbox", "Work", "Knowledge", "Setup"] as const;
export const UI_ROLES = ["neutral", "info", "success", "warn", "error", "muted"] as const;
const UI_CAPABILITY_SCOPES = ["read", "control"] as const;
const UI_CONDITION_STATUSES = ["ready", "unavailable", "init_failed"] as const;
const UI_SETUP_STATES = ["ready", "missing", "pending", "expired", "revoked", "unknown", "unavailable"] as const;
const UI_FIELD_INPUTS = ["text", "multiline", "secret", "number", "boolean", "select", "path", "url"] as const;
const UI_LINK_TARGET_KINDS = ["surface", "session", "daemon-route", "external-url"] as const;
const UI_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
const UI_LOG_STREAM_SOURCE_KINDS = ["sse"] as const;
const UI_ATTACHMENT_KINDS = ["root", "intent", "surface"] as const;
const UI_CONDITION_KINDS = ["capability", "setup", "scope"] as const;
const UI_PERMISSION_KINDS = ["capability-scope", "effect"] as const;
const UI_ACTION_EFFECTS = ["read", "write", "external"] as const;
const UI_SCHEMA_TYPES = ["string", "number", "integer", "boolean", "array", "object"] as const;
const UI_SCHEMA_FORMATS = ["secret-reference", "path", "url"] as const;
export const UI_NODE_KINDS = [
  "navigation", "status-summary", "metrics", "text", "link", "tabs",
  "list", "table", "detail", "progress", "log", "log-stream", "form",
  "action-list", "command", "empty", "error",
] as const;

function formatValue(value: string): string {
  return JSON.stringify(value) ?? String(value);
}

export function errorIf(condition: boolean, errors: string[], message: string): void {
  if (condition) errors.push(message);
}

export function validateKnown<T extends string>(
  value: string,
  allowed: readonly T[],
  label: string,
  errors: string[],
): value is T {
  const valid = allowed.includes(value as T);
  errorIf(!valid, errors, `${label} ${formatValue(value)} must be one of ${allowed.join(", ")}`);
  return valid;
}

export function validateOptionalKnown<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  label: string,
  errors: string[],
): void {
  if (value !== undefined) validateKnown(value, allowed, label, errors);
}

export function validateId(value: string, label: string, errors: string[]): void {
  errorIf(typeof value !== "string" || !ID_PATTERN.test(value), errors, `${label} ${formatValue(value)} must match ${ID_PATTERN.source}`);
}

export function validateClientMember(value: string, label: string, errors: string[]): void {
  errorIf(typeof value !== "string" || !CLIENT_MEMBER_PATTERN.test(value), errors, `${label} ${formatValue(value)} must match ${CLIENT_MEMBER_PATTERN.source}`);
}

export function validateUnique(value: string, seen: Set<string>, label: string, errors: string[]): void {
  errorIf(seen.has(value), errors, `duplicate ${label} "${value}"`);
  seen.add(value);
}

export function validateSchema(schema: UiJsonSchema, label: string, errors: string[]): void {
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

export function validateConditions(
  conditions: readonly UiCondition[] | undefined,
  label: string,
  errors: string[],
): void {
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

export function validatePermissions(
  permissions: readonly UiPermission[] | undefined,
  label: string,
  errors: string[],
): void {
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

export function validateAttachmentPoint(
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
    errorIf(!surfaceIds.has(attachmentPoint.surfaceId), errors, `surface "${surfaceId}" attaches to unknown surface "${attachmentPoint.surfaceId}"`);
  }
}

export function validateFormField(field: UiFormField, label: string, errors: string[]): void {
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

export function validateLinkTarget(target: UiLinkTarget, label: string, errors: string[]): void {
  const kind = target.kind;
  if (!validateKnown(kind, UI_LINK_TARGET_KINDS, `${label}.kind`, errors)) return;
  if (kind === "surface") {
    validateId(target.surfaceId, `${label}.surfaceId`, errors);
    return;
  }
  if (kind === "session") {
    errorIf(target.sessionId.trim() === "", errors, `${label}.sessionId must not be empty`);
    return;
  }
  if (kind === "daemon-route") {
    errorIf(!target.path.startsWith("/"), errors, `${label}.path must start with /`);
    return;
  }
  validateUrl(target.url, `${label}.url`, errors);
}

export function validateLogEntry(entry: UiLogEntry, label: string, errors: string[]): void {
  validateKnown(entry.level, UI_LOG_LEVELS, `${label}.level`, errors);
  errorIf(entry.timestamp.trim() === "", errors, `${label}.timestamp must not be empty`);
  errorIf(entry.message.trim() === "", errors, `${label}.message must not be empty`);
}

export function validateLogStreamSource(source: UiLogStreamSource, label: string, errors: string[]): void {
  const kind = source.kind;
  if (!validateKnown(kind, UI_LOG_STREAM_SOURCE_KINDS, `${label}.kind`, errors)) return;
  errorIf(!source.path.startsWith("/"), errors, `${label}.path must start with /`);
  errorIf(source.eventTypes.length === 0, errors, `${label}.eventTypes must not be empty`);
  for (const eventType of source.eventTypes) validateId(eventType, `${label}.eventTypes`, errors);
}
