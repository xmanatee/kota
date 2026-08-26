import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  OwnerConfirmedActionMetadata,
  OwnerDecisionJsonObject,
} from "#core/daemon/owner-decision-store.js";
import { confirmedOwnerActionStep } from "#core/workflow/owner-confirmed-action-step.js";
import {
  type AwaitedOwnerDecisionOutcome,
  ownerDecisionSteps,
} from "#core/workflow/owner-decision-step.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowBatchFlushPayload } from "#core/workflow/trigger-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  type CalendarAvailabilityOutput,
  type CalendarBusyWindow,
  CHANNEL_OPPORTUNITY_REFERENCE_WORKFLOW_NAME,
  type ChannelOpportunityBatchInput,
  type CheapClassificationOutput,
  checkCalendarAvailability,
  classifyChannelOpportunities,
  executeReferenceProviderAction,
  type OpportunityScreeningOutput,
  type OwnerDecisionPreparation,
  parseCalendarToolBusyWindows,
  prepareOwnerDecision,
  type ReferenceProviderActionResult,
  readChannelOpportunityBatch,
  screenLikelyOpportunities,
} from "./matching.js";

export type ChannelOpportunityReferenceWorkflowOptions = {
  calendarToolName?: string;
  calendarBusyWindows?: readonly CalendarBusyWindow[];
  providerActionAdapterName?: string;
  failProviderActionIds?: readonly string[];
};

export type ChannelOpportunityRunArtifact = {
  artifactPath: string;
  batch: ChannelOpportunityBatchInput;
  cheapClassification: CheapClassificationOutput;
  enrichment: OpportunityScreeningOutput;
  calendar: CalendarAvailabilityOutput;
  ownerDecision: OwnerDecisionPreparation;
  ownerOutcome: AwaitedOwnerDecisionOutcome | null;
  providerAction: ReferenceProviderActionResult | null;
};

export function channelOpportunityActionMetadata(
  adapterName = "channel-opportunity-reference",
): OwnerConfirmedActionMetadata {
  return {
    actionId: "channel-opportunity-reference.execute-provider-action",
    adapterName,
    description:
      "Dry-run the provider-specific action selected by the channel opportunity workflow.",
    dryRun: true,
    requiresConfirmation: true,
    dangerousEffect: false,
    authorizingSelection: { kind: "single-choice", optionId: "accept" },
  };
}

function hasOwnerPrompt(preparation: OwnerDecisionPreparation | undefined): boolean {
  return preparation?.status === "needs-owner";
}

function ownerAccepted(outcome: AwaitedOwnerDecisionOutcome | undefined): boolean {
  return outcome?.kind === "answered" &&
    outcome.selectedValue.kind === "single-choice" &&
    outcome.selectedValue.optionId === "accept";
}

async function resolveBusyWindows(
  ctx: WorkflowStepContext,
  options: ChannelOpportunityReferenceWorkflowOptions,
  screened: OpportunityScreeningOutput,
): Promise<readonly CalendarBusyWindow[]> {
  if (!options.calendarToolName) return options.calendarBusyWindows ?? [];
  if (screened.candidates.length === 0) return [];

  const starts = screened.candidates.map((candidate) => candidate.startsAt).sort();
  const ends = screened.candidates.map((candidate) => candidate.endsAt).sort();
  const result = await ctx.runTool(options.calendarToolName, {
    timeMin: starts[0]!,
    timeMax: ends[ends.length - 1]!,
  });
  if (result.is_error) throw new Error(result.content);
  return parseCalendarToolBusyWindows(result.content);
}

function ownerDecisionInput(
  preparation: OwnerDecisionPreparation,
  action: OwnerConfirmedActionMetadata,
) {
  if (preparation.status !== "needs-owner") {
    throw new Error("channel opportunity owner decision requested without a candidate");
  }
  return {
    context: preparation.context,
    reason: "The opportunity survived cheap classification and calendar availability checks.",
    request: {
      kind: "single-choice" as const,
      prompt: preparation.prompt,
      options: [
        {
          id: "accept",
          label: "Dry-run action",
          description: "Record acceptance and execute the configured fake provider action.",
        },
        {
          id: "decline",
          label: "Decline",
          description: "Record the decision without executing the provider action.",
        },
      ],
    },
    evidence: [
      {
        summary:
          "Channel opportunity batch was classified, enriched, and checked against calendar availability.",
      },
    ],
    source: "channel-opportunity-reference",
    action,
  };
}

function providerActionInput(preparation: OwnerDecisionPreparation): OwnerDecisionJsonObject {
  if (preparation.status !== "needs-owner") {
    throw new Error("provider action requested without an owner-selected candidate");
  }
  return preparation.actionInput;
}

function writeArtifact(
  ctx: WorkflowStepContext,
  artifact: Omit<ChannelOpportunityRunArtifact, "artifactPath">,
): ChannelOpportunityRunArtifact {
  mkdirSync(ctx.workflow.runDirPath, { recursive: true });
  const artifactPath = join(ctx.workflow.runDirPath, "channel-opportunity-reference.json");
  const withPath = { artifactPath, ...artifact };
  writeFileSync(artifactPath, `${JSON.stringify(withPath, null, 2)}\n`);
  return withPath;
}

