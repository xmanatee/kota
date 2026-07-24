import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AutonomyHealthJsonValue,
  isAutonomyHealthJsonObject,
} from "#modules/autonomy/health-signal.js";
import {
  DAEMON_STOP_ATTEMPTS_RELATIVE_PATH,
  type DaemonStopAttemptRecord,
} from "#modules/daemon-ops/daemon-ops-operations.js";
import {
  addPattern,
  MAX_DAEMON_STOP_ATTEMPTS,
  normalizeLogCode,
  type RuntimeHealthAuditContext,
  stableHash,
  truncateSingleLine,
} from "./runtime-health-audit-model.js";

function scanTextEvidenceFile(args: {
  ctx: RuntimeHealthAuditContext;
  path: string;
  repoPath: string;
  sourceId: string;
  sourceKind: "daemon" | "inbox";
}): void {
  if (!existsSync(args.path)) return;
  const lines = readFileSync(args.path, "utf-8").split(/\r?\n/);
  if (args.sourceKind === "daemon") args.ctx.inspected.daemonEvidenceFiles += 1;
  if (args.sourceKind === "inbox") args.ctx.inspected.inboxEntries += 1;

  for (let index = 0; index < lines.length; index++) {
    const text = lines[index] ?? "";
    const timestamp = /"ts"\s*:\s*"([^"]+)"/.exec(text)?.[1];
    const timestampMs = timestamp === undefined ? Number.NaN : Date.parse(timestamp);
    if (args.sourceKind === "daemon" && !Number.isFinite(timestampMs)) continue;
    if (
      Number.isFinite(timestampMs) &&
      timestampMs < args.ctx.windowStartMs
    ) {
      continue;
    }
    const normalized = normalizeLogCode(text);
    if (
      /(shutdown|graceful stop|daemon stop|stopping daemon).*(timeout|timed out|hung|stuck)/.test(
        normalized,
      )
    ) {
      addPattern(args.ctx, {
        dedupeKey: "daemon:shutdown-timeout",
        category: "local-code",
        severity: "warning",
        actionability: "local-code",
        labels: ["daemon", "local-code", "shutdown", "runtime"],
        summary: "Daemon shutdown or graceful stop evidence reports a timeout.",
        source: { kind: args.sourceKind, id: args.sourceId },
        evidenceRefs: [
          {
            kind: "artifact",
            ref: `${args.repoPath}#L${index + 1}`,
            summary: truncateSingleLine(text),
          },
        ],
      });
    }

    if (/(runtime warning|runtime failure|dead-letter|interrupted run)/.test(normalized)) {
      const sourceLabel = args.sourceKind === "inbox" ? "inbox" : "daemon";
      addPattern(args.ctx, {
        dedupeKey: `${sourceLabel}:runtime-warning:${stableHash(normalized)}`,
        category: "operator-action",
        severity: "warning",
        actionability: "owner-action",
        labels: ["operator-action", "runtime", "warning"],
        summary:
          args.sourceKind === "inbox"
            ? "Operator inbox captured a runtime warning that needs routing."
            : "Recent daemon evidence captured a runtime warning that needs routing.",
        source: { kind: args.sourceKind, id: args.sourceId },
        evidenceRefs: [
          {
            kind: "artifact",
            ref: `${args.repoPath}#L${index + 1}`,
            summary: truncateSingleLine(text),
          },
        ],
      });
    }
  }
}

function isDaemonStopAttemptRecord(
  value: AutonomyHealthJsonValue,
): value is DaemonStopAttemptRecord {
  if (!isAutonomyHealthJsonObject(value)) return false;
  if (value.kind !== "daemon-stop-attempt") return false;
  if (typeof value.attemptedAt !== "string") return false;
  if (typeof value.timeoutSec !== "number") return false;
  const result = value.result;
  return isAutonomyHealthJsonObject(result) && typeof result.ok === "boolean";
}

function scanDaemonStopAttempts(ctx: RuntimeHealthAuditContext): void {
  const path = join(ctx.projectDir, DAEMON_STOP_ATTEMPTS_RELATIVE_PATH);
  if (!existsSync(path)) return;
  ctx.inspected.daemonEvidenceFiles += 1;

  const lines = readFileSync(path, "utf-8")
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter((entry) => entry.line.trim().length > 0)
    .slice(-MAX_DAEMON_STOP_ATTEMPTS);

  for (const entry of lines) {
    let parsed: AutonomyHealthJsonValue;
    try {
      parsed = JSON.parse(entry.line) as AutonomyHealthJsonValue;
    } catch {
      continue;
    }
    if (!isDaemonStopAttemptRecord(parsed)) continue;

    const attemptedMs = Date.parse(parsed.attemptedAt);
    if (Number.isFinite(attemptedMs) && attemptedMs < ctx.windowStartMs) continue;
    ctx.inspected.daemonStopAttempts += 1;

    if (
      parsed.result.ok === false &&
      parsed.result.reason === "timeout" &&
      typeof parsed.result.pid === "number"
    ) {
      addPattern(ctx, {
        dedupeKey: "daemon:shutdown-timeout",
        category: "local-code",
        severity: "warning",
        actionability: "local-code",
        labels: ["daemon", "local-code", "shutdown", "runtime"],
        summary: `Daemon stop timed out after ${parsed.timeoutSec}s for pid ${parsed.result.pid}.`,
        source: { kind: "daemon", id: "stop-attempts" },
        evidenceRefs: [
          {
            kind: "artifact",
            ref: `${DAEMON_STOP_ATTEMPTS_RELATIVE_PATH}#L${entry.lineNumber}`,
            summary: truncateSingleLine(
              `daemon stop timeout pid=${parsed.result.pid} timeoutSec=${parsed.timeoutSec}`,
            ),
          },
        ],
      });
    }
  }
}

export function scanDaemonEvidence(ctx: RuntimeHealthAuditContext): void {
  for (const name of ["daemon.log", "daemon.err"]) {
    scanTextEvidenceFile({
      ctx,
      path: join(ctx.projectDir, ".kota", name),
      repoPath: join(".kota", name),
      sourceId: name,
      sourceKind: "daemon",
    });
  }
  scanDaemonStopAttempts(ctx);
}

export function scanInboxWarnings(ctx: RuntimeHealthAuditContext): void {
  const inboxDir = join(ctx.projectDir, "data", "inbox");
  if (!existsSync(inboxDir)) return;
  for (const entry of readdirSync(inboxDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "AGENTS.md") {
      continue;
    }
    scanTextEvidenceFile({
      ctx,
      path: join(inboxDir, entry.name),
      repoPath: join("data", "inbox", entry.name),
      sourceId: entry.name.slice(0, -".md".length),
      sourceKind: "inbox",
    });
  }
}
