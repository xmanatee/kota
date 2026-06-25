import {
  asArray,
  asBool,
  asKnown,
  asNumber,
  asObject,
  asOptionalNumber,
  asOptionalString,
  asString,
  fail,
} from './decoder-common';
import { SETUP_STATES } from './decoder-setup';
import {
  UI_ACTION_EFFECTS,
  UI_ACTION_METHODS,
  UI_ATTACHMENT_KINDS,
  UI_CAPABILITY_SCOPES,
  UI_CONDITION_KINDS,
  UI_CONDITION_STATUSES,
  UI_CONFIRMATION_MODES,
  UI_CONFIRMATION_RISKS,
  UI_FIELD_INPUTS,
  UI_INTENTS,
  UI_OPERATION_KINDS,
  UI_PERMISSION_KINDS,
  UI_READINESS_STATES,
  UI_SCHEMA_FORMATS,
  UI_SCHEMA_TYPES,
  type UiAction,
  type UiActionOperation,
  type UiActionReadiness,
  type UiAttachmentPoint,
  type UiCondition,
  type UiConfirmation,
  type UiFormField,
  type UiJsonSchema,
  type UiPermission,
} from './decoder-ui-types';

export function parseUiJsonSchema(raw: unknown, field: string): UiJsonSchema {
  const obj = asObject(raw, field);
  const type = asKnown(obj.type, `${field}.type`, UI_SCHEMA_TYPES);
  const base = {
    type,
    title: asOptionalString(obj.title, `${field}.title`),
    description: asOptionalString(obj.description, `${field}.description`),
  };
  if (type === "string") {
    return {
      ...base,
      enum: obj.enum === undefined
        ? undefined
        : asArray(obj.enum, `${field}.enum`).map((entry, index) =>
            asString(entry, `${field}.enum[${index}]`)
          ),
      default: obj.default === undefined ? undefined : asString(obj.default, `${field}.default`),
      format: obj.format === undefined
        ? undefined
        : asKnown(obj.format, `${field}.format`, UI_SCHEMA_FORMATS),
    };
  }
  if (type === "number" || type === "integer") {
    return {
      ...base,
      default: obj.default === undefined ? undefined : asNumber(obj.default, `${field}.default`),
      minimum: asOptionalNumber(obj.minimum, `${field}.minimum`),
      maximum: asOptionalNumber(obj.maximum, `${field}.maximum`),
    };
  }
  if (type === "boolean") {
    return {
      ...base,
      default: obj.default === undefined ? undefined : asBool(obj.default, `${field}.default`),
    };
  }
  if (type === "array") {
    return {
      ...base,
      items: parseUiJsonSchema(obj.items, `${field}.items`),
    };
  }
  const props = asObject(obj.properties, `${field}.properties`);
  const properties: Record<string, UiJsonSchema> = {};
  for (const [key, value] of Object.entries(props)) {
    properties[key] = parseUiJsonSchema(value, `${field}.properties.${key}`);
  }
  return {
    ...base,
    properties,
    required: obj.required === undefined
      ? undefined
      : asArray(obj.required, `${field}.required`).map((entry, index) =>
          asString(entry, `${field}.required[${index}]`)
        ),
    additionalProperties: obj.additionalProperties === undefined
      ? undefined
      : asBool(obj.additionalProperties, `${field}.additionalProperties`),
  };
}

export function parseUiAttachmentPoint(raw: unknown, field: string): UiAttachmentPoint {
  const obj = asObject(raw, field);
  const kind = asKnown(obj.kind, `${field}.kind`, UI_ATTACHMENT_KINDS);
  if (kind === "root") return { kind };
  if (kind === "intent") {
    return { kind, intent: asKnown(obj.intent, `${field}.intent`, UI_INTENTS) };
  }
  return { kind, surfaceId: asString(obj.surfaceId, `${field}.surfaceId`) };
}

export function parseUiCondition(raw: unknown, field: string): UiCondition {
  const obj = asObject(raw, field);
  const kind = asKnown(obj.kind, `${field}.kind`, UI_CONDITION_KINDS);
  if (kind === "capability") {
    return {
      kind,
      capabilityId: asString(obj.capabilityId, `${field}.capabilityId`),
      status: asKnown(obj.status, `${field}.status`, UI_CONDITION_STATUSES),
    };
  }
  if (kind === "setup") {
    return {
      kind,
      moduleName: asString(obj.moduleName, `${field}.moduleName`),
      requirementId: asString(obj.requirementId, `${field}.requirementId`),
      state: asKnown(obj.state, `${field}.state`, SETUP_STATES),
    };
  }
  return { kind, scopeId: asString(obj.scopeId, `${field}.scopeId`) };
}

export function parseUiPermission(raw: unknown, field: string): UiPermission {
  const obj = asObject(raw, field);
  const kind = asKnown(obj.kind, `${field}.kind`, UI_PERMISSION_KINDS);
  if (kind === "capability-scope") {
    return { kind, scope: asKnown(obj.scope, `${field}.scope`, UI_CAPABILITY_SCOPES) };
  }
  return { kind, effect: asKnown(obj.effect, `${field}.effect`, UI_ACTION_EFFECTS) };
}

export function parseOptionalUiConditions(value: unknown, field: string): UiCondition[] | undefined {
  if (value === undefined) return undefined;
  return asArray(value, field).map((entry, index) => parseUiCondition(entry, `${field}[${index}]`));
}

