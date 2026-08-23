import { join } from "node:path";
import { readOptionalJsonFile, writeJsonFileAtomic } from "#core/util/json-file.js";
import {
  SCOPE_IMPROVEMENT_CONFIG_PATH,
  SCOPE_IMPROVEMENT_DEFAULT_MAX_ACTIONS_PER_RUN,
  SCOPE_IMPROVEMENT_MAX_SIGNATURES,
  SCOPE_IMPROVEMENT_STATE_PATH,
  type ScopeImprovementAppliedAction,
  type ScopeImprovementConfig,
  type ScopeImprovementInputs,
  type ScopeImprovementState,
} from "./scope-improvement-types.js";

type ConfigFile = Partial<ScopeImprovementConfig>;
type StateFile = Partial<ScopeImprovementState>;

function defaultConfig(): ScopeImprovementConfig {
  return {
    enabled: true,
    maxActionsPerRun: SCOPE_IMPROVEMENT_DEFAULT_MAX_ACTIONS_PER_RUN,
  };
}

export function readScopeImprovementConfig(projectDir: string): ScopeImprovementConfig {
  const raw = readOptionalJsonFile<ConfigFile>(
    join(projectDir, SCOPE_IMPROVEMENT_CONFIG_PATH),
  );
  const base = defaultConfig();
  if (!raw) return base;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
    maxActionsPerRun:
      typeof raw.maxActionsPerRun === "number" && raw.maxActionsPerRun > 0
        ? Math.floor(raw.maxActionsPerRun)
        : base.maxActionsPerRun,
  };
}

export function readScopeImprovementState(
  projectDir: string,
  scopeId: string,
): ScopeImprovementState {
  const raw = readOptionalJsonFile<StateFile>(
    join(projectDir, SCOPE_IMPROVEMENT_STATE_PATH),
  );
  if (!raw) {
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
  const pendingFingerprint =
    typeof raw.pendingFingerprint === "string" ? raw.pendingFingerprint : null;
  const pendingBoundary = raw.pendingBoundary === "initial-onboarding" ||
      raw.pendingBoundary === "content-policy-changed"
    ? raw.pendingBoundary
    : pendingFingerprint
      ? typeof raw.consumedFingerprint === "string"
        ? "content-policy-changed"
        : "initial-onboarding"
      : null;
  const pendingDelivery = raw.pendingDelivery === "queued" ||
      raw.pendingDelivery === "deferred"
    ? raw.pendingDelivery
    : pendingFingerprint
      ? "deferred"
      : null;
  const pendingDeliveryAttempt = Number.isInteger(raw.pendingDeliveryAttempt) &&
      raw.pendingDeliveryAttempt! >= 0
    ? raw.pendingDeliveryAttempt!
    : 0;
  return {
    scopeId: typeof raw.scopeId === "string" ? raw.scopeId : scopeId,
    lastRunAt: typeof raw.lastRunAt === "string" ? raw.lastRunAt : null,
    consumedFingerprint:
      typeof raw.consumedFingerprint === "string"
        ? raw.consumedFingerprint
        : null,
    pendingFingerprint,
    pendingBoundary,
    pendingDelivery,
    pendingDeliveryAttempt,
    recentSignatures: Array.isArray(raw.recentSignatures)
      ? raw.recentSignatures.filter(
          (entry): entry is ScopeImprovementState["recentSignatures"][number] =>
            typeof entry.signature === "string" &&
            typeof entry.action === "string" &&
            typeof entry.lastSeenAt === "string",
        )
      : [],
  };
}

export function writeScopeImprovementState(args: {
  projectDir: string;
  inputs: ScopeImprovementInputs;
  actions: readonly ScopeImprovementAppliedAction[];
}): void {
  const now = args.inputs.generatedAt;
  const automatic = args.inputs.semanticInput.automatic;
  const currentState = automatic
    ? args.inputs.state
    : readScopeImprovementState(
      args.projectDir,
      args.inputs.scope.scopeId,
    );
  const recorded = args.actions
    .filter((action) => action.kind !== "skipped")
    .map((action) => ({
      signature: action.signature,
      action: action.kind,
      lastSeenAt: now,
    }));
  const recentSignatures = [
    ...recorded,
    ...currentState.recentSignatures.filter(
      (entry) => !recorded.some((item) => item.signature === entry.signature),
    ),
  ].slice(0, SCOPE_IMPROVEMENT_MAX_SIGNATURES);
  writeJsonFileAtomic(join(args.projectDir, SCOPE_IMPROVEMENT_STATE_PATH), {
    scopeId: args.inputs.scope.scopeId,
    lastRunAt: now,
    consumedFingerprint: automatic
      ? args.inputs.semanticInput.fingerprint
      : currentState.consumedFingerprint,
    pendingFingerprint: automatic ? null : currentState.pendingFingerprint,
    pendingBoundary: automatic ? null : currentState.pendingBoundary,
    pendingDelivery: automatic ? null : currentState.pendingDelivery,
    pendingDeliveryAttempt: automatic ? 0 : currentState.pendingDeliveryAttempt,
    recentSignatures,
  } satisfies ScopeImprovementState);
}

export function writePendingScopeFingerprint(args: {
  projectDir: string;
  scopeId: string;
  fingerprint: string;
  boundary: "initial-onboarding" | "content-policy-changed";
  delivery: "queued" | "deferred";
  deliveryAttempt: number;
}): void {
  const state = readScopeImprovementState(args.projectDir, args.scopeId);
  writeJsonFileAtomic(join(args.projectDir, SCOPE_IMPROVEMENT_STATE_PATH), {
    ...state,
    scopeId: args.scopeId,
    pendingFingerprint: args.fingerprint,
    pendingBoundary: args.boundary,
    pendingDelivery: args.delivery,
    pendingDeliveryAttempt: args.deliveryAttempt,
  } satisfies ScopeImprovementState);
}

export function deferScopeImprovementInput(
  projectDir: string,
  inputs: ScopeImprovementInputs,
): void {
  if (!inputs.semanticInput.automatic) return;
  if (inputs.triggerKind === "explicit-request") {
    throw new Error("automatic scope improvement input requires a semantic boundary");
  }
  writePendingScopeFingerprint({
    projectDir,
    scopeId: inputs.scope.scopeId,
    fingerprint: inputs.semanticInput.fingerprint,
    boundary: inputs.triggerKind,
    delivery: "deferred",
    deliveryAttempt: inputs.state.pendingDeliveryAttempt + 1,
  });
}
