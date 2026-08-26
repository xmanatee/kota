import { serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import { classifyWorkflowGeneratedTask } from "#modules/autonomy/workflow-generated-task-class.js";
import { renderRepoTaskIntent } from "#modules/repo-tasks/repo-task-intent.js";
import { writeRepoTaskFile } from "#modules/repo-tasks/repo-tasks-domain.js";
import { slugifyTaskTitle } from "#modules/repo-tasks/repo-tasks-operations.js";
import { writeJsonArtifact } from "./security-review-candidates.js";
import type {
  SecurityFindingSeverity,
  SecurityRevalidatedFinding,
} from "./security-review-output.js";
import {
  resolveSecurityFindingTaskTarget,
  securityFindingIdentityAttrs,
} from "./security-review-task-identity.js";

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

function buildFindingTaskBody(args: {
  finding: SecurityRevalidatedFinding;
  reviewRunIds: readonly string[];
}): string {
  const { finding } = args;
  const firstRunId = args.reviewRunIds[0];
  if (!firstRunId) throw new Error("Security finding task requires review provenance");
  const evidence = finding.evidence.flatMap((entry, index) => [
    `Evidence ${index + 1}:`,
    "",
    `path: ${bodyScalar(entry.path)}`,
    `line: ${entry.line}`,
    "excerpt:",
    "",
    quoteMarkdown(entry.excerpt),
  ]).join("\n\n");
  const problem = [
    "The security-review workflow confirmed an application-security finding.",
    "",
    `severity: ${finding.severity}`,
    `affected path: ${bodyScalar(finding.affectedPath)}`,
    "claim:",
    "",
    quoteMarkdown(finding.claim),
  ].join("\n");
  const context = [
    `Created by security-review workflow run ${bodyScalar(firstRunId)}.`,
    "",
    "Confirmed by security-review workflow runs:",
    "",
    ...args.reviewRunIds.map((runId) => `- ${bodyScalar(runId)}`),
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
  ].join("\n");
  return renderRepoTaskIntent({
    problem,
    desiredOutcome: quoteMarkdown(finding.recommendedOutcome),
    constraints: [
    "- Preserve the confirmed security claim and cited evidence until the fix lands.",
    "- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.",
    ].join("\n"),
    howWeWillKnow: [
    "- The cited vulnerability is fixed or proven impossible with code-level evidence.",
    "- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.",
    "- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.",
    ].join("\n"),
    context,
  });
}

export type SecurityFindingTaskResult = {
  createdTaskIds: string[];
  updatedTaskIds: string[];
  unchangedFindingIds: string[];
  skippedFindingIds: string[];
  taskPaths: string[];
};

function taskPriorityForUpdate(
  existing: string | string[] | undefined,
  incoming: ReturnType<typeof taskPriorityForSeverity>,
): ReturnType<typeof taskPriorityForSeverity> {
  if (typeof existing !== "string" || !/^(p1|p2|p3)$/.test(existing)) return incoming;
  return Number(existing.slice(1)) <= Number(incoming.slice(1))
    ? existing as ReturnType<typeof taskPriorityForSeverity>
    : incoming;
}

export function createOrUpdateSecurityFindingTasks(
  projectDir: string,
  args: {
    runId: string;
    findings: readonly SecurityRevalidatedFinding[];
  },
): SecurityFindingTaskResult {
  const createdTaskIds: string[] = [];
  const updatedTaskIds: string[] = [];
  const unchangedFindingIds: string[] = [];
  const skippedFindingIds: string[] = [];
  const taskPaths: string[] = [];

  for (const finding of args.findings) {
    if (finding.verdict !== "confirmed") {
      skippedFindingIds.push(finding.id);
      continue;
    }
    const safeClaim = frontMatterScalar(finding.claim);
    const title = `Security review: ${safeClaim}`;
    const resolution = resolveSecurityFindingTaskTarget(projectDir, {
      baseId: `task-${slugifyTaskTitle(title)}`,
      candidateId: finding.candidateId,
      findingId: finding.id,
      persistedCandidateId: bodyScalar(finding.candidateId),
      persistedFindingId: bodyScalar(finding.id),
      reviewRunId: normalizeControlWhitespace(args.runId),
    });
    if (resolution.current) {
      unchangedFindingIds.push(finding.id);
      continue;
    }
    const { key, reviewRunIds: mergedReviewRunIds, target } = resolution;
    const now = new Date().toISOString();
    const existingCreatedAt = target.kind === "update"
      ? String(target.attrs.created_at ?? now)
      : now;
    const attrs: Record<string, string | string[]> = {
      ...(target.kind === "update" ? target.attrs : {}),
      id: target.id,
      title: `Security review: ${safeClaim}`,
      status: target.state,
      priority: taskPriorityForUpdate(
        target.kind === "update" ? target.attrs.priority : undefined,
        taskPriorityForSeverity(finding.severity),
      ),
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
      ...securityFindingIdentityAttrs(key, mergedReviewRunIds),
    };
    writeRepoTaskFile(
      projectDir,
      target.path,
      serializeFlatFrontMatter(
        attrs,
        buildFindingTaskBody({ finding, reviewRunIds: mergedReviewRunIds }),
      ),
    );
    taskPaths.push(target.path);
    if (target.kind === "update") updatedTaskIds.push(target.id);
    else createdTaskIds.push(target.id);
  }

  return {
    createdTaskIds,
    updatedTaskIds,
    unchangedFindingIds,
    skippedFindingIds,
    taskPaths,
  };
}

export function writeSecurityReviewOutcome(
  runDirPath: string,
  payload: Record<string, string | number | boolean | string[]>,
): { written: true; artifactPath: string } {
  const artifactPath = writeJsonArtifact(runDirPath, "security-review-outcome.json", payload);
  return { written: true, artifactPath };
}
