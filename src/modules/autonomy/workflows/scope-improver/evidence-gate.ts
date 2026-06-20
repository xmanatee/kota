import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { KotaJsonObject, KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import { deadLetterStoreForProject } from "#core/daemon/dead-letter-queue.js";
import { readOptionalJsonFile, writeJsonFileAtomic } from "#core/util/json-file.js";
import type { WorkflowRunStatus, WorkflowRunWarning } from "#core/workflow/run-types.js";
import {
  SOURCE_FILE_SIZE_WARNING_TYPE,
  type SourceFileSizeWarning,
} from "#modules/autonomy/source-size-check.js";
import type {
  ScopeImprovementEvidenceReadyPayload,
  ScopeImprovementEvidenceReadySource,
  ScopeImprovementEvidenceReadySourceKind,
} from "./events.js";
import { SCOPE_IMPROVEMENT_MAX_SIGNATURES } from "./scope-improvement-types.js";

const EVIDENCE_GATE_STATE_PATH = join(
  ".kota",
  "scope-improvement",
  "evidence-ready.json",
);
const MAX_RECENT_RUNS = 20;
const REPEATED_WARNING_RUNS = 3;
const DEAD_LETTER_STORE_FILE = join(".kota", "dead-letter-queue", "items.json");

const EVIDENCE_WEIGHTS = {
  "file-churn": 0,
  "task-churn": 0,
  "failed-run": 5,
  "dead-letter": 5,
  recovery: 3,
  "repeated-warning": 3,
  "oversized-source": 2,
} satisfies Record<ScopeImprovementEvidenceReadySourceKind, number>;

type EvidenceGateState = {
  recentSignatures: {
    signature: string;
    firstSeenAt: string;
    lastSeenAt: string;
    totalWeight: number;
  }[];
};

type RunEvidenceMetadata = {
  id: string;
  workflow: string;
  status: WorkflowRunStatus | "running";
  triggerEvent: string | null;
  warnings: WorkflowRunWarning[];
};

type EvidenceGateStateEntry = EvidenceGateState["recentSignatures"][number];

export type ScopeImprovementEvidenceGateResult = {
  shouldEmit: boolean;
  reason: string;
  payload: ScopeImprovementEvidenceReadyPayload | null;
};

export function scopeImprovementEvidenceWeight(
  kind: ScopeImprovementEvidenceReadySourceKind,
): number {
  return EVIDENCE_WEIGHTS[kind];
}

function stableHash(value: string, length = 20): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function jsonObject(value: KotaJsonValue | undefined): KotaJsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
}

function jsonArray(value: KotaJsonValue | undefined): KotaJsonValue[] {
  return Array.isArray(value) ? value : [];
}

function isEvidenceGateStateEntry(
  value: KotaJsonValue,
): value is EvidenceGateStateEntry {
  const entry = jsonObject(value);
  return (
    entry !== null &&
    typeof entry.signature === "string" &&
    typeof entry.firstSeenAt === "string" &&
    typeof entry.lastSeenAt === "string" &&
    typeof entry.totalWeight === "number"
  );
}

function readEvidenceGateState(projectDir: string): EvidenceGateState {
  const raw = jsonObject(
    readOptionalJsonFile<KotaJsonValue>(
      join(projectDir, EVIDENCE_GATE_STATE_PATH),
    ) ?? undefined,
  );
  if (!raw) return { recentSignatures: [] };
  return {
    recentSignatures: jsonArray(raw.recentSignatures).filter(
      isEvidenceGateStateEntry,
    ),
  };
}

function writeEvidenceGateState(projectDir: string, state: EvidenceGateState): void {
  writeJsonFileAtomic(join(projectDir, EVIDENCE_GATE_STATE_PATH), state);
}

function runMetadataDirs(projectDir: string): string[] {
  const runsDir = join(projectDir, ".kota", "runs");
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir).sort().reverse().slice(0, MAX_RECENT_RUNS);
}

function workflowStatus(
  value: KotaJsonValue | undefined,
): RunEvidenceMetadata["status"] | null {
  if (
    value === "success" ||
    value === "failed" ||
    value === "interrupted" ||
    value === "completed-with-warnings" ||
    value === "running"
  ) {
    return value;
  }
  return null;
}

