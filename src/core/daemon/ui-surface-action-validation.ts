import type {
  UiAction,
  UiActionOperation,
  UiActionReadiness,
  UiConfirmation,
} from "./ui-surface.js";
import {
  errorIf,
  validateClientMember,
  validateConditions,
  validateFormField,
  validateId,
  validateKnown,
  validatePermissions,
  validateSchema,
  validateUnique,
} from "./ui-surface-validation-helpers.js";

const UI_ACTION_EFFECTS = ["read", "write", "external"] as const;
const UI_ACTION_METHODS = ["GET", "POST", "PATCH", "DELETE"] as const;
const UI_OPERATION_KINDS = ["daemon-route", "client-namespace"] as const;
const UI_CONFIRMATION_MODES = ["none", "required"] as const;
const UI_CONFIRMATION_RISKS = ["low", "medium", "high"] as const;
const UI_READINESS_STATES = ["ready", "disabled", "needs-setup"] as const;

function validateActionOperation(
  operation: UiActionOperation,
  label: string,
  errors: string[],
): void {
  const kind = operation.kind;
  if (!validateKnown(kind, UI_OPERATION_KINDS, `${label}.kind`, errors)) return;
  if (kind === "daemon-route") {
    validateKnown(operation.method, UI_ACTION_METHODS, `${label}.method`, errors);
    errorIf(!operation.path.startsWith("/"), errors, `${label}.path must start with /`);
    return;
  }
  validateClientMember(operation.namespace, `${label}.namespace`, errors);
  validateClientMember(operation.method, `${label}.method`, errors);
}

function validateConfirmation(
  confirmation: UiConfirmation,
  label: string,
  errors: string[],
): void {
  const mode = confirmation.mode;
  if (!validateKnown(mode, UI_CONFIRMATION_MODES, `${label}.mode`, errors)) return;
  if (mode !== "required") return;
  errorIf(confirmation.title.trim() === "", errors, `${label}.title must not be empty`);
  errorIf(confirmation.detail.trim() === "", errors, `${label}.detail must not be empty`);
  errorIf(confirmation.confirmLabel.trim() === "", errors, `${label}.confirmLabel must not be empty`);
  validateKnown(confirmation.risk, UI_CONFIRMATION_RISKS, `${label}.risk`, errors);
}

function validateReadiness(
  readiness: UiActionReadiness,
  label: string,
  errors: string[],
): void {
  const state = readiness.state;
  if (!validateKnown(state, UI_READINESS_STATES, `${label}.state`, errors)) return;
  if (state === "disabled") {
    validateId(readiness.reason, `${label}.reason`, errors);
    errorIf(readiness.message.trim() === "", errors, `${label}.message must not be empty`);
  }
  if (state === "needs-setup") {
    validateId(readiness.moduleName, `${label}.moduleName`, errors);
    validateId(readiness.requirementId, `${label}.requirementId`, errors);
    errorIf(readiness.message.trim() === "", errors, `${label}.message must not be empty`);
  }
}

export function validateAction(action: UiAction, label: string, errors: string[]): void {
  validateId(action.surfaceId, `${label}.surfaceId`, errors);
  validateId(action.actionId, `${label}.actionId`, errors);
  validateKnown(action.effect, UI_ACTION_EFFECTS, `${label}.effect`, errors);
  validateActionOperation(action.operation, `${label}.operation`, errors);
  if (action.parameters) {
    validateSchema(action.parameters.schema, `${label}.parameters.schema`, errors);
    const fieldIds = new Set<string>();
    for (const field of action.parameters.fields) {
      validateUnique(field.id, fieldIds, `${label} field id`, errors);
      validateFormField(field, `${label}.parameters.fields.${field.id}`, errors);
      errorIf(
        action.parameters.schema.properties[field.id] === undefined,
        errors,
        `${label}.parameters.fields references missing schema property "${field.id}"`,
      );
    }
    for (const required of action.parameters.schema.required ?? []) {
      errorIf(
        !fieldIds.has(required),
        errors,
        `${label}.parameters.schema requires "${required}" but no matching field is declared`,
      );
    }
  }
  validateConfirmation(action.confirmation, `${label}.confirmation`, errors);
  validateReadiness(action.readiness, `${label}.readiness`, errors);
  errorIf(action.result.success.message.trim() === "", errors, `${label}.result.success.message must not be empty`);
  validateSchema(action.result.success.schema ?? { type: "object", properties: {} }, `${label}.result.success.schema`, errors);
  const errorReasons = new Set<string>();
  for (const outcome of action.result.errors) {
    validateId(outcome.reason, `${label}.result.errors.reason`, errors);
    validateUnique(outcome.reason, errorReasons, `${label} result error reason`, errors);
    errorIf(outcome.message.trim() === "", errors, `${label}.result.errors.${outcome.reason}.message must not be empty`);
    if (outcome.schema) {
      validateSchema(outcome.schema, `${label}.result.errors.${outcome.reason}.schema`, errors);
    }
  }
  validateConditions(action.conditions, label, errors);
  validatePermissions(action.permissions, label, errors);
}
