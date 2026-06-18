/**
 * Strict TypeScript decoders for the thin-client contract conformance
 * fixture (`./contract-fixture.json`).
 *
 * Each decoder parses a wire-shaped JSON value through a typed runtime
 * check that mirrors the macOS Swift `Codable` decoders one-to-one:
 * unknown discriminator values (`source`, `target`, `reason`) throw a
 * `ContractDecodeError` instead of silently passing as `unknown`. This
 * keeps the negative-fixture cases (`negative_unknownReason`,
 * `negative_unknownSource`, `negative_unknownTarget`) honest across the
 * web Vitest and mobile Jest decoder suites alongside the macOS Swift
 * conformance suite.
 *
 * The decoders are deliberately scoped to the surfaces named on
 * `task-share-or-conformance-test-daemon-wire-contracts-ac` (recall,
 * answer, answer-history, capture, retract, per-store semantic search,
 * attention, digest, voice failure envelopes). The web client's
 * `clients/web/src/api/client.ts` and the mobile client's
 * `clients/mobile/src/daemon/{digest,attention,…}.ts` import these
 * decoders directly so the same strict-decode contract that backs the
 * conformance fixture suite also gates the production runtime path.
 */

export class ContractDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractDecodeError";
  }
}

function fail(message: string): never {
  throw new ContractDecodeError(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") fail(`expected string at ${field}`);
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number") fail(`expected number at ${field}`);
  return value;
}

function asInt(value: unknown, field: string): number {
  const n = asNumber(value, field);
  if (!Number.isInteger(n)) fail(`expected integer at ${field}`);
  return n;
}

function asBool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") fail(`expected boolean at ${field}`);
  return value;
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (!isObject(value)) fail(`expected object at ${field}`);
  return value;
}

function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) fail(`expected array at ${field}`);
  return value;
}

function asOptionalString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  return asString(value, field);
}

function asOptionalInt(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  return asInt(value, field);
}

function asOptionalNumber(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  return asNumber(value, field);
}

function asOptionalStringArray(
  value: unknown,
  field: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  return asArray(value, field).map((entry, index) =>
    asString(entry, `${field}[${index}]`),
  );
}

// MARK: - Project registry projection

export type ProjectRegistryEntry = {
  projectId: string;
  projectDir: string;
  displayName: string;
};

export type ProjectRegistryProjection = {
  defaultProjectId: string;
  projects: ProjectRegistryEntry[];
};

export function parseProjectRegistryProjection(
  raw: unknown,
): ProjectRegistryProjection {
  const obj = asObject(raw, "projects");
  const defaultProjectId = asString(
    obj.defaultProjectId,
    "projects.defaultProjectId",
  );
  const projectsRaw = asArray(obj.projects, "projects.projects");
  if (projectsRaw.length === 0) {
    fail("projects.projects must declare at least one entry");
  }
  const projects = projectsRaw.map((entry, index) => {
    const e = asObject(entry, `projects.projects[${index}]`);
    return {
      projectId: asString(e.projectId, `projects.projects[${index}].projectId`),
      projectDir: asString(
        e.projectDir,
        `projects.projects[${index}].projectDir`,
      ),
      displayName: asString(
        e.displayName,
        `projects.projects[${index}].displayName`,
      ),
    };
  });
  if (!projects.some((p) => p.projectId === defaultProjectId)) {
    fail(
      `projects.defaultProjectId ${defaultProjectId} does not match any registered project`,
    );
  }
  return { defaultProjectId, projects };
}

// MARK: - Scope registry projection

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

export function parseScopeRegistryProjection(
  raw: unknown,
): ScopeRegistryProjection {
  const obj = asObject(raw, "scopes");
  const rootScopeId = asString(obj.rootScopeId, "scopes.rootScopeId");
  const defaultScopeId = asString(
    obj.defaultScopeId,
    "scopes.defaultScopeId",
  );
  const scopesRaw = asArray(obj.scopes, "scopes.scopes");
  if (scopesRaw.length === 0) {
    fail("scopes.scopes must declare at least one entry");
  }
  const scopes = scopesRaw.map((entry, index) => {
    const e = asObject(entry, `scopes.scopes[${index}]`);
    return {
      scopeId: asString(e.scopeId, `scopes.scopes[${index}].scopeId`),
      displayName: asString(
        e.displayName,
        `scopes.scopes[${index}].displayName`,
      ),
      parentScopeId: asOptionalString(
        e.parentScopeId,
        `scopes.scopes[${index}].parentScopeId`,
      ),
      directoryRoot: asOptionalString(
        e.directoryRoot,
        `scopes.scopes[${index}].directoryRoot`,
      ),
    };
  });
  if (!scopes.some((scope) => scope.scopeId === rootScopeId)) {
    fail(`scopes.rootScopeId ${rootScopeId} does not match any registered scope`);
  }
  if (!scopes.some((scope) => scope.scopeId === defaultScopeId)) {
    fail(
      `scopes.defaultScopeId ${defaultScopeId} does not match any registered scope`,
    );
  }
  return { rootScopeId, defaultScopeId, scopes };
}

// MARK: - Scope policy projection

const SCOPE_POLICY_AREAS = [
  "autonomy",
  "writes",
  "channels",
  "setup",
  "ownerConfirmation",
  "retention",
  "modules",
  "externalEffects",
] as const;
const SCOPE_POLICY_EXPLANATION_ACTIONS = ["set", "override", "inherit"] as const;
const SCOPE_POLICY_AUTONOMY_MODES = ["passive", "supervised", "autonomous"] as const;
const SCOPE_POLICY_WRITE_MODES = ["none", "scope-directory", "paths", "unrestricted"] as const;
const SCOPE_POLICY_CHANNEL_MODES = ["blocked", "allow-list", "allow-all"] as const;
const SCOPE_POLICY_SETUP_VISIBILITIES = ["hidden", "metadata", "full"] as const;
const SCOPE_POLICY_ACTION_POLICIES = ["allow", "confirm", "deny"] as const;
const SCOPE_POLICY_RETENTION_MODES = ["retain", "expire-after-days"] as const;
const SCOPE_POLICY_REDACTION_PROFILES = ["full", "sensitive-fields", "none"] as const;
const SCOPE_POLICY_MODULE_AVAILABILITIES = ["enabled", "setup-required", "disabled"] as const;
const SCOPE_POLICY_DECISION_KINDS = ["channel-route", "tool-effect"] as const;
const SCOPE_POLICY_DECISION_OUTCOMES = ["allow", "confirm", "deny", "ignore"] as const;

export type ScopePolicySource = {
  scopeId: string;
  reason: string;
};

export type ScopePolicyDecision = {
  kind: KnownLiteral<typeof SCOPE_POLICY_DECISION_KINDS>;
  target: string;
  outcome: KnownLiteral<typeof SCOPE_POLICY_DECISION_OUTCOMES>;
  source: ScopePolicySource;
  reason: string;
  rendered: string;
};

