/**
 * Decision-attribution report inputs are deliberately visible artifacts:
 * bounded workflow metadata, normalized task records, run summaries, structured
 * reviewer records, owner-question records, and artifact filenames under the
 * run directory. Hidden reasoning traces and raw private transcript text are
 * out of scope; uncertainty stays explicit as `unknown`.
 */

import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type {
  WorkflowRunMetadata,
  WorkflowStepResult,
} from "#core/workflow/run-types.js";
import type { WorkflowRunSummary } from "#modules/autonomy/run-summary.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  hardSuccessSignalsForRun,
  operatorEvidenceRefs,
  refsForRun,
  troubleSignalsForRun,
} from "./decision-attribution-signals.js";
import type {
  DecisionAttribution,
  DecisionAttributionCount,
  DecisionAttributionRecord,
  DecisionAttributionReport,
  DecisionAttributionReportInput,
  DecisionAttributionWarning,
} from "./decision-attribution-types.js";
import type { OwnerInterventionReport } from "./owner-interventions.js";

const ATTRIBUTION_ORDER: DecisionAttribution[] = [
  "owner",
  "kota",
  "mixed",
  "unknown",
];

const KOTA_PLANNING_RE =
  /\b(?:explorer run|decomposer|progress-reviewer|critic|review-scrutiny|autonomy-health|trajectory-diagnostic|follow-up task|repair task|backlog-promoter|blocked-promoter|inbox-sorter|scope-improver)\b/i;
const OWNER_PLANNING_RE =
  /\b(?:owner (?:asked|requested|decided|captured|accepted|provided)|user (?:asked|requested|provided)|operator (?:asked|requested|provided)|inbox capture|manual capture)\b/i;
const DOMAIN_CONTEXT_RE =
  /\b(?:source \/ intent|research|owner|operator|anthropic|runtime evidence|watchlist|external source|source analyzes)\b/i;
const AUTONOMOUS_EXECUTION_WORKFLOWS = new Set([
  "attention-digest",
  "autonomy-health-reviewer",
  "backlog-promoter",
  "blocked-promoter",
  "builder",
  "decomposer",
  "explorer",
  "fan-out-consolidator",
  "inbox-sorter",
  "progress-reviewer",
  "research-retry",
  "review-scrutiny-escalator",
  "scope-improver",
  "trajectory-diagnostic-escalator",
]);

export function buildDecisionAttributionReport(
  input: DecisionAttributionReportInput,
): DecisionAttributionReport {
  const records = input.runs.map((run) => classifyRun(input, run));
  return {
    totalRuns: records.length,
    byPlanning: attributionCounts(records, (record) => record.planning),
    byExecution: attributionCounts(records, (record) => record.execution),
    byWorkMode: countRows(records, "workMode", (record) => record.workMode),
    hardSuccessSignals: countRows(
      records.flatMap((record) => record.hardSuccessSignals),
      "signal",
      (signal) => signal,
    ),
    troubleSignals: countRows(
      records.flatMap((record) => record.troubleSignals),
      "signal",
      (signal) => signal,
    ),
    warnings: buildWarnings(records),
    records,
  };
}

function classifyRun(
  input: DecisionAttributionReportInput,
  run: WorkflowRunMetadata,
): DecisionAttributionRecord {
  const runSummary = readOptionalJsonFile<WorkflowRunSummary>(
    join(input.runsDir, run.id, "run-summary.json"),
  );
  const taskId = runSummary?.taskId ?? taskIdFromStepOutputs(run);
  const task = taskId ? input.taskById.get(taskId) ?? null : null;
  const taskOwnerRecords = taskId
    ? input.ownerInterventions.records.filter((record) => record.taskId === taskId)
    : [];
  const runOwnerRecords = input.ownerInterventions.records.filter(
    (record) => record.runId === run.id,
  );
  const ownerRecords = dedupeOwnerRecords([...taskOwnerRecords, ...runOwnerRecords]);
  const reviewRecords = input.reviewRecords.filter((record) => record.runId === run.id);
  const productEvidenceRefs = task?.taskClass === "Product"
    ? operatorEvidenceRefs(input.runsDir, run.id, runSummary)
    : [];
  const planningContext =
    task && hasDecisionAttributionDomainContext(task) || ownerRecords.length > 0
      ? "owner-or-domain"
      : "insufficient";

  const hardSuccessSignals = hardSuccessSignalsForRun({
    run,
    task,
    runSummary,
    reviewRecords,
    ownerRecords,
    productEvidenceRefs,
  });
  const troubleSignals = troubleSignalsForRun({
    run,
    task,
    reviewRecords,
    ownerRecords,
    hardSuccessSignals,
    productEvidenceRefs,
  });

  return {
    runId: run.id,
    workflow: run.workflow,
    workMode: task?.taskClass !== undefined && task.taskClass !== "Unclassified"
      ? task.taskClass
      : `workflow:${run.workflow}`,
    taskId,
    taskTitle: runSummary?.taskTitle ?? task?.title ?? null,
    planning: planningAttribution(task, ownerRecords),
    planningContext,
    execution: executionAttribution(run, runSummary, runOwnerRecords),
    hardSuccessSignals,
    troubleSignals,
    refs: refsForRun(run, task, runSummary, productEvidenceRefs),
  };
}

