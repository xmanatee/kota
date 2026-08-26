import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import {
  emptyAutonomyIssueProjection,
  recordAutonomyIssueDispositions,
} from "#modules/autonomy/autonomy-issue-projection.js";
import { materializeGeneratedWorkProposal } from "#modules/autonomy/generated-work-proposal.js";
import {
  type AutonomyHealthSignalInput,
  normalizeHealthSignal,
} from "#modules/autonomy/health-signal.js";
import {
  buildAutonomyHealthReviewFromSignals,
  finalizeAutonomyHealthReviewActions,
  stageAutonomyHealthReviewActions,
  writeAutonomyHealthReviewArtifact,
} from "./health-review.js";
import { planAutonomyHealthReviewPublication, publishAutonomyHealthReview } from "./health-review-publication.js";

const NOW = "2026-08-25T10:00:00.000Z";
const SCOPE_ID = "scope-health-review";

function signal(
  dedupeKey: string,
  observation: AutonomyHealthSignalInput["observation"],
): ReturnType<typeof normalizeHealthSignal> {
  return normalizeHealthSignal({
    observation,
    source: { kind: "workflow", id: dedupeKey, workflow: "builder" },
    severity: "error",
    labels: ["runtime", "workflow-failure"],
    summary: `Observed ${dedupeKey}.`,
    evidenceRefs: [{ kind: "run", ref: `.kota/runs/${dedupeKey}/metadata.json` }],
    actionability: "local-code",
    dedupeKey,
    observationCount: 1,
    createdAt: NOW,
  });
}

describe("autonomy health review publication", () => {
  let rootDir: string;
  let scopeDir: string;
  let sandboxDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "kota-health-publication-"));
    scopeDir = join(rootDir, "scope");
    sandboxDir = join(rootDir, "sandbox");
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("reuses its durable pre-mutation event plan after finalization replays", () => {
    const ownerQuestionQueue = new OwnerQuestionQueue(
      join(scopeDir, ".kota", "owner-questions"),
    );
    const openedReview = buildAutonomyHealthReviewFromSignals({
      signals: [signal("workflow:builder:runtime-failure", "present")],
      generatedAt: NOW,
      sourceEventName: "autonomy.runtime-health.audit",
      reason: "fixture setup",
    });
    let currentProjection = emptyAutonomyIssueProjection();
    const opened = finalizeAutonomyHealthReviewActions({
      currentProjection,
      scopeDir,
      ownerQuestionQueue,
      review: openedReview,
      repositoryActions: stageAutonomyHealthReviewActions({
        projectDir: sandboxDir,
        currentProjection,
        scopeDir,
        review: openedReview,
      }),
    });
    currentProjection = opened.projection;
    const issueKey = opened.applied[0]!.issueKey;
    const question = ownerQuestionQueue.enqueue({
      context: "Fixture context",
      question: "How should this issue be handled?",
      reason: "Fixture reason",
      source: "fixture",
      answerBehavior: "record-only",
      origin: { kind: "manual", source: "fixture" },
    });
    currentProjection = recordAutonomyIssueDispositions({
      current: currentProjection,
      updates: [{
        issueKey,
        kind: "owner-question",
        decidedAt: NOW,
        taskIds: [],
        ownerQuestionIds: [question.id],
      }],
    });
    mkdirSync(sandboxDir, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: sandboxDir });
    const task = materializeGeneratedWorkProposal({
      projectDir: sandboxDir,
      proposal: {
        kind: "task",
        proposalKey: `autonomy-issue:${issueKey}`,
        title: "Repair the generated health issue",
        summary: "Route the health issue through builder.",
        priority: "p1",
        area: "autonomy",
        taskClass: "Meta",
        body: "## Problem\n\nThe health issue is open.\n",
        provenance: {
          source: "improver",
          runId: "improver-run",
          issueKey,
          semanticRevision: 1,
          evidenceRefs: [".kota/runs/builder-1/metadata.json"],
        },
      },
    });
    const review = buildAutonomyHealthReviewFromSignals({
      signals: [
        signal("workflow:builder:runtime-failure", "cleared"),
        signal("workflow:dispatcher:runtime-failure", "present"),
      ],
      generatedAt: "2026-08-25T10:05:00.000Z",
      sourceEventName: "autonomy.runtime-health.audit",
      reason: "fixture publication",
    });
    const repositoryActions = stageAutonomyHealthReviewActions({
      projectDir: sandboxDir,
      currentProjection,
      scopeDir,
      review,
    });
    const runDir = join(scopeDir, ".kota", "runs", "health-review-run");
    writeAutonomyHealthReviewArtifact(runDir, {
      generatedAt: review.generatedAt,
      review,
      actions: repositoryActions,
    });

    expect(repositoryActions.droppedTaskIds).toEqual([task.taskId]);
    expect(existsSync(
      join(sandboxDir, "data", "tasks", "dropped", `${task.taskId}.md`),
    )).toBe(true);
    expect(existsSync(join(scopeDir, "data", "tasks"))).toBe(false);
    expect(currentProjection.issues[0]?.status).toBe(
      "needs-decision",
    );
    expect(ownerQuestionQueue.get(question.id)?.status).toBe("pending");

    // The writer has only staged repository actions at this point. No
    // canonical projection or owner-question state has changed.
    expect(ownerQuestionQueue.get(question.id)?.status).toBe("pending");

    const plan = planAutonomyHealthReviewPublication({
      scopeDir,
      sourceRunId: "health-review-run",
      scopeId: SCOPE_ID,
      currentProjection,
    });
    const publication = publishAutonomyHealthReview({
      scopeDir,
      sourceRunId: "health-review-run",
      scopeId: SCOPE_ID,
      currentProjection,
      plan,
    });
    const issues = publication.nextProjection.issues;
    expect(issues.find((issue) => issue.issueKey === issueKey)?.status).toBe(
      "resolved",
    );
    expect(ownerQuestionQueue.get(question.id)?.status).toBe("dismissed");
    expect(publication.result.decisionRequests).toHaveLength(1);
    expect(publication.result.attentionDigest).not.toBeNull();

    const replay = publishAutonomyHealthReview({
      scopeDir,
      sourceRunId: "health-review-run",
      scopeId: SCOPE_ID,
      currentProjection,
      plan,
    });
    expect(ownerQuestionQueue.get(question.id)?.status).toBe("dismissed");
    expect(replay).toEqual(publication);
    expect(replay.result.decisionRequests).toHaveLength(1);
    expect(replay.result.attentionDigest).not.toBeNull();
  });
});
