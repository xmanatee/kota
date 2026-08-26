import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import {
  buildCriticReviewScrutinyRecord,
  buildProgressReviewScrutinyRecordFromReview,
  buildPrReviewScrutinyRecord,
} from "./review-scrutiny-builders.js";
import { summarizeReviewScrutiny } from "./review-scrutiny-summary.js";
import {
  CRITIC_REVIEW_ARTIFACT,
  isJsonObject,
  type JsonObject,
  type JsonValue,
  numberValue,
  objectArray,
  PROGRESS_REVIEW_ARTIFACT,
  type ReviewScrutinyRecord,
  type ReviewScrutinyReport,
  type ReviewScrutinyUnsupportedArtifact,
  SEMANTIC_GATE_REVIEW_ARTIFACT,
  stringArray,
  stringValue,
} from "./review-scrutiny-types.js";
import { taskIdentityFromRunTrigger } from "./run-delivery-evidence.js";

function readJsonObject(
  path: string,
): { ok: true; value: JsonObject } | { ok: false; reason: string } {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as JsonValue;
    if (!isJsonObject(parsed)) {
      return { ok: false, reason: "artifact is not a JSON object" };
    }
    return { ok: true, value: parsed };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function artifactGeneratedAt(run: WorkflowRunMetadata, obj: JsonObject): string {
  return stringValue(obj.generatedAt) ?? run.completedAt ?? run.startedAt;
}

function strictStringArray(value: JsonValue | undefined): string[] | null {
  if (!Array.isArray(value)) return null;
  const entries: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    entries.push(entry);
  }
  return entries;
}

function taskIdFromRunData(run: WorkflowRunMetadata): string | undefined {
  return taskIdentityFromRunTrigger(run).taskId ?? undefined;
}

function buildProgressReviewScrutinyRecord(args: {
  runId: string;
  workflow: string;
  generatedAt: string;
  taskId?: string;
  artifact: JsonObject;
}): ReviewScrutinyRecord | null {
  const review = isJsonObject(args.artifact.review) ? args.artifact.review : null;
  if (!review) return null;
  const decision = stringValue(review.verdict);
  if (
    decision !== "on-track" &&
    decision !== "needs-steering" &&
    decision !== "blocked" &&
    decision !== "insufficient-evidence"
  ) {
    return null;
  }
  const findings = isJsonObject(review.findings) ? review.findings : {};
  const groups = [
    ...(isJsonObject(findings.crossScope) ? [findings.crossScope] : []),
    ...(isJsonObject(findings.localScope) ? [findings.localScope] : []),
  ];
  const ownerQuestions = objectArray(review.ownerQuestions);
  return buildProgressReviewScrutinyRecordFromReview({
    ...args,
    decision,
    summary: stringValue(review.summary) ?? "",
    findingGroups: groups.map((group) => ({
      claims: objectArray(group.claims).map((claim) => ({
        evidenceIds: stringArray(claim.evidenceIds),
      })),
      followUpTasks: objectArray(group.followUpTasks).map((task) => ({
        evidenceIds: stringArray(task.evidenceIds),
      })),
    })),
    ownerQuestions: ownerQuestions.map((question) => ({
      evidenceIds: stringArray(question.evidenceIds),
    })),
  });
}

export function collectReviewScrutinyReport(args: {
  runsDir: string;
  runs: readonly WorkflowRunMetadata[];
}): ReviewScrutinyReport {
  const records: ReviewScrutinyRecord[] = [];
  const unsupported: ReviewScrutinyUnsupportedArtifact[] = [];
  for (const run of args.runs) {
    collectCriticLike(run, args.runsDir, CRITIC_REVIEW_ARTIFACT, records, unsupported);
    collectCriticLike(
      run,
      args.runsDir,
      SEMANTIC_GATE_REVIEW_ARTIFACT,
      records,
      unsupported,
    );
    collectProgress(run, args.runsDir, records, unsupported);
    collectPrReviewer(run, records, unsupported);
  }
  return summarizeReviewScrutiny(records, unsupported);
}

