import { describe, expect, it } from "vitest";
import { evaluateAdmission, relevantDeliveryCohort } from "./admission.js";
import type { ArchitectureObservation, SettledGardenerReview } from "./types.js";

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
const evaluate = (observations: ArchitectureObservation[], previousReview?: SettledGardenerReview, idle = false) => evaluateAdmission({
  targetScope: "repo", observations, previousReview, idle, explicitRequest: false, requestFingerprint: null,
  followUpFingerprints: [], reviewedTaskEvidence: [],
});
const settle = (observations: ArchitectureObservation[], deliveryIssueKeys: string[]): SettledGardenerReview => ({
  decision: { action: "no-action", rationale: "No shared cause demonstrated yet.", evidenceRefs: ["billing/index.ts"],
    existingTaskId: null, proposal: null, revisit: { deliveryIssueKeys, reason: "Changed ownership or receipt loading outcomes." } },
  structuralCohort: evaluate(observations).structuralCohort,
  deliveryCohort: relevantDeliveryCohort(observations, deliveryIssueKeys), requestFingerprint: null,
});

describe("gardener evidence admission", () => {
  it("reviews meaningful idle structural evidence once without requiring a delivery failure", () => {
    expect(evaluate([], undefined, true).admitted).toBe(false);
    expect(evaluate([friction], undefined, true).admitted).toBe(false);
    const metric = { ...structural, kind: "complexity-concentration" as const, category: "complexity" as const };
    expect(evaluate([metric], undefined, true).admitted).toBe(false);
    expect(evaluate([structural], undefined, true).admitted).toBe(true);
    const previous = JSON.parse(JSON.stringify(settle([structural], []))) as SettledGardenerReview;
    expect(evaluate([structural], previous, true).admitted).toBe(false);
    expect(evaluate([{ ...structural, fingerprint: "new-boundary" }], previous, true).admitted).toBe(true);
  });

  it("settles the causal judgment while ignoring unrelated delivery churn", () => {
    expect(evaluate([structural]).admitted).toBe(false);
    expect(evaluate([friction]).admitted).toBe(false);
    const metric = { ...structural, kind: "complexity-concentration" as const, category: "complexity" as const };
    expect(evaluate([metric, friction]).admitted).toBe(false);
    const first = [structural, friction];
    expect(evaluate(first).admitted).toBe(true);
    const rejectedCorrelation = settle(first, []);
    expect(evaluate([structural, { ...friction, fingerprint: "delivery-v2" }], rejectedCorrelation).admitted).toBe(false);
    const related = settle(first, [friction.id]);
    expect(evaluate([...first, { ...friction, id: "unrelated", fingerprint: "churn" }], related).admitted).toBe(false);
    const changed = [structural, { ...friction, fingerprint: "new-failure-kind" }];
    expect(evaluate(changed, related).admitted).toBe(true);
    expect(evaluate(changed, settle(changed, [friction.id])).admitted).toBe(false);
    expect(evaluate([{ ...structural, fingerprint: "new-boundary" }, friction], rejectedCorrelation).admitted).toBe(true);
    expect(evaluate([friction], rejectedCorrelation).admitted).toBe(true); // Removal also warrants checking the outcome.
  });

  it("permits justified requests and terminal outcome evidence once across restart", () => {
    const input = { targetScope: "repo", observations: [], idle: false, explicitRequest: true, requestFingerprint: "new-causal-evidence",
      previousReview: undefined, followUpFingerprints: [], reviewedTaskEvidence: [] };
    expect(evaluateAdmission(input).admitted).toBe(true);
    const previousReview = JSON.parse(JSON.stringify({ ...settle([], []), requestFingerprint: input.requestFingerprint })) as SettledGardenerReview;
    expect(evaluateAdmission({ ...input, previousReview }).admitted).toBe(false);
    expect(evaluateAdmission({ ...input, previousReview, requestFingerprint: "counterevidence" }).admitted).toBe(true);
    const followUp = { ...input, previousReview, explicitRequest: false, followUpFingerprints: ["completed-task-proof"] };
    expect(evaluateAdmission(followUp).admitted).toBe(true);
    expect(evaluateAdmission({ ...followUp, observations: [friction], reviewedTaskEvidence: followUp.followUpFingerprints }).admitted).toBe(false);
  });
});