export type ScopePolicyRouteResponse = {
  policy: {
    scopeId: string;
    lineage: string[];
    directoryRoot?: string;
    autonomy: {
      defaultMode: KnownLiteral<typeof SCOPE_POLICY_AUTONOMY_MODES>;
      maxMode: KnownLiteral<typeof SCOPE_POLICY_AUTONOMY_MODES>;
      source: ScopePolicySource;
    };
    writes: {
      mode: KnownLiteral<typeof SCOPE_POLICY_WRITE_MODES>;
      paths?: string[];
      source: ScopePolicySource;
    };
    channels: {
      mode: KnownLiteral<typeof SCOPE_POLICY_CHANNEL_MODES>;
      allowedChannels: string[];
      blockedSources: string[];
      ignoredSources: string[];
      source: ScopePolicySource;
    };
    setup: {
      visibility: KnownLiteral<typeof SCOPE_POLICY_SETUP_VISIBILITIES>;
      source: ScopePolicySource;
    };
    ownerConfirmation: {
      localWrite: KnownLiteral<typeof SCOPE_POLICY_ACTION_POLICIES>;
      externalWrite: KnownLiteral<typeof SCOPE_POLICY_ACTION_POLICIES>;
      destructive: KnownLiteral<typeof SCOPE_POLICY_ACTION_POLICIES>;
      source: ScopePolicySource;
    };
    retention:
      | {
          mode: "retain";
          redaction: KnownLiteral<typeof SCOPE_POLICY_REDACTION_PROFILES>;
          source: ScopePolicySource;
        }
      | {
          mode: "expire-after-days";
          maxAgeDays: number;
          redaction: KnownLiteral<typeof SCOPE_POLICY_REDACTION_PROFILES>;
          source: ScopePolicySource;
        };
    modules: {
      defaultAvailability: KnownLiteral<typeof SCOPE_POLICY_MODULE_AVAILABILITIES>;
      overrides: Array<{
        moduleName: string;
        availability: KnownLiteral<typeof SCOPE_POLICY_MODULE_AVAILABILITIES>;
      }>;
      source: ScopePolicySource;
    };
    externalEffects: {
      networkRead: KnownLiteral<typeof SCOPE_POLICY_ACTION_POLICIES>;
      networkWrite: KnownLiteral<typeof SCOPE_POLICY_ACTION_POLICIES>;
      networkDestructive: KnownLiteral<typeof SCOPE_POLICY_ACTION_POLICIES>;
      source: ScopePolicySource;
    };
    explanations: Array<{
      area: KnownLiteral<typeof SCOPE_POLICY_AREAS>;
      scopeId: string;
      action: KnownLiteral<typeof SCOPE_POLICY_EXPLANATION_ACTIONS>;
      message: string;
    }>;
  };
  decisionExamples: ScopePolicyDecision[];
};

export function parseScopePolicyRouteResponse(
  raw: unknown,
): ScopePolicyRouteResponse {
  const obj = asObject(raw, "scopePolicy");
  const policy = parseScopePolicy(asObject(obj.policy, "scopePolicy.policy"));
  const decisionExamples = asArray(
    obj.decisionExamples,
    "scopePolicy.decisionExamples",
  ).map((entry, index) =>
    parseScopePolicyDecision(entry, `scopePolicy.decisionExamples[${index}]`),
  );
  return { policy, decisionExamples };
}

function parseScopePolicySource(raw: unknown, field: string): ScopePolicySource {
  const obj = asObject(raw, field);
  return {
    scopeId: asString(obj.scopeId, `${field}.scopeId`),
    reason: asString(obj.reason, `${field}.reason`),
  };
}

function parseScopePolicy(raw: Record<string, unknown>): ScopePolicyRouteResponse["policy"] {
  const scopeId = asString(raw.scopeId, "scopePolicy.policy.scopeId");
  const lineage = asStringArray(raw.lineage, "scopePolicy.policy.lineage");
  const directoryRoot = asOptionalString(
    raw.directoryRoot,
    "scopePolicy.policy.directoryRoot",
  );
  if (!lineage.includes(scopeId)) {
    fail("scopePolicy.policy.lineage must include policy.scopeId");
  }
  const retentionObj = asObject(raw.retention, "scopePolicy.policy.retention");
  const retentionMode = asKnown(
    retentionObj.mode,
    "scopePolicy.policy.retention.mode",
    SCOPE_POLICY_RETENTION_MODES,
  );
  const retention = retentionMode === "retain"
    ? {
        mode: retentionMode,
        redaction: asKnown(
          retentionObj.redaction,
          "scopePolicy.policy.retention.redaction",
          SCOPE_POLICY_REDACTION_PROFILES,
        ),
        source: parseScopePolicySource(retentionObj.source, "scopePolicy.policy.retention.source"),
      }
    : {
        mode: retentionMode,
        maxAgeDays: asInt(retentionObj.maxAgeDays, "scopePolicy.policy.retention.maxAgeDays"),
        redaction: asKnown(
          retentionObj.redaction,
          "scopePolicy.policy.retention.redaction",
          SCOPE_POLICY_REDACTION_PROFILES,
        ),
        source: parseScopePolicySource(retentionObj.source, "scopePolicy.policy.retention.source"),
      };
  return {
    scopeId,
    lineage,
    ...(directoryRoot !== undefined ? { directoryRoot } : {}),
    autonomy: parseAutonomyPolicy(raw.autonomy),
    writes: parseWritePolicy(raw.writes),
    channels: parseChannelPolicy(raw.channels),
    setup: parseSetupPolicy(raw.setup),
    ownerConfirmation: parseOwnerPolicy(raw.ownerConfirmation),
    retention,
    modules: parseModulePolicy(raw.modules),
    externalEffects: parseExternalPolicy(raw.externalEffects),
    explanations: asArray(raw.explanations, "scopePolicy.policy.explanations").map((entry, index) => {
      const e = asObject(entry, `scopePolicy.policy.explanations[${index}]`);
      return {
        area: asKnown(e.area, `scopePolicy.policy.explanations[${index}].area`, SCOPE_POLICY_AREAS),
        scopeId: asString(e.scopeId, `scopePolicy.policy.explanations[${index}].scopeId`),
        action: asKnown(
          e.action,
          `scopePolicy.policy.explanations[${index}].action`,
          SCOPE_POLICY_EXPLANATION_ACTIONS,
        ),
        message: asString(e.message, `scopePolicy.policy.explanations[${index}].message`),
      };
    }),
  };
}

function asStringArray(value: unknown, field: string): string[] {
  return asArray(value, field).map((entry, index) =>
    asString(entry, `${field}[${index}]`),
  );
}

function parseAutonomyPolicy(raw: unknown): ScopePolicyRouteResponse["policy"]["autonomy"] {
  const obj = asObject(raw, "scopePolicy.policy.autonomy");
  return {
    defaultMode: asKnown(obj.defaultMode, "scopePolicy.policy.autonomy.defaultMode", SCOPE_POLICY_AUTONOMY_MODES),
    maxMode: asKnown(obj.maxMode, "scopePolicy.policy.autonomy.maxMode", SCOPE_POLICY_AUTONOMY_MODES),
    source: parseScopePolicySource(obj.source, "scopePolicy.policy.autonomy.source"),
  };
}

function parseWritePolicy(raw: unknown): ScopePolicyRouteResponse["policy"]["writes"] {
  const obj = asObject(raw, "scopePolicy.policy.writes");
  const mode = asKnown(obj.mode, "scopePolicy.policy.writes.mode", SCOPE_POLICY_WRITE_MODES);
  const paths = mode === "paths"
    ? asStringArray(obj.paths, "scopePolicy.policy.writes.paths")
    : undefined;
  return {
    mode,
    ...(paths !== undefined ? { paths } : {}),
    source: parseScopePolicySource(obj.source, "scopePolicy.policy.writes.source"),
  };
}

function parseChannelPolicy(raw: unknown): ScopePolicyRouteResponse["policy"]["channels"] {
  const obj = asObject(raw, "scopePolicy.policy.channels");
  return {
    mode: asKnown(obj.mode, "scopePolicy.policy.channels.mode", SCOPE_POLICY_CHANNEL_MODES),
    allowedChannels: asStringArray(obj.allowedChannels, "scopePolicy.policy.channels.allowedChannels"),
    blockedSources: asStringArray(obj.blockedSources, "scopePolicy.policy.channels.blockedSources"),
    ignoredSources: asStringArray(obj.ignoredSources, "scopePolicy.policy.channels.ignoredSources"),
    source: parseScopePolicySource(obj.source, "scopePolicy.policy.channels.source"),
  };
}

function parseSetupPolicy(raw: unknown): ScopePolicyRouteResponse["policy"]["setup"] {
  const obj = asObject(raw, "scopePolicy.policy.setup");
  return {
    visibility: asKnown(obj.visibility, "scopePolicy.policy.setup.visibility", SCOPE_POLICY_SETUP_VISIBILITIES),
    source: parseScopePolicySource(obj.source, "scopePolicy.policy.setup.source"),
  };
}