export function parseOptionalUiPermissions(value: unknown, field: string): UiPermission[] | undefined {
  if (value === undefined) return undefined;
  return asArray(value, field).map((entry, index) => parseUiPermission(entry, `${field}[${index}]`));
}

export function parseUiOperation(raw: unknown, field: string): UiActionOperation {
  const obj = asObject(raw, field);
  const kind = asKnown(obj.kind, `${field}.kind`, UI_OPERATION_KINDS);
  if (kind === "daemon-route") {
    return {
      kind,
      method: asKnown(obj.method, `${field}.method`, UI_ACTION_METHODS),
      path: asString(obj.path, `${field}.path`),
    };
  }
  return {
    kind,
    namespace: asString(obj.namespace, `${field}.namespace`),
    method: asString(obj.method, `${field}.method`),
  };
}

export function parseUiConfirmation(raw: unknown, field: string): UiConfirmation {
  const obj = asObject(raw, field);
  const mode = asKnown(obj.mode, `${field}.mode`, UI_CONFIRMATION_MODES);
  if (mode === "none") return { mode };
  return {
    mode,
    title: asString(obj.title, `${field}.title`),
    detail: asString(obj.detail, `${field}.detail`),
    confirmLabel: asString(obj.confirmLabel, `${field}.confirmLabel`),
    risk: asKnown(obj.risk, `${field}.risk`, UI_CONFIRMATION_RISKS),
  };
}

export function parseUiReadiness(raw: unknown, field: string): UiActionReadiness {
  const obj = asObject(raw, field);
  const state = asKnown(obj.state, `${field}.state`, UI_READINESS_STATES);
  if (state === "ready") {
    return { state, message: asOptionalString(obj.message, `${field}.message`) };
  }
  if (state === "disabled") {
    return {
      state,
      reason: asString(obj.reason, `${field}.reason`),
      message: asString(obj.message, `${field}.message`),
    };
  }
  return {
    state,
    moduleName: asString(obj.moduleName, `${field}.moduleName`),
    requirementId: asString(obj.requirementId, `${field}.requirementId`),
    message: asString(obj.message, `${field}.message`),
  };
}

export function parseUiFormField(raw: unknown, field: string): UiFormField {
  const item = asObject(raw, field);
  return {
    id: asString(item.id, `${field}.id`),
    label: asString(item.label, `${field}.label`),
    input: asKnown(item.input, `${field}.input`, UI_FIELD_INPUTS),
    required: asBool(item.required, `${field}.required`),
    options: item.options === undefined
      ? undefined
      : asArray(item.options, `${field}.options`).map((entry, index) => {
          const option = asObject(entry, `${field}.options[${index}]`);
          return {
            label: asString(option.label, `${field}.options[${index}].label`),
            value: asString(option.value, `${field}.options[${index}].value`),
          };
        }),
    schema: item.schema === undefined ? undefined : parseUiJsonSchema(item.schema, `${field}.schema`),
  };
}

export function parseUiParameters(raw: unknown, field: string): UiAction["parameters"] {
  if (raw === undefined) return undefined;
  const obj = asObject(raw, field);
  const schema = parseUiJsonSchema(obj.schema, `${field}.schema`);
  if (schema.type !== "object") fail(`${field}.schema must be an object schema`);
  return {
    schema: schema as UiJsonSchema & { type: "object" },
    fields: asArray(obj.fields, `${field}.fields`).map((entry, index) =>
      parseUiFormField(entry, `${field}.fields[${index}]`)
    ),
  };
}

export function parseUiResult(raw: unknown, field: string): UiAction["result"] {
  const obj = asObject(raw, field);
  const success = asObject(obj.success, `${field}.success`);
  return {
    success: {
      message: asString(success.message, `${field}.success.message`),
      schema: success.schema === undefined ? undefined : parseUiJsonSchema(success.schema, `${field}.success.schema`),
    },
    errors: asArray(obj.errors, `${field}.errors`).map((entry, index) => {
      const item = asObject(entry, `${field}.errors[${index}]`);
      return {
        reason: asString(item.reason, `${field}.errors[${index}].reason`),
        message: asString(item.message, `${field}.errors[${index}].message`),
        schema: item.schema === undefined
          ? undefined
          : parseUiJsonSchema(item.schema, `${field}.errors[${index}].schema`),
      };
    }),
  };
}

export function parseUiAction(raw: unknown, field: string): UiAction {
  const obj = asObject(raw, field);
  return {
    surfaceId: asString(obj.surfaceId, `${field}.surfaceId`),
    actionId: asString(obj.actionId, `${field}.actionId`),
    scopeId: asString(obj.scopeId, `${field}.scopeId`),
    label: asString(obj.label, `${field}.label`),
    effect: asKnown(obj.effect, `${field}.effect`, UI_ACTION_EFFECTS),
    operation: parseUiOperation(obj.operation, `${field}.operation`),
    parameters: parseUiParameters(obj.parameters, `${field}.parameters`),
    confirmation: parseUiConfirmation(obj.confirmation, `${field}.confirmation`),
    readiness: parseUiReadiness(obj.readiness, `${field}.readiness`),
    result: parseUiResult(obj.result, `${field}.result`),
    conditions: parseOptionalUiConditions(obj.conditions, `${field}.conditions`),
    permissions: parseOptionalUiPermissions(obj.permissions, `${field}.permissions`),
  };
}
