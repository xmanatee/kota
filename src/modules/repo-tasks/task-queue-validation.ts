import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import {
  findFlatFrontMatterSeparator,
  parseFlatFrontMatter,
  splitFrontMatter,
} from "#core/util/frontmatter.js";
import { parseBlockedPrecondition } from "./blocked-precondition.js";
import {
  verifyProductionReplacementCompletion,
} from "./production-replacement-completion.js";
import {
  PRODUCTION_REPLACEMENT_SECTION,
  parseProductionReplacementDeclaration,
} from "./production-replacement-proof.js";
import {
  getRepoTaskStateDir,
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
  state: RepoTaskState;
  fileName: string;
  path: string;
  taskId: string;
  raw: string;
};

type TaskEntryScan = {
  entries: TaskFileEntry[];
  findings: TaskQueueValidationFinding[];
};

const REQUIRED_ATTRS = [
  "title",
  "priority",
  "area",
  "summary",
  "created_at",
  "updated_at",
] as const;
const TASK_CLASSES = ["Product", "Safety", "Platform", "Meta"] as const;

function isOpenTaskState(state: RepoTaskState): boolean {
  return state === "ready" || state === "backlog" || state === "doing" ||
    state === "blocked";
}

function listTaskEntries(projectDir: string): TaskEntryScan {
  const entries: TaskFileEntry[] = [];
  const findings: TaskQueueValidationFinding[] = [];
  for (const state of REPO_TASK_STATES) {
    const dir = getRepoTaskStateDir(projectDir, state);
    if (!existsSync(dir)) continue;
    for (const dirent of readdirSync(dir, { withFileTypes: true })) {
      if (!dirent.name.endsWith(".md") || dirent.name === "AGENTS.md") continue;
      const path = join(dir, dirent.name);
      if (!dirent.isFile()) {
        findings.push({
          code: "task-path-unsafe",
          severity: "error",
          message: `${path} must be a regular task file; links and special entries are not allowed`,
          paths: [path],
        });
        continue;
      }
      entries.push({
        state,
        fileName: dirent.name,
        path,
        taskId: basename(dirent.name, ".md"),
        raw: readFileSync(path, "utf8"),
      });
    }
  }
  return { entries, findings };
}

function listNestedRuntimeStateDirsUnderData(projectDir: string): string[] {
  const dataDir = join(projectDir, "data");
  if (!existsSync(dataDir)) return [];
  const paths: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(dir, entry.name);
      if (entry.name === ".kota" || entry.name === "runs") {
        paths.push(`${relative(projectDir, path)}/`);
      } else {
        walk(path);
      }
    }
  };
  walk(dataDir);
  return paths.sort();
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

function findDependencyCycle(
  graph: ReadonlyMap<string, readonly string[]>,
): string[] | null {
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
        const start = stack.indexOf(dependency);
        return [...stack.slice(start), dependency];
      }
    }
    stack.pop();
    visiting.delete(taskId);
    return null;
  };

  for (const taskId of graph.keys()) {
    if (visited.has(taskId)) continue;
    const cycle = visit(taskId);
    if (cycle) return cycle;
  }
  return null;
}

export function formatTaskQueueValidationSummary(
  result: TaskQueueValidationResult,
): string {
  return [
    `task-queue-valid: errors=${result.errorCount} warnings=${result.warningCount}`,
    `ready: count=${result.counts.ready}`,
    `backlog: count=${result.counts.backlog}`,
  ].join("\n");
}

function formatFindingList(findings: TaskQueueValidationFinding[]): string {
  return findings
    .map((finding) => `- [${finding.code}] ${finding.message}`)
    .join("\n");
}

