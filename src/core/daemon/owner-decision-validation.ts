import type {
  OwnerConfirmedActionMetadata,
  OwnerDecisionClientProjection,
  OwnerDecisionFormField,
  OwnerDecisionJsonObject,
  OwnerDecisionJsonValue,
  OwnerDecisionOption,
  OwnerDecisionRecord,
  OwnerDecisionRequest,
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

const SENSITIVE_KEY_PATTERN = /(authorization|credential|password|secret|token|api[-_]?key)/i;
const REDACTED_SELECTED_VALUE = "[redacted]";

function isSensitiveField(field: OwnerDecisionFormField | undefined, fieldId: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(fieldId) || (field !== undefined && SENSITIVE_KEY_PATTERN.test(field.label));
}

function redactJsonValue(value: OwnerDecisionJsonValue, key = ""): OwnerDecisionJsonValue {
  if (SENSITIVE_KEY_PATTERN.test(key)) return REDACTED_SELECTED_VALUE;
  if (Array.isArray(value)) return value.map((entry) => redactJsonValue(entry));
  if (value !== null && typeof value === "object") {
    const out: OwnerDecisionJsonObject = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      if (entryValue !== undefined) out[entryKey] = redactJsonValue(entryValue, entryKey);
    }
    return out;
  }
  return value;
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
      ? REDACTED_SELECTED_VALUE
      : redactJsonValue(value, fieldId);
  }
  return out;
}

export function sanitizeOwnerDecisionSelectionForStorage(
  request: OwnerDecisionRequest,
  selectedValue: OwnerDecisionSelectedValue,
): OwnerDecisionSelectedValue {
  if (request.kind === "free-text" && selectedValue.kind === "free-text" && SENSITIVE_KEY_PATTERN.test(request.prompt)) {
    return { kind: "free-text", text: REDACTED_SELECTED_VALUE };
  }
  if (request.kind === "form" && selectedValue.kind === "form") {
    return { kind: "form", fields: redactFormSelection(request, selectedValue.fields) };
  }
  return selectedValue;
}

export function sanitizeOwnerConfirmedActionMetadataForStorage(
  request: OwnerDecisionRequest,
  action: OwnerConfirmedActionMetadata,
): OwnerConfirmedActionMetadata {
  return {
    ...action,
    authorizingSelection: sanitizeOwnerDecisionSelectionForStorage(request, action.authorizingSelection),
  };
}

function redactSelectedValue(value: OwnerDecisionSelectedValue): OwnerDecisionSelectedValue {
  if (value.kind !== "form") return value;
  return { kind: "form", fields: redactJsonValue(value.fields) as OwnerDecisionJsonObject };
}

export function projectOwnerDecisionForClient(decision: OwnerDecisionRecord): OwnerDecisionClientProjection {
  if (decision.selectedValue === undefined) return decision;
  return { ...decision, selectedValue: redactSelectedValue(decision.selectedValue) };
}
