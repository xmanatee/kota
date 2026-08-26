import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import {
  emptyAutonomyIssueProjection,
  materializeAutonomyIssueProjection,
  readAutonomyIssueProjection,
  recordAutonomyIssueDispositions,
} from "#modules/autonomy/autonomy-issue-projection.js";
import { materializeGeneratedWorkProposal } from "#modules/autonomy/generated-work-proposal.js";
import {
  type AutonomyHealthSignalInput,
  normalizeHealthSignal,
} from "#modules/autonomy/health-signal.js";
import type { AutonomyHealthReview } from "./health-review.js";
import {
  buildAutonomyHealthAttentionDigest,
  buildAutonomyHealthReviewFromSignals,
  finalizeAutonomyHealthReviewActions,
  stageAutonomyHealthReviewActions,
  writeAutonomyHealthReviewArtifact,
} from "./health-review.js";

const NOW = "2026-06-17T12:30:00.000Z";

function signal(
  overrides: Partial<AutonomyHealthSignalInput> = {},
): ReturnType<typeof normalizeHealthSignal> {
  return normalizeHealthSignal({
    observation: "present",
    source: { kind: "workflow", id: "builder", workflow: "builder" },
    severity: "error",
    labels: ["runtime", "workflow-failure"],
    summary: "Builder hit the same typed runtime failure.",
    evidenceRefs: [{ kind: "run", ref: ".kota/runs/builder-1/metadata.json" }],
    actionability: "local-code",
    dedupeKey: "workflow:builder:runtime-failure",
    observationCount: 1,
    createdAt: NOW,
    ...overrides,
  });
}

function review(signals: ReturnType<typeof signal>[], generatedAt = NOW) {
  return buildAutonomyHealthReviewFromSignals({
    signals,
    generatedAt,
    sourceEventName: "autonomy.runtime-health.audit",
    reason: "test",
  });
}

function applyReview(workspaceRoot: string, built: AutonomyHealthReview) {
  const currentProjection = readAutonomyIssueProjection(workspaceRoot);
  const repositoryActions = stageAutonomyHealthReviewActions({
    workspaceRoot,
    currentProjection,
    scopeRoot: workspaceRoot,
    review: built,
  });
  const finalized = finalizeAutonomyHealthReviewActions({
    currentProjection,
    scopeRoot: workspaceRoot,
    ownerQuestionQueue: new OwnerQuestionQueue(
      join(workspaceRoot, ".kota", "owner-questions"),
    ),
    review: built,
    repositoryActions,
  });
  materializeAutonomyIssueProjection(workspaceRoot, finalized.projection);
  return finalized;
}

