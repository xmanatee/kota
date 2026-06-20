import type {
  OwnerDecisionJsonObject,
} from "#core/daemon/owner-decision-store.js";
import type { WorkflowBatchFlushPayload } from "#core/workflow/trigger-types.js";
import type {
  InboundSignalActorTrust,
  InboundSignalReceivedPayload,
  InboundSignalSourceStatus,
} from "#modules/inbound-signals/events.js";

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

export type RoutedInboundSignalPayload = {
  routeId: string;
  sourceStatus: InboundSignalSourceStatus;
  provider: string;
  channel: string;
  accountId: string;
  sourceId: string;
  actorTrust: InboundSignalActorTrust;
  signal: InboundSignalReceivedPayload;
};

export type CalendarToolPayload = {
  busyWindows?: CalendarBusyWindow[];
  events?: CalendarBusyWindow[];
};
