import { isAbsolute, join } from "node:path";
import {
  buildProcessDisciplineRecord,
  PROCESS_DISCIPLINE_RUBRIC_VERSION,
  type ProcessDisciplineAbstentionEvidence,
  type ProcessDisciplineGrade,
  type ProcessDisciplineRecord,
} from "#core/agent-harness/index.js";
import type { TrajectoryDiagnosticsProjectionArtifact } from "#core/agent-harness/trajectory-diagnostics-projection.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type {
  WorkflowRunMetadata,
  WorkflowStepResult,
} from "#core/workflow/run-types.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { WorkflowRunSummary } from "../run-summary.js";

export const PROCESS_DISCIPLINE_WEAK_SAMPLE_THRESHOLD = 3;
export { PROCESS_DISCIPLINE_RUBRIC_VERSION };

export const PROCESS_DISCIPLINE_GROUP_DIMENSIONS = [
  "workflow",
  "harness",
  "taskClass",
  "taskArea",
] as const;

export type ProcessDisciplineGroupDimension =
  (typeof PROCESS_DISCIPLINE_GROUP_DIMENSIONS)[number];

export type ProcessDisciplineGradeCount = {
  grade: ProcessDisciplineGrade;
  count: number;
};

export type ProcessDisciplineReportRecord = {
  runId: string;
  workflow: string;
  stepId: string;
  harness: string;
  taskId: string | null;
  taskClass: string;
  taskArea: string;
  sourceArtifactPath: string;
  processDiscipline: ProcessDisciplineRecord;
};

export type ProcessDisciplineGroupSummary = {
  dimension: ProcessDisciplineGroupDimension;
  value: string;
  sampleCount: number;
  averageScore: number | null;
  gradeCounts: ProcessDisciplineGradeCount[];
  weakSample: boolean;
  missingEvidenceDimensions: number;
  unsupportedDimensions: number;
  sourceArtifactPaths: string[];
};

export type ProcessDisciplineReport = {
  rubricVersion: typeof PROCESS_DISCIPLINE_RUBRIC_VERSION;
  weakSampleThreshold: number;
  totalRecords: number;
  records: ProcessDisciplineReportRecord[];
  groups: ProcessDisciplineGroupSummary[];
};

const GRADE_ORDER: ProcessDisciplineGrade[] = [
  "excellent",
  "good",
  "caution",
  "weak",
  "unsupported",
];
const SOURCE_ARTIFACT_LIMIT = 5;
const GROUP_LIMIT = 40;

export function buildProcessDisciplineReport(input: {
  runs: readonly WorkflowRunMetadata[];
  runsDir: string;
  taskById: ReadonlyMap<string, RepoTaskFullRecord>;
}): ProcessDisciplineReport {
  const records = input.runs.flatMap((run) =>
    buildRunProcessDisciplineRecords(run, input.runsDir, input.taskById),
  );
  return {
    rubricVersion: PROCESS_DISCIPLINE_RUBRIC_VERSION,
    weakSampleThreshold: PROCESS_DISCIPLINE_WEAK_SAMPLE_THRESHOLD,
    totalRecords: records.length,
    records,
    groups: buildGroups(records),
  };
}

function buildRunProcessDisciplineRecords(
  run: WorkflowRunMetadata,
  runsDir: string,
  taskById: ReadonlyMap<string, RepoTaskFullRecord>,
): ProcessDisciplineReportRecord[] {
  const summary = readOptionalJsonFile<WorkflowRunSummary>(
    join(runsDir, run.id, "run-summary.json"),
  );
  const task = summary?.taskId ? taskById.get(summary.taskId) : undefined;
  return run.steps.flatMap((step) => {
    if (step.type !== "agent") return [];
    const artifactPath = step.trajectoryDiagnostics?.artifactPath;
    if (artifactPath === undefined || artifactPath.trim().length === 0) {
      return [];
    }
    const diagnostics =
      readOptionalJsonFile<TrajectoryDiagnosticsProjectionArtifact>(
        resolveRunArtifactPath(runsDir, run.id, artifactPath),
      );
    if (diagnostics === null) return [];
    const processDiscipline = buildProcessDisciplineRecord({
      diagnostics,
      source: {
        kind: "workflow-agent-step",
        artifactPath,
      },
      abstention: abstentionEvidenceForTask(task),
    });
    return [
      {
        runId: run.id,
        workflow: run.workflow,
        stepId: step.id,
        harness: stepHarness(step),
        taskId: summary?.taskId ?? null,
        taskClass: task?.taskClass ?? "(missing)",
        taskArea: task?.area || "(missing)",
        sourceArtifactPath: artifactPath,
        processDiscipline,
      },
    ];
  });
}

