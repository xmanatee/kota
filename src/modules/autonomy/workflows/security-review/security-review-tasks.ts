import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import { classifyWorkflowGeneratedTask } from "#modules/autonomy/workflow-generated-task-class.js";
import {
  getRepoTaskStateDir,
  REPO_TASK_STATES,
  type RepoTaskState,
  writeRepoTaskFile,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { slugifyTaskTitle } from "#modules/repo-tasks/repo-tasks-operations.js";
import { writeJsonArtifact } from "./security-review-candidates.js";
import type {
  SecurityFindingSeverity,
  SecurityRevalidatedFinding,
} from "./security-review-output.js";

function taskPriorityForSeverity(severity: SecurityFindingSeverity): "p1" | "p2" | "p3" {
  if (severity === "critical" || severity === "high") return "p1";
  if (severity === "medium") return "p2";
  return "p3";
}

function replaceControlCharacters(
  value: string,
  options: { preserveLineFeeds: boolean },
): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
    const code = char.charCodeAt(0);
    if (options.preserveLineFeeds && code === 13) {
      output += "\n";
      if (value.charCodeAt(index + 1) === 10) index += 1;
      continue;
    }
    if (options.preserveLineFeeds && code === 10) {
      output += "\n";
      continue;
    }
    output += code < 32 || code === 127 ? " " : char;
  }
  return output;
}

function normalizeControlWhitespace(value: string): string {
  const normalized = replaceControlCharacters(value, { preserveLineFeeds: false })
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized : "(empty)";
}

function frontMatterScalar(value: string): string {
  const normalized = escapeMarkdownHeadingMarkers(normalizeControlWhitespace(value));
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? `\\${normalized}`
    : normalized;
}

function bodyScalar(value: string): string {
  return escapeMarkdownHeadingMarkers(normalizeControlWhitespace(value));
}

function escapeMarkdownHeadingMarkers(line: string): string {
  let escaped = "";
  let hashRunLength = 0;
  for (const char of line) {
    if (char === "#") {
      escaped += hashRunLength === 0 ? char : `\\${char}`;
      hashRunLength += 1;
      continue;
    }
    escaped += char;
    hashRunLength = 0;
  }
  return escaped;
}

function quoteMarkdown(value: string): string {
  return replaceControlCharacters(value, { preserveLineFeeds: true })
    .split("\n")
    .map((line) => {
      const escapedLine = escapeMarkdownHeadingMarkers(line);
      return escapedLine.length > 0 ? `> ${escapedLine}` : ">";
    })
    .join("\n");
}

type ExistingSecurityFindingTask = { state: RepoTaskState; path: string };

type SecurityFindingTaskTarget =
  | { kind: "create"; id: string; state: "ready"; path: string }
  | { kind: "update"; id: string; state: RepoTaskState; path: string };

function isTerminalTaskState(state: RepoTaskState): boolean {
  return state === "done" || state === "dropped";
}

function securityFindingTaskId(baseId: string, collisionIndex: number): string {
  return collisionIndex === 1 ? baseId : `${baseId}-${collisionIndex}`;
}

function findExistingTask(
  projectDir: string,
  id: string,
): ExistingSecurityFindingTask | null {
  for (const state of REPO_TASK_STATES) {
    const taskPath = join(getRepoTaskStateDir(projectDir, state), `${id}.md`);
    if (existsSync(taskPath)) return { state, path: taskPath };
  }
  return null;
}

function resolveSecurityFindingTaskTarget(
  projectDir: string,
  baseId: string,
): SecurityFindingTaskTarget {
  for (let collisionIndex = 1; ; collisionIndex += 1) {
    const id = securityFindingTaskId(baseId, collisionIndex);
    const existing = findExistingTask(projectDir, id);
    if (!existing) {
      return {
        kind: "create",
        id,
        state: "ready",
        path: join(getRepoTaskStateDir(projectDir, "ready"), `${id}.md`),
      };
    }
    if (!isTerminalTaskState(existing.state)) {
      return { kind: "update", id, state: existing.state, path: existing.path };
    }
  }
}

