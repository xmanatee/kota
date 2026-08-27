import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import {
  findFlatFrontMatterSeparator,
  parseFlatFrontMatter,
  splitFrontMatter,
} from "#core/util/frontmatter.js";
import { parseBlockedPrecondition } from "./blocked-precondition.js";
import {
  getRepoTaskArchiveDir,
  getRepoTasksDir,
  REPO_TASK_STATES,
  type RepoTaskState,
} from "./repo-tasks-domain.js";
import {
  findDroppedTaskDependencyIds,
  findDuplicateTaskDependencyIds,
  parseTaskDependencyIds,
  TASK_DEPENDENCIES_FIELD,
} from "./task-dependencies.js";
import { isRepoTaskId } from "./task-id.js";

export type TaskQueueValidationSeverity = "error" | "warning";
export type TaskQueueValidationFinding = {
  code: string;
  severity: TaskQueueValidationSeverity;
  message: string;
  paths?: string[];
};
export type TaskQueueValidationResult = {
  findings: TaskQueueValidationFinding[];
  counts: Record<RepoTaskState, number>;
  errorCount: number;
  warningCount: number;
};

type TaskFileEntry = {
  archived: boolean;
  path: string;
  taskId: string;
  raw: string;
};

function scanContainer(repoRoot: string, directory: string, archived: boolean) {
  const entries: TaskFileEntry[] = [];
  const findings: TaskQueueValidationFinding[] = [];
  if (!existsSync(directory)) return { entries, findings };
  for (const dirent of readdirSync(directory, { withFileTypes: true })) {
    if (dirent.name === "AGENTS.md" || (!archived && dirent.name === "archive")) continue;
    const path = join(directory, dirent.name);
    if (!dirent.name.endsWith(".md")) {
      findings.push({
        code: "task-layout-invalid",
        severity: "error",
        message: `${relative(repoRoot, path)} is not allowed in the task container`,
        paths: [path],
      });
      continue;
    }
    if (!dirent.isFile()) {
      findings.push({
        code: "task-path-unsafe",
        severity: "error",
        message: `${relative(repoRoot, path)} must be a regular task file`,
        paths: [path],
      });
      continue;
    }
    entries.push({
      archived,
      path,
      taskId: basename(dirent.name, ".md"),
      raw: readFileSync(path, "utf8"),
    });
  }
  return { entries, findings };
}

function listTaskEntries(repoRoot: string) {
  const active = scanContainer(repoRoot, getRepoTasksDir(repoRoot), false);
  const archive = scanContainer(repoRoot, getRepoTaskArchiveDir(repoRoot), true);
  return {
    entries: [...active.entries, ...archive.entries],
    findings: [...active.findings, ...archive.findings],
  };
}

function frontmatterSyntaxError(raw: string): string | null {
  const split = splitFrontMatter(raw);
  if (!split) return "missing or unterminated flat frontmatter block";
  const keys = new Set<string>();
  for (const line of split.frontmatter.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = findFlatFrontMatterSeparator(trimmed);
    if (separator < 1) return `malformed frontmatter line: ${trimmed}`;
    const key = trimmed.slice(0, separator).trim();
    if (keys.has(key)) return `duplicate frontmatter field: ${key}`;
    keys.add(key);
  }
  return null;
}

function findDependencyCycle(graph: ReadonlyMap<string, readonly string[]>): string[] | null {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stack: string[] = [];
  const visit = (taskId: string): string[] | null => {
    visited.add(taskId);
    visiting.add(taskId);
    stack.push(taskId);
    for (const dependency of graph.get(taskId) ?? []) {
      if (!graph.has(dependency)) continue;
      if (!visited.has(dependency)) {
        const nested = visit(dependency);
        if (nested) return nested;
      } else if (visiting.has(dependency)) {
        return [...stack.slice(stack.indexOf(dependency)), dependency];
      }
    }
    stack.pop();
    visiting.delete(taskId);
    return null;
  };
  for (const taskId of graph.keys()) {
    if (!visited.has(taskId)) {
      const cycle = visit(taskId);
      if (cycle) return cycle;
    }
  }
  return null;
}

export function formatTaskQueueValidationSummary(result: TaskQueueValidationResult): string {
  return [
    `task-queue-valid: errors=${result.errorCount} warnings=${result.warningCount}`,
    `active: count=${result.counts.open + result.counts.blocked}`,
    `archive: count=${result.counts.done + result.counts.dropped}`,
  ].join("\n");
}

function finding(code: string, message: string, path?: string): TaskQueueValidationFinding {
  return { code, severity: "error", message, ...(path ? { paths: [path] } : {}) };
}

