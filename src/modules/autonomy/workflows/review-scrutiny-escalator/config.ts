import {
  DEFAULT_REVIEW_SCRUTINY_COOLDOWN_MS,
  DEFAULT_REVIEW_SCRUTINY_MIN_APPROVALS,
  DEFAULT_REVIEW_SCRUTINY_MIN_RATIO,
  DEFAULT_REVIEW_SCRUTINY_MIN_THIN_ACCEPTANCES,
  DEFAULT_REVIEW_SCRUTINY_WINDOW_MS,
  type ReviewScrutinyEscalationConfig,
  type ReviewScrutinyEscalationDetection,
} from "#modules/autonomy/review-scrutiny-escalation.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isSafeInteger(raw) || raw <= 0) return fallback;
  return raw;
}

function readRatioEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0 || raw > 1) return fallback;
  return raw;
}

export function readReviewScrutinyEscalatorConfig(): ReviewScrutinyEscalationConfig {
  const windowMs =
    readPositiveIntegerEnv(
      "KOTA_REVIEW_SCRUTINY_WINDOW_DAYS",
      DEFAULT_REVIEW_SCRUTINY_WINDOW_MS / MS_PER_DAY,
    ) * MS_PER_DAY;
  const cooldownMs =
    readPositiveIntegerEnv(
      "KOTA_REVIEW_SCRUTINY_COOLDOWN_DAYS",
      DEFAULT_REVIEW_SCRUTINY_COOLDOWN_MS / MS_PER_DAY,
    ) * MS_PER_DAY;
  return {
    windowMs,
    cooldownMs,
    minApprovalLikeDecisions: readPositiveIntegerEnv(
      "KOTA_REVIEW_SCRUTINY_MIN_APPROVALS",
      DEFAULT_REVIEW_SCRUTINY_MIN_APPROVALS,
    ),
    minThinAcceptances: readPositiveIntegerEnv(
      "KOTA_REVIEW_SCRUTINY_MIN_THIN_ACCEPTANCES",
      DEFAULT_REVIEW_SCRUTINY_MIN_THIN_ACCEPTANCES,
    ),
    minThinAcceptanceRatio: readRatioEnv(
      "KOTA_REVIEW_SCRUTINY_MIN_RATIO",
      DEFAULT_REVIEW_SCRUTINY_MIN_RATIO,
    ),
    nowMs: Date.now(),
  };
}

export function emptyReviewScrutinyDetection(
  config: ReviewScrutinyEscalationConfig,
): ReviewScrutinyEscalationDetection {
  return {
    thresholds: {
      windowMs: config.windowMs ?? DEFAULT_REVIEW_SCRUTINY_WINDOW_MS,
      minApprovalLikeDecisions:
        config.minApprovalLikeDecisions ?? DEFAULT_REVIEW_SCRUTINY_MIN_APPROVALS,
      minThinAcceptances:
        config.minThinAcceptances ?? DEFAULT_REVIEW_SCRUTINY_MIN_THIN_ACCEPTANCES,
      minThinAcceptanceRatio:
        config.minThinAcceptanceRatio ?? DEFAULT_REVIEW_SCRUTINY_MIN_RATIO,
      cooldownMs: config.cooldownMs ?? DEFAULT_REVIEW_SCRUTINY_COOLDOWN_MS,
    },
    patterns: [],
    belowThreshold: [],
    unsupportedArtifacts: 0,
  };
}
