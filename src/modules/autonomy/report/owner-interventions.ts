import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type OwnerQuestionOrigin,
  OwnerQuestionQueue,
  type PendingOwnerQuestion,
} from "#core/daemon/owner-question-queue.js";
import { classifyOwnerInterventionOutcome } from "./owner-intervention-classification.js";
import {
  emptyOwnerInterventionReport,
  type OwnerInterventionCountRow,
  type OwnerInterventionMarker,
  type OwnerInterventionPressureBucket,
  type OwnerInterventionRecord,
  type OwnerInterventionReport,
} from "./owner-intervention-types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_STALE_PENDING_MS = MS_PER_DAY;
const MAX_BUCKET_ROWS = 10;

export type { OwnerInterventionReport } from "./owner-intervention-types.js";

export type OwnerInterventionReportInput = {
  projectDir: string;
  windowStartMs: number;
  windowEndMs: number;
};

export function buildOwnerInterventionReport(
  input: OwnerInterventionReportInput,
): OwnerInterventionReport {
  const dir = join(input.projectDir, ".kota", "owner-questions");
  if (!existsSync(dir)) return emptyOwnerInterventionReport();

  const queue = new OwnerQuestionQueue(dir);
  const records = queue
    .list()
    .filter((question) => isInReportWindow(question, input))
    .map((question) => toOwnerInterventionRecord(question, input.windowEndMs))
    .sort(compareOwnerInterventionRecords);

  return summarizeOwnerInterventions(records);
}

function isInReportWindow(
  question: PendingOwnerQuestion,
  input: OwnerInterventionReportInput,
): boolean {
  if (question.status === "pending") return true;
  const createdMs = Date.parse(question.createdAt);
  if (
    Number.isFinite(createdMs) &&
    createdMs >= input.windowStartMs &&
    createdMs <= input.windowEndMs
  ) {
    return true;
  }
  const resolvedMs =
    question.resolvedAt === undefined ? Number.NaN : Date.parse(question.resolvedAt);
  return (
    Number.isFinite(resolvedMs) &&
    resolvedMs >= input.windowStartMs &&
    resolvedMs <= input.windowEndMs
  );
}

function toOwnerInterventionRecord(
  question: PendingOwnerQuestion,
  nowMs: number,
): OwnerInterventionRecord {
  const createdMs = Date.parse(question.createdAt);
  const ageDays = Number.isFinite(createdMs)
    ? Math.max(0, Math.floor((nowMs - createdMs) / MS_PER_DAY))
    : 0;
  const origin = originFields(question.origin);
  const markers = interventionMarkers(question, nowMs);
  const workflow = origin.workflowName;
  const run = origin.runId;
  const task = origin.taskId;

  return {
    questionId: question.id,
    status: question.status,
    createdAt: question.createdAt,
    resolvedAt: question.resolvedAt ?? null,
    source: question.source.trim() || "(unknown)",
    originKind: question.origin.kind,
    workflowName: workflow,
    runId: run,
    stepId: origin.stepId,
    taskId: task,
    answerBehavior: question.answerBehavior,
    outcomeBucket: classifyOwnerInterventionOutcome(question),
    ageDays,
    refs: {
      question: `owner-question:${question.id}`,
      workflow,
      run: run === null ? null : `run:${run}`,
      task: task === null ? null : `task:${task}`,
    },
    markers,
  };
}

function originFields(origin: OwnerQuestionOrigin): {
  workflowName: string | null;
  runId: string | null;
  stepId: string | null;
  taskId: string | null;
} {
  if (origin.kind !== "workflow") {
    return { workflowName: null, runId: null, stepId: null, taskId: null };
  }
  return {
    workflowName: cleanOptional(origin.workflowName),
    runId: cleanOptional(origin.runId),
    stepId: cleanOptional(origin.stepId),
    taskId: cleanOptional(origin.taskId),
  };
}

