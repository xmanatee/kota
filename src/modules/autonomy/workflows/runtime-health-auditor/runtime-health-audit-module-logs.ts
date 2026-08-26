import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  normalizeLogCode,
  type PatternInput,
  type RuntimeHealthAuditContext,
  stableHash,
  truncateSingleLine,
} from "./runtime-health-audit-model.js";

type LogObservation = {
  moduleName: string;
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
  const normalized = normalizeLogCode(observation.text);
  const evidence: AutonomyHealthEvidenceRef = {
    kind: "module-log",
    ref: `${observation.path}#L${observation.lineNumber}`,
    summary: truncateSingleLine(observation.text),
  };

  if (
    observation.moduleName === "telegram" &&
    /getupdates/.test(normalized) &&
    /(conflict|terminated by other getupdates request|409)/.test(normalized)
  ) {
    return {
      dedupeKey: "module:telegram:getupdates-conflict",
      category: "duplicate-consumer",
      severity: "error",
      actionability: "owner-action",
      labels: [
        "duplicate-consumer",
        "external-service",
        "operator-action",
        "telegram",
      ],
      summary:
        "Telegram getUpdates conflict indicates another consumer is using the same bot token.",
      source: { kind: "module-log", id: "telegram", module: "telegram" },
      evidenceRefs: [evidence],
    };
  }

  if (/(unauthorized|forbidden|invalid token|auth|oauth|401|403)/.test(normalized)) {
    return {
      dedupeKey: `module:${observation.moduleName}:auth-failure`,
      category: "external-service/auth",
      severity: "error",
      actionability: "external-service",
      labels: ["auth", "external-service", observation.moduleName],
      summary: `${observation.moduleName} log reports an auth/setup failure.`,
      source: {
        kind: "module-log",
        id: observation.moduleName,
        module: observation.moduleName,
      },
      evidenceRefs: [evidence],
    };
  }

  if (
    /(rate limit|429|timeout|econnreset|etimedout|enotfound|network|temporar)/.test(
      normalized,
    )
  ) {
    return {
      dedupeKey: `module:${observation.moduleName}:external-provider-failure`,
      category: "external-service/auth",
      severity: "warning",
      actionability: "external-service",
      labels: ["external-service", observation.moduleName, "provider"],
      summary: `${observation.moduleName} log reports repeated provider or network failures.`,
      source: {
        kind: "module-log",
        id: observation.moduleName,
        module: observation.moduleName,
      },
      evidenceRefs: [evidence],
    };
  }

  if (/(cost|budget|spend|token).*(exceed|limit|spike|risk|runaway)/.test(normalized)) {
    return {
      dedupeKey: `module:${observation.moduleName}:cost-risk`,
      category: "cost-risk",
      severity: "critical",
      actionability: "informational",
      labels: ["cost-risk", observation.moduleName, "runtime"],
      summary: `${observation.moduleName} log reports a runtime cost-risk condition.`,
      source: {
        kind: "module-log",
        id: observation.moduleName,
        module: observation.moduleName,
      },
      evidenceRefs: [evidence],
    };
  }

  if (
    /(typeerror|referenceerror|syntaxerror|err_module_not_found|cannot find module|invariant|assertion failed)/.test(
      normalized,
    )
  ) {
    return {
      dedupeKey: `module:${observation.moduleName}:local-code:${stableHash(normalized)}`,
      category: "local-code",
      severity: "error",
      actionability: "local-code",
      labels: ["local-code", observation.moduleName, "runtime"],
      summary: `${observation.moduleName} log reports a repeated local runtime error.`,
      source: {
        kind: "module-log",
        id: observation.moduleName,
        module: observation.moduleName,
      },
      evidenceRefs: [evidence],
    };
  }

  return null;
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
        return [{ ...entry, text: logLineText(parsed, entry.line) }];
      });
    ctx.inspected.moduleLogLines += lines.length;

    const localPatterns = new Map<string, PatternInput[]>();
    for (const line of lines) {
      const pattern = classifyLogObservation({
        moduleName,
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
