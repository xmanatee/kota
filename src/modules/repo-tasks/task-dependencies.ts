export const TASK_DEPENDENCIES_FIELD = "depends_on";

const TASK_ID_RE = /^task-[a-z0-9-]+$/;

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
    if (!TASK_ID_RE.test(dependency)) {
      return {
        ok: false,
        error: `${TASK_DEPENDENCIES_FIELD} entries must match ${TASK_ID_RE.source}, got '${dependency}'`,
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
