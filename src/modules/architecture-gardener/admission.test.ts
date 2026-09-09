import { describe, expect, it } from "vitest";
import { evaluateAdmission } from "./admission.js";
import type { ArchitectureObservation } from "./types.js";

const structural: ArchitectureObservation = {
  id: "boundary", kind: "undeclared-runtime-cross-module-import", category: "dependency-boundary",
  targetScope: "module:billing", summary: "Billing imports the receipt module without declaring it.",
  affectedPaths: ["src/modules/billing/index.ts"],
  fingerprint: "boundary-v1", evidence: { sourceFile: "billing/index.ts" }, timestamp: "2026-09-09T12:00:00Z",
};
const friction: ArchitectureObservation = {
  ...structural, id: "delivery", kind: "delivery-friction", category: "delivery", fingerprint: "delivery-v1",
  summary: "Billing delivery failed while loading the receipt module.",
};
const evaluate = (observations: ArchitectureObservation[], previousCohort?: string) => evaluateAdmission({
  targetScope: "repo", observations, previousCohort, explicitRequest: false, followUpFingerprints: [], reviewedTaskEvidence: [],
});

describe("gardener evidence admission", () => {
  it("requires changed structural and delivery evidence instead of metric counts", () => {
    expect(evaluate([structural]).admitted).toBe(false);
    expect(evaluate([friction]).admitted).toBe(false);
    const metric = { ...structural, kind: "complexity-concentration" as const, category: "complexity" as const };
    expect(evaluate([metric, { ...metric, fingerprint: "another-count" }]).admitted).toBe(false);
    const first = evaluate([structural, friction]);
    expect(first.admitted).toBe(true);
    expect(evaluate([friction, structural], first.cohort).admitted).toBe(false);
    expect(evaluate([structural, { ...friction, fingerprint: "delivery-v2" }], first.cohort).admitted).toBe(true);
  });

  it("admits an empty explicit investigation once without certifying an improvement", () => {
    const input = { targetScope: "repo", observations: [], explicitRequest: true, previousCohort: undefined, followUpFingerprints: [], reviewedTaskEvidence: [] };
    const first = evaluateAdmission(input);
    expect(first.admitted).toBe(true);
    expect(evaluateAdmission({ ...input, previousCohort: first.cohort }).admitted).toBe(false);
    expect(evaluate([]).admitted).toBe(false);
  });
  it("does not let an already reviewed terminal task admit unrelated metrics", () => {
    const input = { targetScope: "repo", observations: [], explicitRequest: false, previousCohort: undefined,
      followUpFingerprints: ["completed-task-proof"], reviewedTaskEvidence: [] as string[] };
    expect(evaluateAdmission(input).admitted).toBe(true);
    expect(evaluateAdmission({ ...input, observations: [friction], reviewedTaskEvidence: input.followUpFingerprints }).admitted).toBe(false);
  });

});
