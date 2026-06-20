import type {
  InboundSignalReceivedPayload,
} from "#modules/inbound-signals/events.js";
import { jsonString } from "./matching-json.js";
import type {
  ChannelOpportunityBatchInput,
  CheapClassificationOutput,
  CheapOpportunityCandidate,
  RejectedSignal,
} from "./matching-types.js";

function bodyText(signal: InboundSignalReceivedPayload): string {
  if (signal.body.kind === "message") return signal.body.text;
  const messageText = jsonString(signal.body.data, "messageText");
  return [signal.body.label, messageText, signal.body.action]
    .filter((part): part is string => Boolean(part && part.trim().length > 0))
    .join("\n");
}

function opportunityTermsMatch(text: string): boolean {
  const normalized = text.toLowerCase();
  if (/\b(full|sold out|cancelled|canceled|watching|results?)\b/.test(normalized)) {
    return false;
  }
  return (
    /\b(available|spot|slot|space|join|player|court|booking)\b/.test(normalized) &&
    /\b(padel|badminton|tennis)\b/.test(normalized)
  );
}

export function classifyChannelOpportunities(
  batch: ChannelOpportunityBatchInput,
): CheapClassificationOutput {
  if (batch.signals.length === 0) {
    return {
      inputCount: 0,
      candidateCount: 0,
      candidates: [],
      rejected: [{
        externalId: "batch",
        sourceId: batch.groupingKey,
        reason: "no-op-batch",
        detail: "batch contained no routed signals",
      }],
    };
  }

  const candidates: CheapOpportunityCandidate[] = [];
  const rejected: RejectedSignal[] = [];
  for (const routed of batch.signals) {
    const signal = routed.signal;
    if (routed.sourceStatus !== "active") {
      rejected.push({
        externalId: signal.externalId,
        sourceId: routed.sourceId,
        reason: "source-not-active",
        detail: `source status is ${routed.sourceStatus}`,
      });
      continue;
    }
    if (routed.actorTrust === "blocked" || signal.actor.trust === "blocked") {
      rejected.push({
        externalId: signal.externalId,
        sourceId: routed.sourceId,
        reason: "actor-blocked",
        detail: "actor trust is blocked",
      });
      continue;
    }

    const text = bodyText(signal);
    if (!opportunityTermsMatch(text)) {
      rejected.push({
        externalId: signal.externalId,
        sourceId: routed.sourceId,
        reason: "cheap-reject",
        detail: "cheap classifier found no actionable sports availability terms",
      });
      continue;
    }
    candidates.push({
      routeId: routed.routeId,
      provider: routed.provider,
      channel: routed.channel,
      sourceId: routed.sourceId,
      externalId: signal.externalId,
      sourceUrl: signal.sourceUrl,
      occurredAt: signal.occurredAt,
      text,
      signal: routed,
    });
  }

  return {
    inputCount: batch.signals.length,
    candidateCount: candidates.length,
    candidates,
    rejected,
  };
}
