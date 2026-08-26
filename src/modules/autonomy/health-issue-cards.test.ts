import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyAutonomyIssueObservations,
  buildAutonomyIssueObservation,
  emptyAutonomyIssueProjection,
  materializeAutonomyIssueProjection,
  recordAutonomyIssueDispositions,
} from "./autonomy-issue-projection.js";
import { collectCurrentAutonomyHealthIssueCards } from "./health-issue-cards.js";

const NOW = "2026-06-17T12:30:00.000Z";

function observation(args: {
  rootCauseKey: string;
  runId: string;
  observedAt: string;
}) {
  return buildAutonomyIssueObservation({
    kind: "present",
    rootCauseKey: args.rootCauseKey,
    observedAt: args.observedAt,
    signalIds: [`health-${args.runId}`],
    source: { kind: "workflow", id: "builder" },
    severity: "warning",
    actionability: "local-code",
    labels: ["runtime"],
    summaries: ["Builder repeated the same local runtime failure."],
    evidenceRefs: [
      {
        kind: "run",
        ref: `.kota/runs/${args.runId}/metadata.json`,
      },
    ],
    observationCount: 1,
  });
}

describe("current autonomy health issue cards", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-health-issue-cards-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(workspaceRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("reads every unresolved issue from the durable projection", () => {
    const first = observation({
      rootCauseKey: "workflow:builder:runtime-warning",
      runId: "builder-1",
      observedAt: NOW,
    });
    const second = observation({
      rootCauseKey: "workflow:improver:runtime-warning",
      runId: "improver-1",
      observedAt: "2026-06-17T13:00:00.000Z",
    });
    const projected = applyAutonomyIssueObservations({
      current: emptyAutonomyIssueProjection(),
      observations: [first, second],
    }).projection;
    materializeAutonomyIssueProjection(workspaceRoot, recordAutonomyIssueDispositions({
      current: projected,
      updates: [
        {
          issueKey: first.issueKey,
          kind: "task",
          decidedAt: NOW,
          taskIds: ["task-health-workflow-builder-runtime-warning"],
          ownerQuestionIds: [],
        },
      ],
    }));

    const evidence = collectCurrentAutonomyHealthIssueCards(workspaceRoot, {
      nowIso: "2026-06-17T13:01:00.000Z",
    });

    expect(evidence.projectionUpdatedAt).toBe(
      "2026-06-17T13:00:00.000Z",
    );
    expect(evidence.issueCards).toHaveLength(2);
    expect(evidence.issueCards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueKey: first.issueKey,
          dedupeKey: "workflow:builder:runtime-warning",
          status: "open",
          semanticRevision: 1,
          taskIds: ["task-health-workflow-builder-runtime-warning"],
        }),
        expect.objectContaining({
          issueKey: second.issueKey,
          dedupeKey: "workflow:improver:runtime-warning",
          status: "needs-decision",
        }),
      ]),
    );
  });

  it("does not infer current issues from latest review artifacts", () => {
    const runDir = join(workspaceRoot, ".kota", "runs", "review-legacy");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "autonomy-health-review.json"),
      JSON.stringify({
        generatedAt: NOW,
        review: { groups: [{ dedupeKey: "legacy:artifact-only" }] },
      }),
      "utf-8",
    );

    expect(collectCurrentAutonomyHealthIssueCards(workspaceRoot)).toEqual({
      generatedAt: expect.any(String),
      projectionUpdatedAt: null,
      issueCards: [],
    });
  });

  it("omits explicitly cleared issues", () => {
    const present = observation({
      rootCauseKey: "workflow:builder:runtime-warning",
      runId: "builder-1",
      observedAt: NOW,
    });
    const cleared = buildAutonomyIssueObservation({
      ...present,
      kind: "cleared",
      observedAt: "2026-06-17T14:00:00.000Z",
      signalIds: ["health-builder-cleared"],
    });
    const projected = applyAutonomyIssueObservations({
      current: emptyAutonomyIssueProjection(),
      observations: [present, cleared],
    }).projection;
    materializeAutonomyIssueProjection(workspaceRoot, projected);

    expect(
      collectCurrentAutonomyHealthIssueCards(workspaceRoot).issueCards,
    ).toEqual([]);
  });
});
