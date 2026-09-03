import { join } from "node:path";
import type { ResolvedScopePolicy } from "#core/daemon/scope-policy.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import {
  SCOPE_IMPROVEMENT_CONFIG_FILE,
  SCOPE_IMPROVEMENT_DEFAULT_MAX_ACTIONS_PER_RUN,
  SCOPE_IMPROVEMENT_MAX_SIGNATURES,
  type ScopeImprovementAppliedAction,
  type ScopeImprovementConfig,
  type ScopeImprovementInputs,
  type ScopeImprovementState,
} from "./scope-improvement-types.js";

export const SCOPE_IMPROVEMENT_STATE_KEY =
  "autonomy/scope-improvement/semantic-state";

type ConfigFile = Partial<Omit<ScopeImprovementConfig, "posture">>;

function decodeConfigFile(value: unknown): ConfigFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("scope improvement config must be an object");
  }
  const raw = value as Record<string, unknown>;
  for (const field of Object.keys(raw)) {
    if (field !== "enabled" && field !== "maxActionsPerRun") {
      throw new Error(`scope improvement config has unknown field ${field}`);
    }
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
    throw new Error("scope improvement config enabled must be a boolean");
  }
  if (
    raw.maxActionsPerRun !== undefined &&
    (
      typeof raw.maxActionsPerRun !== "number" ||
      !Number.isSafeInteger(raw.maxActionsPerRun) ||
      raw.maxActionsPerRun <= 0
    )
  ) {
    throw new Error(
      "scope improvement config maxActionsPerRun must be a positive integer",
    );
  }
  return {
    ...(raw.enabled !== undefined ? { enabled: raw.enabled as boolean } : {}),
    ...(raw.maxActionsPerRun !== undefined
      ? { maxActionsPerRun: raw.maxActionsPerRun as number }
      : {}),
  };
}

function defaultConfig(): ScopeImprovementConfig {
  return {
    enabled: true,
    maxActionsPerRun: SCOPE_IMPROVEMENT_DEFAULT_MAX_ACTIONS_PER_RUN,
    posture: "build",
  };
}

export function readScopeImprovementConfig(workspaceRoot: string): ScopeImprovementConfig {
  return readScopeImprovementConfigFromStateDir(join(workspaceRoot, ".kota"));
}

export function readScopeImprovementConfigFromStateDir(
  stateDir: string,
  policy?: ResolvedScopePolicy,
): ScopeImprovementConfig {
  const stored = readOptionalJsonFile<unknown>(
    join(stateDir, SCOPE_IMPROVEMENT_CONFIG_FILE),
  );
  const base = defaultConfig();
  const raw = stored === null ? {} : decodeConfigFile(stored);
  return {
    enabled: raw.enabled ?? base.enabled,
    maxActionsPerRun: raw.maxActionsPerRun ?? base.maxActionsPerRun,
    posture: policy === undefined ? base.posture : postureForPolicy(policy),
  };
}

function postureForPolicy(policy: ResolvedScopePolicy): ScopeImprovementConfig["posture"] {
  if (policy.writes.mode === "none") return "observe";
  if (policy.autonomy.maxMode === "passive") return "observe";
  if (policy.autonomy.maxMode === "supervised") return "propose";
  return "build";
}

export function emptyScopeImprovementState(scopeId: string): ScopeImprovementState {
  return {
    scopeId,
    lastRunAt: null,
    consumedFingerprint: null,
    pendingFingerprint: null,
    pendingBoundary: null,
    pendingDelivery: null,
    pendingDeliveryAttempt: 0,
    recentSignatures: [],
  };
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error(`scope improvement state ${field} must be a string or null`);
  }
  return value;
}

