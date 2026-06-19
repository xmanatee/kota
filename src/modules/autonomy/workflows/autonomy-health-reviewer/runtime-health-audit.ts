import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import type { DeadLetterItem } from "#core/daemon/dead-letter-queue.js";
import { redactSensitiveText } from "#core/evidence/policy.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { isProcessAlive } from "#core/util/process-alive.js";
import { STATE_FILE } from "#core/workflow/run-store-snapshot.js";
import { PAUSE_SIGNAL_FILE } from "#core/workflow/runtime-signals.js";
import type {
  AutonomyHealthActionability,
  AutonomyHealthEvidenceRef,
  AutonomyHealthSeverity,
  AutonomyHealthSignal,
  AutonomyHealthSignalInput,
} from "#modules/autonomy/health-signal.js";
import {
  type AutonomyHealthJsonObject,
  type AutonomyHealthJsonValue,
  isAutonomyHealthJsonObject,
  normalizeHealthSignal,
} from "#modules/autonomy/health-signal.js";
import {
  DAEMON_STOP_ATTEMPTS_RELATIVE_PATH,
  type DaemonStopAttemptRecord,
} from "#modules/daemon-ops/daemon-ops-operations.js";
import {
  buildOperatorRuntimeInboxItems,
  type OperatorInboxItem,
} from "#modules/daemon-ops/operator-inbox.js";
import type { StatusSnapshot } from "#modules/daemon-ops/status-cli.js";
import { loadRunsInWindow } from "#modules/workflow-ops/runs/workflow-history.js";

export const RUNTIME_HEALTH_AUDIT_ARTIFACT = "runtime-health-audit.json";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_MS = 7 * MS_PER_DAY;
const DEFAULT_STALE_DLQ_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOG_PATTERN_MIN_OBSERVATIONS = 2;
const DEFAULT_INTERRUPTED_RUN_MIN_COUNT = 2;
const MAX_EVIDENCE_REFS_PER_PATTERN = 12;
const MAX_SUMMARIES_PER_PATTERN = 5;
const MAX_LOG_LINES_PER_FILE = 500;
const MAX_RUN_ERROR_TEXT_BYTES = 4000;
const MAX_DAEMON_STOP_ATTEMPTS = 100;

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
    daemonEvidenceFiles: number;
    daemonStopAttempts: number;
    inboxEntries: number;
    operatorRuntimeWarnings: number;
  };
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

