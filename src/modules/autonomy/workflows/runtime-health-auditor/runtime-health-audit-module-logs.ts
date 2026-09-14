import { join } from "node:path";
import { assertModuleStorageName } from "#core/modules/module-files.js";
import { moduleLogRecordDigest, moduleLogRecordReference } from "#core/modules/module-log.js";
import { listAnchoredDirectory, readAnchoredTextFile } from "#core/util/filesystem/anchored-files.js";
import { classifyModuleOperationHealth, moduleOperationRecoveryPattern } from "#modules/autonomy/autonomy-issue-module-failure.js";
import { stableToken } from "#modules/autonomy/autonomy-issue-source-shared.js";
import type { AutonomyHealthEvidenceRef } from "#modules/autonomy/health-signal.js";
import {
  type AutonomyHealthJsonObject,
  type AutonomyHealthJsonValue,
  isAutonomyHealthJsonObject,
  normalizeHealthSignal,
} from "#modules/autonomy/health-signal.js";
import {
  addPattern,
  isHighSignalLogCategory,
  MAX_LOG_LINES_PER_FILE,
  type PatternInput,
  type RuntimeHealthAuditContext,
  truncateSingleLine,
} from "./runtime-health-audit-model.js";

type LogObservation = {
  moduleName: string;
  operation: string;
  line: string;
  text: string;
};

function parseJsonLine(line: string): AutonomyHealthJsonObject | null {
  try {
    const value = JSON.parse(line) as AutonomyHealthJsonValue;
    return isAutonomyHealthJsonObject(value) ? value : null;
  } catch {
    return null;
  }
}

function stringField(
  object: AutonomyHealthJsonObject,
  field: string,
): string | null {
  const value = object[field];
  return typeof value === "string" && value.trim() ? value : null;
}

function logLineText(
  parsed: AutonomyHealthJsonObject,
  line: string,
): string {
  return (
    stringField(parsed, "message") ??
    stringField(parsed, "msg") ??
    stringField(parsed, "error") ??
    stringField(parsed, "reason") ??
    stringField(parsed, "detail") ??
    stringField(parsed, "event") ??
    line
  );
}

function classifyLogObservation(
  observation: LogObservation,
): PatternInput | null {
  const evidence: AutonomyHealthEvidenceRef = {
    kind: "module-log",
    ref: moduleLogRecordReference(observation.moduleName, observation.line),
    summary: truncateSingleLine(observation.text),
  };

  const pattern = classifyModuleOperationHealth({
    module: observation.moduleName,
    operation: observation.operation,
    message: observation.text,
  });
  if (pattern.labels.includes("unclassified")) return null;
  const category: PatternInput["category"] = pattern.labels.includes("cost-risk")
    ? "cost-risk"
    : pattern.labels.includes("duplicate-consumer")
      ? "duplicate-consumer"
      : pattern.actionability === "external-service"
        ? "external-service/auth"
        : pattern.actionability === "owner-action"
          ? "operator-action"
          : "local-code";
  return {
    ...pattern,
    category,
    evidenceRefs: [evidence],
  };
}

export function scanModuleLogs(ctx: RuntimeHealthAuditContext): void {
  const modulesDir = join(ctx.stateDir, "modules");
  for (const entry of listAnchoredDirectory({ rootPath: ctx.scopeRoot, boundaryDir: modulesDir, directoryPath: modulesDir })) {
    if (entry.kind !== "directory") continue;
    const moduleName = entry.name;
    assertModuleStorageName(moduleName);
    const absolutePath = join(modulesDir, moduleName, "logs.jsonl");
    const file = readAnchoredTextFile({ rootPath: ctx.scopeRoot, boundaryDir: join(modulesDir, moduleName), filePath: absolutePath });
    if (file === null) continue;

    ctx.inspected.moduleLogFiles += 1;
    const lines = file.content
      .split(/\r?\n/)
      .map((line, index) => ({ line, lineNumber: index + 1 }))
      .filter((entry) => entry.line.trim().length > 0)
      .slice(-MAX_LOG_LINES_PER_FILE)
      .flatMap((entry) => {
        const parsed = parseJsonLine(entry.line);
        if (!parsed) return [];
        const timestamp = stringField(parsed, "ts");
        const timestampMs = timestamp === null ? Number.NaN : Date.parse(timestamp);
        if (!Number.isFinite(timestampMs) || timestampMs < ctx.windowStartMs || timestampMs > ctx.nowMs) {
          return [];
        }
        const data = parsed.data;
        const operation = isAutonomyHealthJsonObject(data)
          ? stringField(data, "operation") ?? "legacy-log"
          : "legacy-log";
        const text = logLineText(parsed, entry.line);
        // Only the historical Telegram producer's exact success message is a
        // legacy recovery. Arbitrary informational logs cannot clear failures.
        const recovered = parsed.level === "info" && isAutonomyHealthJsonObject(data) && (
          data.health === "recovered" ||
          (moduleName === "telegram" && operation === "poll-loop" &&
            parsed.level === "info" && text === "telegram-interactive poll loop completed a healthy getUpdates request; interactive reply not verified")
        );
        if (!recovered && parsed.level !== undefined && parsed.level !== "warn" && parsed.level !== "error") return [];
        return [{ ...entry, operation, text, recovered, timestamp: new Date(timestampMs).toISOString() }];
      });
    ctx.inspected.moduleLogLines += lines.length;

    const localPatterns = new Map<string, { pattern: PatternInput; records: typeof lines }>();
    for (const line of lines) {
      if (line.recovered) continue;
      const pattern = classifyLogObservation({ moduleName, operation: line.operation, line: line.line, text: line.text });
      if (!pattern) continue;
      const key = JSON.stringify([pattern.dedupeKey, line.operation]);
      const group = localPatterns.get(key) ?? { pattern, records: [] };
      if (!group.records.some((record) => record.line === line.line)) group.records.push(line);
      localPatterns.set(key, group);
    }

    for (const { pattern, records } of localPatterns.values()) {
      records.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.line.localeCompare(b.line));
      const latestFailure = records.at(-1)!;
      const evidenceRefs = records.map((record) => ({
        kind: "module-log" as const,
        ref: moduleLogRecordReference(moduleName, record.line),
        summary: truncateSingleLine(record.text),
        moduleOperation: { operation: stableToken(record.operation), observedAt: record.timestamp, observation: "present" as const },
      }));
      if (records.length >= ctx.logPatternMinObservations || isHighSignalLogCategory(pattern.category)) {
        addPattern(ctx, { ...pattern, observationCount: records.length, evidenceRefs });
      }
      ctx.moduleSignals.push(normalizeHealthSignal({
        ...pattern,
        signalId: `module-log-${moduleLogRecordDigest(latestFailure.line)}:${pattern.dedupeKey}`,
        observation: "present",
        createdAt: latestFailure.timestamp,
        observationCount: records.length,
        evidenceRefs,
      }));
    }
    for (const recovery of lines.filter((line) => line.recovered)) {
      ctx.moduleSignals.push(normalizeHealthSignal({
        ...moduleOperationRecoveryPattern(moduleName, recovery.operation),
        signalId: `module-log-recovery-${moduleLogRecordDigest(recovery.line)}`,
        observation: "cleared",
        createdAt: recovery.timestamp,
        observationCount: 1,
        evidenceRefs: [{
          kind: "module-log",
          ref: moduleLogRecordReference(moduleName, recovery.line),
          moduleOperation: { operation: stableToken(recovery.operation), observedAt: recovery.timestamp, observation: "cleared" },
        }],
      }));
    }
  }
}
