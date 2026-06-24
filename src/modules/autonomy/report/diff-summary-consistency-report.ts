import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import {
  DIFF_SUMMARY_CONSISTENCY_ARTIFACT,
  type DiffSummaryConsistencyRecord,
  type DiffSummaryMismatchCategory,
  type DiffSummaryMissingData,
} from "#modules/autonomy/diff-summary-consistency.js";
import { isBuilderTerminalRun } from "./code-health-drift-reader.js";

export type DiffSummaryConsistencyMissingKind =
  | DiffSummaryMissingData
  | "artifact";

export type DiffSummaryConsistencyExample = {
  runId: string;
  taskId: string | null;
  commitRef: string | null;
  categories: DiffSummaryMismatchCategory[];
  changedFileCount: number;
  topLevelAreas: string[];
  moduleNames: string[];
};

export type DiffSummaryConsistencyReport = {
  totalBuilderRuns: number;
  recordedRuns: number;
  runsWithMismatches: number;
  totalMismatches: number;
  byCategory: { category: DiffSummaryMismatchCategory; count: number }[];
  missingData: { kind: DiffSummaryConsistencyMissingKind; count: number }[];
  examples: DiffSummaryConsistencyExample[];
};

export function buildDiffSummaryConsistencyReport(input: {
  runs: readonly WorkflowRunMetadata[];
  runsDir: string;
}): DiffSummaryConsistencyReport {
  let totalBuilderRuns = 0;
  let recordedRuns = 0;
  let runsWithMismatches = 0;
  let totalMismatches = 0;
  const categoryCounts = new Map<DiffSummaryMismatchCategory, number>();
  const missingCounts = new Map<DiffSummaryConsistencyMissingKind, number>();
  const examples: DiffSummaryConsistencyExample[] = [];

  for (const run of input.runs) {
    if (!isBuilderTerminalRun(run)) continue;
    totalBuilderRuns += 1;
    const record = readOptionalJsonFile<DiffSummaryConsistencyRecord>(
      join(input.runsDir, run.id, DIFF_SUMMARY_CONSISTENCY_ARTIFACT),
    );
    if (!record) {
      addCount(missingCounts, "artifact");
      continue;
    }
    recordedRuns += 1;
    for (const kind of record.missingData) addCount(missingCounts, kind);
    if (record.mismatches.length === 0) continue;
    runsWithMismatches += 1;
    totalMismatches += record.mismatches.length;
    const categories = sortedUnique(
      record.mismatches.map((mismatch) => mismatch.category),
    );
    for (const category of categories) addCount(categoryCounts, category);
    examples.push({
      runId: record.runId ?? run.id,
      taskId: record.taskId,
      commitRef: record.commitSha,
      categories,
      changedFileCount: record.facts.changedFileCount,
      topLevelAreas: record.facts.topLevelAreas,
      moduleNames: record.facts.moduleNames,
    });
  }

  return {
    totalBuilderRuns,
    recordedRuns,
    runsWithMismatches,
    totalMismatches,
    byCategory: sortedCountRows(categoryCounts, "category"),
    missingData: sortedCountRows(missingCounts, "kind"),
    examples: examples
      .sort((left, right) => right.runId.localeCompare(left.runId))
      .slice(0, 8),
  };
}

function addCount<TKey extends string>(counts: Map<TKey, number>, key: TKey): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function sortedCountRows<TKey extends string, TLabel extends string>(
  counts: Map<TKey, number>,
  label: TLabel,
): Array<Record<TLabel, TKey> & { count: number }> {
  return [...counts.entries()]
    .map(([key, count]) => ({ [label]: key, count }) as Record<TLabel, TKey> & { count: number })
    .sort((left, right) => right.count - left.count || String(left[label]).localeCompare(String(right[label])));
}

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}
