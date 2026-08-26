import {
  asArray,
  asBool,
  asInt,
  asKnown,
  asObject,
  asOptionalInt,
  asOptionalString,
  asString,
} from './decoder-common';
import type { KnownLiteral } from './decoder-common';

// MARK: - Module setup requirements

const SETUP_KINDS = [
  "config",
  "secret",
  "oauth",
  "browser-profile",
  "external-url",
  "capability",
] as const;
const SETUP_SENSITIVITIES = ["none", "secret", "oauth", "browser-profile"] as const;
export const SETUP_STATES = [
  "ready",
  "missing",
  "pending",
  "expired",
  "revoked",
  "unknown",
  "unavailable",
] as const;
const SETUP_SCOPES = ["scope", "global"] as const;
const SETUP_MODES = ["form", "url", "none"] as const;
const SETUP_FIELD_TYPES = ["string", "number", "boolean"] as const;
const SETUP_FIELD_VALUE_KINDS = ["secret-reference"] as const;
const SETUP_ACTION_STATES = ["pending", "completed", "revoked"] as const;

export type SetupKind = KnownLiteral<typeof SETUP_KINDS>;
export type SetupSensitivity = KnownLiteral<typeof SETUP_SENSITIVITIES>;
export type SetupState = KnownLiteral<typeof SETUP_STATES>;
export type SetupScope = KnownLiteral<typeof SETUP_SCOPES>;

export type SetupFormField = {
  id: string;
  label: string;
  type: KnownLiteral<typeof SETUP_FIELD_TYPES>;
  valueKind?: KnownLiteral<typeof SETUP_FIELD_VALUE_KINDS>;
  configPath: string;
  required: boolean;
  placeholder?: string;
  helperText?: string;
};

export type SetupMode =
  | { mode: "form"; fields: SetupFormField[] }
  | { mode: "url"; url: string; label: string; pendingTtlMs?: number }
  | { mode: "none" };

export type SetupRequirementStatus = {
  moduleName: string;
  requirementId: string;
  kind: SetupKind;
  title: string;
  description?: string;
  required: boolean;
  scope: SetupScope;
  owner?: string;
  sensitivity: SetupSensitivity;
  setup: SetupMode;
  state: SetupState;
  reason: string;
  message: string;
  secretRefs?: Array<{
    name: string;
    scope: SetupScope;
    present: boolean;
    source?: string;
  }>;
  configFields?: Array<{
    id: string;
    label: string;
    configPath: string;
    required: boolean;
    present: boolean;
  }>;
  capabilities?: Array<{
    id: string;
    status: "ready" | "unavailable" | "init_failed";
    reason?: string;
    message?: string;
  }>;
  pendingAction?: {
    actionId: string;
    moduleName: string;
    requirementId: string;
    url: string;
    label: string;
    status: KnownLiteral<typeof SETUP_ACTION_STATES>;
    createdAt: string;
    expiresAt: string;
    completedAt?: string;
  };
};

export type SetupStatusResponse = {
  requirements: SetupRequirementStatus[];
  summary: Record<SetupState, number>;
};

function parseSetupMode(raw: unknown, field: string): SetupMode {
  const obj = asObject(raw, field);
  const mode = asKnown(obj.mode, `${field}.mode`, SETUP_MODES);
  if (mode === "form") {
    return {
      mode,
      fields: asArray(obj.fields, `${field}.fields`).map((entry, index) => {
        const f = asObject(entry, `${field}.fields[${index}]`);
        const valueKind = f.valueKind === undefined
          ? undefined
          : asKnown(
              f.valueKind,
              `${field}.fields[${index}].valueKind`,
              SETUP_FIELD_VALUE_KINDS,
            );
        return {
          id: asString(f.id, `${field}.fields[${index}].id`),
          label: asString(f.label, `${field}.fields[${index}].label`),
          type: asKnown(f.type, `${field}.fields[${index}].type`, SETUP_FIELD_TYPES),
          ...(valueKind !== undefined && { valueKind }),
          configPath: asString(f.configPath, `${field}.fields[${index}].configPath`),
          required: asBool(f.required, `${field}.fields[${index}].required`),
          placeholder: asOptionalString(
            f.placeholder,
            `${field}.fields[${index}].placeholder`,
          ),
          helperText: asOptionalString(
            f.helperText,
            `${field}.fields[${index}].helperText`,
          ),
        };
      }),
    };
  }
  if (mode === "url") {
    return {
      mode,
      url: asString(obj.url, `${field}.url`),
      label: asString(obj.label, `${field}.label`),
      pendingTtlMs: asOptionalInt(obj.pendingTtlMs, `${field}.pendingTtlMs`),
    };
  }
  return { mode };
}