function resolveRunArtifactPath(
  runsDir: string,
  runId: string,
  artifactPath: string,
): string {
  if (isAbsolute(artifactPath)) return artifactPath;
  const runPrefix = `.kota/runs/${runId}/`;
  if (artifactPath.startsWith(runPrefix)) {
    return join(runsDir, runId, artifactPath.slice(runPrefix.length));
  }
  return join(runsDir, runId, artifactPath);
}

function stepHarness(step: WorkflowStepResult): string {
  const harness = step.harness?.trim();
  return harness && harness.length > 0 ? harness : "(missing)";
}

function abstentionEvidenceForTask(
  task: RepoTaskFullRecord | undefined,
): ProcessDisciplineAbstentionEvidence | undefined {
  if (task?.state !== "blocked") return undefined;
  return {
    outcome: "blocked",
    reason: `Linked task ${task.id} is in blocked state.`,
  };
}

function buildGroups(
  records: readonly ProcessDisciplineReportRecord[],
): ProcessDisciplineGroupSummary[] {
  const groups = new Map<
    string,
    {
      dimension: ProcessDisciplineGroupDimension;
      value: string;
      records: ProcessDisciplineReportRecord[];
    }
  >();
  for (const record of records) {
    for (const dimension of PROCESS_DISCIPLINE_GROUP_DIMENSIONS) {
      const value = groupValue(record, dimension);
      const key = `${dimension}\0${value}`;
      const group = groups.get(key) ?? { dimension, value, records: [] };
      group.records.push(record);
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .map((group) => summarizeGroup(group.dimension, group.value, group.records))
    .sort(compareGroups)
    .slice(0, GROUP_LIMIT);
}

function summarizeGroup(
  dimension: ProcessDisciplineGroupDimension,
  value: string,
  records: readonly ProcessDisciplineReportRecord[],
): ProcessDisciplineGroupSummary {
  const scores = records
    .map((record) => record.processDiscipline.aggregate.score)
    .filter((score): score is number => score !== null);
  return {
    dimension,
    value,
    sampleCount: records.length,
    averageScore:
      scores.length > 0
        ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
        : null,
    gradeCounts: gradeCounts(records),
    weakSample: records.length < PROCESS_DISCIPLINE_WEAK_SAMPLE_THRESHOLD,
    missingEvidenceDimensions: records.reduce(
      (sum, record) =>
        sum + record.processDiscipline.aggregate.missingEvidenceDimensions,
      0,
    ),
    unsupportedDimensions: records.reduce(
      (sum, record) =>
        sum + record.processDiscipline.aggregate.unsupportedDimensions,
      0,
    ),
    sourceArtifactPaths: firstUnique(
      records.map((record) => record.sourceArtifactPath),
      SOURCE_ARTIFACT_LIMIT,
    ),
  };
}

function groupValue(
  record: ProcessDisciplineReportRecord,
  dimension: ProcessDisciplineGroupDimension,
): string {
  switch (dimension) {
    case "workflow":
      return record.workflow;
    case "harness":
      return record.harness;
    case "taskClass":
      return record.taskClass;
    case "taskArea":
      return record.taskArea;
  }
}

function gradeCounts(
  records: readonly ProcessDisciplineReportRecord[],
): ProcessDisciplineGradeCount[] {
  return GRADE_ORDER.map((grade) => ({
    grade,
    count: records.filter(
      (record) => record.processDiscipline.aggregate.grade === grade,
    ).length,
  })).filter((entry) => entry.count > 0);
}

function firstUnique(values: readonly string[], limit: number): string[] {
  const unique: string[] = [];
  for (const value of values) {
    if (unique.includes(value)) continue;
    unique.push(value);
    if (unique.length >= limit) break;
  }
  return unique;
}

function compareGroups(
  left: ProcessDisciplineGroupSummary,
  right: ProcessDisciplineGroupSummary,
): number {
  return (
    right.sampleCount - left.sampleCount ||
    compareNullableScore(left.averageScore, right.averageScore) ||
    left.dimension.localeCompare(right.dimension) ||
    left.value.localeCompare(right.value)
  );
}

function compareNullableScore(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}
