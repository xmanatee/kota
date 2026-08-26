import type {
  EvidenceArtifactPolicy,
  EvidenceArtifactType,
  EvidenceDataClass,
  EvidenceJsonObject,
  EvidenceJsonValue,
  EvidenceLifecycleState,
  EvidenceProjectionTarget,
  EvidenceProvenance,
  EvidencePrunedReference,
  EvidenceRedactionMarker,
  EvidenceRedactionProfile,
  EvidenceRedactionReason,
  EvidenceRetentionRule,
  EvidenceRetentionScope,
} from "./policy-model.js";
import { EVIDENCE_POLICY, EVIDENCE_REDACTED } from "./policy-model.js";

export type {
  EvidenceArtifactPolicy,
  EvidenceArtifactReference,
  EvidenceArtifactType,
  EvidenceDataClass,
  EvidenceJsonObject,
  EvidenceJsonPrimitive,
  EvidenceJsonValue,
  EvidenceLifecycleState,
  EvidencePolicyModel,
  EvidenceProjectionTarget,
  EvidenceProvenance,
  EvidencePrunedReference,
  EvidenceRedactionMarker,
  EvidenceRedactionProfile,
  EvidenceRedactionReason,
  EvidenceRetentionPeriod,
  EvidenceRetentionRule,
  EvidenceRetentionScope,
  EvidenceSensitivity,
} from "./policy-model.js";
export { EVIDENCE_POLICY, EVIDENCE_REDACTED } from "./policy-model.js";

export type EvidenceRetentionQuery = {
  artifactType: EvidenceArtifactType;
  state: EvidenceLifecycleState;
  scope: EvidenceRetentionScope;
};

export type EvidenceRetentionResolution =
  | {
      kind: "retain";
      expiredPayload: EvidenceRetentionRule["expiredPayload"];
    }
  | {
      kind: "expires";
      durationMs: number;
      expiresAt: string;
      expiredPayload: EvidenceRetentionRule["expiredPayload"];
    };

const SECRET_KEY_PATTERN =
  /(authorization|credential|password|secret|token|api[-_]?key|access[-_]?key|refresh[-_]?token|cookie|bearer)/i;
const TOKEN_USAGE_KEY_PATTERN =
  /^(tokens|(?:input|output|total|prompt|completion|cached)[-_]?tokens?|(?:input|output|total|prompt|completion|cached)?[-_]?token[-_]?count)$/i;
const PII_KEY_PATTERN =
  /(^email$|e[-_]?mail|phone|ssn|social[-_]?security|address|birth[-_]?date|dob)/i;
const PRIVATE_REASONING_KEY_PATTERN =
  /(thinking|chain[-_]?of[-_]?thought|private[-_]?reasoning|private[-_]?plan|reasoning_trace)/i;
const PROVIDER_PAYLOAD_KEY_PATTERN =
  /(^raw$|raw[-_]?payload|provider[-_]?payload|request[-_]?body|response[-_]?body|http[-_]?body|headers?)/i;
const TOOL_IO_KEY_PATTERN =
  /(tool[-_]?input|tool[-_]?output|tool[-_]?result|stdout|stderr)/i;
const URL_KEY_PATTERN = /(url|uri|endpoint)/i;
const URL_SECRET_PARAM_PATTERN =
  /(authorization|credential|password|secret|token|api[-_]?key|access[-_]?key|refresh[-_]?token|code|state|cookie)/i;
const SENSITIVE_TEXT_ASSIGNMENT_PATTERN =
  /\b(authorization|credential|password|secret|token|api[-_]?key|access[-_]?key|refresh[-_]?token|cookie|bearer)(\s*[:=]\s*)([^\s,;&]+)/gi;
