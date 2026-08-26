import { parseBlockedPrecondition } from "#modules/repo-tasks/blocked-precondition.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  type BuilderEvidence,
  type EvidenceRefs,
  POST_COMPLETION_FOLLOW_UP_REASONS,
  type PostCompletionCorrectiveReason,
} from "./post-completion-followup-types.js";

const TASK_ID_RE = /\btask-[a-z0-9][a-z0-9-]*\b/g;
const RUN_ID_RE =
  /\b\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z0-9-]+\b/g;
const COMMIT_RE = /\b(?:git:commit:)?[a-f0-9]{7,40}\b/gi;
const ARTIFACT_PATH_RE =
  /\.kota\/runs\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z0-9-]+\/[^\s)>'"]+/g;

const HARD_CORRECTIVE_REASONS = new Set<PostCompletionCorrectiveReason>([
  "regression",
  "ci-build-failure",
  "security",
  "review-scrutiny",
  "trajectory-diagnostic",
  "workflow-failure",
  "missing-evidence",
]);

export function buildCompletedTaskEvidenceRefs(
  task: RepoTaskFullRecord,
  builderEvidence: readonly BuilderEvidence[],
): EvidenceRefs {
  const refs = extractEvidenceRefs(`${task.title}\n${task.summary}\n${task.body}`);
  refs.taskIds.clear();
  refs.taskIds.add(task.id);
  for (const evidence of builderEvidence) {
    refs.runIds.add(evidence.runId);
    refs.commitRefs.add(normalizeCommitRef(evidence.commitSha));
  }
  return refs;
}

export function extractFollowUpEvidenceRefs(task: RepoTaskFullRecord): EvidenceRefs {
  return extractEvidenceRefs(stripLocalOverlapCheckSections(taskSearchText(task)));
}

export function findMatchedRefs(
  completedRefs: EvidenceRefs,
  followUpRefs: EvidenceRefs,
): string[] {
  const matched = new Set<string>();
  for (const taskId of completedRefs.taskIds) {
    if (followUpRefs.taskIds.has(taskId)) matched.add(`task:${taskId}`);
  }
  for (const runId of completedRefs.runIds) {
    if (followUpRefs.runIds.has(runId)) matched.add(`run:${runId}`);
  }
  for (const completedCommit of completedRefs.commitRefs) {
    for (const followUpCommit of followUpRefs.commitRefs) {
      if (commitRefsMatch(completedCommit, followUpCommit)) {
        matched.add(`git:commit:${completedCommit}`);
      }
    }
  }
  for (const artifactPath of completedRefs.artifactPaths) {
    if (followUpRefs.artifactPaths.has(artifactPath)) {
      matched.add(`artifact:${artifactPath}`);
    }
  }
  return [...matched].sort();
}

export function classifyCorrectiveReasons(
  task: RepoTaskFullRecord,
): PostCompletionCorrectiveReason[] {
  const text = normalizeText(taskSearchText(task));
  const reasons: PostCompletionCorrectiveReason[] = [];
  if (/\b(regression|regressed|runtime defect|bug|broken|failure masked)\b/.test(text)) {
    reasons.push("regression");
  }
  if (hasCiBuildFailureSignal(text)) {
    reasons.push("ci-build-failure");
  }
  if (/\b(security|secret|credential|permission|sandbox|injection|approval|destructive)\b/.test(text)) {
    reasons.push("security");
  }
  if (/\b(review-scrutiny|thin acceptance|thin approval|semantic-gate)\b/.test(text)) {
    reasons.push("review-scrutiny");
  }
  if (/\btrajectory-diagnostic|trajectory diagnostics\b/.test(text)) {
    reasons.push("trajectory-diagnostic");
  }
  if (/\bworkflow-failure|workflow failure|consecutive failures\b/.test(text)) {
    reasons.push("workflow-failure");
  }
  if (/\bmissing evidence\b|\bmissing rendered evidence\b|\bweak rendered evidence\b|\bacceptance evidence gap\b|\bplaceholder test\b/.test(text)) {
    reasons.push("missing-evidence");
  }
  if (/\bprogress-reviewer\b|\bprogress review\b|\breview verdict\b|\bneeds-steering\b|\boperator report\b|\battention digest\b|\bautonomy health\b/.test(text)) {
    reasons.push("operator-report");
  }
  return POST_COMPLETION_FOLLOW_UP_REASONS.filter((reason) =>
    reasons.includes(reason)
  );
}

