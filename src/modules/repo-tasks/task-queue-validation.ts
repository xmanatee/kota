import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseFlatFrontMatter } from "#root/frontmatter.js";
import {
  getRepoTaskStateDir,
  REPO_TASK_STATES,
  REPO_TASKS_DIR,
  type RepoTaskState,
} from "#core/data/repo-tasks.js";

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

export type TaskQueueValidationOptions = {
  minReady?: number;
  recommendedMinReady?: number;
  recommendedMinBacklog?: number;
  maxDoing?: number;
};

type TaskFileEntry = {
  state: RepoTaskState;
  fileName: string;
  path: string;
  taskId: string;
  raw: string;
};

function listTaskEntries(projectDir: string): TaskFileEntry[] {
  const entries: TaskFileEntry[] = [];
  for (const state of REPO_TASK_STATES) {
    const dir = getRepoTaskStateDir(projectDir, state);
    if (!existsSync(dir)) {
      continue;
    }
    for (const fileName of readdirSync(dir)) {
      if (!fileName.endsWith(".md") || fileName === "AGENTS.md") {
        continue;
      }
      const path = join(dir, fileName);
      entries.push({
        state,
        fileName,
        path,
        taskId: basename(fileName, ".md"),
        raw: readFileSync(path, "utf8"),
      });
    }
  }
  return entries;
}

function readTaskArea(entry: TaskFileEntry): string | null {
  const { attrs } = parseFlatFrontMatter(entry.raw);
  const area = String(attrs.area ?? "").trim();
  return area.length > 0 ? area : null;
}

function readTaskPriority(entry: TaskFileEntry): string | null {
  const { attrs } = parseFlatFrontMatter(entry.raw);
  const priority = String(attrs.priority ?? "").trim();
  return priority.length > 0 ? priority : null;
}

function isStrategicPriority(priority: string | null): boolean {
  return priority === "p0" || priority === "p1" || priority === "p2";
}

export function listRootLevelBuiltInModuleFiles(projectDir: string): string[] {
  const dir = join(projectDir, "src", "modules");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((fileName) => fileName.endsWith(".ts"))
    .filter((fileName) => !fileName.endsWith(".test.ts"))
    .filter((fileName) => !["index.ts", "notify-retry.ts"].includes(fileName))
    .map((fileName) => join("src", "modules", fileName))
    .sort();
}

const ROOT_CLI_ARCHITECTURE_EXCLUSIONS = new Set([
  "cli-history",
]);

export function listRootLevelCliArchitectureDebt(projectDir: string): string[] {
  const cliPath = join(projectDir, "src", "cli.ts");
  if (!existsSync(cliPath)) return [];
  const raw = readFileSync(cliPath, "utf8");
  const matches = [...raw.matchAll(/from\s+"\.\/([a-z0-9-]+-cli)\.js"/gi)];
  return matches
    .map((match) => match[1] ?? "")
    .filter((name) => name.length > 0)
    .filter((name) => !ROOT_CLI_ARCHITECTURE_EXCLUSIONS.has(name))
    .map((name) => join("src", `${name}.ts`))
    .sort();
}

// Routes that once lived in the old server bucket have been migrated to owning modules.
// All five capability route files have been migrated; this list is now empty.
// The function is retained so references to listVisibleArchitectureDebt remain valid.
const SERVER_ROUTE_MIGRATION_TARGETS: string[] = [];

export function listServerRouteMigrationDebt(projectDir: string): string[] {
  const serverDir = join(projectDir, "src", "server");
  return SERVER_ROUTE_MIGRATION_TARGETS
    .filter((f) => existsSync(join(serverDir, f)))
    .map((f) => join("src", "server", f));
}

export function listVisibleArchitectureDebt(projectDir: string): string[] {
  return [
    ...listRootLevelBuiltInModuleFiles(projectDir),
    ...listRootLevelCliArchitectureDebt(projectDir),
    ...listServerRouteMigrationDebt(projectDir),
  ];
}

export function hasStrategicReadyArchitectureTask(projectDir: string): boolean {
  return listTaskEntries(projectDir)
    .filter((entry) => entry.state === "ready")
    .some((entry) =>
      readTaskArea(entry) === "architecture" && isStrategicPriority(readTaskPriority(entry)),
    );
}

export function hasArchitectureReadyCoverageGap(projectDir: string): boolean {
  const remainingArchitectureDebt = listVisibleArchitectureDebt(projectDir);
  return remainingArchitectureDebt.length > 0 && !hasStrategicReadyArchitectureTask(projectDir);
}