function parseOwnerPolicy(raw: unknown): ScopePolicyRouteResponse["policy"]["ownerConfirmation"] {
  const obj = asObject(raw, "scopePolicy.policy.ownerConfirmation");
  return {
    localWrite: asKnown(obj.localWrite, "scopePolicy.policy.ownerConfirmation.localWrite", SCOPE_POLICY_ACTION_POLICIES),
    externalWrite: asKnown(obj.externalWrite, "scopePolicy.policy.ownerConfirmation.externalWrite", SCOPE_POLICY_ACTION_POLICIES),
    destructive: asKnown(obj.destructive, "scopePolicy.policy.ownerConfirmation.destructive", SCOPE_POLICY_ACTION_POLICIES),
    source: parseScopePolicySource(obj.source, "scopePolicy.policy.ownerConfirmation.source"),
  };
}

function parseModulePolicy(raw: unknown): ScopePolicyRouteResponse["policy"]["modules"] {
  const obj = asObject(raw, "scopePolicy.policy.modules");
  return {
    defaultAvailability: asKnown(
      obj.defaultAvailability,
      "scopePolicy.policy.modules.defaultAvailability",
      SCOPE_POLICY_MODULE_AVAILABILITIES,
    ),
    overrides: asArray(obj.overrides, "scopePolicy.policy.modules.overrides").map((entry, index) => {
      const e = asObject(entry, `scopePolicy.policy.modules.overrides[${index}]`);
      return {
        moduleName: asString(e.moduleName, `scopePolicy.policy.modules.overrides[${index}].moduleName`),
        availability: asKnown(
          e.availability,
          `scopePolicy.policy.modules.overrides[${index}].availability`,
          SCOPE_POLICY_MODULE_AVAILABILITIES,
        ),
      };
    }),
    source: parseScopePolicySource(obj.source, "scopePolicy.policy.modules.source"),
  };
}

function parseExternalPolicy(raw: unknown): ScopePolicyRouteResponse["policy"]["externalEffects"] {
  const obj = asObject(raw, "scopePolicy.policy.externalEffects");
  return {
    networkRead: asKnown(obj.networkRead, "scopePolicy.policy.externalEffects.networkRead", SCOPE_POLICY_ACTION_POLICIES),
    networkWrite: asKnown(obj.networkWrite, "scopePolicy.policy.externalEffects.networkWrite", SCOPE_POLICY_ACTION_POLICIES),
    networkDestructive: asKnown(
      obj.networkDestructive,
      "scopePolicy.policy.externalEffects.networkDestructive",
      SCOPE_POLICY_ACTION_POLICIES,
    ),
    source: parseScopePolicySource(obj.source, "scopePolicy.policy.externalEffects.source"),
  };
}

function parseScopePolicyDecision(raw: unknown, field: string): ScopePolicyDecision {
  const obj = asObject(raw, field);
  return {
    kind: asKnown(obj.kind, `${field}.kind`, SCOPE_POLICY_DECISION_KINDS),
    target: asString(obj.target, `${field}.target`),
    outcome: asKnown(obj.outcome, `${field}.outcome`, SCOPE_POLICY_DECISION_OUTCOMES),
    source: parseScopePolicySource(obj.source, `${field}.source`),
    reason: asString(obj.reason, `${field}.reason`),
    rendered: asString(obj.rendered, `${field}.rendered`),
  };
}

export type UnknownProjectError = {
  error: "Unknown project";
  reason: "unknown_project";
  projectId: string;
};

export function parseUnknownProjectError(raw: unknown): UnknownProjectError {
  const obj = asObject(raw, "unknownProjectError");
  const error = asString(obj.error, "unknownProjectError.error");
  if (error !== "Unknown project") {
    fail(`unknownProjectError.error must be "Unknown project", got ${error}`);
  }
  const reason = asString(obj.reason, "unknownProjectError.reason");
  if (reason !== "unknown_project") {
    fail(
      `unknownProjectError.reason must be "unknown_project", got ${reason}`,
    );
  }
  return {
    error,
    reason,
    projectId: asString(obj.projectId, "unknownProjectError.projectId"),
  };
}

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
const SETUP_STATES = [
  "ready",
  "missing",
  "pending",
  "expired",
  "revoked",
  "unknown",
  "unavailable",
] as const;
const SETUP_SCOPES = ["project", "global"] as const;
const SETUP_MODES = ["form", "url", "none"] as const;
const SETUP_FIELD_TYPES = ["string", "number", "boolean"] as const;
const SETUP_FIELD_VALUE_KINDS = ["secret-reference"] as const;
const SETUP_ACTION_STATES = ["pending", "completed", "revoked"] as const;

type KnownLiteral<T extends readonly string[]> = T[number];

function asKnown<T extends readonly string[]>(
  value: unknown,
  field: string,
  known: T,
): KnownLiteral<T> {
  const raw = asString(value, field);
  if (!known.includes(raw)) {
    return fail(`unknown ${field}: ${raw}`);
  }
  return raw;
}

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

// MARK: - Shared UI surfaces

const UI_PROTOCOL_VERSIONS = ["ui.surface.v1"] as const;
const UI_INTENTS = ["Status", "Inbox", "Work", "Knowledge", "Setup"] as const;
const UI_ROLES = ["neutral", "info", "success", "warn", "error", "muted"] as const;
const UI_ACTION_EFFECTS = ["read", "write", "external"] as const;
const UI_ACTION_METHODS = ["GET", "POST", "PATCH", "DELETE"] as const;
const UI_OPERATION_KINDS = ["daemon-route", "client-namespace"] as const;
const UI_CONFIRMATION_MODES = ["none", "required"] as const;
const UI_CONFIRMATION_RISKS = ["low", "medium", "high"] as const;
const UI_READINESS_STATES = ["ready", "disabled", "needs-setup"] as const;
const UI_ATTACHMENT_KINDS = ["root", "intent", "surface"] as const;
const UI_CONDITION_KINDS = ["capability", "setup", "scope"] as const;
const UI_CONDITION_STATUSES = ["ready", "unavailable", "init_failed"] as const;
const UI_PERMISSION_KINDS = ["capability-scope", "effect"] as const;
const UI_CAPABILITY_SCOPES = ["read", "control"] as const;
const UI_LINK_TARGET_KINDS = ["surface", "daemon-route", "external-url"] as const;
const UI_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
const UI_LOG_STREAM_SOURCE_KINDS = ["sse"] as const;
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
const UI_FIELD_INPUTS = ["text", "secret", "number", "boolean", "select", "path", "url"] as const;
const UI_SCHEMA_TYPES = ["string", "number", "integer", "boolean", "array", "object"] as const;
const UI_SCHEMA_FORMATS = ["secret-reference", "path", "url"] as const;

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