export function validateTaskQueue(projectDir: string): TaskQueueValidationResult {
  const scan = listTaskEntries(projectDir);
  const entries = scan.entries;
  const counts = Object.fromEntries(
    REPO_TASK_STATES.map((state) => [state, 0]),
  ) as Record<RepoTaskState, number>;
  const findings = [...scan.findings];
  const seenTaskStates = new Map<string, RepoTaskState[]>();
  const dependencyGraph = new Map<string, string[]>();

  for (const entry of entries) {
    counts[entry.state] += 1;
    const seenStates = seenTaskStates.get(entry.taskId) ?? [];
    seenStates.push(entry.state);
    seenTaskStates.set(entry.taskId, seenStates);
    dependencyGraph.set(entry.taskId, []);

    if (!isRepoTaskId(entry.taskId)) {
      findings.push({
        code: "task-id-invalid",
        severity: "error",
        message: `${entry.path} filename does not contain a valid task id`,
        paths: [entry.path],
      });
    }

    const syntaxError = frontmatterSyntaxError(entry.raw);
    if (syntaxError) {
      findings.push({
        code: "task-frontmatter-invalid",
        severity: "error",
        message: `${entry.path} has invalid metadata: ${syntaxError}`,
        paths: [entry.path],
      });
    }

    const { attrs, body } = parseFlatFrontMatter(entry.raw);
    const actualId = String(attrs.id ?? "");
    if (actualId !== entry.taskId) {
      findings.push({
        code: "task-id-mismatch",
        severity: "error",
        message: `${entry.path} frontmatter id "${actualId}" does not match filename "${entry.taskId}"`,
        paths: [entry.path],
      });
    }
    const actualStatus = String(attrs.status ?? "");
    if (actualStatus !== entry.state) {
      findings.push({
        code: "task-status-mismatch",
        severity: "error",
        message: `${entry.path} frontmatter status "${actualStatus}" does not match directory "${entry.state}"`,
        paths: [entry.path],
      });
    }

    for (const attr of REQUIRED_ATTRS) {
      if (typeof attrs[attr] !== "string" || attrs[attr].trim().length === 0) {
        findings.push({
          code: "task-missing-required-attr",
          severity: "error",
          message: `${entry.path} is missing required frontmatter field: ${attr}`,
          paths: [entry.path],
        });
      }
    }

    const priority = attrs.priority;
    if (
      typeof priority === "string" &&
      priority.length > 0 &&
      !["p0", "p1", "p2", "p3"].includes(priority)
    ) {
      findings.push({
        code: "task-invalid-priority",
        severity: "error",
        message: `${entry.path} has invalid priority "${priority}"`,
        paths: [entry.path],
      });
    }
    for (const attr of ["created_at", "updated_at"] as const) {
      if (
        typeof attrs[attr] === "string" &&
        attrs[attr].length > 0 &&
        Number.isNaN(Date.parse(attrs[attr]))
      ) {
        findings.push({
          code: "task-date-invalid",
          severity: "error",
          message: `${entry.path} has an invalid ${attr} timestamp`,
          paths: [entry.path],
        });
      }
    }

    const taskClass = attrs.task_class;
    if (isOpenTaskState(entry.state) && typeof taskClass !== "string") {
      findings.push({
        code: "open-task-missing-class",
        severity: "error",
        message: `${entry.path} must classify open work as ${TASK_CLASSES.join(", ")}`,
        paths: [entry.path],
      });
    } else if (
      typeof taskClass === "string" &&
      !(TASK_CLASSES as readonly string[]).includes(taskClass)
    ) {
      findings.push({
        code: "task-invalid-class",
        severity: "error",
        message: `${entry.path} has invalid task_class "${taskClass}"`,
        paths: [entry.path],
      });
    }

    const productionReplacement = attrs.production_replacement;
    if (
      productionReplacement !== undefined &&
      productionReplacement !== "true"
    ) {
      findings.push({
        code: "task-production-replacement-invalid-flag",
        severity: "error",
        message: `${entry.path} must omit production_replacement or set it to true`,
        paths: [entry.path],
      });
    }
    if (productionReplacement === "true") {
      const declaration = parseProductionReplacementDeclaration(body);
      if (declaration.kind !== "valid") {
        const reason = declaration.kind === "absent"
          ? `missing ## ${PRODUCTION_REPLACEMENT_SECTION}`
          : declaration.error;
        findings.push({
          code: "task-production-replacement-contract-invalid",
          severity: "error",
          message: `${entry.path} has an invalid production replacement contract: ${reason}`,
          paths: [entry.path],
        });
      } else if (entry.state === "done") {
        const completion = verifyProductionReplacementCompletion({
          raw: body,
          taskId: entry.taskId,
          projectDir,
        });
        if (!completion.ok) {
          findings.push({
            code: "done-production-replacement-proof-incomplete",
            severity: "error",
            message: `${entry.path} has incomplete production replacement proof: ${completion.error}`,
            paths: [entry.path],
          });
        }
      }
    }

    const parsedDependencies = parseTaskDependencyIds(attrs);
    if (!parsedDependencies.ok) {
      findings.push({
        code: "task-dependencies-invalid",
        severity: "error",
        message: `${entry.path} has malformed ${TASK_DEPENDENCIES_FIELD}: ${parsedDependencies.error}`,
        paths: [entry.path],
      });
    } else {
      const dependencies = parsedDependencies.dependencies;
      dependencyGraph.set(entry.taskId, dependencies);
      const duplicates = findDuplicateTaskDependencyIds(dependencies);
      if (duplicates.length > 0) {
        findings.push({
          code: "task-dependency-duplicate",
          severity: "error",
          message: `${entry.path} repeats predecessor id(s): ${duplicates.join(", ")}`,
          paths: [entry.path],
        });
      }
      if (dependencies.includes(entry.taskId)) {
        findings.push({
          code: "task-dependency-self",
          severity: "error",
          message: `${entry.path} cannot depend on itself`,
          paths: [entry.path],
        });
      }
    }

    if (entry.state === "blocked") {
      const parsed = parseBlockedPrecondition(entry.raw);
      if (!parsed.ok) {
        findings.push({
          code: "blocked-task-precondition-invalid",
          severity: "error",
          message: `${entry.path} has an invalid unblock precondition: ${parsed.error}`,
          paths: [entry.path],
        });
      } else if (parsed.precondition.kind === "task-done" && parsedDependencies.ok) {
        const dependencies = parsedDependencies.dependencies;
        if (
          dependencies.length !== 1 ||
          dependencies[0] !== parsed.precondition.ref
        ) {
          findings.push({
            code: "blocked-task-done-dependency-mismatch",
            severity: "error",
            message: `${entry.path} task-done precondition and ${TASK_DEPENDENCIES_FIELD} must name the same sole predecessor`,
            paths: [entry.path],
          });
        }
      }
    }
  }

  for (const [taskId, states] of seenTaskStates) {
    if (states.length <= 1) continue;
    findings.push({
      code: "task-duplicate-state",
      severity: "error",
      message: `${taskId} appears in multiple task states: ${states.join(", ")}`,
    });
  }

  const knownTaskIds = new Set(seenTaskStates.keys());
  const stateByTaskId = new Map(
    entries.map((entry) => [entry.taskId, entry.state] as const),
  );
  for (const [taskId, dependencies] of dependencyGraph) {
    const entry = entries.find((candidate) => candidate.taskId === taskId);
    for (const dependency of dependencies) {
      if (knownTaskIds.has(dependency)) continue;
      findings.push({
        code: "task-dependency-missing",
        severity: "error",
        message: `${entry?.path ?? taskId} depends on missing predecessor: ${dependency}`,
        paths: entry ? [entry.path] : undefined,
      });
    }
    const dropped = findDroppedTaskDependencyIds(dependencies, stateByTaskId);
    if (entry && !["done", "dropped"].includes(entry.state) && dropped.length > 0) {
      findings.push({
        code: "task-dependency-dropped",
        severity: "error",
        message: `${entry.path} depends on dropped predecessor(s): ${dropped.join(", ")}`,
        paths: [entry.path],
      });
    }
  }

  const cycle = findDependencyCycle(dependencyGraph);
  if (cycle) {
    findings.push({
      code: "task-dependency-cycle",
      severity: "error",
      message: `Task dependency cycle detected: ${cycle.join(" -> ")}`,
    });
  }

  const nestedRuntimeStateDirs = listNestedRuntimeStateDirsUnderData(projectDir);
  if (nestedRuntimeStateDirs.length > 0) {
    findings.push({
      code: "data-nested-runtime-state",
      severity: "error",
      message: `Runtime state directories are not allowed under data/: ${nestedRuntimeStateDirs.join(", ")}`,
      paths: nestedRuntimeStateDirs,
    });
  }

  return {
    findings,
    counts,
    errorCount: findings.filter((finding) => finding.severity === "error").length,
    warningCount: findings.filter((finding) => finding.severity === "warning").length,
  };
}

export function assertTaskQueueValid(projectDir: string): TaskQueueValidationResult {
  const result = validateTaskQueue(projectDir);
  const errors = result.findings.filter((finding) => finding.severity === "error");
  if (errors.length > 0) throw new Error(formatFindingList(errors));
  return result;
}
