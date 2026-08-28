
import { describe, expect, it } from "vitest";
import { renderGardenerTaskBody, slugifyScope } from "./gardener-task.js";
import type { ParetoEvaluation, SimplificationHypothesis } from "./types.js";

describe("Gardener Task Rendering & Proposals", () => {
  it("slugifyScope normalizes target scope names safely", () => {
    expect(slugifyScope("src/core/router.ts")).toBe("src-core-router-ts");
    expect(slugifyScope("module:foo-bar")).toBe("module-foo-bar");
  });

  it("renderGardenerTaskBody produces structured task markdown with falsifiable claims", () => {
    const hypothesis: SimplificationHypothesis = {
      id: "hyp-del-123456",
      targetScope: "src/modules/old-feature",
      problem: "Duplicated and obsolete helper logic",
      behaviorPreservationClaim: "Preserves all external module API surface without breakage.",
      structuralImprovement: {
        dimension: "deletion",
        description: "Remove obsolete helper functions in old-feature",
      },
      candidateActions: [
        { type: "delete", target: "src/modules/old-feature/legacy.ts", details: "Remove unused legacy export" },
      ],
      evidenceFingerprints: ["fp-abc123456"],
      admittedAt: "2026-08-28T00:00:00Z",
    };

    const pareto: ParetoEvaluation = {
      hypothesisId: hypothesis.id,
      disposition: "accepted",
      reasons: ["Pareto improvement accepted"],
      improvedDimensions: ["deletion"],
      protectedInvariantsPreserved: true,
      score: 100,
    };

    const body = renderGardenerTaskBody({ hypothesis, pareto });
    expect(body).toContain("## Problem");
    expect(body).toContain("## Desired Outcome");
    expect(body).toContain("## Constraints");
    expect(body).toContain("## How We Will Know");
    expect(body).toContain("Behavior Preservation Claim");
    expect(body).toContain("Preserves all external module API surface without breakage.");
  });
});