export function decodeScopeImprovementState(
  value: unknown,
  scopeId: string,
): ScopeImprovementState {
  if (value === null || value === undefined) return emptyScopeImprovementState(scopeId);
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("scope improvement state must be an object");
  }
  const raw = value as Partial<ScopeImprovementState>;
  if (raw.scopeId !== scopeId) {
    throw new Error("scope improvement state does not belong to its runtime scope");
  }
  const pendingFingerprint = nullableString(
    raw.pendingFingerprint,
    "pendingFingerprint",
  );
  const pendingBoundary = raw.pendingBoundary === null || raw.pendingBoundary === undefined
    ? null
    : raw.pendingBoundary === "initial-onboarding" ||
        raw.pendingBoundary === "content-policy-changed"
      ? raw.pendingBoundary
      : (() => {
          throw new Error("scope improvement state has an invalid pending boundary");
        })();
  const pendingDelivery = raw.pendingDelivery === null || raw.pendingDelivery === undefined
    ? null
    : raw.pendingDelivery === "queued" || raw.pendingDelivery === "deferred"
      ? raw.pendingDelivery
      : (() => {
          throw new Error("scope improvement state has an invalid pending delivery");
        })();
  if (!Number.isSafeInteger(raw.pendingDeliveryAttempt) || raw.pendingDeliveryAttempt! < 0) {
    throw new Error("scope improvement state has an invalid delivery attempt");
  }
  if (!Array.isArray(raw.recentSignatures)) {
    throw new Error("scope improvement state recentSignatures must be an array");
  }
  const recentSignatures = raw.recentSignatures.map((entry) => {
    if (
      !entry ||
      typeof entry.signature !== "string" ||
      typeof entry.action !== "string" ||
      typeof entry.lastSeenAt !== "string"
    ) {
      throw new Error("scope improvement state has an invalid signature entry");
    }
    return {
      signature: entry.signature,
      action: entry.action,
      lastSeenAt: entry.lastSeenAt,
    };
  });
  return {
    scopeId,
    lastRunAt: nullableString(raw.lastRunAt, "lastRunAt"),
    consumedFingerprint: nullableString(
      raw.consumedFingerprint,
      "consumedFingerprint",
    ),
    pendingFingerprint,
    pendingBoundary,
    pendingDelivery,
    pendingDeliveryAttempt: raw.pendingDeliveryAttempt!,
    recentSignatures,
  };
}

export function reserveScopeImprovementInput(
  state: ScopeImprovementState,
  input: {
    fingerprint: string;
    boundary: "initial-onboarding" | "content-policy-changed";
    delivery: "queued" | "deferred";
    deliveryAttempt: number;
  },
): ScopeImprovementState {
  if (!input.fingerprint) throw new Error("scope improvement fingerprint is required");
  if (!Number.isSafeInteger(input.deliveryAttempt) || input.deliveryAttempt < 0) {
    throw new Error("scope improvement delivery attempt must be non-negative");
  }
  return {
    ...state,
    pendingFingerprint: input.fingerprint,
    pendingBoundary: input.boundary,
    pendingDelivery: input.delivery,
    pendingDeliveryAttempt: input.deliveryAttempt,
  };
}

export function deferScopeImprovementInput(
  current: ScopeImprovementState,
  inputs: ScopeImprovementInputs,
): ScopeImprovementState {
  if (!inputs.semanticInput.automatic) return current;
  if (inputs.triggerKind === "explicit-request") {
    throw new Error("automatic scope improvement input requires a semantic boundary");
  }
  if (current.consumedFingerprint === inputs.semanticInput.fingerprint) return current;
  if (
    current.pendingFingerprint !== null &&
    current.pendingFingerprint !== inputs.state.pendingFingerprint &&
    current.pendingFingerprint !== inputs.semanticInput.fingerprint
  ) {
    return current;
  }
  return reserveScopeImprovementInput(current, {
    fingerprint: inputs.semanticInput.fingerprint,
    boundary: inputs.triggerKind,
    delivery: "deferred",
    deliveryAttempt: inputs.state.pendingDeliveryAttempt + 1,
  });
}

export function completeScopeImprovementInput(input: {
  current: ScopeImprovementState;
  inputs: ScopeImprovementInputs;
  actions: readonly ScopeImprovementAppliedAction[];
}): ScopeImprovementState {
  const { current, inputs } = input;
  if (current.scopeId !== inputs.scope.scopeId) {
    throw new Error("scope improvement state does not belong to its runtime scope");
  }
  const now = inputs.generatedAt;
  if (current.lastRunAt !== null && current.lastRunAt >= now) return current;
  const automatic = inputs.semanticInput.automatic;
  const preserveNewerPending = automatic &&
    current.pendingFingerprint !== null &&
    current.pendingFingerprint !== inputs.state.pendingFingerprint &&
    current.pendingFingerprint !== inputs.semanticInput.fingerprint;
  const recorded = input.actions
    .filter((action) => action.kind !== "skipped")
    .map((action) => ({
      signature: action.signature,
      action: action.kind,
      lastSeenAt: now,
    }));
  const recentSignatures = [
    ...recorded,
    ...current.recentSignatures.filter(
      (entry) => !recorded.some((item) => item.signature === entry.signature),
    ),
  ].slice(0, SCOPE_IMPROVEMENT_MAX_SIGNATURES);
  return {
    scopeId: inputs.scope.scopeId,
    lastRunAt: now,
    consumedFingerprint: automatic
      ? inputs.semanticInput.fingerprint
      : current.consumedFingerprint,
    pendingFingerprint:
      automatic && !preserveNewerPending ? null : current.pendingFingerprint,
    pendingBoundary:
      automatic && !preserveNewerPending ? null : current.pendingBoundary,
    pendingDelivery:
      automatic && !preserveNewerPending ? null : current.pendingDelivery,
    pendingDeliveryAttempt:
      automatic && !preserveNewerPending ? 0 : current.pendingDeliveryAttempt,
    recentSignatures,
  };
}