export function buildChannelOpportunityReferenceWorkflow(
  options: ChannelOpportunityReferenceWorkflowOptions = {},
): WorkflowDefinitionInput {
  const actionMetadata = channelOpportunityActionMetadata(
    options.providerActionAdapterName,
  );

  const inspectBatch = typedCodeStep<ChannelOpportunityBatchInput>({
    id: "inspect-batch",
    type: "code",
    validate: (raw) => expectStructuredOutput<ChannelOpportunityBatchInput>(raw, [
      "signals",
      "count",
      "groupingKey",
    ]),
    run: (ctx) => readChannelOpportunityBatch(ctx.trigger.payload as WorkflowBatchFlushPayload),
  });

  const cheapClassifier = typedCodeStep<CheapClassificationOutput>({
    id: "cheap-classify",
    type: "code",
    validate: (raw) => expectStructuredOutput<CheapClassificationOutput>(raw, [
      "inputCount",
      "candidateCount",
      "candidates",
      "rejected",
    ]),
    run: (ctx) => classifyChannelOpportunities(inspectBatch.outputRequired(ctx)),
  });

  const enrichLikely = typedCodeStep<OpportunityScreeningOutput>({
    id: "enrich-likely-opportunities",
    type: "code",
    validate: (raw) => expectStructuredOutput<OpportunityScreeningOutput>(raw, [
      "screenedCount",
      "candidates",
      "rejected",
    ]),
    run: (ctx) => screenLikelyOpportunities(cheapClassifier.outputRequired(ctx)),
  });

  const calendarCheck = typedCodeStep<CalendarAvailabilityOutput>({
    id: "check-calendar-availability",
    type: "code",
    validate: (raw) => expectStructuredOutput<CalendarAvailabilityOutput>(raw, [
      "busyWindows",
      "checkedCount",
      "available",
      "rejected",
    ]),
    run: async (ctx) => {
      const screened = enrichLikely.outputRequired(ctx);
      const busyWindows = await resolveBusyWindows(ctx, options, screened);
      return checkCalendarAvailability(screened, busyWindows);
    },
  });

  const prepareDecision = typedCodeStep<OwnerDecisionPreparation>({
    id: "prepare-owner-decision",
    type: "code",
    validate: (raw) => expectStructuredOutput<OwnerDecisionPreparation>(raw, [
      "status",
      "reason",
      "selectedCandidate",
      "prompt",
      "context",
      "actionInput",
    ]),
    run: (ctx) => prepareOwnerDecision(calendarCheck.outputRequired(ctx)),
  });

  const owner = ownerDecisionSteps({
    idPrefix: "owner-confirm",
    input: (ctx) => ownerDecisionInput(prepareDecision.outputRequired(ctx), actionMetadata),
  });
  owner.ask.when = (ctx) => hasOwnerPrompt(prepareDecision.output(ctx));
  owner.wait.when = (ctx) => hasOwnerPrompt(prepareDecision.output(ctx));
  owner.consume.when = (ctx) => hasOwnerPrompt(prepareDecision.output(ctx));

  const providerAction = confirmedOwnerActionStep<OwnerDecisionJsonObject, ReferenceProviderActionResult>({
    id: "execute-provider-action-dry-run",
    decisionId: (ctx) => owner.consume.outputRequired(ctx).decisionId,
    input: (ctx) => providerActionInput(prepareDecision.outputRequired(ctx)),
    adapter: {
      metadata: actionMetadata,
      execute: ({ input }) =>
        executeReferenceProviderAction(
          input,
          options.failProviderActionIds ?? [],
        ),
    },
  });
  providerAction.when = (ctx) => ownerAccepted(owner.consume.output(ctx));

  const recordArtifact = typedCodeStep<ChannelOpportunityRunArtifact>({
    id: "record-reference-artifact",
    type: "code",
    validate: (raw) => expectStructuredOutput<ChannelOpportunityRunArtifact>(raw, [
      "artifactPath",
      "batch",
      "cheapClassification",
      "enrichment",
      "calendar",
      "ownerDecision",
      "ownerOutcome",
      "providerAction",
    ]),
    run: (ctx) => writeArtifact(ctx, {
      batch: inspectBatch.outputRequired(ctx),
      cheapClassification: cheapClassifier.outputRequired(ctx),
      enrichment: enrichLikely.outputRequired(ctx),
      calendar: calendarCheck.outputRequired(ctx),
      ownerDecision: prepareDecision.outputRequired(ctx),
      ownerOutcome: owner.consume.output(ctx) ?? null,
      providerAction: providerAction.output(ctx)?.result ?? null,
    }),
  });

  return {
    name: CHANNEL_OPPORTUNITY_REFERENCE_WORKFLOW_NAME,
    description:
      "Reference workflow for batching channel opportunities, checking availability, asking the owner, and dry-running a provider action.",
    repository: "none",
    tags: ["channel", "reference"],
    notify: { onFailure: true, onSuccess: false },
    triggers: [{ event: "manual.channel-opportunity-reference" }],
    steps: [
      inspectBatch,
      cheapClassifier,
      enrichLikely,
      calendarCheck,
      prepareDecision,
      owner.ask,
      owner.wait,
      owner.consume,
      providerAction,
      recordArtifact,
    ],
  };
}