function parseUiJsonSchema(raw: unknown, field: string): UiJsonSchema {
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

function parseUiAttachmentPoint(raw: unknown, field: string): UiAttachmentPoint {
  const obj = asObject(raw, field);
  const kind = asKnown(obj.kind, `${field}.kind`, UI_ATTACHMENT_KINDS);
  if (kind === "root") return { kind };
  if (kind === "intent") {
    return { kind, intent: asKnown(obj.intent, `${field}.intent`, UI_INTENTS) };
  }
  return { kind, surfaceId: asString(obj.surfaceId, `${field}.surfaceId`) };
}

function parseUiCondition(raw: unknown, field: string): UiCondition {
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

function parseUiPermission(raw: unknown, field: string): UiPermission {
  const obj = asObject(raw, field);
  const kind = asKnown(obj.kind, `${field}.kind`, UI_PERMISSION_KINDS);
  if (kind === "capability-scope") {
    return { kind, scope: asKnown(obj.scope, `${field}.scope`, UI_CAPABILITY_SCOPES) };
  }
  return { kind, effect: asKnown(obj.effect, `${field}.effect`, UI_ACTION_EFFECTS) };
}

function parseOptionalUiConditions(value: unknown, field: string): UiCondition[] | undefined {
  if (value === undefined) return undefined;
  return asArray(value, field).map((entry, index) => parseUiCondition(entry, `${field}[${index}]`));
}

function parseOptionalUiPermissions(value: unknown, field: string): UiPermission[] | undefined {
  if (value === undefined) return undefined;
  return asArray(value, field).map((entry, index) => parseUiPermission(entry, `${field}[${index}]`));
}

function parseUiOperation(raw: unknown, field: string): UiActionOperation {
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

function parseUiConfirmation(raw: unknown, field: string): UiConfirmation {
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

function parseUiReadiness(raw: unknown, field: string): UiActionReadiness {
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

function parseUiFormField(raw: unknown, field: string): UiFormField {
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

function parseUiParameters(raw: unknown, field: string): UiAction["parameters"] {
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

function parseUiResult(raw: unknown, field: string): UiAction["result"] {
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

function parseUiAction(raw: unknown, field: string): UiAction {
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

function parseUiListItem(raw: unknown, field: string): UiListItem {
  const obj = asObject(raw, field);
  return {
    id: asString(obj.id, `${field}.id`),
    title: asString(obj.title, `${field}.title`),
    detail: asString(obj.detail, `${field}.detail`),
    role: asKnown(obj.role, `${field}.role`, UI_ROLES),
    action: obj.action === undefined ? undefined : parseUiAction(obj.action, `${field}.action`),
  };
}

function parseUiLinkTarget(raw: unknown, field: string): UiLinkTarget {
  const obj = asObject(raw, field);
  const kind = asKnown(obj.kind, `${field}.kind`, UI_LINK_TARGET_KINDS);
  if (kind === "surface") {
    return { kind, surfaceId: asString(obj.surfaceId, `${field}.surfaceId`) };
  }
  if (kind === "daemon-route") {
    return { kind, path: asString(obj.path, `${field}.path`) };
  }
  return { kind, url: asString(obj.url, `${field}.url`) };
}

function parseUiTab(raw: unknown, field: string): UiTab {
  const obj = asObject(raw, field);
  return {
    id: asString(obj.id, `${field}.id`),
    label: asString(obj.label, `${field}.label`),
    nodes: asArray(obj.nodes, `${field}.nodes`).map((entry, index) =>
      parseUiNode(entry, `${field}.nodes[${index}]`)
    ),
  };
}

function parseUiLogEntry(raw: unknown, field: string): UiLogEntry {
  const obj = asObject(raw, field);
  return {
    timestamp: asString(obj.timestamp, `${field}.timestamp`),
    level: asKnown(obj.level, `${field}.level`, UI_LOG_LEVELS),
    message: asString(obj.message, `${field}.message`),
    source: asOptionalString(obj.source, `${field}.source`),
  };
}

function parseUiLogStreamSource(raw: unknown, field: string): UiLogStreamSource {
  const obj = asObject(raw, field);
  return {
    kind: asKnown(obj.kind, `${field}.kind`, UI_LOG_STREAM_SOURCE_KINDS),
    path: asString(obj.path, `${field}.path`),
    eventTypes: asArray(obj.eventTypes, `${field}.eventTypes`).map((entry, index) =>
      asString(entry, `${field}.eventTypes[${index}]`)
    ),
  };
}

function parseUiNode(raw: unknown, field: string): UiNode {
  const obj = asObject(raw, field);
  const kind = asKnown(obj.kind, `${field}.kind`, UI_NODE_KINDS);
  switch (kind) {
    case "navigation":
      return {
        kind,
        label: asString(obj.label, `${field}.label`),
        items: asArray(obj.items, `${field}.items`).map((entry, index) => {
          const item = asObject(entry, `${field}.items[${index}]`);
          return {
            surfaceId: asString(item.surfaceId, `${field}.items[${index}].surfaceId`),
            label: asString(item.label, `${field}.items[${index}].label`),
          };
        }),
      };
    case "status-summary":
      return {
        kind,
        entries: asArray(obj.entries, `${field}.entries`).map((entry, index) => {
          const item = asObject(entry, `${field}.entries[${index}]`);
          return {
            label: asString(item.label, `${field}.entries[${index}].label`),
            value: asString(item.value, `${field}.entries[${index}].value`),
            role: asKnown(item.role, `${field}.entries[${index}].role`, UI_ROLES),
          };
        }),
      };
    case "metrics":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        metrics: asArray(obj.metrics, `${field}.metrics`).map((entry, index) => {
          const item = asObject(entry, `${field}.metrics[${index}]`);
          return {
            label: asString(item.label, `${field}.metrics[${index}].label`),
            value: asString(item.value, `${field}.metrics[${index}].value`),
            unit: asOptionalString(item.unit, `${field}.metrics[${index}].unit`),
            role: asKnown(item.role, `${field}.metrics[${index}].role`, UI_ROLES),
          };
        }),
      };
    case "text":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        body: asString(obj.body, `${field}.body`),
        role: obj.role === undefined ? undefined : asKnown(obj.role, `${field}.role`, UI_ROLES),
      };
    case "link":
      return {
        kind,
        label: asString(obj.label, `${field}.label`),
        target: parseUiLinkTarget(obj.target, `${field}.target`),
        role: obj.role === undefined ? undefined : asKnown(obj.role, `${field}.role`, UI_ROLES),
      };
    case "tabs":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        activeTabId: asString(obj.activeTabId, `${field}.activeTabId`),
        tabs: asArray(obj.tabs, `${field}.tabs`).map((entry, index) =>
          parseUiTab(entry, `${field}.tabs[${index}]`)
        ),
      };
    case "list":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        items: asArray(obj.items, `${field}.items`).map((entry, index) =>
          parseUiListItem(entry, `${field}.items[${index}]`)
        ),
      };
    case "table":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        columns: asArray(obj.columns, `${field}.columns`).map((entry, index) => {
          const item = asObject(entry, `${field}.columns[${index}]`);
          return {
            id: asString(item.id, `${field}.columns[${index}].id`),
            label: asString(item.label, `${field}.columns[${index}].label`),
            role: item.role === undefined ? undefined : asKnown(item.role, `${field}.columns[${index}].role`, UI_ROLES),
          };
        }),
        rows: asArray(obj.rows, `${field}.rows`).map((entry, index) => {
          const row = asObject(entry, `${field}.rows[${index}]`);
          return {
            id: asString(row.id, `${field}.rows[${index}].id`),
            cells: asArray(row.cells, `${field}.rows[${index}].cells`).map((cellEntry, cellIndex) => {
              const cell = asObject(cellEntry, `${field}.rows[${index}].cells[${cellIndex}]`);
              return {
                columnId: asString(cell.columnId, `${field}.rows[${index}].cells[${cellIndex}].columnId`),
                value: asString(cell.value, `${field}.rows[${index}].cells[${cellIndex}].value`),
                role: cell.role === undefined
                  ? undefined
                  : asKnown(cell.role, `${field}.rows[${index}].cells[${cellIndex}].role`, UI_ROLES),
              };
            }),
            action: row.action === undefined ? undefined : parseUiAction(row.action, `${field}.rows[${index}].action`),
          };
        }),
      };
    case "detail":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        body: asString(obj.body, `${field}.body`),
      };
    case "progress":
      return {
        kind,
        label: asString(obj.label, `${field}.label`),
        value: asNumber(obj.value, `${field}.value`),
        max: asNumber(obj.max, `${field}.max`),
        role: asKnown(obj.role, `${field}.role`, UI_ROLES),
      };
    case "log":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        entries: asArray(obj.entries, `${field}.entries`).map((entry, index) =>
          parseUiLogEntry(entry, `${field}.entries[${index}]`)
        ),
      };
    case "log-stream":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        streamId: asString(obj.streamId, `${field}.streamId`),
        source: parseUiLogStreamSource(obj.source, `${field}.source`),
        entries: asArray(obj.entries, `${field}.entries`).map((entry, index) =>
          parseUiLogEntry(entry, `${field}.entries[${index}]`)
        ),
      };
    case "form":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        fields: asArray(obj.fields, `${field}.fields`).map((entry, index) =>
          parseUiFormField(entry, `${field}.fields[${index}]`)
        ),
        submit: parseUiAction(obj.submit, `${field}.submit`),
      };
    case "action-list":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        actions: asArray(obj.actions, `${field}.actions`).map((entry, index) =>
          parseUiAction(entry, `${field}.actions[${index}]`)
        ),
      };
    case "command":
      return {
        kind,
        action: parseUiAction(obj.action, `${field}.action`),
      };
    case "empty":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        detail: asString(obj.detail, `${field}.detail`),
        action: parseUiAction(obj.action, `${field}.action`),
      };
    case "error":
      return {
        kind,
        title: asString(obj.title, `${field}.title`),
        detail: asString(obj.detail, `${field}.detail`),
        action: parseUiAction(obj.action, `${field}.action`),
      };
  }
}