export function hasStrategicReadyCoverageGap(projectDir: string): boolean {
  const entries = listTaskEntries(projectDir);
  const readyEntries = entries.filter((entry) => entry.state === "ready");
  if (readyEntries.length === 0) {
    return false;
  }
  const hasReadyStrategicTask = readyEntries.some((entry) =>
    isStrategicPriority(readTaskPriority(entry)),
  );
  if (hasReadyStrategicTask) {
    return false;
  }
  const actionableEntries = entries.filter((entry) =>
    entry.state === "ready" || entry.state === "backlog" || entry.state === "doing",
  );
  return !actionableEntries.some((entry) => isStrategicPriority(readTaskPriority(entry)));
}

function readTaskGitStatus(projectDir: string): {
  untracked: string[];
  deleted: string[];
} {
  try {
    const output = execFileSync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all", "--", REPO_TASKS_DIR],
      { cwd: projectDir, encoding: "utf8" },
    );
    const untracked: string[] = [];
    const deleted: string[] = [];
    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      const status = line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const path = rawPath.includes(" -> ") ? rawPath.split(" -> ")[1] : rawPath;
      if (!path.endsWith(".md") || path.endsWith("/AGENTS.md")) {
        continue;
      }
      if (status === "??") {
        untracked.push(path);
        continue;
      }
      if (status[1] === "D") {
        deleted.push(path);
      }
    }
    return { untracked, deleted };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      untracked: [`git-status-unavailable: ${message}`],
      deleted: [],
    };
  }
}

function formatFindingList(findings: TaskQueueValidationFinding[]): string {
  return findings
    .map((finding) => `- [${finding.code}] ${finding.message}`)
    .join("\n");
}

export function validateTaskQueue(
  projectDir: string,
  options: TaskQueueValidationOptions = {},
): TaskQueueValidationResult {
  const entries = listTaskEntries(projectDir);
  const counts = Object.fromEntries(
    REPO_TASK_STATES.map((state) => [state, 0]),
  ) as Record<RepoTaskState, number>;
  const findings: TaskQueueValidationFinding[] = [];
  const seenTaskStates = new Map<string, string[]>();

  for (const entry of entries) {
    counts[entry.state] += 1;
    const seenStates = seenTaskStates.get(entry.taskId) ?? [];
    seenStates.push(entry.state);
    seenTaskStates.set(entry.taskId, seenStates);

    const { attrs } = parseFlatFrontMatter(entry.raw);
    if (String(attrs.id || "") !== entry.taskId) {
      findings.push({
        code: "task-id-mismatch",
        severity: "error",
        message: `${entry.path} id does not match its filename`,
        paths: [entry.path],
      });
    }
    if (String(attrs.status || "") !== entry.state) {
      findings.push({
        code: "task-status-mismatch",
        severity: "error",
        message: `${entry.path} status must match ${entry.state}`,
        paths: [entry.path],
      });
    }
    const REQUIRED_ATTRS = ["title", "priority", "area", "summary", "created_at", "updated_at"] as const;
    for (const attr of REQUIRED_ATTRS) {
      if (typeof attrs[attr] !== "string" || String(attrs[attr]).trim().length === 0) {
        findings.push({
          code: "task-missing-required-attr",
          severity: "error",
          message: `${entry.path} is missing required frontmatter field: ${attr}`,
          paths: [entry.path],
        });
      }
    }

    const priority = String(attrs.priority ?? "");
    if (priority.length > 0 && !["p0", "p1", "p2", "p3"].includes(priority)) {
      findings.push({
        code: "task-invalid-priority",
        severity: "error",
        message: `${entry.path} has invalid priority "${priority}"; must be one of p0, p1, p2, p3`,
        paths: [entry.path],
      });
    }

    const REQUIRED_SECTIONS = ["## Problem", "## Desired Outcome", "## Constraints", "## Done When"] as const;
    for (const section of REQUIRED_SECTIONS) {
      if (!entry.raw.includes(section)) {
        findings.push({
          code: "task-missing-required-section",
          severity: "error",
          message: `${entry.path} is missing required section: ${section}`,
          paths: [entry.path],
        });
      }
    }
  }

  for (const [taskId, states] of seenTaskStates) {
    if (states.length > 1) {
      findings.push({
        code: "task-duplicate-state",
        severity: "error",
        message: `${taskId} appears in multiple task states: ${states.join(", ")}`,
      });
    }
  }

  const maxDoing = options.maxDoing ?? 1;
  if (counts.doing > maxDoing) {
    findings.push({
      code: "too-many-doing",
      severity: "error",
      message: `data/tasks/doing contains ${counts.doing} tasks; maximum supported is ${maxDoing}`,
    });
  }

  if (options.minReady !== undefined && counts.ready < options.minReady) {
    findings.push({
      code: "ready-underflow",
      severity: "error",
      message: `data/tasks/ready contains ${counts.ready} tasks; expected at least ${options.minReady}`,
    });
  }

  if (
    options.recommendedMinReady !== undefined &&
    counts.ready < options.recommendedMinReady
  ) {
    findings.push({
      code: "ready-thin",
      severity: "warning",
      message: `data/tasks/ready contains ${counts.ready} tasks; recommended minimum is ${options.recommendedMinReady}`,
    });
  }

  if (
    options.recommendedMinBacklog !== undefined &&
    counts.backlog < options.recommendedMinBacklog
  ) {
    findings.push({
      code: "backlog-thin",
      severity: "warning",
      message: `data/tasks/backlog contains ${counts.backlog} tasks; recommended minimum is ${options.recommendedMinBacklog}`,
    });
  }

  const gitStatus = readTaskGitStatus(projectDir);
  const gitStatusUnavailable = gitStatus.untracked.find((value) =>
    value.startsWith("git-status-unavailable: "),
  );
  if (gitStatusUnavailable) {
    findings.push({
      code: "git-status-unavailable",
      severity: "error",
      message: gitStatusUnavailable.replace(/^git-status-unavailable:\s*/, ""),
    });
  } else {
    if (gitStatus.untracked.length > 0) {
      findings.push({
        code: "task-untracked",
        severity: "error",
        message: `Task files must be tracked before a run finishes: ${gitStatus.untracked.join(", ")}`,
        paths: gitStatus.untracked,
      });
    }
    if (gitStatus.deleted.length > 0) {
      findings.push({
        code: "task-deleted-unstaged",
        severity: "error",
        message: `Task files must not be left as deleted paths in git status: ${gitStatus.deleted.join(", ")}`,
        paths: gitStatus.deleted,
      });
    }
  }

  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;

  return { findings, counts, errorCount, warningCount };
}

