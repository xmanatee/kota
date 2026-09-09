import { describe, expect, it } from "vitest";
import { evaluateAdmission } from "./admission.js";
import { type ArchitectureAssessment, type ArchitectureAssessmentInput, decodeArchitectureAssessment } from "./hypothesis.js";

const ref = ".kota/runs/review/evidence.json";
const input: ArchitectureAssessmentInput = {
  admitted: [evaluateAdmission({ targetScope: "module:foo", signals: [], explicitRequest: { targetScope: "module:foo" } })],
  evidenceRefs: [ref], reason: "Assess the duplicate owner identified in the handoff",
};
const assessment: ArchitectureAssessment = {
  reason: "The cited registrations show two owners of the same operation.",
  evidenceAssessment: [{ ref, available: true, assessment: "Both current registrations implement the same public operation." }],
  hypothesis: {
    targetScope: "module:foo", problem: "Two registrations own the same operation.",
    behaviorPreservationClaim: "Keep the public operation and route all callers through foo's canonical registration.",
    structuralImprovement: { dimension: "ownership-collapse", description: "Retire the duplicate registration" },
    candidateActions: [{ type: "collapse-ownership", target: "src/modules/foo/index.ts", details: "Keep one registration and update its callers." }],
    abstractionJustification: null, evidenceRefs: [ref],
    regressesProtectedInvariants: false, introducesDualOwnership: false,
  },
};

describe("architecture evidence assessment", () => {
  it("allows assessed handoff evidence to support a hypothesis beyond the AST catalog", () => {
    expect(decodeArchitectureAssessment(assessment, input)).toEqual(assessment);
  });

  it("requires the receiving owner to assess the handoff and forbids unavailable or invented citations", () => {
    expect(() => decodeArchitectureAssessment({ ...assessment, evidenceAssessment: [] }, input)).toThrow("every handoff reference");
    expect(() => decodeArchitectureAssessment({ ...assessment,
      evidenceAssessment: [{ ref, available: false, assessment: "Source unavailable" }],
    }, input)).toThrow("assessed, available evidence");
    expect(() => decodeArchitectureAssessment({ ...assessment,
      evidenceAssessment: [{ ref: "invented", available: true, assessment: "Unsupported" }],
    }, input)).toThrow("unknown evidence");
    expect(() => decodeArchitectureAssessment({ ...assessment,
      hypothesis: { ...assessment.hypothesis, targetScope: "module:unrelated" },
    }, input)).toThrow("admitted target");
  });
});