export function isBlockedOperatorCapture(task: RepoTaskFullRecord): boolean {
  if (task.state !== "blocked") return false;
  const parsed = parseBlockedPrecondition(task.body);
  return parsed.ok && parsed.precondition.kind === "operator-capture";
}

export function isPlannedContinuation(task: RepoTaskFullRecord): boolean {
  return /\b(planned sibling|planned decomposition|decomposed subtask|sub-slice|normal product fan-out|planned fan-out|strategic anchor)\b/i.test(
    taskSearchText(task),
  );
}

export function hasHardCorrectiveReason(
  reasons: readonly PostCompletionCorrectiveReason[],
): boolean {
  return reasons.some((reason) => HARD_CORRECTIVE_REASONS.has(reason));
}

function extractEvidenceRefs(text: string): EvidenceRefs {
  const refs = emptyRefs();
  for (const match of text.matchAll(TASK_ID_RE)) refs.taskIds.add(match[0]);
  for (const match of text.matchAll(RUN_ID_RE)) refs.runIds.add(match[0]);
  for (const match of text.matchAll(COMMIT_RE)) {
    refs.commitRefs.add(normalizeCommitRef(match[0]));
  }
  for (const match of text.matchAll(ARTIFACT_PATH_RE)) {
    refs.artifactPaths.add(trimTrailingPunctuation(match[0]));
  }
  return refs;
}

function emptyRefs(): EvidenceRefs {
  return {
    taskIds: new Set<string>(),
    runIds: new Set<string>(),
    commitRefs: new Set<string>(),
    artifactPaths: new Set<string>(),
  };
}

function taskSearchText(task: RepoTaskFullRecord): string {
  return `${task.id}\n${task.title}\n${task.summary}\n${task.body}`;
}

function stripLocalOverlapCheckSections(text: string): string {
  let result = text;
  while (true) {
    const marker = result.search(/\nLocal overlap check:\s*\n/i);
    if (marker < 0) return result;
    const afterMarker = marker + 1;
    const nextTaskSection = result.indexOf("\n## ", afterMarker);
    const nonduplicativeGap = result.indexOf("\nThe nonduplicative gap", afterMarker);
    const endCandidates = [nextTaskSection, nonduplicativeGap].filter(
      (index) => index >= 0,
    );
    const end = endCandidates.length > 0
      ? Math.min(...endCandidates)
      : result.length;
    result = result.slice(0, marker) + result.slice(end);
  }
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

const FAILURE_TERM = "(?:fail(?:ed|ing|ures?|s)?|broken|break(?:age|s)?|red)";
const CI_TERM = "(?:ci|ci/cd|continuous integration)";
const BUILD_TERM = "(?:build|build pipeline|production build)";
const INTEGRATION_TEST_TERM =
  "(?:integration tests?|integration test suite|test[- ]suite|e2e tests?|end-to-end tests?)";
const NEARBY_WORDS = "(?:\\s+[a-z0-9/.-]+){0,6}\\s+";
const CI_BUILD_FAILURE_PATTERNS = [
  new RegExp(`\\b${CI_TERM}\\b${NEARBY_WORDS}${FAILURE_TERM}\\b`),
  new RegExp(`\\b${FAILURE_TERM}\\b${NEARBY_WORDS}${CI_TERM}\\b`),
  new RegExp(`\\b${BUILD_TERM}\\b${NEARBY_WORDS}${FAILURE_TERM}\\b`),
  new RegExp(`\\b${FAILURE_TERM}\\b${NEARBY_WORDS}${BUILD_TERM}\\b`),
  new RegExp(`\\b${INTEGRATION_TEST_TERM}\\b${NEARBY_WORDS}${FAILURE_TERM}\\b`),
  new RegExp(`\\b${FAILURE_TERM}\\b${NEARBY_WORDS}${INTEGRATION_TEST_TERM}\\b`),
  /\bpost[- ](?:merge|completion)\b(?:\s+[a-z0-9/.-]+){0,8}\s+(?:ci|build|integration tests?|test[- ]suite)\b(?:\s+[a-z0-9/.-]+){0,8}\s+(?:fail(?:ed|ing|ures?|s)?|broken|break(?:age|s)?)\b/,
];

function hasCiBuildFailureSignal(text: string): boolean {
  return CI_BUILD_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

function normalizeCommitRef(raw: string): string {
  return raw.toLowerCase().replace(/^git:commit:/, "");
}

function commitRefsMatch(left: string, right: string): boolean {
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return shorter.length >= 7 && longer.startsWith(shorter);
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[.,;:]+$/, "");
}
