import type {
  OwnerDecisionJsonObject,
} from "#core/daemon/owner-decision-store.js";
import type {
  CalendarAvailabilityOutput,
  CalendarCandidateResult,
  OwnerDecisionPreparation,
} from "./matching-types.js";

function actionInput(candidate: CalendarCandidateResult): OwnerDecisionJsonObject {
  return {
    opportunityId: candidate.id,
    title: candidate.title,
    sport: candidate.sport,
    startsAt: candidate.startsAt,
    endsAt: candidate.endsAt,
    providerAdapter: candidate.providerAction.adapterName,
    providerActionId: candidate.providerAction.actionId,
    providerActionLabel: candidate.providerAction.label,
    dryRun: true,
    source: {
      provider: candidate.source.provider,
      channel: candidate.source.channel,
      sourceId: candidate.source.sourceId,
      externalId: candidate.source.externalId,
      sourceUrl: candidate.source.sourceUrl,
    },
    providerPayload: candidate.providerAction.payload,
  };
}

export function prepareOwnerDecision(
  availability: CalendarAvailabilityOutput,
): OwnerDecisionPreparation {
  const selectedCandidate = availability.available[0];
  if (!selectedCandidate) {
    return {
      status: "none",
      reason: availability.checkedCount === 0
        ? "no candidates survived screening"
        : "no candidates fit the calendar",
      selectedCandidate: null,
      prompt: null,
      context: null,
      actionInput: null,
    };
  }

  return {
    status: "needs-owner",
    reason: "calendar-fit-opportunity",
    selectedCandidate,
    prompt: `Join this ${selectedCandidate.sport} opportunity?`,
    context: [
      `Opportunity: ${selectedCandidate.title}`,
      `Window: ${selectedCandidate.startsAt} to ${selectedCandidate.endsAt}`,
      `Source: ${selectedCandidate.source.provider}/${selectedCandidate.source.channel}/${selectedCandidate.source.sourceId}`,
      `Provider action: ${selectedCandidate.providerAction.label}`,
    ].join("\n"),
    actionInput: actionInput(selectedCandidate),
  };
}