describe("autonomy health issue projection", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "kota-health-review-"));
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("keeps one warning ephemeral and admits the repeated observation", () => {
    const first = applyReview(
      workspaceRoot,
      review([signal({ severity: "warning", observationCount: 1 })]),
    );

    expect(first.issueTransitions).toEqual([]);
    expect(readAutonomyIssueProjection(workspaceRoot).issues).toEqual([]);

    const repeated = applyReview(
      workspaceRoot,
      review(
        [signal({ severity: "warning", observationCount: 2 })],
        "2026-06-17T13:00:00.000Z",
      ),
    );

    expect(repeated.issueTransitions).toEqual([
      expect.objectContaining({ kind: "opened", requiresDecision: true }),
    ]);
    expect(readAutonomyIssueProjection(workspaceRoot).issues).toHaveLength(1);
  });

  it("requests one issue decision without writing tasks or owner questions", () => {
    const actions = applyReview(
      workspaceRoot,
      review([
        signal(),
        signal({
          evidenceRefs: [
            { kind: "run", ref: ".kota/runs/builder-2/metadata.json" },
          ],
          createdAt: "2026-06-17T12:31:00.000Z",
        }),
      ]),
    );

    expect(actions.applied).toEqual([
      expect.objectContaining({
        kind: "decision-requested",
        dedupeKey: "workflow:builder:runtime-failure",
        semanticRevision: 1,
        transition: "opened",
      }),
    ]);
    expect(actions.touchedTaskQueue).toBe(false);
    expect(existsSync(join(workspaceRoot, "data", "tasks"))).toBe(false);
    expect(
      readAutonomyIssueProjection(workspaceRoot).issues[0]?.evidenceRefs.map(
        (ref) => ref.ref,
      ),
    ).toEqual([
      ".kota/runs/builder-1/metadata.json",
      ".kota/runs/builder-2/metadata.json",
    ]);
  });

  it("enriches repeated evidence without another decision or attention item", () => {
    const firstReview = review([signal()]);
    applyReview(workspaceRoot, firstReview);
    const repeatedReview = review(
      [
        signal({
          evidenceRefs: [
            { kind: "run", ref: ".kota/runs/builder-2/metadata.json" },
          ],
          createdAt: "2026-06-17T13:00:00.000Z",
        }),
      ],
      "2026-06-17T13:00:00.000Z",
    );
    const repeated = applyReview(workspaceRoot, repeatedReview);

    expect(repeated.issueTransitions).toEqual([
      expect.objectContaining({ kind: "repeated", requiresDecision: false }),
    ]);
    expect(repeated.applied).toEqual([]);
    expect(
      buildAutonomyHealthAttentionDigest({ review: repeatedReview, actions: repeated }),
    ).toMatchObject({ items: [], text: "Autonomy health review (0 patterns):" });
    const issue = readAutonomyIssueProjection(workspaceRoot).issues[0]!;
    expect(issue.semanticRevision).toBe(1);
    expect(issue.occurrenceCount).toBe(2);
  });

  it("resolves linked pending questions only from an explicit clear", () => {
    const opened = applyReview(workspaceRoot, review([signal()]));
    const issueKey = opened.applied[0]!.issueKey;
    const queue = new OwnerQuestionQueue(
      join(workspaceRoot, ".kota", "owner-questions"),
    );
    const question = queue.enqueue({
      context: "Fixture context",
      question: "What should happen?",
      reason: "Fixture reason",
      source: "fixture",
      answerBehavior: "record-only",
      origin: { kind: "manual", source: "fixture" },
    });
    materializeAutonomyIssueProjection(workspaceRoot, recordAutonomyIssueDispositions({
      current: readAutonomyIssueProjection(workspaceRoot),
      updates: [{
        issueKey,
        kind: "owner-question",
        decidedAt: "2026-06-17T12:45:00.000Z",
        taskIds: [],
        ownerQuestionIds: [question.id],
      }],
    }));

    const cleared = applyReview(
      workspaceRoot,
      review(
        [
          signal({
            observation: "cleared",
            createdAt: "2026-06-17T13:00:00.000Z",
          }),
        ],
        "2026-06-17T13:00:00.000Z",
      ),
    );

    expect(cleared.dismissedOwnerQuestionIds).toEqual([question.id]);
    expect(cleared.applied).toEqual([
      expect.objectContaining({ kind: "resolved", transition: "cleared" }),
    ]);
    expect(queue.get(question.id)?.status).toBe("dismissed");
    expect(readAutonomyIssueProjection(workspaceRoot).issues[0]?.status).toBe(
      "resolved",
    );
  });

  it("drops the stable generated task on an explicit source clear", () => {
    execFileSync("git", ["init", "--quiet"], { cwd: workspaceRoot });
    const opened = applyReview(workspaceRoot, review([signal()]));
    const issueKey = opened.applied[0]!.issueKey;
    const task = materializeGeneratedWorkProposal({
      workspaceRoot,
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
    materializeAutonomyIssueProjection(workspaceRoot, recordAutonomyIssueDispositions({
      current: readAutonomyIssueProjection(workspaceRoot),
      updates: [{
        issueKey,
        kind: "task",
        decidedAt: "2026-06-17T12:45:00.000Z",
        taskIds: [task.taskId!],
        ownerQuestionIds: [],
      }],
    }));

    const cleared = applyReview(
      workspaceRoot,
      review(
        [signal({
          observation: "cleared",
          createdAt: "2026-06-17T13:00:00.000Z",
        })],
        "2026-06-17T13:00:00.000Z",
      ),
    );

    expect(cleared.droppedTaskIds).toEqual([task.taskId]);
    expect(cleared.touchedTaskQueue).toBe(true);
    expect(cleared.taskMutationPaths).toEqual([
      `data/tasks/dropped/${task.taskId}.md`,
      `data/tasks/ready/${task.taskId}.md`,
    ]);
    expect(existsSync(
      join(workspaceRoot, "data", "tasks", "dropped", `${task.taskId}.md`),
    )).toBe(true);
    expect(readAutonomyIssueProjection(workspaceRoot).issues[0]?.status).toBe(
      "resolved",
    );
  });

  it("persists bounded projected evidence instead of raw runtime text", () => {
    const runtimeText = "raw runtime detail that must not be copied";
    const built = review([
      signal({
        summary: runtimeText,
        evidenceRefs: [{
          kind: "run",
          ref: ".kota/runs/builder-1/metadata.json",
          summary: runtimeText,
        }],
      }),
    ]);
    const actions = stageAutonomyHealthReviewActions({
      workspaceRoot,
      currentProjection: emptyAutonomyIssueProjection(),
      scopeRoot: workspaceRoot,
      review: built,
    });
    const path = writeAutonomyHealthReviewArtifact(
      join(workspaceRoot, ".kota", "runs", "health-review"),
      { generatedAt: NOW, review: built, actions },
    );
    const persisted = readFileSync(path, "utf-8");

    expect(persisted).toContain(".kota/runs/builder-1/metadata.json");
    expect(persisted).not.toContain(runtimeText);
  });
});