function isWorkflowWarning(value: KotaJsonValue): value is WorkflowRunWarning {
  const warning = jsonObject(value);
  return (
    warning !== null &&
    typeof warning.type === "string" &&
    typeof warning.message === "string"
  );
}

function workflowWarnings(value: KotaJsonValue | undefined): WorkflowRunWarning[] {
  return jsonArray(value).filter(isWorkflowWarning);
}

function readRunMetadata(projectDir: string): RunEvidenceMetadata[] {
  return runMetadataDirs(projectDir).flatMap((runId) => {
    const raw = jsonObject(
      readOptionalJsonFile<KotaJsonValue>(
        join(projectDir, ".kota", "runs", runId, "metadata.json"),
      ) ?? undefined,
    );
    if (!raw) return [];
    const status = workflowStatus(raw.status);
    if (!status) return [];
    const trigger = jsonObject(raw.trigger);
    return [
      {
        id: typeof raw.id === "string" ? raw.id : runId,
        workflow: typeof raw.workflow === "string" ? raw.workflow : "unknown",
        status,
        triggerEvent: typeof trigger?.event === "string" ? trigger.event : null,
        warnings: workflowWarnings(raw.warnings),
      },
    ];
  });
}

function source(args: {
  kind: ScopeImprovementEvidenceReadySourceKind;
  id: string;
  ref: string;
  summary: string;
}): ScopeImprovementEvidenceReadySource {
  return {
    ...args,
    weight: scopeImprovementEvidenceWeight(args.kind),
  };
}

function failedRunSources(runs: readonly RunEvidenceMetadata[]) {
  return runs
    .filter((run) => run.status === "failed")
    .map((run) =>
      source({
        kind: "failed-run",
        id: `run:${run.id}`,
        ref: join(".kota", "runs", run.id, "metadata.json"),
        summary: `${run.workflow} run failed`,
      }),
    );
}

function recoveryRunSources(runs: readonly RunEvidenceMetadata[]) {
  return runs
    .filter((run) => run.triggerEvent === "runtime.recovered")
    .map((run) =>
      source({
        kind: "recovery",
        id: `recovery:${run.id}`,
        ref: join(".kota", "runs", run.id, "metadata.json"),
        summary: `${run.workflow} ran from runtime recovery`,
      }),
    );
}

function repeatedWarningSources(runs: readonly RunEvidenceMetadata[]) {
  const grouped = new Map<
    string,
    { workflow: string; warningType: string; runIds: string[] }
  >();
  for (const run of runs) {
    if (run.status !== "completed-with-warnings") continue;
    for (const warning of run.warnings) {
      const warningType = warning.type.trim();
      if (!warningType) continue;
      const key = `${run.workflow}\0${warningType}`;
      const current = grouped.get(key) ?? {
        workflow: run.workflow,
        warningType,
        runIds: [],
      };
      current.runIds.push(run.id);
      grouped.set(key, current);
    }
  }
  return [...grouped.values()]
    .filter((group) => group.runIds.length >= REPEATED_WARNING_RUNS)
    .map((group) =>
      source({
        kind: "repeated-warning",
        id:
          `warning:${group.workflow}:${group.warningType}:` +
          stableHash(group.runIds.join("\0"), 12),
        ref: join(".kota", "runs", group.runIds[0] ?? "", "metadata.json"),
        summary:
          `${group.workflow} completed with warning ${group.warningType} in ` +
          `${group.runIds.length} recent runs`,
      }),
    );
}

function isSourceSizeWarning(value: KotaJsonValue): value is SourceFileSizeWarning {
  const warning = jsonObject(value);
  return (
    warning !== null &&
    warning.type === SOURCE_FILE_SIZE_WARNING_TYPE &&
    typeof warning.file === "string" &&
    typeof warning.lines === "number" &&
    typeof warning.threshold === "number" &&
    typeof warning.changedLines === "number" &&
    typeof warning.message === "string"
  );
}