function parseUiSurface(raw: unknown, field: string): UiSurface {
  const obj = asObject(raw, field);
  return {
    protocolVersion: asKnown(obj.protocolVersion, `${field}.protocolVersion`, UI_PROTOCOL_VERSIONS),
    surfaceId: asString(obj.surfaceId, `${field}.surfaceId`),
    extensionId: asString(obj.extensionId, `${field}.extensionId`),
    title: asString(obj.title, `${field}.title`),
    intent: asKnown(obj.intent, `${field}.intent`, UI_INTENTS),
    scopeId: asString(obj.scopeId, `${field}.scopeId`),
    attachmentPoint: parseUiAttachmentPoint(obj.attachmentPoint, `${field}.attachmentPoint`),
    order: asNumber(obj.order, `${field}.order`),
    conditions: parseOptionalUiConditions(obj.conditions, `${field}.conditions`),
    permissions: parseOptionalUiPermissions(obj.permissions, `${field}.permissions`),
    nodes: asArray(obj.nodes, `${field}.nodes`).map((entry, index) =>
      parseUiNode(entry, `${field}.nodes[${index}]`)
    ),
    actions: asArray(obj.actions, `${field}.actions`).map((entry, index) =>
      parseUiAction(entry, `${field}.actions[${index}]`)
    ),
  };
}

export function parseUiSurfaceBundle(raw: unknown): UiSurfaceBundle {
  const obj = asObject(raw, "uiSurfaces");
  return {
    protocolVersion: asKnown(obj.protocolVersion, "uiSurfaces.protocolVersion", UI_PROTOCOL_VERSIONS),
    surfaces: asArray(obj.surfaces, "uiSurfaces.surfaces").map((entry, index) =>
      parseUiSurface(entry, `uiSurfaces.surfaces[${index}]`)
    ),
  };
}

// MARK: - Recall

export type RecallSource =
  | "knowledge"
  | "memory"
  | "history"
  | "tasks"
  | "answer";

export type RecallKnowledgeHit = {
  source: "knowledge";
  score: number;
  id: string;
  title: string;
  preview: string;
  updated: string;
};

export type RecallMemoryHit = {
  source: "memory";
  score: number;
  id: string;
  preview: string;
  created: string;
};

export type RecallHistoryHit = {
  source: "history";
  score: number;
  id: string;
  title: string;
  cwd: string;
  updatedAt: string;
};

export type RecallTasksHit = {
  source: "tasks";
  score: number;
  id: string;
  title: string;
  state: string;
  priority: string;
  updatedAt: string;
};

export type RecallAnswerHitResult =
  | { ok: true }
  | {
      ok: false;
      reason: "no_hits" | "semantic_unavailable" | "synthesis_failed";
    };

export type RecallAnswerHit = {
  source: "answer";
  score: number;
  id: string;
  query: string;
  preview: string;
  citationCount: number;
  createdAt: string;
  result: RecallAnswerHitResult;
};

export type RecallHit =
  | RecallKnowledgeHit
  | RecallMemoryHit
  | RecallHistoryHit
  | RecallTasksHit
  | RecallAnswerHit;

export type RecallResult =
  | { ok: true; hits: RecallHit[] }
  | { ok: false; reason: "semantic_unavailable" };

function parseRecallAnswerHitResult(raw: unknown): RecallAnswerHitResult {
  const obj = asObject(raw, "recallHit[answer].result");
  const ok = asBool(obj.ok, "recallHit[answer].result.ok");
  if (ok) return { ok: true };
  const reason = asString(obj.reason, "recallHit[answer].result.reason");
  if (
    reason === "no_hits" ||
    reason === "semantic_unavailable" ||
    reason === "synthesis_failed"
  ) {
    return { ok: false, reason };
  }
  return fail(`unknown recall answer-hit result reason: ${reason}`);
}

export function parseRecallHit(raw: unknown): RecallHit {
  const obj = asObject(raw, "recallHit");
  const source = asString(obj.source, "recallHit.source");
  const score = asNumber(obj.score, "recallHit.score");
  const id = asString(obj.id, "recallHit.id");
  switch (source) {
    case "knowledge":
      return {
        source: "knowledge",
        score,
        id,
        title: asString(obj.title, "recallHit[knowledge].title"),
        preview: asString(obj.preview, "recallHit[knowledge].preview"),
        updated: asString(obj.updated, "recallHit[knowledge].updated"),
      };
    case "memory":
      return {
        source: "memory",
        score,
        id,
        preview: asString(obj.preview, "recallHit[memory].preview"),
        created: asString(obj.created, "recallHit[memory].created"),
      };
    case "history":
      return {
        source: "history",
        score,
        id,
        title: asString(obj.title, "recallHit[history].title"),
        cwd: asString(obj.cwd, "recallHit[history].cwd"),
        updatedAt: asString(obj.updatedAt, "recallHit[history].updatedAt"),
      };
    case "tasks":
      return {
        source: "tasks",
        score,
        id,
        title: asString(obj.title, "recallHit[tasks].title"),
        state: asString(obj.state, "recallHit[tasks].state"),
        priority: asString(obj.priority, "recallHit[tasks].priority"),
        updatedAt: asString(obj.updatedAt, "recallHit[tasks].updatedAt"),
      };
    case "answer":
      return {
        source: "answer",
        score,
        id,
        query: asString(obj.query, "recallHit[answer].query"),
        preview: asString(obj.preview, "recallHit[answer].preview"),
        citationCount: asInt(
          obj.citationCount,
          "recallHit[answer].citationCount",
        ),
        createdAt: asString(obj.createdAt, "recallHit[answer].createdAt"),
        result: parseRecallAnswerHitResult(obj.result),
      };
    default:
      return fail(`unknown recall hit source: ${source}`);
  }
}

export function parseRecallResult(raw: unknown): RecallResult {
  const obj = asObject(raw, "recall");
  const ok = asBool(obj.ok, "recall.ok");
  if (ok) {
    const hits = asArray(obj.hits, "recall.hits").map(parseRecallHit);
    return { ok: true, hits };
  }
  const reason = asString(obj.reason, "recall.reason");
  if (reason === "semantic_unavailable") return { ok: false, reason };
  return fail(`unknown recall reason: ${reason}`);
}

// MARK: - Answer

export type AnswerCitation = { source: RecallSource; id: string };

export type AnswerResult =
  | {
      ok: true;
      answer: string;
      citations: AnswerCitation[];
      hits: RecallHit[];
    }
  | {
      ok: false;
      reason: "no_hits" | "semantic_unavailable" | "synthesis_failed";
    };

function parseAnswerCitation(raw: unknown): AnswerCitation {
  const obj = asObject(raw, "answerCitation");
  const source = asString(obj.source, "answerCitation.source");
  if (
    source !== "knowledge" &&
    source !== "memory" &&
    source !== "history" &&
    source !== "tasks" &&
    source !== "answer"
  ) {
    return fail(`unknown answer citation source: ${source}`);
  }
  return { source, id: asString(obj.id, "answerCitation.id") };
}

export function parseAnswerResult(raw: unknown): AnswerResult {
  const obj = asObject(raw, "answer");
  const ok = asBool(obj.ok, "answer.ok");
  if (ok) {
    return {
      ok: true,
      answer: asString(obj.answer, "answer.answer"),
      citations: asArray(obj.citations, "answer.citations").map(
        parseAnswerCitation,
      ),
      hits: asArray(obj.hits, "answer.hits").map(parseRecallHit),
    };
  }
  const reason = asString(obj.reason, "answer.reason");
  if (
    reason === "no_hits" ||
    reason === "semantic_unavailable" ||
    reason === "synthesis_failed"
  ) {
    return { ok: false, reason };
  }
  return fail(`unknown answer reason: ${reason}`);
}

