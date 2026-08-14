import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { AutonomyHealthIssueEvidence } from "#modules/autonomy/health-issue-cards.js";
import type { RunOutcomeAggregation } from "#modules/autonomy/run-outcome-aggregation.js";
import {
  gatherImproverHealthIssueCardsOperation,
  gatherImproverRunDataOperation,
  gatherImproverTaskGovernanceOperation,
} from "./blocking-operations.js";
import {
  decideImproverEvidenceGate,
  readImproverEvidenceGateState,
} from "./evidence-gate.js";
import type { ImproverTaskGovernanceEvidence } from "./task-governance.js";

export const gatherRunDataStep = typedCodeStep<RunOutcomeAggregation>({
  id: "gather-run-data",
  type: "code",
  exposeOutputToAgent: true,
  validate: (raw) =>
    expectStructuredOutput<RunOutcomeAggregation>(raw, [
      "failureRates24h",
      "failureRates7d",
      "topRepairFailures24h",
      "topRepairFailures7d",
      "durationOutliers",
      "agentStepTimeouts7d",
      "latestActionableRunAt",
    ]),
  run: ({ projectDir, runBlocking }) =>
    runBlocking(gatherImproverRunDataOperation, { projectDir }),
});

export const gatherHealthIssueCardsStep =
  typedCodeStep<AutonomyHealthIssueEvidence>({
    id: "gather-health-issue-cards",
    type: "code",
    exposeOutputToAgent: true,
    validate: (raw) =>
      expectStructuredOutput<AutonomyHealthIssueEvidence>(raw, [
        "generatedAt",
        "projectionUpdatedAt",
        "issueCards",
      ]),
    run: ({ projectDir, runBlocking }) =>
      runBlocking(gatherImproverHealthIssueCardsOperation, { projectDir }),
  });

export const gatherTaskGovernanceStep =
  typedCodeStep<ImproverTaskGovernanceEvidence>({
    id: "gather-task-governance",
    type: "code",
    exposeOutputToAgent: true,
    validate: (raw) =>
      expectStructuredOutput<ImproverTaskGovernanceEvidence>(raw, [
        "generatedAt",
        "openByTaskClass",
        "actionableMetaWithoutProductSafetyLink",
        "productDoneWithoutOperatorEvidence",
      ]),
    run: ({ projectDir, runBlocking }) =>
      runBlocking(gatherImproverTaskGovernanceOperation, { projectDir }),
  });

export const gateEvidenceStep = typedCodeStep<
  ReturnType<typeof decideImproverEvidenceGate>
>({
  id: "gate-evidence",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<ReturnType<typeof decideImproverEvidenceGate>>(raw, [
      "shouldRun",
      "reason",
    ]),
  run: (ctx) =>
    decideImproverEvidenceGate(
      gatherRunDataStep.outputRequired(ctx),
      readImproverEvidenceGateState(ctx.projectDir),
      gatherHealthIssueCardsStep.outputRequired(ctx),
    ),
});