function collectCriticLike(
  run: WorkflowRunMetadata,
  runsDir: string,
  artifact: string,
  records: ReviewScrutinyRecord[],
  unsupported: ReviewScrutinyUnsupportedArtifact[],
): void {
  const path = join(runsDir, run.id, artifact);
  if (!existsSync(path)) return;
  const read = readJsonObject(path);
  if (!read.ok) {
    unsupported.push({ runId: run.id, workflow: run.workflow, artifact, reason: read.reason });
    return;
  }
  const verdict = stringValue(read.value.verdict);
  if (verdict !== "pass" && verdict !== "fail" && verdict !== "pass_with_warnings") {
    unsupported.push({ runId: run.id, workflow: run.workflow, artifact, reason: "unsupported verdict shape" });
    return;
  }
  const criticalIssues = strictStringArray(read.value.critical_issues);
  const warnings = strictStringArray(read.value.warnings);
  const summary = typeof read.value.summary === "string" ? read.value.summary : null;
  if (!criticalIssues || !warnings || summary === null) {
    unsupported.push({
      runId: run.id,
      workflow: run.workflow,
      artifact,
      reason: "unsupported critic verdict fields",
    });
    return;
  }
  records.push(buildCriticReviewScrutinyRecord({
    runId: run.id,
    workflow: run.workflow,
    generatedAt: artifactGeneratedAt(run, read.value),
    artifact,
    reviewerPromptHash: stringValue(read.value.reviewerPromptHash) ?? undefined,
    taskId: taskIdFromRunData(run),
    verdict: {
      verdict,
      critical_issues: criticalIssues,
      warnings,
      summary,
    },
  }));
}

function collectProgress(
  run: WorkflowRunMetadata,
  runsDir: string,
  records: ReviewScrutinyRecord[],
  unsupported: ReviewScrutinyUnsupportedArtifact[],
): void {
  const path = join(runsDir, run.id, PROGRESS_REVIEW_ARTIFACT);
  if (!existsSync(path)) return;
  const read = readJsonObject(path);
  if (!read.ok) {
    unsupported.push({ runId: run.id, workflow: run.workflow, artifact: PROGRESS_REVIEW_ARTIFACT, reason: read.reason });
    return;
  }
  const record = buildProgressReviewScrutinyRecord({
    runId: run.id,
    workflow: run.workflow,
    generatedAt: artifactGeneratedAt(run, read.value),
    taskId: taskIdFromRunData(run),
    artifact: read.value,
  });
  if (record) records.push(record);
  else unsupported.push({ runId: run.id, workflow: run.workflow, artifact: PROGRESS_REVIEW_ARTIFACT, reason: "unsupported progress-review shape" });
}

function collectPrReviewer(
  run: WorkflowRunMetadata,
  records: ReviewScrutinyRecord[],
  unsupported: ReviewScrutinyUnsupportedArtifact[],
): void {
  if (run.workflow !== "pr-reviewer") return;
  const step = run.steps.find((candidate) => candidate.id === "prepare-comment");
  if (!step || step.status !== "success") return;
  const output = step.output as JsonValue | undefined;
  if (!isJsonObject(output)) {
    unsupported.push({ runId: run.id, workflow: run.workflow, artifact: "metadata:prepare-comment", reason: "missing prepared comment output" });
    return;
  }
  const repo = stringValue(output.repo);
  const prNumber = numberValue(output.prNumber);
  const recommendation = stringValue(output.recommendation);
  const body = stringValue(output.body);
  if (
    !repo ||
    prNumber === null ||
    (recommendation !== "approve" && recommendation !== "request-changes") ||
    !body
  ) {
    unsupported.push({ runId: run.id, workflow: run.workflow, artifact: "metadata:prepare-comment", reason: "unsupported prepared comment shape" });
    return;
  }
  records.push(buildPrReviewScrutinyRecord({
    runId: run.id,
    workflow: run.workflow,
    generatedAt: step.completedAt,
    artifact: "metadata:prepare-comment",
    repo,
    prNumber,
    recommendation,
    body,
  }));
}
