import { describe, expect, it } from "vitest";
import { evaluateAdmission, relevantDeliveryCohort, settleGardenerAssessments } from "./admission.js";
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
  decision: { action: "no-action", rationale: "No shared cause demonstrated yet.", evidenceRefs: observations.map((observation) => observation.fingerprint),
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

  it("leaves an unrelated idle opportunity unconsumed by a scoped judgment, including legacy state", () => {
    const second = { ...structural, id: "other-boundary", fingerprint: "other-boundary-v1" };
    const cohort = [structural, second];
    const previous = { ...settle(cohort, []), assessments: settleGardenerAssessments(undefined, cohort, settle([structural], []).decision) };
    expect(evaluate(cohort, previous, true)).toMatchObject({
      admitted: true, unreviewedObservationFingerprints: [second.fingerprint],
    });
    expect(evaluate(cohort, settle(cohort, []), true)).toMatchObject({ admitted: false, unreviewedObservationFingerprints: [] });
    const legacy = { ...previous, assessments: undefined,
      decision: { ...previous.decision, evidenceRefs: [structural.fingerprint] } };
    expect(evaluate(cohort, legacy, true).unreviewedObservationFingerprints).toEqual([second.fingerprint]);
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

  it("retains each assessment's revisit conditions until that evidence is reassessed", () => {
    const second = { ...structural, id: "second", fingerprint: "second-v1" };
    const observations = [structural, second, friction];
    const review = (previous: SettledGardenerReview | undefined, refs: string[], keys: string[], reason: string,
      current = observations): SettledGardenerReview => {
      const next = settle(current, keys);
      const decision = { ...next.decision, evidenceRefs: refs, revisit: { deliveryIssueKeys: keys, reason } };
      return { ...next, decision, assessments: settleGardenerAssessments(previous, current, decision) };
    };
    const first = review(undefined, [structural.fingerprint], [friction.id], "Receipt loading outcomes.");
    const both = JSON.parse(JSON.stringify(review(first, [second.fingerprint], [], "Second ownership."))) as SettledGardenerReview;
    expect(evaluate(observations, both, true)).toMatchObject({ admitted: false, unreviewedObservationFingerprints: [] });
    expect(evaluate(observations, both, true).reason).toContain("Receipt loading outcomes.");
    expect(evaluate(observations, both, true).reason).toContain("Second ownership.");
    const changed = [structural, second, { ...friction, fingerprint: "delivery-v2" }];
    expect(evaluate(changed, both).admitted).toBe(true);
    expect(evaluate([structural, second], both).admitted).toBe(true);
    expect(evaluate([...observations, { ...friction, id: "unrelated", fingerprint: "churn" }], both).admitted).toBe(false);
    // Reviewing B again must neither consume X's change nor erase A's condition.
    const stillPending = review(both, [second.fingerprint], [], "Second ownership.", changed);
    expect(evaluate(changed, stillPending).admitted).toBe(true);
    const reassessed = review(stillPending, [structural.fingerprint], [friction.id], "New loading baseline.", changed);
    expect(evaluate(changed, reassessed, true).admitted).toBe(false);
    const rejected = review(reassessed, [structural.fingerprint], [], "Correlation disproved.", changed);
    expect(evaluate(observations, rejected, true).admitted).toBe(false);
    expect(evaluate(observations, rejected).reason).not.toContain("loading");
    const shared = review(undefined, [structural.fingerprint, second.fingerprint], [friction.id], "Shared condition.");
    const partial = review(shared, [structural.fingerprint], [], "First correlation disproved.");
    expect(evaluate(changed, partial).admitted).toBe(true);
    // An old source-only review remains causal across an unrelated new assessment.
    const legacy = { ...settle(observations, [friction.id]), decision: {
      ...settle(observations, [friction.id]).decision, evidenceRefs: ["billing/index.ts"],
    } };
    expect(evaluate(changed, review(legacy, [second.fingerprint], [], "Second ownership.")).admitted).toBe(true);
  });

  it.each([false, true])("keeps a missing observation pending through unrelated settlement (delivery also changed: %s)", (deliveryChanged) => {
    const second = { ...structural, id: "second", fingerprint: "second-v1" };
    const initial = [structural, second, friction];
    const decisionA = { ...settle(initial, [friction.id]).decision, evidenceRefs: [structural.fingerprint] };
    const first = { ...settle(initial, [friction.id]), decision: decisionA,
      assessments: settleGardenerAssessments(undefined, initial, decisionA) };
    const current = [second, { ...friction, fingerprint: deliveryChanged ? "delivery-v2" : friction.fingerprint }];
    const decisionB = { ...settle(current, []).decision, evidenceRefs: [second.fingerprint] };
    const secondReview = { ...settle(current, []), decision: decisionB,
      assessments: settleGardenerAssessments(first, current, decisionB) };
    const restarted = JSON.parse(JSON.stringify(secondReview)) as SettledGardenerReview;
    expect(evaluate(current, restarted, true).admitted).toBe(true);
    // Explicit inspection can resolve A even though its old fingerprint is absent.
    const resolvedDecision = { ...decisionA, revisit: { reason: "The removed import resolved this cause.", deliveryIssueKeys: [] } };
    const resolved = { ...settle(current, []), decision: resolvedDecision,
      assessments: settleGardenerAssessments(restarted, current, resolvedDecision) };
    expect(evaluate(current, resolved, true).admitted).toBe(false);
    const reappeared = [...current, structural];
    expect(evaluate(reappeared, resolved, true).admitted).toBe(true);
    const otherAfterResolution = { ...settle(reappeared, []), decision: decisionB,
      assessments: settleGardenerAssessments(resolved, reappeared, decisionB) };
    expect(evaluate(reappeared, otherAfterResolution, true).unreviewedObservationFingerprints).toContain(structural.fingerprint);
    // A new fingerprint is independent evidence until the prior one is reassessed.
    const replacement = { ...structural, fingerprint: "boundary-v2" };
    const changed = [...current, replacement];
    const replacementDecision = { ...decisionB, evidenceRefs: [replacement.fingerprint] };
    const replacementReview = { ...settle(changed, []), decision: replacementDecision,
      assessments: settleGardenerAssessments(restarted, changed, replacementDecision) };
    expect(evaluate(changed, replacementReview, true).admitted).toBe(true);
    const reconciled = { ...settle(changed, []), decision: resolvedDecision,
      assessments: settleGardenerAssessments(replacementReview, changed, resolvedDecision) };
    expect(evaluate(changed, reconciled, true).admitted).toBe(false);
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
