import { describe, expect, it } from "vitest";
import { evaluateArchitecturalFitness } from "./fitness-functions.js";
import { evaluateParetoComparator } from "./pareto.js";
import type { ArchitectureObservation, SimplificationHypothesis } from "./types.js";

function makeHypothesis(overrides: Partial<SimplificationHypothesis> = {}): SimplificationHypothesis {
  return {
    id: "hyp-del-123456",
    targetScope: "module:old-module",
    problem: "Redundant duplicated logic across modules",
    behaviorPreservationClaim: "Preserves all public interfaces and behavior. Existing tests pass unchanged.",
    structuralImprovement: {
      dimension: "deletion",
      description: "Delete retired adapter implementation",
    },
    candidateActions: [
      { type: "delete", target: "src/modules/old-module/adapter.ts" },
    ],
    evidenceFingerprints: ["fp-1", "fp-2"],
    admittedAt: "2026-08-28T00:00:00Z",
    ...overrides,
  };
}

describe("Architectural Fitness Functions & Pareto Comparator", () => {
  describe("evaluateArchitecturalFitness", () => {
    it("reports satisfied invariants when no violations are present", () => {
      const report = evaluateArchitecturalFitness([]);
      expect(report.passed).toBe(true);
      expect(report.protectedInvariantsSatisfied).toBe(true);
      expect(report.violations.forbiddenCoreDependencies).toBe(0);
      expect(report.violations.moduleDependencyCycles).toBe(0);
    });

    it("reports violations when protected invariants are broken", () => {
      const obs: ArchitectureObservation[] = [
        {
          id: "obs-1",
          kind: "forbidden-core-to-module-dependency",
          category: "dependency-boundary",
          targetScope: "src/core/router.ts",
          summary: "Forbidden core-to-module dependency",
          fingerprint: "fp-1",
          evidence: {},
          timestamp: "2026-08-28T00:00:00Z",
        },
        {
          id: "obs-2",
          kind: "module-dependency-cycle",
          category: "dependency-boundary",
          targetScope: "module:a",
          summary: "Module dependency cycle detected",
          fingerprint: "fp-2",
          evidence: {},
          timestamp: "2026-08-28T00:00:00Z",
        },
      ];

      const report = evaluateArchitecturalFitness(obs);
      expect(report.passed).toBe(false);
      expect(report.protectedInvariantsSatisfied).toBe(false);
      expect(report.violations.forbiddenCoreDependencies).toBe(1);
      expect(report.violations.moduleDependencyCycles).toBe(1);
    });
  });

  describe("evaluateParetoComparator", () => {
    it("accepts a valid hypothesis with a non-empty behavior-preservation claim", () => {
      const hyp = makeHypothesis();
      const evalResult = evaluateParetoComparator(hyp);

      expect(evalResult.disposition).toBe("accepted");
      expect(evalResult.protectedInvariantsPreserved).toBe(true);
      expect(evalResult.improvedDimensions).toContain("deletion");
      expect(evalResult.score).toBeGreaterThan(0);
    });

    it("rejects hypothesis with missing behavior-preservation claim", () => {
      const hyp = makeHypothesis({ behaviorPreservationClaim: "" });
      const evalResult = evaluateParetoComparator(hyp);

      expect(evalResult.disposition).toBe("rejected");
      expect(evalResult.reasons.some((r) => r.includes("behavior-preservation claim"))).toBe(true);
    });

    it("rejects hypothesis that regresses protected architectural invariants", () => {
      const hyp = makeHypothesis();
      const evalResult = evaluateParetoComparator(hyp, {
        regressesProtectedInvariants: true,
      });

      expect(evalResult.disposition).toBe("rejected");
      expect(evalResult.protectedInvariantsPreserved).toBe(false);
      expect(evalResult.reasons.some((r) => r.includes("regresses protected"))).toBe(true);
    });

    it("rejects hypothesis that introduces permanent dual ownership", () => {
      const hyp = makeHypothesis();
      const evalResult = evaluateParetoComparator(hyp, {
        introducesDualOwnership: true,
      });

      expect(evalResult.disposition).toBe("rejected");
      expect(evalResult.reasons.some((r) => r.includes("dual ownership"))).toBe(true);
    });

    describe("abstraction justification rules", () => {
      it("rejects new abstraction missing justification entirely", () => {
        const hyp = makeHypothesis({
          structuralImprovement: {
            dimension: "abstraction-consolidation",
            description: "Introduce common adapter wrapper",
          },
        });
        const evalResult = evaluateParetoComparator(hyp);

        expect(evalResult.disposition).toBe("rejected");
        expect(evalResult.reasons.some((r) => r.includes("missing required abstraction justification"))).toBe(true);
      });

      it("rejects new abstraction replacing fewer than 2 real implementations", () => {
        const hyp = makeHypothesis({
          structuralImprovement: {
            dimension: "abstraction-consolidation",
            description: "Introduce common adapter wrapper",
          },
          abstractionJustification: {
            replacesImplementationCount: 1,
            variationAxis: "storage-backend",
            leavesConsumersSimpler: true,
            canonicalOwner: "src/modules/storage",
          },
        });
        const evalResult = evaluateParetoComparator(hyp);

        expect(evalResult.disposition).toBe("rejected");
        expect(evalResult.reasons.some((r) => r.includes("replaces only 1 implementation(s)"))).toBe(true);
      });

      it("accepts new abstraction meeting all 4 justification conditions", () => {
        const hyp = makeHypothesis({
          structuralImprovement: {
            dimension: "abstraction-consolidation",
            description: "Introduce unified memory cache",
          },
          abstractionJustification: {
            replacesImplementationCount: 3,
            variationAxis: "cache-eviction-policy",
            leavesConsumersSimpler: true,
            canonicalOwner: "src/modules/memory",
          },
        });
        const evalResult = evaluateParetoComparator(hyp);

        expect(evalResult.disposition).toBe("accepted");
        expect(evalResult.improvedDimensions).toContain("abstraction-consolidation");
      });
    });
  });
});
