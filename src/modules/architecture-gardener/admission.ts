import { combineFingerprints, isMaterialDelta } from "./fingerprint.js";
import type {
  AdmissionEvaluation,
  ArchitectureSignal,
  StoredFingerprintRecord,
} from "./types.js";

export type AdmissionContext = {
  readonly targetScope: string;
  readonly signals: readonly ArchitectureSignal[];
  readonly explicitRequest?: {
    readonly targetScope: string;
    readonly reason?: string;
  };
  readonly storedFingerprints?: Readonly<Record<string, StoredFingerprintRecord>>;
  readonly cooldownExpiry?: string;
  readonly hasActiveTask?: boolean;
  readonly activeTaskId?: string;
  readonly now?: string;
};

/**
 * Evaluate whether an architectural target scope should be admitted for semantic review.
 * Enforces:
 * 1. Cooldown suppression
 * 2. Active task deduplication
 * 3. Stable fingerprint suppression of unchanged evidence
 * 4. Explicit owner request admission
 * 5. Rejection of isolated single advisory metrics
 * 6. Admission of convergent, materially changed signals (>= 2 independent eligible signals)
 */
export function evaluateAdmission(context: AdmissionContext): AdmissionEvaluation {
  const {
    targetScope,
    signals,
    explicitRequest,
    storedFingerprints = {},
    cooldownExpiry,
    hasActiveTask = false,
    now = new Date().toISOString(),
  } = context;

  const combinedFingerprint = combineFingerprints(
    signals.map((s) => s.fingerprint),
  );
  const eligibleSignalCount = signals.length;

  // 1. Active task deduplication
  if (hasActiveTask) {
    return {
      targetScope,
      admitted: false,
      disposition: "deduplicated",
      reason: `Target scope "${targetScope}" already has an active implementation task.`,
      eligibleSignalCount,
      signals,
      combinedFingerprint,
    };
  }

  // 2. Cooldown check
  if (cooldownExpiry && new Date(cooldownExpiry).getTime() > new Date(now).getTime()) {
    return {
      targetScope,
      admitted: false,
      disposition: "cooled_down",
      reason: `Target scope "${targetScope}" is on cooldown until ${cooldownExpiry}.`,
      eligibleSignalCount,
      signals,
      combinedFingerprint,
    };
  }

  // 3. Explicit owner request check
  const isExplicit =
    explicitRequest !== undefined &&
    (explicitRequest.targetScope === targetScope ||
      targetScope.startsWith(explicitRequest.targetScope));

  if (isExplicit) {
    return {
      targetScope,
      admitted: true,
      disposition: "accepted",
      reason: `Explicit owner request admitted for "${targetScope}": ${
        explicitRequest.reason ?? "Manual review requested"
      }.`,
      eligibleSignalCount,
      signals,
      combinedFingerprint,
    };
  }

  // 4. Suppress unchanged evidence if no material delta
  if (signals.length > 0 && !isMaterialDelta(signals, storedFingerprints)) {
    return {
      targetScope,
      admitted: false,
      disposition: "suppressed",
      reason: `Unchanged evidence suppressed by stable fingerprint for "${targetScope}".`,
      eligibleSignalCount,
      signals,
      combinedFingerprint,
    };
  }

  // 5. Single advisory metric alone must NEVER admit review or create work
  const advisorySignals = signals.filter((s) => s.kind === "advisory-metric");
  const structuralViolations = signals.filter(
    (s) => s.kind === "structural-violation",
  );

  if (structuralViolations.length === 0 && advisorySignals.length === 1) {
    return {
      targetScope,
      admitted: false,
      disposition: "rejected",
      reason: `Single advisory metric is insufficient evidence to admit review for "${targetScope}". Requires at least two independent eligible signals.`,
      eligibleSignalCount,
      signals,
      combinedFingerprint,
    };
  }

  // 6. Convergent materially changed signals (>= 2 independent signals, or >= 1 structural violation)
  if (structuralViolations.length > 0 || signals.length >= 2) {
    const signalDescriptions = signals.map((s) => s.summary).join("; ");
    return {
      targetScope,
      admitted: true,
      disposition: "accepted",
      reason: `Admitted on convergent materially changed signals (${signals.length} signal(s)): ${signalDescriptions}`,
      eligibleSignalCount,
      signals,
      combinedFingerprint,
    };
  }

  // 7. No eligible signals
  return {
    targetScope,
    admitted: false,
    disposition: "rejected",
    reason: `No eligible signals to justify architectural review for "${targetScope}".`,
    eligibleSignalCount,
    signals,
    combinedFingerprint,
  };
}