function cleanOptional(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function interventionMarkers(
  question: PendingOwnerQuestion,
  nowMs: number,
): OwnerInterventionMarker[] {
  const markers: OwnerInterventionMarker[] = [];
  if (
    question.origin.kind === "manual" &&
    question.origin.source === "not recorded"
  ) {
    markers.push("legacy-origin");
  }
  if (question.answerBehavior === "unknown") {
    markers.push("legacy-answer-behavior");
  }
  if (question.status === "pending" && isStalePending(question, nowMs)) {
    markers.push("stale-pending");
  }
  if (question.status === "expired" || question.resolutionSource === "timeout") {
    markers.push("resolved-by-timeout");
  }
  return markers;
}

function isStalePending(question: PendingOwnerQuestion, nowMs: number): boolean {
  const createdMs = Date.parse(question.createdAt);
  if (!Number.isFinite(createdMs)) return false;
  const thresholdMs = question.timeoutMs ?? DEFAULT_STALE_PENDING_MS;
  return nowMs >= createdMs + thresholdMs;
}

function summarizeOwnerInterventions(
  records: OwnerInterventionRecord[],
): OwnerInterventionReport {
  const byStatus = new Map<string, number>();
  const byOutcome = new Map<string, number>();
  const byAnswerBehavior = new Map<string, number>();
  const bySource = new Map<string, OwnerInterventionPressureBucket>();
  const byWorkflow = new Map<string, OwnerInterventionPressureBucket>();
  const byTask = new Map<string, OwnerInterventionPressureBucket>();
  let stalePending = 0;
  let answeredCorrections = 0;
  let timeouts = 0;
  let legacyUnknown = 0;

  for (const record of records) {
    addCount(byStatus, record.status);
    addCount(byOutcome, record.outcomeBucket);
    addCount(byAnswerBehavior, record.answerBehavior);
    if (record.markers.includes("stale-pending")) stalePending += 1;
    if (record.markers.includes("resolved-by-timeout")) timeouts += 1;
    if (
      record.outcomeBucket === "freeform-correction" ||
      record.outcomeBucket === "setup-action"
    ) {
      answeredCorrections += 1;
    }
    if (
      record.markers.includes("legacy-origin") ||
      record.markers.includes("legacy-answer-behavior")
    ) {
      legacyUnknown += 1;
    }
    addPressureBucket(bySource, record.source, record);
    addPressureBucket(byWorkflow, record.workflowName ?? "(none)", record);
    if (record.taskId !== null) addPressureBucket(byTask, record.taskId, record);
  }

  return {
    totalQuestions: records.length,
    pending: byStatus.get("pending") ?? 0,
    stalePending,
    answered: byStatus.get("answered") ?? 0,
    answeredCorrections,
    dismissed: byStatus.get("dismissed") ?? 0,
    timeouts,
    legacyUnknown,
    byStatus: countRows(byStatus, "status"),
    byOutcome: countRows(byOutcome, "outcome"),
    byAnswerBehavior: countRows(byAnswerBehavior, "answerBehavior"),
    bySource: pressureRows(bySource),
    byWorkflow: pressureRows(byWorkflow),
    byTask: pressureRows(byTask),
    records,
  };
}

function addCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function countRows<TKey extends string>(
  map: Map<string, number>,
  key: TKey,
): OwnerInterventionCountRow<TKey>[] {
  return [...map.entries()]
    .map(([label, count]) => ({ [key]: label, count }) as OwnerInterventionCountRow<TKey>)
    .sort((a, b) => b.count - a.count || a[key].localeCompare(b[key]));
}

function addPressureBucket(
  map: Map<string, OwnerInterventionPressureBucket>,
  key: string,
  record: OwnerInterventionRecord,
): void {
  const bucket = map.get(key) ?? {
    key,
    total: 0,
    stalePending: 0,
    timeouts: 0,
    answeredCorrections: 0,
  };
  bucket.total += 1;
  if (record.markers.includes("stale-pending")) bucket.stalePending += 1;
  if (record.markers.includes("resolved-by-timeout")) bucket.timeouts += 1;
  if (
    record.outcomeBucket === "freeform-correction" ||
    record.outcomeBucket === "setup-action"
  ) {
    bucket.answeredCorrections += 1;
  }
  map.set(key, bucket);
}

function pressureRows(
  map: Map<string, OwnerInterventionPressureBucket>,
): OwnerInterventionPressureBucket[] {
  return [...map.values()]
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
    .slice(0, MAX_BUCKET_ROWS);
}

function compareOwnerInterventionRecords(
  a: OwnerInterventionRecord,
  b: OwnerInterventionRecord,
): number {
  const pressure =
    pressureRank(b) - pressureRank(a) ||
    Date.parse(b.createdAt) - Date.parse(a.createdAt);
  return pressure || a.questionId.localeCompare(b.questionId);
}

function pressureRank(record: OwnerInterventionRecord): number {
  if (record.markers.includes("stale-pending")) return 4;
  if (record.markers.includes("resolved-by-timeout")) return 3;
  if (record.outcomeBucket === "freeform-correction") return 2;
  if (record.outcomeBucket === "setup-action") return 2;
  if (record.status === "pending") return 1;
  return 0;
}
