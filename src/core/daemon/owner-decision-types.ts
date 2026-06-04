export type OwnerDecisionStatus = "pending" | "answered" | "canceled" | "expired" | "consumed";
export type OwnerDecisionKind = "single-choice" | "multi-choice" | "free-text" | "form";

export type OwnerDecisionJsonPrimitive = string | number | boolean | null;
export type OwnerDecisionJsonValue =
  | OwnerDecisionJsonPrimitive
  | OwnerDecisionJsonValue[]
  | { [key: string]: OwnerDecisionJsonValue | undefined };
export type OwnerDecisionJsonObject = { [key: string]: OwnerDecisionJsonValue | undefined };

export type OwnerDecisionOption = {
  id: string;
  label: string;
  description?: string;
};

export type OwnerDecisionFormField = {
  id: string;
  label: string;
  type: "text" | "number" | "boolean" | "select";
  required: boolean;
  options?: OwnerDecisionOption[];
};

export type OwnerDecisionRequest =
  | { kind: "single-choice"; prompt: string; options: OwnerDecisionOption[] }
  | { kind: "multi-choice"; prompt: string; options: OwnerDecisionOption[]; minSelected?: number; maxSelected?: number }
  | { kind: "free-text"; prompt: string; multiline?: boolean }
  | { kind: "form"; prompt: string; fields: OwnerDecisionFormField[] };

export type OwnerDecisionSelectedValue =
  | { kind: "single-choice"; optionId: string }
  | { kind: "multi-choice"; optionIds: string[] }
  | { kind: "free-text"; text: string }
  | { kind: "form"; fields: OwnerDecisionJsonObject };

export type OwnerDecisionRequester =
  | { kind: "workflow"; workflowName: string; runId: string; stepId: string; taskId: string | null }
  | { kind: "session"; sessionId: string | null }
  | { kind: "manual"; source: string };

export type OwnerDecisionEvidence = {
  summary: string;
  source?: string;
  artifactPath?: string;
};

export type OwnerConfirmedActionMetadata = {
  actionId: string;
  adapterName: string;
  description: string;
  dryRun: boolean;
  requiresConfirmation: boolean;
  dangerousEffect: boolean;
  authorizingSelection: OwnerDecisionSelectedValue;
};

export type OwnerDecisionConsumption = {
  workflowName: string;
  runId: string;
  stepId: string;
  actionId: string;
  adapterName: string;
  approvalId: string | null;
  consumedAt: string;
};

export type OwnerDecisionRecord = {
  id: string;
  seq: number;
  scopeId: string;
  status: OwnerDecisionStatus;
  request: OwnerDecisionRequest;
  requester: OwnerDecisionRequester;
  evidence: OwnerDecisionEvidence[];
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  ownerQuestionId?: string;
  action?: OwnerConfirmedActionMetadata;
  selectedValue?: OwnerDecisionSelectedValue;
  resolvedAt?: string;
  resolutionSource?: string;
  canceledReason?: string;
  consumption?: OwnerDecisionConsumption;
};

export type OwnerDecisionCreateInput = {
  request: OwnerDecisionRequest;
  requester: OwnerDecisionRequester;
  evidence: OwnerDecisionEvidence[];
  expiresAt?: string;
  action?: OwnerConfirmedActionMetadata;
};

export type OwnerDecisionConsumeResult =
  | { ok: true; decision: OwnerDecisionRecord }
  | { ok: false; reason: "not_found" | "not_answered" | "already_consumed" | "action_mismatch" };

export type OwnerDecisionClientProjection = Omit<OwnerDecisionRecord, "selectedValue"> & {
  selectedValue?: OwnerDecisionSelectedValue;
};