function taskIdFromStepOutputs(run: WorkflowRunMetadata): string | null {
  for (const step of run.steps) {
    const output = step.output;
    if (!output || typeof output !== "object" || Array.isArray(output)) continue;
    const taskId = (output as Record<string, unknown>).taskId;
    if (typeof taskId === "string" && taskId.trim().length > 0) {
      return taskId.trim();
    }
  }
  return null;
}

function dedupeOwnerRecords(
  records: OwnerInterventionReport["records"],
): OwnerInterventionReport["records"] {
  const byId = new Map<string, OwnerInterventionReport["records"][number]>();
  for (const record of records) byId.set(record.questionId, record);
  return [...byId.values()];
}

function planningAttribution(
  task: RepoTaskFullRecord | null,
  ownerRecords: OwnerInterventionReport["records"],
): DecisionAttribution {
  const text = task
    ? [task.title, task.summary, task.body].join("\n")
    : "";
  const owner = ownerRecords.length > 0 || OWNER_PLANNING_RE.test(text);
  const kota = task !== null && KOTA_PLANNING_RE.test(text);
  if (owner && kota) return "mixed";
  if (owner) return "owner";
  if (kota) return "kota";
  return "unknown";
}

function executionAttribution(
  run: WorkflowRunMetadata,
  runSummary: WorkflowRunSummary | null,
  ownerRecords: OwnerInterventionReport["records"],
): DecisionAttribution {
  const owner = ownerRecords.length > 0 || run.steps.some(isOwnerExecutionStep);
  const kota =
    runSummary?.commitSha !== undefined ||
    run.steps.some((step) => step.type === "agent") ||
    AUTONOMOUS_EXECUTION_WORKFLOWS.has(run.workflow);
  if (owner && kota) return "mixed";
  if (owner) return "owner";
  if (kota) return "kota";
  return "unknown";
}

function isOwnerExecutionStep(step: WorkflowStepResult): boolean {
  if (step.type === "approval" || step.type === "await-event") return true;
  const output = step.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) return false;
  const record = output as Record<string, unknown>;
  return (
    typeof record.ownerQuestionId === "string" ||
    typeof record.decisionId === "string"
  );
}

function buildWarnings(
  records: readonly DecisionAttributionRecord[],
): DecisionAttributionWarning[] {
  const kotaWithoutContext = records.filter(
    (record) =>
      record.planning === "kota" &&
      record.planningContext === "insufficient",
  );
  const weakEvidence = records.filter((record) =>
    record.troubleSignals.includes("claimed-success-without-hard-evidence") ||
    record.troubleSignals.includes("weak-product-success-evidence")
  );
  const warnings: DecisionAttributionWarning[] = [];
  if (kotaWithoutContext.length > 0) {
    warnings.push({
      kind: "kota-planning-without-context",
      count: kotaWithoutContext.length,
      refs: warningRefs(kotaWithoutContext),
      message:
        "KOTA-planned work lacks visible owner/domain context; inspect before steering more work that way.",
    });
  }
  if (weakEvidence.length > 0) {
    warnings.push({
      kind: "success-lacks-hard-evidence",
      count: weakEvidence.length,
      refs: warningRefs(weakEvidence),
      message:
        "Successful runs lacked hard success evidence or Product rendered evidence.",
    });
  }
  return warnings;
}

function warningRefs(records: readonly DecisionAttributionRecord[]): string[] {
  return records.flatMap((record) => record.refs.slice(0, 2)).slice(0, 8);
}

function attributionCounts(
  records: readonly DecisionAttributionRecord[],
  keyFn: (record: DecisionAttributionRecord) => DecisionAttribution,
): DecisionAttributionCount<"attribution">[] {
  const rows = countRows(records, "attribution", keyFn);
  return rows.sort(
    (a, b) =>
      ATTRIBUTION_ORDER.indexOf(a.attribution as DecisionAttribution) -
      ATTRIBUTION_ORDER.indexOf(b.attribution as DecisionAttribution),
  );
}

function countRows<T, TKey extends string>(
  values: readonly T[],
  key: TKey,
  keyFn: (value: T) => string,
): DecisionAttributionCount<TKey>[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const label = keyFn(value);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ [key]: label, count }) as DecisionAttributionCount<TKey>)
    .sort((a, b) => b.count - a.count || a[key].localeCompare(b[key]));
}

export function hasDecisionAttributionDomainContext(
  task: RepoTaskFullRecord,
): boolean {
  return DOMAIN_CONTEXT_RE.test([task.title, task.summary, task.body].join("\n"));
}