export function assertArchitectureReadyCoverage(projectDir: string): string {
  const remainingArchitectureDebt = listVisibleArchitectureDebt(projectDir);
  if (remainingArchitectureDebt.length === 0 || hasStrategicReadyArchitectureTask(projectDir)) {
    return "architecture-ready-coverage-ok";
  }
  throw new Error(
    "data/tasks/ready must keep at least one p1/p2 architecture task while visible module-first debt remains: " +
      remainingArchitectureDebt.join(", "),
  );
}

export function assertStrategicReadyCoverage(projectDir: string): string {
  if (!hasStrategicReadyCoverageGap(projectDir)) {
    return "strategic-ready-coverage-ok";
  }
  throw new Error(
    "data/tasks/ready must keep at least one p0/p1/p2 task. The actionable queue has drifted " +
      "to p3-only work, which is too weak for the front of the autonomous queue.",
  );
}

export function assertTaskQueueValid(
  projectDir: string,
  options: TaskQueueValidationOptions = {},
): TaskQueueValidationResult {
  const result = validateTaskQueue(projectDir, options);
  const errors = result.findings.filter((finding) => finding.severity === "error");
  if (errors.length > 0) {
    throw new Error(formatFindingList(errors));
  }
  return result;
}

export function assertTaskQueueRecommendations(
  projectDir: string,
  options: TaskQueueValidationOptions = {},
): TaskQueueValidationResult {
  const result = validateTaskQueue(projectDir, options);
  const warnings = result.findings.filter((finding) => finding.severity === "warning");
  if (warnings.length > 0) {
    throw new Error(formatFindingList(warnings));
  }
  return result;
}

/**
 * Returns true if any p1/p2 tasks are sitting in backlog, regardless of ready queue size.
 * Use this to detect priority inversions (high-priority work behind lower-priority work).
 */
export function hasHighPriorityBacklogTasks(projectDir: string): boolean {
  const entries = listTaskEntries(projectDir);
  return entries
    .filter((e) => e.state === "backlog")
    .some((e) => {
      const { attrs } = parseFlatFrontMatter(e.raw);
      const priority = String(attrs.priority ?? "");
      return priority === "p1" || priority === "p2";
    });
}

/**
 * Throws if p1/p2 tasks are sitting in backlog. These tasks should be promoted to ready
 * rather than waiting for a follow-up explorer run.
 */
export function assertNoHighPriorityBacklogStrandedTasks(
  projectDir: string,
  options: { recommendedMinReady: number },
): void {
  const entries = listTaskEntries(projectDir);
  const readyCount = entries.filter((e) => e.state === "ready").length;

  const stranded = entries
    .filter((e) => e.state === "backlog")
    .filter((e) => {
      const { attrs } = parseFlatFrontMatter(e.raw);
      const priority = String(attrs.priority ?? "");
      return priority === "p1" || priority === "p2";
    });

  if (stranded.length === 0) {
    return;
  }

  const taskList = stranded.map((e) => `  - ${e.taskId}`).join("\n");
  throw new Error(
    `data/tasks/ready has ${readyCount} task(s) (target: ${options.recommendedMinReady}), but these p1/p2 tasks are still in backlog — promote them to ready:\n${taskList}`,
  );
}
