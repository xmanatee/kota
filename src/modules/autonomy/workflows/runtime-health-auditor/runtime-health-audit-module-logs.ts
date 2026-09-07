import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyModuleOperationHealth } from "#modules/autonomy/autonomy-issue-module-failure.js";
import type { AutonomyHealthEvidenceRef } from "#modules/autonomy/health-signal.js";
import {
  type AutonomyHealthJsonObject,
  type AutonomyHealthJsonValue,
  isAutonomyHealthJsonObject,
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
  path: string;
  lineNumber: number;
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
    ref: `${observation.path}#L${observation.lineNumber}`,
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
  if (!existsSync(modulesDir)) return;

  for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const moduleName = entry.name;
    const absolutePath = join(modulesDir, moduleName, "logs.jsonl");
    if (!existsSync(absolutePath)) continue;

    const repoPath = join(".kota", "modules", moduleName, "logs.jsonl");
    ctx.inspected.moduleLogFiles += 1;
    const lines = readFileSync(absolutePath, "utf-8")
      .split(/\r?\n/)
      .map((line, index) => ({ line, lineNumber: index + 1 }))
      .filter((entry) => entry.line.trim().length > 0)
      .slice(-MAX_LOG_LINES_PER_FILE)
      .flatMap((entry) => {
        const parsed = parseJsonLine(entry.line);
        if (!parsed) return [];
        const timestamp = stringField(parsed, "ts");
        const timestampMs = timestamp === null ? Number.NaN : Date.parse(timestamp);
        if (!Number.isFinite(timestampMs) || timestampMs < ctx.windowStartMs) {
          return [];
        }
        const data = parsed.data;
        const operation = isAutonomyHealthJsonObject(data)
          ? stringField(data, "operation") ?? "legacy-log"
          : "legacy-log";
        return [{ ...entry, operation, text: logLineText(parsed, entry.line) }];
      });
    ctx.inspected.moduleLogLines += lines.length;

    const localPatterns = new Map<string, PatternInput[]>();
    for (const line of lines) {
      const pattern = classifyLogObservation({
        moduleName,
        operation: line.operation,
        path: repoPath,
        lineNumber: line.lineNumber,
        text: line.text,
      });
      if (!pattern) continue;
      const list = localPatterns.get(pattern.dedupeKey) ?? [];
      list.push(pattern);
      localPatterns.set(pattern.dedupeKey, list);
    }

    for (const [dedupeKey, observations] of localPatterns) {
      const first = observations[0]!;
      if (
        observations.length < ctx.logPatternMinObservations &&
        !isHighSignalLogCategory(first.category)
      ) {
        continue;
      }
      addPattern(ctx, {
        ...first,
        dedupeKey,
        observationCount: observations.length,
        evidenceRefs: observations.flatMap((item) => item.evidenceRefs),
      });
    }
  }
}
