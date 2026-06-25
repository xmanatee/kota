import { asArray, asInt, asKnown, asObject, asOptionalString, asString, fail } from './decoder-common';
import {
  SCOPE_POLICY_ACTION_POLICIES,
  SCOPE_POLICY_AREAS,
  SCOPE_POLICY_AUTONOMY_MODES,
  SCOPE_POLICY_CHANNEL_MODES,
  SCOPE_POLICY_DECISION_KINDS,
  SCOPE_POLICY_DECISION_OUTCOMES,
  SCOPE_POLICY_EXPLANATION_ACTIONS,
  SCOPE_POLICY_MODULE_AVAILABILITIES,
  SCOPE_POLICY_REDACTION_PROFILES,
  SCOPE_POLICY_RETENTION_MODES,
  SCOPE_POLICY_SETUP_VISIBILITIES,
  SCOPE_POLICY_WRITE_MODES,
  type ScopePolicyDecision,
  type ScopePolicyRouteResponse,
  type ScopePolicySource,
} from './decoder-scope-policy-types';

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