const BEARER_TEXT_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+/gi;
const SECRET_VALUE_TEXT_PATTERN =
  /\b(?:sk-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{20,}|ya29\.[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g;
const SECRET_LIKE_TEXT_TOKEN_PATTERN =
  /\b[A-Za-z0-9._~+/-]*?(?:secret|password|credential|api[-_]?key|access[-_]?key|refresh[-_]?token|cookie)[A-Za-z0-9._~+/-]*\b/gi;
const SECRET_LABEL_TEXT_PATTERN =
  /^(secret|password|credential|cookie|token|bearer|api[-_ ]?key|access[-_ ]?key|refresh[-_ ]?token)$/i;
const EMAIL_TEXT_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SSN_TEXT_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;
const URL_TEXT_PATTERN = /\bhttps?:\/\/[^\s<>"')]+/gi;
const SECRET_REFERENCE_METADATA_KEYS = new Set([
  "secretRef",
  "secretRefs",
  "secretReference",
  "secretReferences",
]);
const SECRET_REFERENCE_METADATA_VALUE_KEYS = new Set(["name", "scope", "source", "present"]);

type ProjectionContext = {
  secretReferenceMetadata: boolean;
};

const DEFAULT_PROJECTION_CONTEXT: ProjectionContext = {
  secretReferenceMetadata: false,
};

export function evidencePolicyForArtifact(
  artifactType: EvidenceArtifactType,
): EvidenceArtifactPolicy {
  const policy = EVIDENCE_POLICY.artifacts.find((entry) => entry.artifactType === artifactType);
  if (!policy) throw new Error(`No evidence policy for artifact type "${artifactType}"`);
  return policy;
}

export function redactionProfileForTarget(
  target: EvidenceProjectionTarget,
): EvidenceRedactionProfile {
  const profile = EVIDENCE_POLICY.redactionProfiles.find((entry) => entry.target === target);
  if (!profile) throw new Error(`No evidence redaction profile for target "${target}"`);
  return profile;
}

export function evidenceRetentionRuleFor(
  query: EvidenceRetentionQuery,
): EvidenceRetentionRule {
  const policy = evidencePolicyForArtifact(query.artifactType);
  const rule = policy.retention.find((entry) =>
    entry.scope === query.scope && entry.state === query.state
  );
  if (!rule) {
    throw new Error(
      `No evidence retention rule for ${query.scope}/${query.artifactType}/${query.state}`,
    );
  }
  return rule;
}

export function evidenceRetentionDurationMsFor(
  query: EvidenceRetentionQuery,
): number {
  const rule = evidenceRetentionRuleFor(query);
  if (rule.retention.kind === "retain") {
    throw new Error(
      `Evidence retention rule for ${query.scope}/${query.artifactType}/${query.state} does not expire`,
    );
  }
  return rule.retention.durationMs;
}

export function resolveEvidenceRetention(input: EvidenceRetentionQuery & {
  retainedFrom: Date;
}): EvidenceRetentionResolution {
  const rule = evidenceRetentionRuleFor(input);
  if (rule.retention.kind === "retain") {
    return {
      kind: "retain",
      expiredPayload: rule.expiredPayload,
    };
  }
  return {
    kind: "expires",
    durationMs: rule.retention.durationMs,
    expiresAt: new Date(input.retainedFrom.getTime() + rule.retention.durationMs).toISOString(),
    expiredPayload: rule.expiredPayload,
  };
}

export function evidenceRetentionScopeForScopeId(
  scopeId: string,
): EvidenceRetentionScope {
  return scopeId === "global" ? "global" : "directory";
}

export function cloneEvidenceJsonObject(value: object): EvidenceJsonObject {
  return JSON.parse(JSON.stringify(value)) as EvidenceJsonObject;
}

export function projectEvidenceObject(
  value: object,
  target: EvidenceProjectionTarget,
): EvidenceJsonObject {
  return projectEvidenceJsonValue(cloneEvidenceJsonObject(value), target) as EvidenceJsonObject;
}

export function projectEvidenceJsonObject(
  value: EvidenceJsonObject,
  target: EvidenceProjectionTarget,
): EvidenceJsonObject {
  return projectEvidenceJsonValue(value, target) as EvidenceJsonObject;
}

export function projectEvidenceJsonValueAsDataClass(
  value: EvidenceJsonValue,
  target: EvidenceProjectionTarget,
  dataClass: Extract<EvidenceDataClass, "private-reasoning" | "provider-payload" | "tool-io">,
): EvidenceJsonValue {
  const profile = redactionProfileForTarget(target);
  if (dataClass === "private-reasoning" && profile.omitPrivateReasoning) {
    return redactionMarker("private-reasoning", value);
  }
  if (dataClass === "provider-payload" && profile.omitProviderPayloads) {
    return redactionMarker("provider-payload", value);
  }
  if (dataClass === "tool-io" && profile.omitToolIo) {
    return redactionMarker("tool-io", value);
  }
  return projectEvidenceJsonValue(value, target);
}

export function projectEvidenceJsonValue(
  value: EvidenceJsonValue,
  target: EvidenceProjectionTarget,
  key = "",
): EvidenceJsonValue {
  return projectEvidenceJsonValueInternal(value, target, key, DEFAULT_PROJECTION_CONTEXT);
}

function projectEvidenceJsonValueInternal(
  value: EvidenceJsonValue,
  target: EvidenceProjectionTarget,
  key: string,
  context: ProjectionContext = DEFAULT_PROJECTION_CONTEXT,
): EvidenceJsonValue {
  const profile = redactionProfileForTarget(target);
  const currentContext = projectionContextForKey(key, context);
  const keyClass = classifyEvidenceKey(key);
  if (
    profile.scrubSecretsAndPii &&
    currentContext.secretReferenceMetadata &&
    key.length > 0 &&
    !SECRET_REFERENCE_METADATA_KEYS.has(key) &&
    !SECRET_REFERENCE_METADATA_VALUE_KEYS.has(key)
  ) return EVIDENCE_REDACTED;
  if (profile.scrubSecretsAndPii && keyClass === "secret") return EVIDENCE_REDACTED;
  if (profile.scrubSecretsAndPii && keyClass === "pii") return EVIDENCE_REDACTED;
  if (profile.omitPrivateReasoning && keyClass === "private-reasoning") {
    return redactionMarker("private-reasoning", value);
  }
  if (profile.omitProviderPayloads && keyClass === "provider-payload") {
    return redactionMarker("provider-payload", value);
  }
  if (profile.omitToolIo && keyClass === "tool-io") {
    return redactionMarker("tool-io", value);
  }
  if (typeof value === "string") {
    const projected = URL_KEY_PATTERN.test(key) ? redactSensitiveUrl(value) : value;
    if (preserveSecretReferenceMetadataValue(key, currentContext)) return projected;
    return profile.scrubSecretsAndPii ? redactSensitiveText(projected) : projected;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => projectEvidenceJsonValueInternal(entry, target, "", currentContext));
  }
  if (isEvidenceJsonObject(value)) {
    const out: EvidenceJsonObject = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      if (entryValue !== undefined) {
        out[entryKey] = projectEvidenceJsonValueInternal(entryValue, target, entryKey, currentContext);
      }
    }
    return out;
  }
  return value;
}

export function projectEvidenceText(
  text: string,
  target: EvidenceProjectionTarget,
  dataClass: Extract<EvidenceDataClass, "private-reasoning" | "provider-payload" | "tool-io">,
): EvidenceRedactionMarker | string {
  const profile = redactionProfileForTarget(target);
  if (dataClass === "private-reasoning" && profile.omitPrivateReasoning) {
    return textRedactionMarker("private-reasoning", text);
  }
  if (dataClass === "provider-payload" && profile.omitProviderPayloads) {
    return textRedactionMarker("provider-payload", text);
  }
  if (dataClass === "tool-io" && profile.omitToolIo) {
    return textRedactionMarker("tool-io", text);
  }
  return text;
}

export function projectEvidenceUrl(
  value: string,
  target: EvidenceProjectionTarget,
): string {
  return redactionProfileForTarget(target).scrubSecretsAndPii
    ? redactSensitiveUrl(value)
    : value;
}

export function redactSensitiveText(text: string): string {
  return redactSensitiveValues(text).replace(SECRET_LIKE_TEXT_TOKEN_PATTERN, (match) =>
    SECRET_LABEL_TEXT_PATTERN.test(match) ? match : EVIDENCE_REDACTED
  );
}

export function redactSensitiveValues(text: string): string {
  return text
    .replace(URL_TEXT_PATTERN, (match) => redactSensitiveUrl(match))
    .replace(BEARER_TEXT_PATTERN, "Bearer [redacted]")
    .replace(SENSITIVE_TEXT_ASSIGNMENT_PATTERN, (_match, key, separator, value) =>
      `${key}${separator}${isAlreadyRedactedText(value) ? value : EVIDENCE_REDACTED}`
    )
    .replace(SECRET_VALUE_TEXT_PATTERN, EVIDENCE_REDACTED)
    .replace(EMAIL_TEXT_PATTERN, EVIDENCE_REDACTED)
    .replace(SSN_TEXT_PATTERN, EVIDENCE_REDACTED);
}

function isAlreadyRedactedText(value: string): boolean {
  if (value === EVIDENCE_REDACTED) return true;
  try {
    return decodeURIComponent(value) === EVIDENCE_REDACTED;
  } catch {
    return false;
  }
}

export function buildEvidencePrunedReference(input: {
  artifactType: EvidenceArtifactType;
  id: string;
  prunedAt: string;
  retained: EvidenceJsonObject;
  provenance: EvidenceProvenance;
}): EvidencePrunedReference {
  return {
    artifactType: input.artifactType,
    id: input.id,
    prunedAt: input.prunedAt,
    retained: projectEvidenceJsonObject(input.retained, "internal-storage"),
    provenance: input.provenance,
    payloadExpired: true,
  };
}

function classifyEvidenceKey(key: string): EvidenceRedactionReason | null {
  if (SECRET_REFERENCE_METADATA_KEYS.has(key)) return null;
  if (TOKEN_USAGE_KEY_PATTERN.test(key)) return null;
  if (SECRET_KEY_PATTERN.test(key)) return "secret";
  if (PII_KEY_PATTERN.test(key)) return "pii";
  if (PRIVATE_REASONING_KEY_PATTERN.test(key)) return "private-reasoning";
  if (PROVIDER_PAYLOAD_KEY_PATTERN.test(key)) return "provider-payload";
  if (TOOL_IO_KEY_PATTERN.test(key)) return "tool-io";
  return null;
}

function projectionContextForKey(
  key: string,
  context: ProjectionContext,
): ProjectionContext {
  if (!SECRET_REFERENCE_METADATA_KEYS.has(key)) return context;
  return { secretReferenceMetadata: true };
}

function preserveSecretReferenceMetadataValue(
  key: string,
  context: ProjectionContext,
): boolean {
  if (!context.secretReferenceMetadata) return false;
  return SECRET_REFERENCE_METADATA_KEYS.has(key) || SECRET_REFERENCE_METADATA_VALUE_KEYS.has(key);
}

function redactionMarker(
  reason: EvidenceRedactionReason,
  value: EvidenceJsonValue,
): EvidenceRedactionMarker {
  return {
    redacted: true,
    reason,
    bytes: JSON.stringify(value).length,
  };
}

function textRedactionMarker(
  reason: EvidenceRedactionReason,
  text: string,
): EvidenceRedactionMarker {
  return {
    redacted: true,
    reason,
    bytes: Buffer.byteLength(text, "utf8"),
  };
}

function isEvidenceJsonObject(value: EvidenceJsonValue): value is EvidenceJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactSensitiveUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return value;
  }
  let changed = false;
  if (parsed.username.length > 0) {
    parsed.username = EVIDENCE_REDACTED;
    changed = true;
  }
  if (parsed.password.length > 0) {
    parsed.password = EVIDENCE_REDACTED;
    changed = true;
  }
  for (const key of [...parsed.searchParams.keys()]) {
    if (URL_SECRET_PARAM_PATTERN.test(key)) {
      parsed.searchParams.set(key, EVIDENCE_REDACTED);
      changed = true;
    }
  }
  const fragment = new URLSearchParams(parsed.hash.slice(1));
  let fragmentChanged = false;
  for (const key of [...fragment.keys()]) {
    if (URL_SECRET_PARAM_PATTERN.test(key)) {
      fragment.set(key, EVIDENCE_REDACTED);
      fragmentChanged = true;
    }
  }
  if (fragmentChanged) {
    parsed.hash = fragment.toString();
    changed = true;
  }
  return changed ? parsed.toString() : value;
}
