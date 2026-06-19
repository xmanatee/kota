import type {
  OwnerDecisionJsonObject,
  OwnerDecisionJsonValue,
} from "#core/daemon/owner-decision-store.js";
import type { WorkflowBatchFlushPayload } from "#core/workflow/trigger-types.js";
import type {
  InboundSignalActorTrust,
  InboundSignalJsonObject,
  InboundSignalJsonValue,
  InboundSignalReceivedPayload,
  InboundSignalSourceStatus,
} from "#modules/inbound-signals/events.js";
import type { InboundSignalRouteConfig } from "#modules/inbound-signals/routing.js";

export const CHANNEL_OPPORTUNITY_REFERENCE_WORKFLOW_NAME =
  "channel-opportunity-matching-reference";
export const CHANNEL_OPPORTUNITY_REFERENCE_ROUTE_ID =
  "telegram-redacted-sports-communities";

export type RoutedOpportunitySignal = {
  routeId: string;
  sourceStatus: InboundSignalSourceStatus;
  provider: string;
  channel: string;
  accountId: string;
  sourceId: string;
  actorTrust: InboundSignalActorTrust;
  signal: InboundSignalReceivedPayload;
};

export type ChannelOpportunityBatchInput = {
  scopeId: string;
  projectId: string;
  sourceEventName: string;
  groupingKey: string;
  flushReason: WorkflowBatchFlushPayload["reason"];
  count: number;
  droppedInputCount: number;
  signals: RoutedOpportunitySignal[];
};

export type CheapOpportunityCandidate = {
  routeId: string;
  provider: string;
  channel: string;
  sourceId: string;
  externalId: string;
  sourceUrl: string;
  occurredAt: string;
  text: string;
  signal: RoutedOpportunitySignal;
};

export type RejectedSignal = {
  externalId: string;
  sourceId: string;
  reason:
    | "no-op-batch"
    | "source-not-active"
    | "actor-blocked"
    | "cheap-reject"
    | "missing-structured-opportunity"
    | "calendar-conflict";
  detail: string;
};

export type CheapClassificationOutput = {
  inputCount: number;
  candidateCount: number;
  candidates: CheapOpportunityCandidate[];
  rejected: RejectedSignal[];
};

export type ProviderActionSelection = {
  adapterName: string;
  actionId: string;
  label: string;
  payload: OwnerDecisionJsonObject;
};

export type OpportunityCandidate = {
  id: string;
  title: string;
  sport: "padel" | "badminton" | "tennis";
  startsAt: string;
  endsAt: string;
  confidence: number;
  source: {
    provider: string;
    channel: string;
    sourceId: string;
    externalId: string;
    sourceUrl: string;
  };
  providerAction: ProviderActionSelection;
};

export type OpportunityScreeningOutput = {
  screenedCount: number;
  candidates: OpportunityCandidate[];
  rejected: RejectedSignal[];
};

export type CalendarBusyWindow = {
  start: string;
  end: string;
  summary: string;
};

export type CalendarCandidateResult = OpportunityCandidate & {
  available: boolean;
  conflicts: CalendarBusyWindow[];
};

export type CalendarAvailabilityOutput = {
  busyWindows: CalendarBusyWindow[];
  checkedCount: number;
  available: CalendarCandidateResult[];
  rejected: RejectedSignal[];
};

export type OwnerDecisionPreparation =
  | {
      status: "none";
      reason: string;
      selectedCandidate: null;
      prompt: null;
      context: null;
      actionInput: null;
    }
  | {
      status: "needs-owner";
      reason: "calendar-fit-opportunity";
      selectedCandidate: CalendarCandidateResult;
      prompt: string;
      context: string;
      actionInput: OwnerDecisionJsonObject;
    };

export type ReferenceProviderActionResult = {
  ok: true;
  dryRun: true;
  providerAdapter: string;
  providerActionId: string;
  opportunityId: string;
  message: string;
};

export function referenceTelegramSportsRouteConfig(): InboundSignalRouteConfig {
  return {
    id: CHANNEL_OPPORTUNITY_REFERENCE_ROUTE_ID,
    provider: "telegram",
    channel: "telegram.group",
    sourceId: "telegram:redacted-sports-community",
    actorTrust: "trusted",
    targets: [
      {
        kind: "workflow",
        name: CHANNEL_OPPORTUNITY_REFERENCE_WORKFLOW_NAME,
        batch: {
          mode: "workflow-trigger",
          maxItems: 6,
          idleMs: 5 * 60 * 1000,
          maxBufferSize: 30,
          overflow: "flush-oldest",
          groupBy: ["channel", "sourceId"],
        },
      },
    ],
    processing: {
      classifier: "cheap",
      modelTier: "capable",
      allowNonReadActions: true,
    },
  };
}

type RoutedInboundSignalPayload = {
  routeId: string;
  sourceStatus: InboundSignalSourceStatus;
  provider: string;
  channel: string;
  accountId: string;
  sourceId: string;
  actorTrust: InboundSignalActorTrust;
  signal: InboundSignalReceivedPayload;
};