// MARK: - Answer history

export type AnswerHistoryEntryResult =
  | { ok: true; citationCount: number }
  | { ok: false; reason: "no_hits" | "semantic_unavailable" | "synthesis_failed" };

export type AnswerHistoryEntry = {
  id: string;
  createdAt: string;
  query: string;
  result: AnswerHistoryEntryResult;
};

function parseAnswerHistoryEntryResult(raw: unknown): AnswerHistoryEntryResult {
  const obj = asObject(raw, "answerHistoryEntry.result");
  const ok = asBool(obj.ok, "answerHistoryEntry.result.ok");
  if (ok) {
    return {
      ok: true,
      citationCount: asInt(
        obj.citationCount,
        "answerHistoryEntry.result.citationCount",
      ),
    };
  }
  const reason = asString(obj.reason, "answerHistoryEntry.result.reason");
  if (
    reason === "no_hits" ||
    reason === "semantic_unavailable" ||
    reason === "synthesis_failed"
  ) {
    return { ok: false, reason };
  }
  return fail(`unknown answer history entry reason: ${reason}`);
}

export type AnswerHistoryListResult = { entries: AnswerHistoryEntry[] };

export function parseAnswerHistoryListResult(
  raw: unknown,
): AnswerHistoryListResult {
  const obj = asObject(raw, "answerHistoryList");
  return {
    entries: asArray(obj.entries, "answerHistoryList.entries").map((entry) => {
      const e = asObject(entry, "answerHistoryEntry");
      return {
        id: asString(e.id, "answerHistoryEntry.id"),
        createdAt: asString(e.createdAt, "answerHistoryEntry.createdAt"),
        query: asString(e.query, "answerHistoryEntry.query"),
        result: parseAnswerHistoryEntryResult(e.result),
      };
    }),
  };
}

export type AnswerHistoryRecord = {
  id: string;
  createdAt: string;
  query: string;
  filter: {
    topK?: number;
    minScore?: number;
    sources?: string[];
  };
  recallHits: RecallHit[];
  result: AnswerResult;
};

export type AnswerHistoryShowResult =
  | { ok: true; record: AnswerHistoryRecord }
  | { ok: false; reason: "not_found" };

export function parseAnswerHistoryShowResult(
  raw: unknown,
): AnswerHistoryShowResult {
  const obj = asObject(raw, "answerHistoryShow");
  const ok = asBool(obj.ok, "answerHistoryShow.ok");
  if (ok) {
    const record = asObject(obj.record, "answerHistoryShow.record");
    const filter = asObject(record.filter, "answerHistoryShow.record.filter");
    return {
      ok: true,
      record: {
        id: asString(record.id, "record.id"),
        createdAt: asString(record.createdAt, "record.createdAt"),
        query: asString(record.query, "record.query"),
        filter: {
          topK: asOptionalInt(filter.topK, "filter.topK"),
          minScore: asOptionalNumber(filter.minScore, "filter.minScore"),
          sources: asOptionalStringArray(filter.sources, "filter.sources"),
        },
        recallHits: asArray(record.recallHits, "record.recallHits").map(
          parseRecallHit,
        ),
        result: parseAnswerResult(record.result),
      },
    };
  }
  const reason = asString(obj.reason, "answerHistoryShow.reason");
  if (reason === "not_found") return { ok: false, reason };
  return fail(`unknown answer history show reason: ${reason}`);
}

// MARK: - Capture

export type CaptureTarget = "memory" | "knowledge" | "tasks" | "inbox";

export type CaptureRecord =
  | { target: "memory"; recordId: string }
  | { target: "knowledge"; recordId: string }
  | { target: "tasks"; recordId: string; path: string }
  | { target: "inbox"; recordId: string; path: string };

function parseCaptureTarget(raw: unknown, field: string): CaptureTarget {
  const value = asString(raw, field);
  if (
    value === "memory" ||
    value === "knowledge" ||
    value === "tasks" ||
    value === "inbox"
  ) {
    return value;
  }
  return fail(`unknown capture target: ${value}`);
}

function parseCaptureRecord(raw: unknown): CaptureRecord {
  const obj = asObject(raw, "captureRecord");
  const target = parseCaptureTarget(obj.target, "captureRecord.target");
  const recordId = asString(obj.recordId, "captureRecord.recordId");
  switch (target) {
    case "memory":
    case "knowledge":
      return { target, recordId };
    case "tasks":
    case "inbox":
      return {
        target,
        recordId,
        path: asString(obj.path, `captureRecord[${target}].path`),
      };
  }
}

export type CaptureResult =
  | { ok: true; record: CaptureRecord }
  | { ok: false; reason: "ambiguous"; suggestions: CaptureTarget[] }
  | { ok: false; reason: "no_contributors" }
  | {
      ok: false;
      reason: "contributor_failed";
      target: CaptureTarget;
      message: string;
    };

export function parseCaptureResult(raw: unknown): CaptureResult {
  const obj = asObject(raw, "capture");
  const ok = asBool(obj.ok, "capture.ok");
  if (ok) {
    return { ok: true, record: parseCaptureRecord(obj.record) };
  }
  const reason = asString(obj.reason, "capture.reason");
  switch (reason) {
    case "ambiguous": {
      const suggestions = asArray(obj.suggestions, "capture.suggestions").map(
        (entry, index) =>
          parseCaptureTarget(entry, `capture.suggestions[${index}]`),
      );
      return { ok: false, reason, suggestions };
    }
    case "no_contributors":
      return { ok: false, reason };
    case "contributor_failed":
      return {
        ok: false,
        reason,
        target: parseCaptureTarget(obj.target, "capture.target"),
        message: asString(obj.message, "capture.message"),
      };
    default:
      return fail(`unknown capture reason: ${reason}`);
  }
}

// MARK: - Retract

export type RetractTarget = "memory" | "knowledge" | "tasks" | "inbox";

export type RetractRecord =
  | { target: "memory"; recordId: string }
  | { target: "knowledge"; recordId: string }
  | {
      target: "tasks";
      recordId: string;
      previousPath: string;
      path: string;
      toState: "dropped";
    }
  | { target: "inbox"; recordId: string; path: string };

function parseRetractTarget(raw: unknown, field: string): RetractTarget {
  const value = asString(raw, field);
  if (
    value === "memory" ||
    value === "knowledge" ||
    value === "tasks" ||
    value === "inbox"
  ) {
    return value;
  }
  return fail(`unknown retract target: ${value}`);
}

function parseRetractRecord(raw: unknown): RetractRecord {
  const obj = asObject(raw, "retractRecord");
  const target = parseRetractTarget(obj.target, "retractRecord.target");
  const recordId = asString(obj.recordId, "retractRecord.recordId");
  switch (target) {
    case "memory":
    case "knowledge":
      return { target, recordId };
    case "tasks": {
      const toState = asString(obj.toState, "retractRecord[tasks].toState");
      if (toState !== "dropped") {
        return fail(`unknown retract task toState: ${toState}`);
      }
      return {
        target,
        recordId,
        previousPath: asString(
          obj.previousPath,
          "retractRecord[tasks].previousPath",
        ),
        path: asString(obj.path, "retractRecord[tasks].path"),
        toState,
      };
    }
    case "inbox":
      return {
        target,
        recordId,
        path: asString(obj.path, "retractRecord[inbox].path"),
      };
  }
}

export type RetractResult =
  | { ok: true; record: RetractRecord }
  | { ok: false; reason: "no_contributors" }
  | {
      ok: false;
      reason: "not_found";
      target: RetractTarget;
      identifier: string;
    }
  | {
      ok: false;
      reason: "contributor_failed";
      target: RetractTarget;
      message: string;
    };

