import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import type {
  CodeHealthCleanupCoverage,
  CodeHealthDriftRecord,
  CodeHealthRepeatedSurface,
} from "./code-health-drift-types.js";

export function buildRepeatedSurfaces(
  warningRecords: ReadonlyArray<{ record: CodeHealthDriftRecord; bucket: "current" | "prior" }>,
  openTasks: readonly RepoTaskFullRecord[],
  exceptionCoverageByFile: Map<string, CodeHealthCleanupCoverage[]>,
): CodeHealthRepeatedSurface[] {
  const counts = new Map<string, CodeHealthRepeatedSurface>();
  for (const { record, bucket } of warningRecords) {
    for (const file of record.files) {
      const existing = counts.get(file) ?? emptySurface(file, record);
      if (bucket === "current") existing.currentWarnings += 1;
      else existing.priorWarnings += 1;
      existing.totalWarnings += 1;
      if (record.runId.localeCompare(existing.latestRunId) > 0) {
        existing.latestRunId = record.runId;
      }
      counts.set(file, existing);
    }
  }
  return [...counts.values()]
    .filter((surface) => surface.totalWarnings > 1)
    .map((surface) => ({
      ...surface,
      cleanupCoverage: [
        ...findOpenCleanupCoverage([surface.file], openTasks),
        ...(exceptionCoverageByFile.get(surface.file) ?? []),
      ],
    }))
    .sort((left, right) =>
      right.totalWarnings - left.totalWarnings || left.file.localeCompare(right.file)
    )
    .slice(0, 10);
}

export function findOpenCleanupCoverage(
  files: readonly string[],
  openTasks: readonly RepoTaskFullRecord[],
): CodeHealthCleanupCoverage[] {
  const coverage: CodeHealthCleanupCoverage[] = [];
  for (const task of openTasks) {
    if (!isSourceSizeCleanupTask(task)) continue;
    const matchedFiles = files.filter((file) => taskMentionsFile(task, file));
    if (matchedFiles.length === 0) continue;
    coverage.push({
      kind: "open-cleanup-task",
      taskId: task.id,
      taskTitle: task.title,
      taskState: task.state,
      files: sortedUnique(matchedFiles),
    });
  }
  return coverage.sort((left, right) =>
    coverageSortKey(left).localeCompare(coverageSortKey(right))
  );
}

export function surfaceAreaForFile(file: string): string {
  const parts = file.split("/");
  if (parts[0] === "src" && parts[1] === "modules" && parts[2]) {
    return `module:${parts[2]}`;
  }
  if (parts[0] === "src" && parts[1] === "core" && parts[2]) {
    return `core:${parts[2]}`;
  }
  return parts.slice(0, 2).join("/") || "(root)";
}

export function addCoverage(
  map: Map<string, CodeHealthCleanupCoverage[]>,
  file: string,
  coverage: CodeHealthCleanupCoverage,
): void {
  const existing = map.get(file) ?? [];
  existing.push(coverage);
  map.set(file, existing);
}

function emptySurface(
  file: string,
  record: CodeHealthDriftRecord,
): CodeHealthRepeatedSurface {
  return {
    file,
    warningFamily: record.warningFamily,
    currentWarnings: 0,
    priorWarnings: 0,
    totalWarnings: 0,
    latestRunId: record.runId,
    cleanupCoverage: [],
  };
}

function isSourceSizeCleanupTask(task: RepoTaskFullRecord): boolean {
  const text = `${task.title}\n${task.summary}\n${task.body}`;
  return /\b(source[- ]file[- ]size|source[- ]size|oversized|line-count)\b/i.test(text);
}

function taskMentionsFile(task: RepoTaskFullRecord, file: string): boolean {
  const text = `${task.title}\n${task.summary}\n${task.body}`.toLowerCase();
  const normalized = file.toLowerCase();
  if (text.includes(normalized)) return true;
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) return false;
  return text.includes(normalized.slice(0, slash + 1)) &&
    text.includes(normalized.slice(slash + 1));
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function coverageSortKey(coverage: CodeHealthCleanupCoverage): string {
  return coverage.kind === "open-cleanup-task"
    ? coverage.taskId
    : coverage.taskId ?? coverage.taskPath;
}
