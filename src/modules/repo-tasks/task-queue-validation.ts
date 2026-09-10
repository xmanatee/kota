import { basename, join, relative } from "node:path";
import {
  findFlatFrontMatterSeparator,
  parseFlatFrontMatter,
  splitFrontMatter,
} from "#core/util/frontmatter.js";
import { type RepositoryTextTree, readWorkingTextTree } from "#core/util/repository-tree.js";
import { parseBlockedPrecondition } from "./blocked-precondition.js";
import {
  REPO_TASK_ARCHIVE_DIR,
  REPO_TASK_STATES,
  REPO_TASKS_DIR,
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

function scanContainer(repoRoot: string, tree: RepositoryTextTree, directory: string, archived: boolean) {
  const entries: TaskFileEntry[] = [];
  const findings: TaskQueueValidationFinding[] = [];
  let children: ReturnType<RepositoryTextTree["list"]>;
  try {
    children = tree.list(directory);
  } catch (error) {
    findings.push(finding("task-path-unsafe", String(error), join(repoRoot, directory)));
    return { entries, findings };
  }
  for (const dirent of children) {
    if (dirent.name === "AGENTS.md" && dirent.kind === "file") continue;
    if (!archived && dirent.name === "archive" && dirent.kind === "directory") continue;
    const path = join(repoRoot, directory, dirent.name);
    if (dirent.kind === "unsafe") {
      findings.push(finding("task-path-unsafe", `${relative(repoRoot, path)} must be a regular task file`, path));
      continue;
    }
    if (!dirent.name.endsWith(".md")) {
      findings.push({
        code: "task-layout-invalid",
        severity: "error",
        message: `${relative(repoRoot, path)} is not allowed in the task container`,
        paths: [path],
      });
      continue;
    }
    if (dirent.kind !== "file") {
      findings.push({
        code: "task-path-unsafe",
        severity: "error",
        message: `${relative(repoRoot, path)} must be a regular task file`,
        paths: [path],
      });
      continue;
    }
    try {
      entries.push({ archived, path, taskId: basename(dirent.name, ".md"), raw: tree.read(`${directory}/${dirent.name}`) });
    } catch (error) {
      findings.push(finding("task-path-unsafe", String(error), path));
    }
  }
  return { entries, findings };
}

function listTaskEntries(repoRoot: string, tree: RepositoryTextTree) {
  const active = scanContainer(repoRoot, tree, REPO_TASKS_DIR, false);
  const archive = scanContainer(repoRoot, tree, REPO_TASK_ARCHIVE_DIR, true);
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

const DEFAULT_INTENT_PLACEHOLDERS = new Set([
  "Describe the problem and why it matters.",
  "Describe the observable outcome, without prescribing an implementation.",
  "Name only constraints that materially limit a valid solution.",
  "Describe the behavior or observation that will make completion credible.",
]);

/** Validate complete submitted Markdown using the same body rules as publication. */
export function validateTaskBody(body: string, state: RepoTaskState): TaskQueueValidationFinding[] {
  const findings: TaskQueueValidationFinding[] = [];
  if (!/^#\s+\S[^\n]*$/m.test(body) || !body.trimStart().startsWith("# ")) {
    findings.push(finding("task-title-missing", "must begin its body with one H1 title"));
  }
  if (state === "done" || state === "dropped") return findings;
  const intentLines = body.replace(/<!--[\s\S]*?(?:-->|$)/g, "").trimStart().split(/\r?\n/).slice(1)
    .map((line) => line.trim()).filter((line) => line && !/^#{1,6}\s/.test(line));
  if (intentLines.length === 0) {
    findings.push(finding("task-intent-empty", "must contain authored intent beyond its title"));
  }
  if (intentLines.some((line) => DEFAULT_INTENT_PLACEHOLDERS.has(line))) {
    findings.push(finding("task-intent-placeholder", "contains unchanged default intent text"));
  }
  return findings;
}

export function validateTaskQueue(
  repoRoot: string,
  tree: RepositoryTextTree = readWorkingTextTree(repoRoot),
): TaskQueueValidationResult {
  const scan = listTaskEntries(repoRoot, tree);
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
    findings.push(...validateTaskBody(body, state).map((bodyFinding) => ({
      ...bodyFinding,
      message: `${relative(repoRoot, entry.path)} ${bodyFinding.message}`,
      paths: [entry.path],
    })));

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

export function assertTaskQueueValid(repoRoot: string, tree?: RepositoryTextTree): TaskQueueValidationResult {
  const result = validateTaskQueue(repoRoot, tree);
  const errors = result.findings.filter(({ severity }) => severity === "error");
  if (errors.length) throw new Error(errors.map(({ code, message }) => `- [${code}] ${message}`).join("\n"));
  return result;
}