export function validateTaskQueue(repoRoot: string): TaskQueueValidationResult {
  const scan = listTaskEntries(repoRoot);
  const counts = Object.fromEntries(REPO_TASK_STATES.map((state) => [state, 0])) as Record<RepoTaskState, number>;
  const findings = [...scan.findings];
  const stateByTaskId = new Map<string, RepoTaskState>();
  const dependencyGraph = new Map<string, string[]>();

  for (const entry of scan.entries) {
    if (!isRepoTaskId(entry.taskId)) {
      findings.push(finding("task-id-invalid", `${relative(repoRoot, entry.path)} has an invalid filename identity`, entry.path));
    }
    if (stateByTaskId.has(entry.taskId)) {
      findings.push(finding("task-duplicate", `${entry.taskId} appears more than once`, entry.path));
    }
    const syntaxError = frontmatterSyntaxError(entry.raw);
    if (syntaxError) findings.push(finding("task-frontmatter-invalid", `${relative(repoRoot, entry.path)}: ${syntaxError}`, entry.path));

    const { attrs, body } = parseFlatFrontMatter(entry.raw);
    const status = attrs.status;
    if (typeof status !== "string" || !REPO_TASK_STATES.includes(status as RepoTaskState)) {
      findings.push(finding("task-status-invalid", `${relative(repoRoot, entry.path)} has invalid status ${String(status)}`, entry.path));
      continue;
    }
    const state = status as RepoTaskState;
    counts[state] += 1;
    stateByTaskId.set(entry.taskId, state);
    const shouldBeArchived = state === "done" || state === "dropped";
    if (entry.archived !== shouldBeArchived) {
      findings.push(finding("task-container-mismatch", `${relative(repoRoot, entry.path)} is stored in the wrong container for ${state}`, entry.path));
    }

    const allowed = shouldBeArchived
      ? new Set(["status"])
      : new Set(["status", "priority", TASK_DEPENDENCIES_FIELD]);
    for (const key of Object.keys(attrs)) {
      if (!allowed.has(key)) findings.push(finding("task-attr-unnecessary", `${relative(repoRoot, entry.path)} has unnecessary frontmatter field: ${key}`, entry.path));
    }
    if (!/^#\s+\S[^\n]*$/m.test(body) || !body.trimStart().startsWith("# ")) {
      findings.push(finding("task-title-missing", `${relative(repoRoot, entry.path)} must begin its body with one H1 title`, entry.path));
    }

    if (shouldBeArchived) {
      dependencyGraph.set(entry.taskId, []);
      continue;
    }
    if (typeof attrs.priority !== "string" || !["p0", "p1", "p2", "p3"].includes(attrs.priority)) {
      findings.push(finding("task-priority-invalid", `${relative(repoRoot, entry.path)} must have priority p0, p1, p2, or p3`, entry.path));
    }
    const parsedDependencies = parseTaskDependencyIds(attrs);
    if (!parsedDependencies.ok) {
      findings.push(finding("task-dependencies-invalid", `${relative(repoRoot, entry.path)}: ${parsedDependencies.error}`, entry.path));
      dependencyGraph.set(entry.taskId, []);
    } else {
      dependencyGraph.set(entry.taskId, parsedDependencies.dependencies);
      const duplicates = findDuplicateTaskDependencyIds(parsedDependencies.dependencies);
      if (duplicates.length) findings.push(finding("task-dependency-duplicate", `${relative(repoRoot, entry.path)} repeats: ${duplicates.join(", ")}`, entry.path));
      if (parsedDependencies.dependencies.includes(entry.taskId)) findings.push(finding("task-dependency-self", `${relative(repoRoot, entry.path)} cannot depend on itself`, entry.path));
    }
    if (state === "blocked") {
      const parsed = parseBlockedPrecondition(body);
      if (!parsed.ok) findings.push(finding("blocked-task-precondition-invalid", `${relative(repoRoot, entry.path)} has invalid Blocked on metadata: ${parsed.error}`, entry.path));
    }
  }

  for (const [taskId, dependencies] of dependencyGraph) {
    const entry = scan.entries.find((candidate) => candidate.taskId === taskId);
    for (const dependency of dependencies) {
      if (!stateByTaskId.has(dependency)) findings.push(finding("task-dependency-missing", `${relative(repoRoot, entry?.path ?? taskId)} depends on missing predecessor: ${dependency}`, entry?.path));
    }
    const dropped = findDroppedTaskDependencyIds(dependencies, stateByTaskId);
    if (entry && dropped.length) findings.push(finding("task-dependency-dropped", `${relative(repoRoot, entry.path)} depends on dropped predecessor(s): ${dropped.join(", ")}`, entry.path));
  }
  const cycle = findDependencyCycle(dependencyGraph);
  if (cycle) findings.push(finding("task-dependency-cycle", `Task dependency cycle detected: ${cycle.join(" -> ")}`));

  return {
    findings,
    counts,
    errorCount: findings.filter(({ severity }) => severity === "error").length,
    warningCount: findings.filter(({ severity }) => severity === "warning").length,
  };
}

export function assertTaskQueueValid(repoRoot: string): TaskQueueValidationResult {
  const result = validateTaskQueue(repoRoot);
  const errors = result.findings.filter(({ severity }) => severity === "error");
  if (errors.length) throw new Error(errors.map(({ code, message }) => `- [${code}] ${message}`).join("\n"));
  return result;
}