export function parseRetractResult(raw: unknown): RetractResult {
  const obj = asObject(raw, "retract");
  const ok = asBool(obj.ok, "retract.ok");
  if (ok) {
    return { ok: true, record: parseRetractRecord(obj.record) };
  }
  const reason = asString(obj.reason, "retract.reason");
  switch (reason) {
    case "no_contributors":
      return { ok: false, reason };
    case "not_found":
      return {
        ok: false,
        reason,
        target: parseRetractTarget(obj.target, "retract.target"),
        identifier: asString(obj.identifier, "retract.identifier"),
      };
    case "contributor_failed":
      return {
        ok: false,
        reason,
        target: parseRetractTarget(obj.target, "retract.target"),
        message: asString(obj.message, "retract.message"),
      };
    default:
      return fail(`unknown retract reason: ${reason}`);
  }
}

// MARK: - Per-store semantic search

export type KnowledgeEntry = {
  id: string;
  type: string;
  status: string;
  title: string;
};

export type KnowledgeSearchResponse =
  | { ok: true; entries: KnowledgeEntry[] }
  | { ok: false; reason: "semantic_unavailable" };

export function parseKnowledgeSearchResponse(
  raw: unknown,
): KnowledgeSearchResponse {
  const obj = asObject(raw, "knowledgeSearch");
  const ok = asBool(obj.ok, "knowledgeSearch.ok");
  if (ok) {
    const entries = asArray(obj.entries, "knowledgeSearch.entries").map(
      (entry) => {
        const e = asObject(entry, "knowledgeEntry");
        return {
          id: asString(e.id, "knowledgeEntry.id"),
          type: asString(e.type, "knowledgeEntry.type"),
          status: asString(e.status, "knowledgeEntry.status"),
          title: asString(e.title, "knowledgeEntry.title"),
        };
      },
    );
    return { ok: true, entries };
  }
  const reason = asString(obj.reason, "knowledgeSearch.reason");
  if (reason === "semantic_unavailable") return { ok: false, reason };
  return fail(`unknown knowledge search reason: ${reason}`);
}

export type MemoryEntry = { id: string; created: string; content: string };

export type MemorySearchResponse =
  | { ok: true; entries: MemoryEntry[] }
  | { ok: false; reason: "semantic_unavailable" };

export function parseMemorySearchResponse(
  raw: unknown,
): MemorySearchResponse {
  const obj = asObject(raw, "memorySearch");
  const ok = asBool(obj.ok, "memorySearch.ok");
  if (ok) {
    const entries = asArray(obj.entries, "memorySearch.entries").map(
      (entry) => {
        const e = asObject(entry, "memoryEntry");
        return {
          id: asString(e.id, "memoryEntry.id"),
          created: asString(e.created, "memoryEntry.created"),
          content: asString(e.content, "memoryEntry.content"),
        };
      },
    );
    return { ok: true, entries };
  }
  const reason = asString(obj.reason, "memorySearch.reason");
  if (reason === "semantic_unavailable") return { ok: false, reason };
  return fail(`unknown memory search reason: ${reason}`);
}

export type ConversationRecord = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  messageCount: number;
  cwd: string;
  source?: "user" | "action";
};

export type HistorySearchResponse =
  | { ok: true; conversations: ConversationRecord[] }
  | { ok: false; reason: "semantic_unavailable" };

export function parseHistorySearchResponse(
  raw: unknown,
): HistorySearchResponse {
  const obj = asObject(raw, "historySearch");
  const ok = asBool(obj.ok, "historySearch.ok");
  if (ok) {
    const conversations = asArray(
      obj.conversations,
      "historySearch.conversations",
    ).map((entry) => {
      const c = asObject(entry, "conversationRecord");
      let source: "user" | "action" | undefined;
      if (c.source !== undefined) {
        const s = asString(c.source, "conversationRecord.source");
        if (s !== "user" && s !== "action") {
          fail(`unknown conversation source: ${s}`);
        }
        source = s;
      }
      return {
        id: asString(c.id, "conversationRecord.id"),
        title: asString(c.title, "conversationRecord.title"),
        createdAt: asString(c.createdAt, "conversationRecord.createdAt"),
        updatedAt: asString(c.updatedAt, "conversationRecord.updatedAt"),
        model: asString(c.model, "conversationRecord.model"),
        messageCount: asInt(
          c.messageCount,
          "conversationRecord.messageCount",
        ),
        cwd: asString(c.cwd, "conversationRecord.cwd"),
        source,
      };
    });
    return { ok: true, conversations };
  }
  const reason = asString(obj.reason, "historySearch.reason");
  if (reason === "semantic_unavailable") return { ok: false, reason };
  return fail(`unknown history search reason: ${reason}`);
}

export type RepoTaskSearchHit = {
  id: string;
  title: string;
  state: string;
  priority: string;
  area: string;
  summary: string;
  updatedAt: string;
  score: number;
};

export type TasksSearchResponse =
  | { ok: true; tasks: RepoTaskSearchHit[] }
  | { ok: false; reason: "semantic_unavailable" };

export function parseTasksSearchResponse(raw: unknown): TasksSearchResponse {
  const obj = asObject(raw, "tasksSearch");
  const ok = asBool(obj.ok, "tasksSearch.ok");
  if (ok) {
    const tasks = asArray(obj.tasks, "tasksSearch.tasks").map((entry) => {
      const t = asObject(entry, "repoTaskSearchHit");
      return {
        id: asString(t.id, "repoTaskSearchHit.id"),
        title: asString(t.title, "repoTaskSearchHit.title"),
        state: asString(t.state, "repoTaskSearchHit.state"),
        priority: asString(t.priority, "repoTaskSearchHit.priority"),
        area: asString(t.area, "repoTaskSearchHit.area"),
        summary: asString(t.summary, "repoTaskSearchHit.summary"),
        updatedAt: asString(t.updatedAt, "repoTaskSearchHit.updatedAt"),
        score: asNumber(t.score, "repoTaskSearchHit.score"),
      };
    });
    return { ok: true, tasks };
  }
  const reason = asString(obj.reason, "tasksSearch.reason");
  if (reason === "semantic_unavailable") return { ok: false, reason };
  return fail(`unknown tasks search reason: ${reason}`);
}

// MARK: - Attention

export type AttentionItem = { label: string; detail: string };

export type AttentionResponse = {
  data: { items: AttentionItem[] };
  text: string;
};

export function parseAttentionResponse(raw: unknown): AttentionResponse {
  const obj = asObject(raw, "attention");
  const data = asObject(obj.data, "attention.data");
  const items = asArray(data.items, "attention.data.items").map((entry) => {
    const e = asObject(entry, "attentionItem");
    return {
      label: asString(e.label, "attentionItem.label"),
      detail: asString(e.detail, "attentionItem.detail"),
    };
  });
  return {
    data: { items },
    text: asString(obj.text, "attention.text"),
  };
}

// MARK: - Digest

export type DigestQueueCounts = {
  backlog: number;
  ready: number;
  doing: number;
  blocked: number;
};

export type DigestQueueDelta = {
  current: DigestQueueCounts;
  previous: DigestQueueCounts | null;
  delta: { backlog: number | null; ready: number | null; doing: number | null; blocked: number | null };
};

function parseDigestQueueCounts(raw: unknown, field: string): DigestQueueCounts {
  const o = asObject(raw, field);
  return {
    backlog: asInt(o.backlog, `${field}.backlog`),
    ready: asInt(o.ready, `${field}.ready`),
    doing: asInt(o.doing, `${field}.doing`),
    blocked: asInt(o.blocked, `${field}.blocked`),
  };
}

function parseDigestQueueDelta(raw: unknown): DigestQueueDelta {
  const o = asObject(raw, "digest.data.queueDelta");
  const current = parseDigestQueueCounts(o.current, "queueDelta.current");
  const previousRaw = o.previous;
  const previous = previousRaw === null
    ? null
    : parseDigestQueueCounts(previousRaw, "queueDelta.previous");
  const deltaObj = asObject(o.delta, "queueDelta.delta");
  const readField = (key: keyof DigestQueueCounts): number | null => {
    const v = deltaObj[key];
    if (v === null) return null;
    return asInt(v, `queueDelta.delta.${key}`);
  };
  return {
    current,
    previous,
    delta: {
      backlog: readField("backlog"),
      ready: readField("ready"),
      doing: readField("doing"),
      blocked: readField("blocked"),
    },
  };
}

