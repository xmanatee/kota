import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseFlatFrontMatter } from "./frontmatter.js";
import { REPO_TASK_STATES, type RepoTaskState } from "./repo-tasks.js";

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
    const dir = join(projectDir, "tasks", state);
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

function readTaskGitStatus(projectDir: string): {
  untracked: string[];
  deleted: string[];
} {
  try {
    const output = execFileSync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all", "--", "tasks"],
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
      if (status.includes("D")) {
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

    if (entry.state === "inbox") {
      continue;
    }

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
      message: `tasks/doing contains ${counts.doing} tasks; maximum supported is ${maxDoing}`,
    });
  }

  if (options.minReady !== undefined && counts.ready < options.minReady) {
    findings.push({
      code: "ready-underflow",
      severity: "error",
      message: `tasks/ready contains ${counts.ready} tasks; expected at least ${options.minReady}`,
    });
  }

  if (
    options.recommendedMinReady !== undefined &&
    counts.ready < options.recommendedMinReady
  ) {
    findings.push({
      code: "ready-thin",
      severity: "warning",
      message: `tasks/ready contains ${counts.ready} tasks; recommended minimum is ${options.recommendedMinReady}`,
    });
  }

  if (
    options.recommendedMinBacklog !== undefined &&
    counts.backlog < options.recommendedMinBacklog
  ) {
    findings.push({
      code: "backlog-thin",
      severity: "warning",
      message: `tasks/backlog contains ${counts.backlog} tasks; recommended minimum is ${options.recommendedMinBacklog}`,
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
 * Throws if p1/p2 tasks are sitting in backlog while the ready queue is below the recommended
 * minimum. These tasks should be promoted to ready rather than waiting for a follow-up explorer run.
 */
export function assertNoHighPriorityBacklogStrandedTasks(
  projectDir: string,
  options: { recommendedMinReady: number },
): void {
  const entries = listTaskEntries(projectDir);
  const readyCount = entries.filter((e) => e.state === "ready").length;

  if (readyCount >= options.recommendedMinReady) {
    return;
  }

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
    `tasks/ready has ${readyCount} task(s) (target: ${options.recommendedMinReady}), but these p1/p2 tasks are still in backlog — promote them to ready:\n${taskList}`,
  );
}
