import { createHash } from "node:crypto";
import { redactSensitiveText } from "#core/evidence/policy.js";
import type {
  AutonomyHealthActionability,
  AutonomyHealthEvidenceRef,
  AutonomyHealthSeverity,
  AutonomyHealthSignal,
} from "#modules/autonomy/health-signal.js";

export const RUNTIME_HEALTH_AUDIT_ARTIFACT = "runtime-health-audit.json";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const DEFAULT_WINDOW_MS = 7 * MS_PER_DAY;
export const DEFAULT_STALE_DLQ_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_LOG_PATTERN_MIN_OBSERVATIONS = 2;
export const DEFAULT_INTERRUPTED_RUN_MIN_COUNT = 2;
export const MAX_EVIDENCE_REFS_PER_PATTERN = 12;
export const MAX_SUMMARIES_PER_PATTERN = 5;
export const MAX_LOG_LINES_PER_FILE = 500;
export const MAX_RUN_ERROR_TEXT_BYTES = 4000;
export const MAX_DAEMON_STOP_ATTEMPTS = 100;

export type RuntimeHealthAuditCategory =
  | "local-code"
  | "external-service/auth"
  | "operator-action"
  | "duplicate-consumer"
  | "cost-risk";

export type RuntimeHealthAuditPattern = {
  dedupeKey: string;
  category: RuntimeHealthAuditCategory;
  severity: AutonomyHealthSeverity;
  actionability: AutonomyHealthActionability;
  labels: string[];
  summary: string;
  source: AutonomyHealthSignal["source"];
  observationCount: number;
  evidenceRefs: AutonomyHealthEvidenceRef[];
};

export type RuntimeHealthEvidenceGap = {
  kind: "policy-pruned" | "producer-missing";
  reasonCode: "policy-pruned-payload" | "producer-missing";
  ref: string;
  summary: string;
};

export type RuntimeHealthAudit = {
  generatedAt: string;
  windowStart: string;
  inspected: {
    moduleLogFiles: number;
    moduleLogLines: number;
    deadLetterItems: number;
    staleOpenDeadLetterItems: number;
    recentRuns: number;
    interruptedRuns: number;
    controlCoverageArtifacts: number;
    controlCoverageGapRuns: number;
    policyPrunedEvidenceRefs: number;
    producerMissingEvidenceRefs: number;
    daemonEvidenceFiles: number;
    daemonStopAttempts: number;
    inboxEntries: number;
    operatorRuntimeWarnings: number;
  };
  evidenceGaps: RuntimeHealthEvidenceGap[];
  patterns: RuntimeHealthAuditPattern[];
  signals: AutonomyHealthSignal[];
};

export type RuntimeHealthAuditOptions = {
  nowIso?: string;
  windowMs?: number;
  staleDeadLetterMs?: number;
  logPatternMinObservations?: number;
  interruptedRunMinCount?: number;
};

export type MutablePattern = {
  dedupeKey: string;
  category: RuntimeHealthAuditCategory;
  severity: AutonomyHealthSeverity;
  actionability: AutonomyHealthActionability;
  labels: Set<string>;
  source: AutonomyHealthSignal["source"];
  observationCount: number;
  summaries: Set<string>;
  evidenceRefs: Map<string, AutonomyHealthEvidenceRef>;
};

export type PatternInput = {
  dedupeKey: string;
  category: RuntimeHealthAuditCategory;
  severity: AutonomyHealthSeverity;
  actionability: AutonomyHealthActionability;
  labels: readonly string[];
  summary: string;
  source: AutonomyHealthSignal["source"];
  evidenceRefs: readonly AutonomyHealthEvidenceRef[];
  observationCount?: number;
};

export type RuntimeHealthAuditContext = {
  projectDir: string;
  stateDir: string;
  scopeDir: string;
  nowIso: string;
  nowMs: number;
  windowStartMs: number;
  staleDeadLetterMs: number;
  logPatternMinObservations: number;
  interruptedRunMinCount: number;
  patterns: Map<string, MutablePattern>;
  evidenceGaps: RuntimeHealthEvidenceGap[];
  inspected: RuntimeHealthAudit["inspected"];
};

export const SEVERITY_RANK: Record<AutonomyHealthSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

export function maxSeverity(
  left: AutonomyHealthSeverity,
  right: AutonomyHealthSeverity,
): AutonomyHealthSeverity {
  return SEVERITY_RANK[right] > SEVERITY_RANK[left] ? right : left;
}

export function truncateSingleLine(value: string, max = 220): string {
  const single = redactSensitiveText(value).replace(/\s+/g, " ").trim();
  if (single.length <= max) return single;
  return `${single.slice(0, max - 3)}...`;
}

export function stableHash(value: string, length = 12): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function normalizeLogCode(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/[^\s]+/g, "<url>")
    .replace(/[0-9a-f]{8,}/g, "<hash>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

export function patternSummary(pattern: MutablePattern): string {
  return [...pattern.summaries].slice(0, MAX_SUMMARIES_PER_PATTERN).join(" ");
}

export function addPattern(
  ctx: RuntimeHealthAuditContext,
  input: PatternInput,
): void {
  const existing = ctx.patterns.get(input.dedupeKey);
  if (!existing) {
    const next: MutablePattern = {
      dedupeKey: input.dedupeKey,
      category: input.category,
      severity: input.severity,
      actionability: input.actionability,
      labels: new Set(input.labels),
      source: input.source,
      observationCount: input.observationCount ?? 1,
      summaries: new Set([truncateSingleLine(input.summary)]),
      evidenceRefs: new Map(),
    };
    for (const ref of input.evidenceRefs) {
      next.evidenceRefs.set(`${ref.kind}:${ref.ref}`, ref);
    }
    ctx.patterns.set(input.dedupeKey, next);
    return;
  }

  existing.severity = maxSeverity(existing.severity, input.severity);
  existing.observationCount += input.observationCount ?? 1;
  existing.summaries.add(truncateSingleLine(input.summary));
  for (const label of input.labels) {
    existing.labels.add(label);
  }
  for (const ref of input.evidenceRefs) {
    if (existing.evidenceRefs.size >= MAX_EVIDENCE_REFS_PER_PATTERN) break;
    existing.evidenceRefs.set(`${ref.kind}:${ref.ref}`, ref);
  }
}

export function isHighSignalLogCategory(
  category: RuntimeHealthAuditCategory,
): boolean {
  return category === "duplicate-consumer" || category === "cost-risk";
}
