import type {
  OwnerDecisionJsonObject,
} from "#core/daemon/owner-decision-store.js";
import type {
  InboundSignalJsonObject,
  InboundSignalReceivedPayload,
} from "#modules/inbound-signals/events.js";
import {
  EMPTY_JSON_OBJECT,
  jsonNumber,
  jsonObject,
  jsonString,
  ownerJsonObject,
} from "./matching-json.js";
import type {
  CheapClassificationOutput,
  CheapOpportunityCandidate,
  OpportunityCandidate,
  OpportunityScreeningOutput,
  ProviderActionSelection,
  RejectedSignal,
} from "./matching-types.js";

const SUPPORTED_SPORTS = ["padel", "badminton", "tennis"] as const;

function actionData(signal: InboundSignalReceivedPayload): InboundSignalJsonObject {
  return signal.body.kind === "action" ? signal.body.data : EMPTY_JSON_OBJECT;
}

function sportFromData(data: InboundSignalJsonObject): OpportunityCandidate["sport"] | null {
  const sport = jsonString(data, "sport")?.toLowerCase();
  return SUPPORTED_SPORTS.includes(sport as OpportunityCandidate["sport"])
    ? (sport as OpportunityCandidate["sport"])
    : null;
}

function validIso(value: string | null): string | null {
  if (!value) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function fallbackActionPayload(
  candidate: CheapOpportunityCandidate,
  opportunityId: string,
): OwnerDecisionJsonObject {
  return {
    opportunityId,
    externalId: candidate.externalId,
    sourceId: candidate.sourceId,
    sourceUrl: candidate.sourceUrl,
  };
}

function providerActionSelection(
  candidate: CheapOpportunityCandidate,
  data: InboundSignalJsonObject,
  opportunityId: string,
): ProviderActionSelection {
  const adapterName = jsonString(data, "providerAdapter") ?? "telegram-reaction";
  const actionId =
    jsonString(data, "providerActionId") ?? `${adapterName}:${opportunityId}`;
  const payloadSource = jsonObject(data, "providerPayload");
  return {
    adapterName,
    actionId,
    label: jsonString(data, "providerActionLabel") ?? `Dry-run ${adapterName}`,
    payload: payloadSource
      ? ownerJsonObject(payloadSource)
      : fallbackActionPayload(candidate, opportunityId),
  };
}

export function screenLikelyOpportunities(
  classified: CheapClassificationOutput,
): OpportunityScreeningOutput {
  const candidates: OpportunityCandidate[] = [];
  const rejected: RejectedSignal[] = [...classified.rejected];

  for (const cheap of classified.candidates) {
    const data = actionData(cheap.signal.signal);
    const opportunityId = jsonString(data, "opportunityId");
    const sport = sportFromData(data);
    const startsAt = validIso(jsonString(data, "startsAt"));
    const endsAt = validIso(jsonString(data, "endsAt"));
    if (!opportunityId || !sport || !startsAt || !endsAt) {
      rejected.push({
        externalId: cheap.externalId,
        sourceId: cheap.sourceId,
        reason: "missing-structured-opportunity",
        detail: "strong screening needs opportunityId, sport, startsAt, and endsAt",
      });
      continue;
    }

    candidates.push({
      id: opportunityId,
      title: jsonString(data, "title") ?? `${sport} community slot`,
      sport,
      startsAt,
      endsAt,
      confidence: jsonNumber(data, "confidence") ?? 0.82,
      source: {
        provider: cheap.provider,
        channel: cheap.channel,
        sourceId: cheap.sourceId,
        externalId: cheap.externalId,
        sourceUrl: cheap.sourceUrl,
      },
      providerAction: providerActionSelection(cheap, data, opportunityId),
    });
  }

  return {
    screenedCount: classified.candidates.length,
    candidates,
    rejected,
  };
}