function parseSetupPendingAction(raw: unknown, field: string): SetupRequirementStatus["pendingAction"] {
  if (raw === undefined) return undefined;
  const obj = asObject(raw, field);
  return {
    actionId: asString(obj.actionId, `${field}.actionId`),
    moduleName: asString(obj.moduleName, `${field}.moduleName`),
    requirementId: asString(obj.requirementId, `${field}.requirementId`),
    url: asString(obj.url, `${field}.url`),
    label: asString(obj.label, `${field}.label`),
    status: asKnown(obj.status, `${field}.status`, SETUP_ACTION_STATES),
    createdAt: asString(obj.createdAt, `${field}.createdAt`),
    expiresAt: asString(obj.expiresAt, `${field}.expiresAt`),
    completedAt: asOptionalString(obj.completedAt, `${field}.completedAt`),
  };
}

function parseOptionalSetupSecretRefs(
  raw: unknown,
  field: string,
): SetupRequirementStatus["secretRefs"] {
  if (raw === undefined) return undefined;
  return asArray(raw, field).map((entry, index) => {
    const obj = asObject(entry, `${field}[${index}]`);
    return {
      name: asString(obj.name, `${field}[${index}].name`),
      scope: asKnown(obj.scope, `${field}[${index}].scope`, SETUP_SCOPES),
      present: asBool(obj.present, `${field}[${index}].present`),
      source: asOptionalString(obj.source, `${field}[${index}].source`),
    };
  });
}

function parseOptionalSetupConfigFields(
  raw: unknown,
  field: string,
): SetupRequirementStatus["configFields"] {
  if (raw === undefined) return undefined;
  return asArray(raw, field).map((entry, index) => {
    const obj = asObject(entry, `${field}[${index}]`);
    return {
      id: asString(obj.id, `${field}[${index}].id`),
      label: asString(obj.label, `${field}[${index}].label`),
      configPath: asString(obj.configPath, `${field}[${index}].configPath`),
      required: asBool(obj.required, `${field}[${index}].required`),
      present: asBool(obj.present, `${field}[${index}].present`),
    };
  });
}

function parseOptionalSetupCapabilities(
  raw: unknown,
  field: string,
): SetupRequirementStatus["capabilities"] {
  if (raw === undefined) return undefined;
  return asArray(raw, field).map((entry, index) => {
    const obj = asObject(entry, `${field}[${index}]`);
    return {
      id: asString(obj.id, `${field}[${index}].id`),
      status: asKnown(
        obj.status,
        `${field}[${index}].status`,
        ["ready", "unavailable", "init_failed"] as const,
      ),
      reason: asOptionalString(obj.reason, `${field}[${index}].reason`),
      message: asOptionalString(obj.message, `${field}[${index}].message`),
    };
  });
}

export function parseSetupStatusResponse(raw: unknown): SetupStatusResponse {
  const top = asObject(raw, "setupRequirements");
  const requirements = asArray(
    top.requirements,
    "setupRequirements.requirements",
  ).map((entry, index): SetupRequirementStatus => {
    const obj = asObject(entry, `setupRequirements.requirements[${index}]`);
    return {
      moduleName: asString(obj.moduleName, `setupRequirements.requirements[${index}].moduleName`),
      requirementId: asString(obj.requirementId, `setupRequirements.requirements[${index}].requirementId`),
      kind: asKnown(obj.kind, `setupRequirements.requirements[${index}].kind`, SETUP_KINDS),
      title: asString(obj.title, `setupRequirements.requirements[${index}].title`),
      description: asOptionalString(obj.description, `setupRequirements.requirements[${index}].description`),
      required: asBool(obj.required, `setupRequirements.requirements[${index}].required`),
      scope: asKnown(obj.scope, `setupRequirements.requirements[${index}].scope`, SETUP_SCOPES),
      owner: asOptionalString(obj.owner, `setupRequirements.requirements[${index}].owner`),
      sensitivity: asKnown(
        obj.sensitivity,
        `setupRequirements.requirements[${index}].sensitivity`,
        SETUP_SENSITIVITIES,
      ),
      setup: parseSetupMode(obj.setup, `setupRequirements.requirements[${index}].setup`),
      state: asKnown(obj.state, `setupRequirements.requirements[${index}].state`, SETUP_STATES),
      reason: asString(obj.reason, `setupRequirements.requirements[${index}].reason`),
      message: asString(obj.message, `setupRequirements.requirements[${index}].message`),
      secretRefs: parseOptionalSetupSecretRefs(
        obj.secretRefs,
        `setupRequirements.requirements[${index}].secretRefs`,
      ),
      configFields: parseOptionalSetupConfigFields(
        obj.configFields,
        `setupRequirements.requirements[${index}].configFields`,
      ),
      capabilities: parseOptionalSetupCapabilities(
        obj.capabilities,
        `setupRequirements.requirements[${index}].capabilities`,
      ),
      pendingAction: parseSetupPendingAction(
        obj.pendingAction,
        `setupRequirements.requirements[${index}].pendingAction`,
      ),
    };
  });
  const summaryObj = asObject(top.summary, "setupRequirements.summary");
  const summary = SETUP_STATES.reduce(
    (acc, state) => {
      acc[state] = asInt(summaryObj[state], `setupRequirements.summary.${state}`);
      return acc;
    },
    {} as Record<SetupState, number>,
  );
  return { requirements, summary };
}
