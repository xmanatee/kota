import type { EventEnvelope } from "#core/events/event-journal.js";
import type {
  EvidenceArtifactType,
  EvidenceJsonObject,
  EvidenceProvenance,
} from "#core/evidence/policy.js";
import type { EvidencePrunedReasonCode } from "#core/evidence/pruned-reference.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type { DryRunDiagnostic, DryRunStepPlan, DryRunTriggerMatch } from "../execution/dry-run.js";
import type {
  AutomationBlocker,
  AutomationEffectSummary,
  AutomationExplainReason,
  AutomationExplainResult,
  AutomationPolicyGate,
} from "../graph/index.js";

export type WorkflowSimulationJournalSelector = {
  id?: string;
  after?: string;
  type?: string;
  typePrefix?: string;
  limit?: number;
};

export type WorkflowSimulationRequest = {
  workflowName?: string;
  event?: string;
  payload?: WorkflowRunTrigger["payload"];
  eventId?: string;
  envelope?: EventEnvelope;
  journal?: WorkflowSimulationJournalSelector;
};

export type WorkflowSimulationOutcome =
  | "would-ignore"
  | "would-batch"
  | "would-queue"
  | "would-block"
  | "would-ask-owner"
  | "would-dlq"
  | "would-perform-effect"
  | "would-noop"
  | "unknown";

export type WorkflowSimulationSource = {
  kind: "synthetic" | "envelope" | "journal" | "batch-flush";
  label?: string;
  journalId?: string;
};

export type WorkflowSimulationAvailability = {
  kind: "policy-pruned";
  reasonCode: EvidencePrunedReasonCode;
  artifactType: EvidenceArtifactType;
  id: string;
  prunedAt: string;
  retained: EvidenceJsonObject;
  provenance: EvidenceProvenance;
};

export type WorkflowSimulationDryRun = {
  workflow: string;
  pass: boolean;
  diagnostics: readonly DryRunDiagnostic[];
  triggerMatch?: DryRunTriggerMatch;
  steps: readonly DryRunStepPlan[];
};

export type WorkflowSimulationEffectPreview = AutomationEffectSummary & {
  workflow: string;
  wouldPerform: boolean;
  blocked: boolean;
  reason?: string;
};

export type WorkflowSimulationInputResult = {
  source: WorkflowSimulationSource;
  event: string;
  eventId?: string;
  availability?: WorkflowSimulationAvailability;
  outcome: WorkflowSimulationOutcome;
  reasons: readonly AutomationExplainReason[];
  matches: readonly {
    workflow: string;
    triggerIndex: number;
    triggerEvent: string;
  }[];
  blockers: readonly AutomationBlocker[];
  policyGates: readonly AutomationPolicyGate[];
  effects: readonly WorkflowSimulationEffectPreview[];
  dryRuns: readonly WorkflowSimulationDryRun[];
  explain: AutomationExplainResult;
};

export type WorkflowSimulationSummary = Record<WorkflowSimulationOutcome, number> & {
  total: number;
};

export type WorkflowSimulationResult = {
  ok: true;
  request: {
    workflowName?: string;
    event?: string;
    eventId?: string;
    journal?: WorkflowSimulationJournalSelector;
    envelopeId?: string;
  };
  inputs: readonly WorkflowSimulationInputResult[];
  summary: WorkflowSimulationSummary;
};