function oversizedSourceSources(projectDir: string, runs: readonly RunEvidenceMetadata[]) {
  return runs.flatMap((run) => {
    const summary = jsonObject(
      readOptionalJsonFile<KotaJsonValue>(
        join(projectDir, ".kota", "runs", run.id, "run-summary.json"),
      ) ?? undefined,
    );
    const warnings = jsonArray(summary?.warnings).filter(isSourceSizeWarning);
    return warnings.map((warning) =>
      source({
        kind: "oversized-source",
        id: `oversized:${run.id}:${warning.file}`,
        ref: join(".kota", "runs", run.id, "run-summary.json"),
        summary:
          `Touched oversized source file ${warning.file} ` +
          `(${warning.lines} lines)`,
      }),
    );
  });
}

function deadLetterSources(projectDir: string) {
  if (!existsSync(join(projectDir, DEAD_LETTER_STORE_FILE))) return [];
  return deadLetterStoreForProject(projectDir)
    .list({ status: "open", limit: 8 })
    .map((item) =>
      source({
        kind: "dead-letter",
        id: `dead-letter:${item.id}`,
        ref: `${DEAD_LETTER_STORE_FILE}#${item.id}`,
        summary:
          `Open dead-letter item for ` +
          `${item.affectedWorkflowNames.join(", ") || item.owningModule}`,
      }),
    );
}

export function collectScopeImprovementEvidenceReadySources(
  projectDir: string,
): ScopeImprovementEvidenceReadySource[] {
  const runs = readRunMetadata(projectDir);
  return [
    ...failedRunSources(runs),
    ...deadLetterSources(projectDir),
    ...recoveryRunSources(runs),
    ...repeatedWarningSources(runs),
    ...oversizedSourceSources(projectDir, runs),
  ]
    .filter((item) => item.weight > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function dedupeSignatureFor(
  sources: readonly ScopeImprovementEvidenceReadySource[],
): string {
  return `scope-evidence:${stableHash(
    sources.map((item) => `${item.kind}:${item.id}:${item.weight}`).join("\n"),
  )}`;
}

function reasonFor(sources: readonly ScopeImprovementEvidenceReadySource[]): string {
  const counts = new Map<ScopeImprovementEvidenceReadySourceKind, number>();
  for (const item of sources) {
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${kind}=${count}`);
  const totalWeight = sources.reduce((sum, item) => sum + item.weight, 0);
  return `weighted scope-improvement evidence: ${parts.join(" ")} totalWeight=${totalWeight}`;
}

export function inspectScopeImprovementEvidenceGate(args: {
  projectDir: string;
  now?: Date;
}): ScopeImprovementEvidenceGateResult {
  const sources = collectScopeImprovementEvidenceReadySources(args.projectDir);
  if (sources.length === 0) {
    return {
      shouldEmit: false,
      reason: "no weighted scope-improvement evidence",
      payload: null,
    };
  }
  const totalWeight = sources.reduce((sum, item) => sum + item.weight, 0);
  const dedupeSignature = dedupeSignatureFor(sources);
  const payload: ScopeImprovementEvidenceReadyPayload = {
    generatedAt: (args.now ?? new Date()).toISOString(),
    reason: reasonFor(sources),
    dedupeSignature,
    totalWeight,
    evidenceIds: sources.map((item) => item.id),
    sources,
  };
  const alreadySeen = readEvidenceGateState(args.projectDir).recentSignatures.some(
    (entry) => entry.signature === dedupeSignature,
  );
  return {
    shouldEmit: !alreadySeen,
    reason: alreadySeen
      ? `duplicate scope-improvement evidence signature ${dedupeSignature}`
      : payload.reason,
    payload,
  };
}

export function recordScopeImprovementEvidenceReady(args: {
  projectDir: string;
  payload: ScopeImprovementEvidenceReadyPayload;
}): void {
  const state = readEvidenceGateState(args.projectDir);
  const existing = state.recentSignatures.find(
    (entry) => entry.signature === args.payload.dedupeSignature,
  );
  const entry = {
    signature: args.payload.dedupeSignature,
    firstSeenAt: existing?.firstSeenAt ?? args.payload.generatedAt,
    lastSeenAt: args.payload.generatedAt,
    totalWeight: args.payload.totalWeight,
  };
  writeEvidenceGateState(args.projectDir, {
    recentSignatures: [
      entry,
      ...state.recentSignatures.filter(
        (item) => item.signature !== args.payload.dedupeSignature,
      ),
    ].slice(0, SCOPE_IMPROVEMENT_MAX_SIGNATURES),
  });
}
