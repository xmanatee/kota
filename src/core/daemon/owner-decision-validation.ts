import {
  EVIDENCE_REDACTED,
  type EvidenceJsonValue,
  projectEvidenceJsonValue,
  redactSensitiveText,
} from "#core/evidence/policy.js";
import type {
  OwnerConfirmedActionMetadata,
  OwnerDecisionClientProjection,
  OwnerDecisionEvidence,
  OwnerDecisionFormField,
  OwnerDecisionJsonObject,
  OwnerDecisionJsonValue,
  OwnerDecisionOption,
  OwnerDecisionRecord,
  OwnerDecisionRequest,
  OwnerDecisionRequester,
  OwnerDecisionSelectedValue,
} from "./owner-decision-types.js";

function assertText(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} must be non-empty`);
}

function assertOptions(options: OwnerDecisionOption[], label: string): void {
  if (options.length === 0) throw new Error(`${label} must include at least one option`);
  const ids = new Set<string>();
  for (const option of options) {
    assertText(option.id, `${label} option id`);
    assertText(option.label, `${label} option label`);
    if (ids.has(option.id)) throw new Error(`${label} option id "${option.id}" is duplicated`);
    ids.add(option.id);
  }
}

export function validateOwnerDecisionRequest(request: OwnerDecisionRequest): void {
  assertText(request.prompt, "decision prompt");
  if (request.kind === "single-choice") assertOptions(request.options, "single-choice decision");
  if (request.kind === "multi-choice") {
    assertOptions(request.options, "multi-choice decision");
    if (request.minSelected !== undefined && request.minSelected < 0) throw new Error("minSelected cannot be negative");
    if (request.maxSelected !== undefined && request.maxSelected < 1) throw new Error("maxSelected must be at least 1");
    if (
      request.minSelected !== undefined &&
      request.maxSelected !== undefined &&
      request.minSelected > request.maxSelected
    ) {
      throw new Error("minSelected cannot exceed maxSelected");
    }
  }
  if (request.kind === "form") {
    if (request.fields.length === 0) throw new Error("form decision must include at least one field");
    const ids = new Set<string>();
    for (const field of request.fields) {
      assertText(field.id, "form field id");
      assertText(field.label, "form field label");
      if (ids.has(field.id)) throw new Error(`form field id "${field.id}" is duplicated`);
      ids.add(field.id);
      if (field.type === "select") assertOptions(field.options ?? [], `form field "${field.id}"`);
    }
  }
}

function optionIds(request: Extract<OwnerDecisionRequest, { options: OwnerDecisionOption[] }>): Set<string> {
  return new Set(request.options.map((option) => option.id));
}

export function validateOwnerDecisionSelection(
  request: OwnerDecisionRequest,
  selectedValue: OwnerDecisionSelectedValue,
): void {
  if (request.kind !== selectedValue.kind) {
    throw new Error(`selected value kind "${selectedValue.kind}" does not match decision kind "${request.kind}"`);
  }
  if (request.kind === "single-choice" && selectedValue.kind === "single-choice") {
    if (!optionIds(request).has(selectedValue.optionId)) throw new Error(`unrecognized option id "${selectedValue.optionId}"`);
  }
  if (request.kind === "multi-choice" && selectedValue.kind === "multi-choice") {
    const ids = optionIds(request);
    const unique = new Set(selectedValue.optionIds);
    if (unique.size !== selectedValue.optionIds.length) throw new Error("multi-choice selection contains duplicate ids");
    for (const id of selectedValue.optionIds) {
      if (!ids.has(id)) throw new Error(`unrecognized option id "${id}"`);
    }
    if (request.minSelected !== undefined && selectedValue.optionIds.length < request.minSelected) {
      throw new Error(`multi-choice selection must include at least ${request.minSelected} option(s)`);
    }
    if (request.maxSelected !== undefined && selectedValue.optionIds.length > request.maxSelected) {
      throw new Error(`multi-choice selection must include at most ${request.maxSelected} option(s)`);
    }
  }
  if (request.kind === "free-text" && selectedValue.kind === "free-text") assertText(selectedValue.text, "free-text answer");
  if (request.kind === "form" && selectedValue.kind === "form") validateFormSelection(request, selectedValue.fields);
}

export function validateOwnerConfirmedActionMetadata(
  request: OwnerDecisionRequest,
  action: OwnerConfirmedActionMetadata,
): void {
  assertText(action.actionId, "confirmed action id");
  assertText(action.adapterName, "confirmed action adapter name");
  assertText(action.description, "confirmed action description");
  if (!action.requiresConfirmation) throw new Error("confirmed action metadata requires requiresConfirmation=true");
  validateOwnerDecisionSelection(request, action.authorizingSelection);
}

function validateFormSelection(
  request: Extract<OwnerDecisionRequest, { kind: "form" }>,
  fields: OwnerDecisionJsonObject,
): void {
  const fieldIds = new Set(request.fields.map((field) => field.id));
  for (const fieldId of Object.keys(fields)) {
    if (!fieldIds.has(fieldId)) throw new Error(`form field "${fieldId}" is not declared`);
  }
  for (const field of request.fields) {
    const value = fields[field.id];
    if (field.required && value === undefined) throw new Error(`form field "${field.id}" is required`);
    if (value === undefined) continue;
    if (field.type === "text" && typeof value !== "string") throw new Error(`form field "${field.id}" must be text`);
    if (field.type === "number" && typeof value !== "number") throw new Error(`form field "${field.id}" must be a number`);
    if (field.type === "boolean" && typeof value !== "boolean") throw new Error(`form field "${field.id}" must be boolean`);
    if (field.type === "select") {
      if (typeof value !== "string") throw new Error(`form field "${field.id}" must be an option id`);
      const ids = new Set((field.options ?? []).map((option) => option.id));
      if (!ids.has(value)) throw new Error(`form field "${field.id}" has unrecognized option id "${value}"`);
    }
  }
}

function isSensitiveField(field: OwnerDecisionFormField | undefined, fieldId: string): boolean {
  return (
    projectEvidenceJsonValue("value", "internal-storage", fieldId) === EVIDENCE_REDACTED ||
    (field !== undefined &&
      projectEvidenceJsonValue("value", "internal-storage", field.label) === EVIDENCE_REDACTED)
  );
}

function redactJsonValue(value: OwnerDecisionJsonValue, key = ""): OwnerDecisionJsonValue {
  return projectEvidenceJsonValue(
    value as EvidenceJsonValue,
    "internal-storage",
    key,
  ) as OwnerDecisionJsonValue;
}

function redactFormSelection(
  request: Extract<OwnerDecisionRequest, { kind: "form" }>,
  fields: OwnerDecisionJsonObject,
): OwnerDecisionJsonObject {
  const fieldById = new Map(request.fields.map((field) => [field.id, field]));
  const out: OwnerDecisionJsonObject = {};
  for (const [fieldId, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    out[fieldId] = isSensitiveField(fieldById.get(fieldId), fieldId)
      ? EVIDENCE_REDACTED
      : redactJsonValue(value, fieldId);
  }
  return out;
}

export function sanitizeOwnerDecisionSelectionForStorage(
  request: OwnerDecisionRequest,
  selectedValue: OwnerDecisionSelectedValue,
): OwnerDecisionSelectedValue {
  if (
    request.kind === "free-text" &&
    selectedValue.kind === "free-text" &&
    isSensitiveField(undefined, request.prompt)
  ) {
    return { kind: "free-text", text: EVIDENCE_REDACTED };
  }
  if (request.kind === "free-text" && selectedValue.kind === "free-text") {
    return { kind: "free-text", text: redactSensitiveText(selectedValue.text) };
  }
  if (request.kind === "form" && selectedValue.kind === "form") {
    return { kind: "form", fields: redactFormSelection(request, selectedValue.fields) };
  }
  return selectedValue;
}

function sanitizeOwnerDecisionOption(option: OwnerDecisionOption): OwnerDecisionOption {
  return {
    id: option.id,
    label: redactSensitiveText(option.label),
    ...(option.description !== undefined ? { description: redactSensitiveText(option.description) } : {}),
  };
}

export function sanitizeOwnerDecisionRequestForStorage(
  request: OwnerDecisionRequest,
): OwnerDecisionRequest {
  if (request.kind === "single-choice") {
    return {
      kind: request.kind,
      prompt: redactSensitiveText(request.prompt),
      options: request.options.map(sanitizeOwnerDecisionOption),
    };
  }
  if (request.kind === "multi-choice") {
    return {
      kind: request.kind,
      prompt: redactSensitiveText(request.prompt),
      options: request.options.map(sanitizeOwnerDecisionOption),
      ...(request.minSelected !== undefined ? { minSelected: request.minSelected } : {}),
      ...(request.maxSelected !== undefined ? { maxSelected: request.maxSelected } : {}),
    };
  }
  if (request.kind === "free-text") {
    return {
      kind: request.kind,
      prompt: redactSensitiveText(request.prompt),
      ...(request.multiline !== undefined ? { multiline: request.multiline } : {}),
    };
  }
  return {
    kind: request.kind,
    prompt: redactSensitiveText(request.prompt),
    fields: request.fields.map((field) => ({
      id: field.id,
      label: redactSensitiveText(field.label),
      type: field.type,
      required: field.required,
      ...(field.options !== undefined ? { options: field.options.map(sanitizeOwnerDecisionOption) } : {}),
    })),
  };
}

export function sanitizeOwnerDecisionRequesterForStorage(
  requester: OwnerDecisionRequester,
): OwnerDecisionRequester {
  if (requester.kind === "manual") {
    return { kind: "manual", source: redactSensitiveText(requester.source) };
  }
  return requester;
}

export function sanitizeOwnerDecisionEvidenceForStorage(
  evidence: OwnerDecisionEvidence[],
): OwnerDecisionEvidence[] {
  return evidence.map((entry) => ({
    summary: redactSensitiveText(entry.summary),
    ...(entry.source !== undefined ? { source: redactSensitiveText(entry.source) } : {}),
    ...(entry.artifactPath !== undefined ? { artifactPath: redactSensitiveText(entry.artifactPath) } : {}),
  }));
}

export function sanitizeOwnerConfirmedActionMetadataForStorage(
  request: OwnerDecisionRequest,
  action: OwnerConfirmedActionMetadata,
): OwnerConfirmedActionMetadata {
  return {
    ...action,
    description: redactSensitiveText(action.description),
    authorizingSelection: sanitizeOwnerDecisionSelectionForStorage(request, action.authorizingSelection),
  };
}

function redactSelectedValue(value: OwnerDecisionSelectedValue): OwnerDecisionSelectedValue {
  if (value.kind !== "form") return value;
  return { kind: "form", fields: redactJsonValue(value.fields) as OwnerDecisionJsonObject };
}

export function projectOwnerDecisionForClient(decision: OwnerDecisionRecord): OwnerDecisionClientProjection {
  const projected = projectOwnerDecisionRecord(decision);
  if (projected.selectedValue === undefined) return projected;
  return { ...projected, selectedValue: redactSelectedValue(projected.selectedValue) };
}

export function sanitizeOwnerDecisionRecordForStorage(
  decision: OwnerDecisionRecord,
): OwnerDecisionRecord {
  return projectOwnerDecisionRecord(decision);
}

function projectOwnerDecisionRecord(decision: OwnerDecisionRecord): OwnerDecisionRecord {
  const request = sanitizeOwnerDecisionRequestForStorage(decision.request);
  return {
    ...decision,
    request,
    requester: sanitizeOwnerDecisionRequesterForStorage(decision.requester),
    evidence: sanitizeOwnerDecisionEvidenceForStorage(decision.evidence),
    ...(decision.action !== undefined
      ? { action: sanitizeOwnerConfirmedActionMetadataForStorage(decision.request, decision.action) }
      : {}),
    ...(decision.selectedValue !== undefined
      ? { selectedValue: sanitizeOwnerDecisionSelectionForStorage(request, decision.selectedValue) }
      : {}),
    ...(decision.resolutionSource !== undefined ? { resolutionSource: redactSensitiveText(decision.resolutionSource) } : {}),
    ...(decision.canceledReason !== undefined ? { canceledReason: redactSensitiveText(decision.canceledReason) } : {}),
  };
}