type MutablePattern = {
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

type PatternInput = {
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

type RuntimeHealthAuditContext = {
  projectDir: string;
  nowIso: string;
  nowMs: number;
  windowStartMs: number;
  staleDeadLetterMs: number;
  logPatternMinObservations: number;
  interruptedRunMinCount: number;
  patterns: Map<string, MutablePattern>;
  inspected: RuntimeHealthAudit["inspected"];
};

type LogObservation = {
  moduleName: string;
  path: string;
  lineNumber: number;
  text: string;
};

type HistoricalWorkflowSnapshot = {
  activeRuns: number;
  queuedRuns: number;
  workflowPaused: boolean;
};

type WorkflowHistoryRun = ReturnType<typeof loadRunsInWindow>[number];

type InterruptedRunCause =
  | "unknown-local"
  | "daemon-restart"
  | "harness-abort";

type InterruptedRunObservation = {
  run: WorkflowHistoryRun;
  cause: InterruptedRunCause;
  errorSummary: string | null;
};

const SEVERITY_RANK: Record<AutonomyHealthSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

function maxSeverity(
  left: AutonomyHealthSeverity,
  right: AutonomyHealthSeverity,
): AutonomyHealthSeverity {
  return SEVERITY_RANK[right] > SEVERITY_RANK[left] ? right : left;
}

function truncateSingleLine(value: string, max = 220): string {
  const single = redactSensitiveText(value).replace(/\s+/g, " ").trim();
  if (single.length <= max) return single;
  return `${single.slice(0, max - 3)}...`;
}

function stableHash(value: string, length = 12): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function normalizeLogCode(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/[^\s]+/g, "<url>")
    .replace(/[0-9a-f]{8,}/g, "<hash>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

function patternSummary(pattern: MutablePattern): string {
  return [...pattern.summaries].slice(0, MAX_SUMMARIES_PER_PATTERN).join(" ");
}

function addPattern(ctx: RuntimeHealthAuditContext, input: PatternInput): void {
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

function isHighSignalLogCategory(category: RuntimeHealthAuditCategory): boolean {
  return category === "duplicate-consumer" || category === "cost-risk";
}

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

function logLineText(line: string): string {
  const parsed = parseJsonLine(line);
  if (!parsed) return line;
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

function scanModuleLogs(ctx: RuntimeHealthAuditContext): void {
  const modulesDir = join(ctx.projectDir, ".kota", "modules");
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
      .filter((line) => line.trim().length > 0)
      .slice(-MAX_LOG_LINES_PER_FILE);
    ctx.inspected.moduleLogLines += lines.length;

    const localPatterns = new Map<string, PatternInput[]>();
    for (let index = 0; index < lines.length; index++) {
      const text = logLineText(lines[index]!);
      const pattern = classifyLogObservation({
        moduleName,
        path: repoPath,
        lineNumber: index + 1,
        text,
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

type DeadLetterSnapshot = {
  items: DeadLetterItem[];
};

function dlqWorkflowKey(item: DeadLetterItem): string {
  const workflow =
    item.affectedWorkflowNames[0] ??
    (item.source.kind === "workflow-dispatch" ? item.source.workflowName : null);
  return workflow ?? item.owningModule;
}

function deadLetterCategory(
  item: DeadLetterItem,
): Pick<PatternInput, "category" | "actionability" | "labels" | "severity"> {
  switch (item.failure.lastErrorClass) {
    case "auth":
    case "provider":
    case "rate_limit":
      return {
        category: "external-service/auth",
        actionability: "external-service",
        labels: ["dead-letter", "external-service", item.failure.lastErrorClass],
        severity: "warning",
      };
    case "schema":
    case "validation":
    case "execution":
    case "unknown":
      return {
        category: "local-code",
        actionability: "local-code",
        labels: ["dead-letter", "local-code", item.failure.lastErrorClass],
        severity: "error",
      };
  }
}

function scanDeadLetters(ctx: RuntimeHealthAuditContext): void {
  const path = join(ctx.projectDir, ".kota", "dead-letter-queue", "items.json");
  const snapshot = readOptionalJsonFile<DeadLetterSnapshot>(path);
  if (!snapshot) return;
  ctx.inspected.deadLetterItems = snapshot.items.length;

  for (const item of snapshot.items) {
    if (item.status !== "open") continue;
    const updatedMs = Date.parse(item.updatedAt);
    if (!Number.isFinite(updatedMs)) continue;
    if (ctx.nowMs - updatedMs < ctx.staleDeadLetterMs) continue;
    ctx.inspected.staleOpenDeadLetterItems += 1;

    const classification = deadLetterCategory(item);
    const workflowKey = dlqWorkflowKey(item);
    addPattern(ctx, {
      dedupeKey:
        `dead-letter:${item.failure.lastErrorClass}:${item.owningModule}:${workflowKey}`.toLowerCase(),
      category: classification.category,
      severity: classification.severity,
      actionability: classification.actionability,
      labels: classification.labels,
      summary:
        `Stale open dead-letter item ${item.id} has remained open since ${item.updatedAt}.`,
      source: { kind: "dead-letter", id: item.id },
      evidenceRefs: [
        {
          kind: "dead-letter",
          ref: `.kota/dead-letter-queue/items.json#${item.id}`,
          summary: truncateSingleLine(
            `${item.id}: ${item.failure.lastErrorClass} ${item.failure.reason}`,
          ),
        },
      ],
    });
  }
}

function readInterruptedRunErrorSummary(
  ctx: RuntimeHealthAuditContext,
  run: WorkflowHistoryRun,
): string | null {
  const errorPath = join(ctx.projectDir, ".kota", "runs", run.id, "error.txt");
  if (!existsSync(errorPath)) return null;
  const text = readFileSync(errorPath, "utf-8").slice(0, MAX_RUN_ERROR_TEXT_BYTES);
  return truncateSingleLine(text);
}

function classifyInterruptedRunCause(
  errorSummary: string | null,
): InterruptedRunCause {
  if (!errorSummary) return "unknown-local";
  const normalized = normalizeLogCode(errorSummary);
  if (/daemon restarted while run was in progress/.test(normalized)) {
    return "daemon-restart";
  }
  if (
    /codex cli run aborted/.test(normalized) ||
    /agent step "[^"]+" failed \(aborted\)/.test(normalized)
  ) {
    return "harness-abort";
  }
  return "unknown-local";
}

function interruptedRunEvidenceRefs(
  observation: InterruptedRunObservation,
): AutonomyHealthEvidenceRef[] {
  const runRef = `.kota/runs/${observation.run.id}/metadata.json`;
  const refs: AutonomyHealthEvidenceRef[] = [
    {
      kind: "run",
      ref: runRef,
      summary: observation.errorSummary
        ? `${observation.run.workflow} ${observation.run.status} at ${observation.run.startedAt}: ${observation.errorSummary}`
        : `${observation.run.workflow} ${observation.run.status} at ${observation.run.startedAt}`,
    },
  ];
  if (observation.errorSummary) {
    refs.push({
      kind: "artifact",
      ref: `.kota/runs/${observation.run.id}/error.txt`,
      summary: observation.errorSummary,
    });
  }
  return refs;
}

function interruptedRunPattern(
  workflow: string,
  cause: InterruptedRunCause,
  observations: readonly InterruptedRunObservation[],
): PatternInput {
  const count = observations.length;
  const evidenceRefs = observations.flatMap((observation) =>
    interruptedRunEvidenceRefs(observation)
  );
  if (cause === "daemon-restart") {
    return {
      dedupeKey: `workflow:${workflow}:interrupted-run:daemon-restart`,
      category: "operator-action",
      severity: "warning",
      actionability: "owner-action",
      labels: ["daemon-restart", "interrupted-run", "operator-action", "runtime", workflow],
      summary:
        `${workflow} has ${count} recent interrupted runs caused by daemon restart/recovery; inspect runtime lifecycle evidence before opening a local-code repair.`,
      source: { kind: "workflow", id: workflow, workflow },
      observationCount: count,
      evidenceRefs,
    };
  }
  if (cause === "harness-abort") {
    return {
      dedupeKey: `workflow:${workflow}:interrupted-run:harness-abort`,
      category: "operator-action",
      severity: "warning",
      actionability: "owner-action",
      labels: ["harness-abort", "interrupted-run", "operator-action", "runtime", workflow],
      summary:
        `${workflow} has ${count} recent interrupted runs caused by agent harness aborts; inspect the abort source before opening a local-code repair.`,
      source: { kind: "workflow", id: workflow, workflow },
      observationCount: count,
      evidenceRefs,
    };
  }
  return {
    dedupeKey: `workflow:${workflow}:interrupted-run`,
    category: "local-code",
    severity: "error",
    actionability: "local-code",
    labels: ["interrupted-run", "local-code", "runtime", workflow],
    summary:
      `${workflow} has ${count} recent interrupted runs that need root-cause review.`,
    source: { kind: "workflow", id: workflow, workflow },
    observationCount: count,
    evidenceRefs,
  };
}

function scanRuns(ctx: RuntimeHealthAuditContext): void {
  const runsDir = join(ctx.projectDir, ".kota", "runs");
  const runs = loadRunsInWindow(runsDir, ctx.windowStartMs);
  ctx.inspected.recentRuns = runs.length;

  const interruptedByWorkflowAndCause = new Map<
    string,
    {
      workflow: string;
      cause: InterruptedRunCause;
      observations: InterruptedRunObservation[];
    }
  >();
  for (const run of runs) {
    if (run.status !== "interrupted") continue;
    ctx.inspected.interruptedRuns += 1;
    const errorSummary = readInterruptedRunErrorSummary(ctx, run);
    const cause = classifyInterruptedRunCause(errorSummary);
    const key = `${run.workflow}\0${cause}`;
    const existing = interruptedByWorkflowAndCause.get(key) ?? {
      workflow: run.workflow,
      cause,
      observations: [],
    };
    existing.observations.push({ run, cause, errorSummary });
    interruptedByWorkflowAndCause.set(key, existing);
  }

  for (const group of interruptedByWorkflowAndCause.values()) {
    if (group.observations.length < ctx.interruptedRunMinCount) continue;
    addPattern(
      ctx,
      interruptedRunPattern(group.workflow, group.cause, group.observations),
    );
  }
}

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
    const normalized = normalizeLogCode(text);
    if (
      /(shutdown|graceful stop|daemon stop|stopping daemon).*(timeout|timed out|hung|stuck)/.test(
        normalized,
      )
    ) {
      addPattern(args.ctx, {
        dedupeKey: "daemon:shutdown-timeout",
        category: "local-code",
        severity: "error",
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
      addPattern(args.ctx, {
        dedupeKey: `inbox:runtime-warning:${stableHash(normalized)}`,
        category: "operator-action",
        severity: "warning",
        actionability: "owner-action",
        labels: ["operator-action", "runtime", "warning"],
        summary: "Operator inbox captured a runtime warning that needs routing.",
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
        severity: "error",
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

function scanDaemonEvidence(ctx: RuntimeHealthAuditContext): void {
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

function scanInboxWarnings(ctx: RuntimeHealthAuditContext): void {
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

function classifyDaemonControlFileForAudit(
  projectDir: string,
): StatusSnapshot["controlFile"] {
  const controlPath = join(projectDir, ".kota", "daemon-control.json");
  if (!existsSync(controlPath)) return { kind: "missing" };
  let parsed: AutonomyHealthJsonValue;
  try {
    parsed = JSON.parse(readFileSync(controlPath, "utf-8")) as AutonomyHealthJsonValue;
  } catch {
    return { kind: "unreadable" };
  }
  if (
    !isAutonomyHealthJsonObject(parsed) ||
    typeof parsed.port !== "number" ||
    typeof parsed.pid !== "number"
  ) {
    return { kind: "unreadable" };
  }
  const baseURL = `http://127.0.0.1:${parsed.port}`;
  if (isProcessAlive(parsed.pid)) {
    return { kind: "fresh", pid: parsed.pid, baseURL };
  }
  return { kind: "stale", pid: parsed.pid, baseURL };
}

function readHistoricalWorkflowSnapshot(
  projectDir: string,
): HistoricalWorkflowSnapshot {
  const state = readOptionalJsonFile<AutonomyHealthJsonObject>(
    join(projectDir, ".kota", STATE_FILE),
  );
  return {
    activeRuns: Array.isArray(state?.activeRuns) ? state.activeRuns.length : 0,
    queuedRuns: Array.isArray(state?.pendingRuns) ? state.pendingRuns.length : 0,
    workflowPaused: existsSync(join(projectDir, ".kota", PAUSE_SIGNAL_FILE)),
  };
}

function hasHistoricalWorkflowWarning(
  snapshot: HistoricalWorkflowSnapshot,
): boolean {
  return (
    snapshot.activeRuns > 0 ||
    snapshot.queuedRuns > 0 ||
    snapshot.workflowPaused
  );
}

function buildOperatorRuntimeStatusForAudit(
  projectDir: string,
): StatusSnapshot {
  const controlFile = classifyDaemonControlFileForAudit(projectDir);
  const historicalWorkflow = readHistoricalWorkflowSnapshot(projectDir);
  const daemonRunning = controlFile.kind === "fresh";
  return {
    daemonRunning,
    ...(daemonRunning ? { daemonPid: controlFile.pid } : {}),
    activeRuns: daemonRunning ? historicalWorkflow.activeRuns : 0,
    queuedRuns: daemonRunning ? historicalWorkflow.queuedRuns : 0,
    workflowPaused: daemonRunning ? historicalWorkflow.workflowPaused : false,
    sessions: 0,
    pendingApprovals: 0,
    projectDir,
    projectName: basename(projectDir) || projectDir,
    controlFile,
    ...(!daemonRunning ? { historicalWorkflow } : {}),
  };
}

function runtimeInboxEvidenceRef(item: OperatorInboxItem): AutonomyHealthEvidenceRef {
  const ref =
    item.id === "offline-workflow-store"
      ? join(".kota", STATE_FILE)
      : join(".kota", "daemon-control.json");
  return {
    kind: "artifact",
    ref,
    summary: truncateSingleLine(`${item.title}: ${item.detail} Action: ${item.action}`),
  };
}

function runtimeInboxLabels(item: OperatorInboxItem): string[] {
  const labels = ["operator-action", "runtime", "operator-inbox", item.id];
  if (item.id.startsWith("daemon-control")) labels.push("daemon-control");
  if (item.id.startsWith("daemon-")) labels.push("daemon");
  if (item.id === "offline-workflow-store") labels.push("workflow-store");
  return labels;
}

function runtimeInboxSeverity(item: OperatorInboxItem): AutonomyHealthSeverity {
  return item.role === "error" ? "error" : "warning";
}

function scanOperatorRuntimeWarnings(ctx: RuntimeHealthAuditContext): void {
  const status = buildOperatorRuntimeStatusForAudit(ctx.projectDir);
  const hasControlFileEvidence = status.controlFile.kind !== "missing";
  const hasWorkflowEvidence =
    status.historicalWorkflow !== undefined &&
    hasHistoricalWorkflowWarning(status.historicalWorkflow);
  const items = buildOperatorRuntimeInboxItems(status).filter(
    (item) =>
      item.id !== "daemon-offline" || hasControlFileEvidence || hasWorkflowEvidence,
  );
  ctx.inspected.operatorRuntimeWarnings += items.length;

  for (const item of items) {
    addPattern(ctx, {
      dedupeKey: `operator-inbox:runtime:${item.id}`,
      category: "operator-action",
      severity: runtimeInboxSeverity(item),
      actionability: "owner-action",
      labels: runtimeInboxLabels(item),
      summary: `Operator runtime inbox warning: ${item.title}. ${item.detail}`,
      source: { kind: "inbox", id: `runtime:${item.id}` },
      evidenceRefs: [runtimeInboxEvidenceRef(item)],
    });
  }
}

function finalizedPatterns(ctx: RuntimeHealthAuditContext): RuntimeHealthAuditPattern[] {
  return [...ctx.patterns.values()]
    .map((pattern) => ({
      dedupeKey: pattern.dedupeKey,
      category: pattern.category,
      severity: pattern.severity,
      actionability: pattern.actionability,
      labels: [...pattern.labels].sort((a, b) => a.localeCompare(b)),
      summary: patternSummary(pattern),
      source: pattern.source,
      observationCount: pattern.observationCount,
      evidenceRefs: [...pattern.evidenceRefs.values()].slice(
        0,
        MAX_EVIDENCE_REFS_PER_PATTERN,
      ),
    }))
    .sort((a, b) => {
      const severityDelta = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (severityDelta !== 0) return severityDelta;
      return a.dedupeKey.localeCompare(b.dedupeKey);
    });
}

function signalForPattern(
  pattern: RuntimeHealthAuditPattern,
  createdAt: string,
): AutonomyHealthSignal {
  const input: AutonomyHealthSignalInput = {
    source: pattern.source,
    severity: pattern.severity,
    labels: pattern.labels,
    summary: pattern.summary,
    evidenceRefs: pattern.evidenceRefs,
    actionability: pattern.actionability,
    dedupeKey: pattern.dedupeKey,
    createdAt,
  };
  return normalizeHealthSignal(input);
}

export function collectRuntimeHealthAudit(args: {
  projectDir: string;
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
    inspected: {
      moduleLogFiles: 0,
      moduleLogLines: 0,
      deadLetterItems: 0,
      staleOpenDeadLetterItems: 0,
      recentRuns: 0,
      interruptedRuns: 0,
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
