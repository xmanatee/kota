import type {
  HarnessParityMatrixAggregate,
  HarnessParityMatrixGroupAggregate,
  HarnessParityMatrixRow,
} from "./client.js";

export type MatrixGroup = {
  key: string;
  rows: HarnessParityMatrixRow[];
};

function groupKey(row: HarnessParityMatrixRow): string {
  return [
    row.targetKind,
    row.role,
    row.label,
    row.provider,
    row.model,
    row.harnessName,
    row.scenarioId,
  ].join("\u0000");
}

export function groupRows(
  rows: readonly HarnessParityMatrixRow[],
): MatrixGroup[] {
  const byKey = new Map<string, HarnessParityMatrixRow[]>();
  for (const row of rows) {
    const key = groupKey(row);
    const group = byKey.get(key) ?? [];
    group.push(row);
    byKey.set(key, group);
  }
  return [...byKey.entries()].map(([key, groupedRows]) => ({
    key,
    rows: groupedRows,
  }));
}

export function aggregateGroup(
  group: MatrixGroup,
): HarnessParityMatrixGroupAggregate {
  const first = group.rows[0]!;
  const runnableRows = group.rows.filter((row) => row.status !== "skipped");
  const passedRepeats = runnableRows.filter(
    (row) => row.status === "passed",
  ).length;
  const passAtK =
    runnableRows.length === 0 ? null : passedRepeats > 0 ? 1 : 0;
  const passHatK =
    runnableRows.length === 0
      ? null
      : passedRepeats === runnableRows.length
        ? 1
        : 0;
  return {
    targetKind: first.targetKind,
    role: first.role,
    label: first.label,
    provider: first.provider,
    model: first.model,
    harnessName: first.harnessName,
    scenarioId: first.scenarioId,
    repeatCount: first.repeatCount,
    runnableRepeats: runnableRows.length,
    skippedRepeats: group.rows.length - runnableRows.length,
    passedRepeats,
    passAtK,
    passHatK,
  };
}

export function aggregateMatrix(
  groups: readonly HarnessParityMatrixGroupAggregate[],
): HarnessParityMatrixAggregate {
  const runnableGroups = groups.filter((group) => group.passAtK !== null);
  const passAtK =
    runnableGroups.length === 0
      ? null
      : runnableGroups.filter((group) => group.passAtK === 1).length /
        runnableGroups.length;
  const passHatK =
    runnableGroups.length === 0
      ? null
      : runnableGroups.filter((group) => group.passHatK === 1).length /
        runnableGroups.length;
  return {
    groupCount: groups.length,
    runnableGroupCount: runnableGroups.length,
    skippedGroupCount: groups.length - runnableGroups.length,
    passAtK,
    passHatK,
  };
}