export type DigestData = {
  windowStartedAt: string;
  windowEndedAt: string;
  builderCommits: Array<{
    runId: string;
    taskId: string | null;
    taskTitle: string | null;
    commitSubject: string;
    durationMs: number | null;
  }>;
  explorerAdditions: Array<{
    runId: string;
    taskCount: number;
    watchlistAdds: number;
  }>;
  decomposerSplits: Array<{
    runId: string;
    parentTaskId: string | null;
    childTaskCount: number;
  }>;
  blockedPromoterMoves: Array<{
    runId: string;
    promotedTaskIds: string[];
    toReady: string[];
    toBacklog: string[];
  }>;
  failedMonitoredRuns: Array<{
    runId: string;
    workflow: string;
    status: "failed" | "interrupted";
    startedAt: string;
  }>;
  pendingOwnerQuestions: Array<{
    id: string;
    question: string;
    source: string;
    ageDays: number;
  }>;
  agingOperatorCaptures: Array<{
    taskId: string;
    ageDays: number;
    path: string;
  }>;
  queueDelta: DigestQueueDelta;
  quiet: boolean;
};

export type DigestResponse = { data: DigestData; text: string };

export function parseDigestResponse(raw: unknown): DigestResponse {
  const top = asObject(raw, "digest");
  const data = asObject(top.data, "digest.data");
  const builderCommits = asArray(
    data.builderCommits,
    "digest.data.builderCommits",
  ).map((entry) => {
    const e = asObject(entry, "builderCommit");
    return {
      runId: asString(e.runId, "builderCommit.runId"),
      taskId: e.taskId === null ? null : asString(e.taskId, "builderCommit.taskId"),
      taskTitle:
        e.taskTitle === null ? null : asString(e.taskTitle, "builderCommit.taskTitle"),
      commitSubject: asString(e.commitSubject, "builderCommit.commitSubject"),
      durationMs:
        e.durationMs === null
          ? null
          : asInt(e.durationMs, "builderCommit.durationMs"),
    };
  });
  const explorerAdditions = asArray(
    data.explorerAdditions,
    "digest.data.explorerAdditions",
  ).map((entry) => {
    const e = asObject(entry, "explorerAddition");
    return {
      runId: asString(e.runId, "explorerAddition.runId"),
      taskCount: asInt(e.taskCount, "explorerAddition.taskCount"),
      watchlistAdds: asInt(e.watchlistAdds, "explorerAddition.watchlistAdds"),
    };
  });
  const decomposerSplits = asArray(
    data.decomposerSplits,
    "digest.data.decomposerSplits",
  ).map((entry) => {
    const e = asObject(entry, "decomposerSplit");
    return {
      runId: asString(e.runId, "decomposerSplit.runId"),
      parentTaskId:
        e.parentTaskId === null
          ? null
          : asString(e.parentTaskId, "decomposerSplit.parentTaskId"),
      childTaskCount: asInt(
        e.childTaskCount,
        "decomposerSplit.childTaskCount",
      ),
    };
  });
  const blockedPromoterMoves = asArray(
    data.blockedPromoterMoves,
    "digest.data.blockedPromoterMoves",
  ).map((entry) => {
    const e = asObject(entry, "blockedPromoterMove");
    return {
      runId: asString(e.runId, "blockedPromoterMove.runId"),
      promotedTaskIds: asArray(
        e.promotedTaskIds,
        "blockedPromoterMove.promotedTaskIds",
      ).map((s, i) =>
        asString(s, `blockedPromoterMove.promotedTaskIds[${i}]`),
      ),
      toReady: asArray(e.toReady, "blockedPromoterMove.toReady").map((s, i) =>
        asString(s, `blockedPromoterMove.toReady[${i}]`),
      ),
      toBacklog: asArray(
        e.toBacklog,
        "blockedPromoterMove.toBacklog",
      ).map((s, i) => asString(s, `blockedPromoterMove.toBacklog[${i}]`)),
    };
  });
  const failedMonitoredRuns = asArray(
    data.failedMonitoredRuns,
    "digest.data.failedMonitoredRuns",
  ).map((entry): {
    runId: string;
    workflow: string;
    status: "failed" | "interrupted";
    startedAt: string;
  } => {
    const e = asObject(entry, "failedMonitoredRun");
    const status = asString(e.status, "failedMonitoredRun.status");
    if (status !== "failed" && status !== "interrupted") {
      return fail(`unknown failed-run status: ${status}`);
    }
    return {
      runId: asString(e.runId, "failedMonitoredRun.runId"),
      workflow: asString(e.workflow, "failedMonitoredRun.workflow"),
      status,
      startedAt: asString(e.startedAt, "failedMonitoredRun.startedAt"),
    };
  });
  const pendingOwnerQuestions = asArray(
    data.pendingOwnerQuestions,
    "digest.data.pendingOwnerQuestions",
  ).map((entry) => {
    const e = asObject(entry, "pendingOwnerQuestion");
    return {
      id: asString(e.id, "pendingOwnerQuestion.id"),
      question: asString(e.question, "pendingOwnerQuestion.question"),
      source: asString(e.source, "pendingOwnerQuestion.source"),
      ageDays: asInt(e.ageDays, "pendingOwnerQuestion.ageDays"),
    };
  });
  const agingOperatorCaptures = asArray(
    data.agingOperatorCaptures,
    "digest.data.agingOperatorCaptures",
  ).map((entry) => {
    const e = asObject(entry, "agingOperatorCapture");
    return {
      taskId: asString(e.taskId, "agingOperatorCapture.taskId"),
      ageDays: asInt(e.ageDays, "agingOperatorCapture.ageDays"),
      path: asString(e.path, "agingOperatorCapture.path"),
    };
  });
  return {
    data: {
      windowStartedAt: asString(
        data.windowStartedAt,
        "digest.data.windowStartedAt",
      ),
      windowEndedAt: asString(data.windowEndedAt, "digest.data.windowEndedAt"),
      builderCommits,
      explorerAdditions,
      decomposerSplits,
      blockedPromoterMoves,
      failedMonitoredRuns,
      pendingOwnerQuestions,
      agingOperatorCaptures,
      queueDelta: parseDigestQueueDelta(data.queueDelta),
      quiet: asBool(data.quiet, "digest.data.quiet"),
    },
    text: asString(top.text, "digest.text"),
  };
}

// MARK: - Voice failure envelopes
//
// The voice success surfaces (`POST /voice/transcribe` with audio attached;
// the synthesize route returning audio bytes) carry binary payloads outside
// the JSON contract — only the failure envelopes are exercised here.

export type VoiceFailure = {
  ok: false;
  status: number;
  error: string;
  code: string;
  supported?: string[];
};

export type VoiceTranscribeSuccess = {
  ok: true;
  text: string;
  language?: string;
};

export type VoiceTranscribeResult = VoiceTranscribeSuccess | VoiceFailure;

export function parseVoiceTranscribeResult(raw: unknown): VoiceTranscribeResult {
  const obj = asObject(raw, "voice");
  const ok = asBool(obj.ok, "voice.ok");
  if (ok) {
    return {
      ok: true,
      text: asString(obj.text, "voice.text"),
      language: asOptionalString(obj.language, "voice.language"),
    };
  }
  return parseVoiceFailure(obj);
}

export function parseVoiceFailure(obj: Record<string, unknown>): VoiceFailure {
  const code = asString(obj.code, "voice.code");
  const KNOWN = new Set([
    "stt-unavailable",
    "stt-failed",
    "tts-unavailable",
    "tts-failed",
    "tts-format-unsupported",
  ]);
  if (!KNOWN.has(code)) {
    return fail(`unknown voice failure code: ${code}`);
  }
  return {
    ok: false,
    status: asInt(obj.status, "voice.status"),
    error: asString(obj.error, "voice.error"),
    code,
    supported: asOptionalStringArray(obj.supported, "voice.supported"),
  };
}
