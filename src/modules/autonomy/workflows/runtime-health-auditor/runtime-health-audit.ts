import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { scanDeadLetters } from "./runtime-health-audit-dead-letters.js";
import {
  scanDaemonEvidence,
  scanInboxWarnings,
} from "./runtime-health-audit-evidence.js";
import {
  finalizedPatterns,
  signalForPattern,
} from "./runtime-health-audit-finalize.js";
import {
  DEFAULT_INTERRUPTED_RUN_MIN_COUNT,
  DEFAULT_LOG_PATTERN_MIN_OBSERVATIONS,
  DEFAULT_STALE_DLQ_MS,
  DEFAULT_WINDOW_MS,
  RUNTIME_HEALTH_AUDIT_ARTIFACT,
  type RuntimeHealthAudit,
  type RuntimeHealthAuditContext,
  type RuntimeHealthAuditOptions,
} from "./runtime-health-audit-model.js";
import { scanModuleLogs } from "./runtime-health-audit-module-logs.js";
import { scanOperatorRuntimeWarnings } from "./runtime-health-audit-operator-runtime.js";
import { scanRuns } from "./runtime-health-audit-runs.js";

export type {
  RuntimeHealthAudit,
  RuntimeHealthAuditCategory,
  RuntimeHealthAuditOptions,
  RuntimeHealthAuditPattern,
} from "./runtime-health-audit-model.js";
export { RUNTIME_HEALTH_AUDIT_ARTIFACT };

export function collectRuntimeHealthAudit(args: {
  projectDir: string;
  stateDir: string;
  scopeDir: string;
  options?: RuntimeHealthAuditOptions;
}): RuntimeHealthAudit {
  const nowIso = args.options?.nowIso ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) {
    throw new Error(`runtime health audit nowIso is not parseable: ${nowIso}`);
  }
  const windowMs = args.options?.windowMs ?? DEFAULT_WINDOW_MS;
  const windowStartMs = nowMs - windowMs;
  const ctx: RuntimeHealthAuditContext = {
    projectDir: args.projectDir,
    stateDir: args.stateDir,
    scopeDir: args.scopeDir,
    nowIso,
    nowMs,
    windowStartMs,
    staleDeadLetterMs: args.options?.staleDeadLetterMs ?? DEFAULT_STALE_DLQ_MS,
    logPatternMinObservations:
      args.options?.logPatternMinObservations ??
      DEFAULT_LOG_PATTERN_MIN_OBSERVATIONS,
    interruptedRunMinCount:
      args.options?.interruptedRunMinCount ?? DEFAULT_INTERRUPTED_RUN_MIN_COUNT,
    patterns: new Map(),
    evidenceGaps: [],
    inspected: {
      moduleLogFiles: 0,
      moduleLogLines: 0,
      deadLetterItems: 0,
      staleOpenDeadLetterItems: 0,
      recentRuns: 0,
      interruptedRuns: 0,
      controlCoverageArtifacts: 0,
      controlCoverageGapRuns: 0,
      controlCoverageUnknownRuns: 0,
      policyPrunedEvidenceRefs: 0,
      producerMissingEvidenceRefs: 0,
      daemonEvidenceFiles: 0,
      daemonStopAttempts: 0,
      inboxEntries: 0,
      operatorRuntimeWarnings: 0,
    },
  };

  scanModuleLogs(ctx);
  scanDeadLetters(ctx);
  scanRuns(ctx);
  scanDaemonEvidence(ctx);
  scanInboxWarnings(ctx);
  scanOperatorRuntimeWarnings(ctx);

  const patterns = finalizedPatterns(ctx);
  return {
    generatedAt: nowIso,
    windowStart: new Date(windowStartMs).toISOString(),
    inspected: ctx.inspected,
    evidenceGaps: ctx.evidenceGaps,
    patterns,
    signals: patterns.map((pattern) => signalForPattern(pattern, nowIso)),
  };
}

export function writeRuntimeHealthAuditArtifact(
  runDir: string,
  audit: RuntimeHealthAudit,
): string {
  mkdirSync(runDir, { recursive: true });
  const artifactPath = join(runDir, RUNTIME_HEALTH_AUDIT_ARTIFACT);
  writeFileSync(artifactPath, `${JSON.stringify(audit, null, 2)}\n`, "utf-8");
  return artifactPath;
}

export type RuntimeHealthAuditOperationInput = {
  projectDir: string;
  stateDir: string;
  scopeDir: string;
  runDirPath: string;
  nowIso: string;
};

export type RuntimeHealthAuditOperationOutput = {
  audit: RuntimeHealthAudit;
  artifactPath: string;
};

export function collectRuntimeHealthAuditInWorker(
  input: RuntimeHealthAuditOperationInput,
): RuntimeHealthAuditOperationOutput {
  const audit = collectRuntimeHealthAudit({
    projectDir: input.projectDir,
    stateDir: input.stateDir,
    scopeDir: input.scopeDir,
    options: { nowIso: input.nowIso },
  });
  return {
    audit,
    artifactPath: writeRuntimeHealthAuditArtifact(input.runDirPath, audit),
  };
}

export const collectRuntimeHealthAuditOperation =
  defineWorkflowBlockingOperation<
    RuntimeHealthAuditOperationInput,
    RuntimeHealthAuditOperationOutput
  >(import.meta.url, "collectRuntimeHealthAuditInWorker");
