import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeAutonomyChangeDecisionArtifact } from "./autonomy-change-decision.js";
import { runShadowSemanticReview } from "./shadow-semantic-review.js";
import {
  baseShadowReviewDeclaration,
  makeShadowReviewContext,
  makeShadowReviewDirs,
} from "./shadow-semantic-review-test-support.js";

describe("shadow semantic review blocking mode", () => {
  it("requires a promoted autonomy-change decision before blocking mode", async () => {
    const { projectDir, runDirPath } = makeShadowReviewDirs();
    await expect(
      runShadowSemanticReview({
        ctx: makeShadowReviewContext(projectDir, runDirPath),
        declaration: baseShadowReviewDeclaration({ mode: "blocking" }),
        invoker: async () => {
          throw new Error("invoker should not run without promotion evidence");
        },
      }),
    ).rejects.toThrow(/requires an autonomy-change-decision artifact/);
  });

  it("lets validated blocking mode reject the workflow target", async () => {
    const { projectDir, runDirPath } = makeShadowReviewDirs();
    const decisionPath = join(projectDir, ".kota", "runs", "decision", "autonomy-change-decision.json");
    writeAutonomyChangeDecisionArtifact(decisionPath, {
      schemaVersion: 1,
      artifactType: "autonomy-change-decision",
      runId: "decision",
      createdAt: "2026-07-07T00:00:00.000Z",
      taskIds: ["task-run-shadow-semantic-reviewers-for-non-builder-auto"],
      affectedSurfaces: ["fixture-shadow-review"],
      changeClasses: ["reviewer"],
      hypothesis: "Measured shadow reviewer evidence improved outcomes.",
      sourceRefs: ["task-run-shadow-semantic-reviewers-for-non-builder-auto"],
      baselineRefs: ["baseline"],
      candidateRefs: ["candidate"],
      metricsCompared: [
        {
          name: "catch-rate",
          baseline: "0",
          candidate: "1",
          unit: "count",
          direction: "improved",
          qualitySignal: true,
        },
      ],
      rolloutMode: "blocking",
      decision: "promote",
      rationale: "Fixture promotion.",
      ownerSafetyExceptions: [],
      followUpTaskIds: [],
    });

    await expect(
      runShadowSemanticReview({
        ctx: makeShadowReviewContext(projectDir, runDirPath),
        declaration: baseShadowReviewDeclaration({
          mode: "blocking",
          blockingDecisionArtifact: ".kota/runs/decision/autonomy-change-decision.json",
        }),
        invoker: async () => ({
          text: JSON.stringify({
            decision: "fail",
            summary: "Blocking reviewer found a critical issue.",
            citedArtifacts: ["artifact:diff"],
            findings: [
              {
                severity: "critical",
                summary: "Critical source-decision gap.",
                citedArtifacts: ["artifact:diff"],
                falsePositive: false,
              },
            ],
          }),
          streamedText: "",
          turns: 1,
          usage: {
            tokens: { state: "unknown" },
            cost: { state: "unknown" },
          },
          isError: false,
        }),
      }),
    ).rejects.toThrow(/rejected the target/);

    const artifactPath = join(runDirPath, "shadow-review", "fixture-shadow-review.json");
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
    expect(artifact).toMatchObject({ mode: "blocking", decision: "fail" });
  });
});