function buildFindingTaskBody(args: {
  runId: string;
  finding: SecurityRevalidatedFinding;
}): string {
  const { finding, runId } = args;
  const evidence = finding.evidence.flatMap((entry, index) => [
    `Evidence ${index + 1}:`,
    "",
    `path: ${bodyScalar(entry.path)}`,
    `line: ${entry.line}`,
    "excerpt:",
    "",
    quoteMarkdown(entry.excerpt),
  ]).join("\n\n");
  return [
    "",
    "## Problem",
    "",
    "The security-review workflow confirmed an application-security finding.",
    "",
    `severity: ${finding.severity}`,
    `affected path: ${bodyScalar(finding.affectedPath)}`,
    "claim:",
    "",
    quoteMarkdown(finding.claim),
    "",
    "## Desired Outcome",
    "",
    quoteMarkdown(finding.recommendedOutcome),
    "",
    "## Constraints",
    "",
    "- Preserve the confirmed security claim and cited evidence until the fix lands.",
    "- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.",
    "",
    "## Done When",
    "",
    "- The cited vulnerability is fixed or proven impossible with code-level evidence.",
    "- Focused regression coverage guards the fixed boundary.",
    "- The task records the final verification command or artifact.",
    "",
    "## Source / Intent",
    "",
    `Created by security-review workflow run ${runId}.`,
    "",
    `finding id: ${bodyScalar(finding.id)}`,
    `candidate id: ${bodyScalar(finding.candidateId)}`,
    `verdict: ${finding.verdict}`,
    "rationale:",
    "",
    quoteMarkdown(finding.rationale),
    "",
    "Evidence:",
    "",
    evidence,
    "",
    "## Initiative",
    "",
    "Agentic security review for autonomous coding infrastructure.",
    "",
    "## Acceptance Evidence",
    "",
    "- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.",
    "",
  ].join("\n");
}

export type SecurityFindingTaskResult = {
  createdTaskIds: string[];
  updatedTaskIds: string[];
  skippedFindingIds: string[];
  taskPaths: string[];
};

export function createOrUpdateSecurityFindingTasks(
  projectDir: string,
  args: {
    runId: string;
    findings: readonly SecurityRevalidatedFinding[];
  },
): SecurityFindingTaskResult {
  const createdTaskIds: string[] = [];
  const updatedTaskIds: string[] = [];
  const skippedFindingIds: string[] = [];
  const taskPaths: string[] = [];

  for (const finding of args.findings) {
    if (finding.verdict !== "confirmed") {
      skippedFindingIds.push(finding.id);
      continue;
    }
    const safeClaim = frontMatterScalar(finding.claim);
    const title = `Security review: ${safeClaim}`;
    const target = resolveSecurityFindingTaskTarget(projectDir, `task-${slugifyTaskTitle(title)}`);
    const now = new Date().toISOString();
    const existingCreatedAt = target.kind === "update"
      ? String(parseFlatFrontMatter(readFileSync(target.path, "utf-8")).attrs.created_at ?? now)
      : now;
    const attrs: Record<string, string> = {
      id: target.id,
      title: `Security review: ${safeClaim}`,
      status: target.state,
      priority: taskPriorityForSeverity(finding.severity),
      area: "security",
      task_class: classifyWorkflowGeneratedTask({
        workflowName: "security-review",
        area: "security",
        title,
        summary: safeClaim,
      }),
      summary: safeClaim,
      created_at: existingCreatedAt,
      updated_at: now,
    };
    writeRepoTaskFile(
      projectDir,
      target.path,
      serializeFlatFrontMatter(attrs, buildFindingTaskBody({ runId: args.runId, finding })),
    );
    taskPaths.push(target.path);
    if (target.kind === "update") updatedTaskIds.push(target.id);
    else createdTaskIds.push(target.id);
  }

  return { createdTaskIds, updatedTaskIds, skippedFindingIds, taskPaths };
}

export function writeSecurityReviewOutcome(
  runDirPath: string,
  payload: Record<string, string | number | boolean | string[]>,
): { written: true; artifactPath: string } {
  const artifactPath = writeJsonArtifact(runDirPath, "security-review-outcome.json", payload);
  return { written: true, artifactPath };
}
