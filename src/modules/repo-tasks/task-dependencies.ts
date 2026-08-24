import { isRepoTaskId, REPO_TASK_ID_PATTERN } from "./task-id.js";

export const TASK_DEPENDENCIES_FIELD = "depends_on";

export type TaskDependencyParseResult =
  | { ok: true; dependencies: string[] }
  | { ok: false; error: string };

export function parseTaskDependencyIds(
  attrs: Record<string, string | string[]>,
): TaskDependencyParseResult {
  const raw = attrs[TASK_DEPENDENCIES_FIELD];
  if (raw === undefined) return { ok: true, dependencies: [] };
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      error: `${TASK_DEPENDENCIES_FIELD} must be a frontmatter array like [task-a, task-b]`,
    };
  }
  for (const dependency of raw) {
    if (!isRepoTaskId(dependency)) {
      return {
        ok: false,
        error: `${TASK_DEPENDENCIES_FIELD} entries must match ${REPO_TASK_ID_PATTERN.source}, got '${dependency}'`,
      };
    }
  }
  return { ok: true, dependencies: raw };
}

export function readTaskDependencyIds(
  attrs: Record<string, string | string[]>,
): string[] {
  const parsed = parseTaskDependencyIds(attrs);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.dependencies;
}

export function findDuplicateTaskDependencyIds(dependencies: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const dependency of dependencies) {
    if (seen.has(dependency)) {
      duplicates.add(dependency);
      continue;
    }
    seen.add(dependency);
  }
  return [...duplicates].sort();
}

export function findUnfinishedTaskDependencies(
  dependencies: readonly string[],
  stateByTaskId: ReadonlyMap<string, string>,
): string[] {
  return dependencies.filter((dependency) => stateByTaskId.get(dependency) !== "done");
}

export function findDroppedTaskDependencyIds(
  dependencies: readonly string[],
  stateByTaskId: ReadonlyMap<string, string>,
): string[] {
  return dependencies
    .filter((dependency) => stateByTaskId.get(dependency) === "dropped")
    .sort();
}

function isTaskDependencyReachable(
  targetTaskId: string,
  fromTaskId: string,
  graph: ReadonlyMap<string, readonly string[]>,
): boolean {
  const pending = [...(graph.get(fromTaskId) ?? [])];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const dependency = pending.pop();
    if (!dependency || visited.has(dependency)) continue;
    if (dependency === targetTaskId) return true;
    visited.add(dependency);
    pending.push(...(graph.get(dependency) ?? []));
  }
  return false;
}

export function findRedundantTaskDependencyIds(
  taskId: string,
  graph: ReadonlyMap<string, readonly string[]>,
): string[] {
  const directDependencies = [...new Set(graph.get(taskId) ?? [])];
  return directDependencies
    .filter((candidate) => directDependencies.some(
      (other) => other !== candidate && isTaskDependencyReachable(candidate, other, graph),
    ))
    .sort();
}