type CalendarToolPayload = {
  busyWindows?: CalendarBusyWindow[];
  events?: CalendarBusyWindow[];
};

const EMPTY_JSON_OBJECT: InboundSignalJsonObject = {};
const SUPPORTED_SPORTS = ["padel", "badminton", "tennis"] as const;

function bodyText(signal: InboundSignalReceivedPayload): string {
  if (signal.body.kind === "message") return signal.body.text;
  const messageText = jsonString(signal.body.data, "messageText");
  return [signal.body.label, messageText, signal.body.action]
    .filter((part): part is string => Boolean(part && part.trim().length > 0))
    .join("\n");
}

function actionData(signal: InboundSignalReceivedPayload): InboundSignalJsonObject {
  return signal.body.kind === "action" ? signal.body.data : EMPTY_JSON_OBJECT;
}

function jsonString(source: InboundSignalJsonObject, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function jsonNumber(source: InboundSignalJsonObject, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function jsonObject(
  source: InboundSignalJsonObject,
  key: string,
): InboundSignalJsonObject | null {
  const value = source[key];
  return isInboundJsonObject(value)
    ? value
    : null;
}

function isInboundJsonArray(
  value: InboundSignalJsonValue,
): value is readonly InboundSignalJsonValue[] {
  return Array.isArray(value);
}

function isInboundJsonObject(
  value: InboundSignalJsonValue,
): value is InboundSignalJsonObject {
  return value !== null && typeof value === "object" && !isInboundJsonArray(value);
}

function ownerJsonValue(value: InboundSignalJsonValue): OwnerDecisionJsonValue {
  if (isInboundJsonArray(value)) return value.map(ownerJsonValue);
  if (isInboundJsonObject(value)) return ownerJsonObject(value);
  return value;
}

function ownerJsonObject(source: InboundSignalJsonObject): OwnerDecisionJsonObject {
  const out: OwnerDecisionJsonObject = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = ownerJsonValue(value);
  }
  return out;
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

function windowsOverlap(
  candidate: OpportunityCandidate,
  busy: CalendarBusyWindow,
): boolean {
  return Date.parse(candidate.startsAt) < Date.parse(busy.end) &&
    Date.parse(candidate.endsAt) > Date.parse(busy.start);
}

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

export function readChannelOpportunityBatch(
  payload: WorkflowBatchFlushPayload,
): ChannelOpportunityBatchInput {
  return {
    scopeId: payload.scopeId,
    projectId: payload.projectId,
    sourceEventName: payload.sourceEventName,
    groupingKey: payload.groupingKey,
    flushReason: payload.reason,
    count: payload.count,
    droppedInputCount: payload.batch.droppedInputCount,
    signals: payload.inputEvents.map((event) => {
      const routed = event.payload as RoutedInboundSignalPayload;
      return {
        routeId: routed.routeId,
        sourceStatus: routed.sourceStatus,
        provider: routed.provider,
        channel: routed.channel,
        accountId: routed.accountId,
        sourceId: routed.sourceId,
        actorTrust: routed.actorTrust,
        signal: routed.signal,
      };
    }),
  };
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

export function checkCalendarAvailability(
  screened: OpportunityScreeningOutput,
  busyWindows: readonly CalendarBusyWindow[],
): CalendarAvailabilityOutput {
  const available: CalendarCandidateResult[] = [];
  const rejected: RejectedSignal[] = [...screened.rejected];
  for (const candidate of screened.candidates) {
    const conflicts = busyWindows.filter((busy) => windowsOverlap(candidate, busy));
    if (conflicts.length > 0) {
      rejected.push({
        externalId: candidate.source.externalId,
        sourceId: candidate.source.sourceId,
        reason: "calendar-conflict",
        detail: `candidate overlaps ${conflicts.length} busy calendar window(s)`,
      });
      continue;
    }
    available.push({ ...candidate, available: true, conflicts });
  }

  return {
    busyWindows: [...busyWindows],
    checkedCount: screened.candidates.length,
    available: available.sort((a, b) =>
      a.startsAt.localeCompare(b.startsAt) || b.confidence - a.confidence
    ),
    rejected,
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

export function parseCalendarToolBusyWindows(content: string): CalendarBusyWindow[] {
  const parsed = JSON.parse(content) as CalendarToolPayload;
  return [...(parsed.busyWindows ?? parsed.events ?? [])];
}

function ownerString(input: OwnerDecisionJsonObject, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

export function executeReferenceProviderAction(
  input: OwnerDecisionJsonObject,
  failProviderActionIds: readonly string[],
): ReferenceProviderActionResult {
  const providerActionId = ownerString(input, "providerActionId");
  if (failProviderActionIds.includes(providerActionId)) {
    throw new Error(`dry-run provider action failed: ${providerActionId}`);
  }
  const providerAdapter = ownerString(input, "providerAdapter");
  const opportunityId = ownerString(input, "opportunityId");
  return {
    ok: true,
    dryRun: true,
    providerAdapter,
    providerActionId,
    opportunityId,
    message: `Dry-run ${providerAdapter} action ${providerActionId} for ${opportunityId}`,
  };
}
