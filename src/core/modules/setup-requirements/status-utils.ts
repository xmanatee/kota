import {
  type EvidenceProjectionTarget,
  type EvidenceRetentionScope,
  evidenceRetentionDurationMsFor,
  projectEvidenceUrl,
  redactionProfileForTarget,
  redactSensitiveValues,
} from "#core/evidence/policy.js";
import type {
  ModuleSetupCapabilityStatus,
  ModuleSetupConfigFieldStatus,
  ModuleSetupFormField,
  ModuleSetupPendingAction,
  ModuleSetupRequirement,
  ModuleSetupRequirementStatus,
  ModuleSetupScope,
  ModuleSetupSecretRef,
  ModuleSetupSecretStatus,
  ModuleSetupStatusState,
} from "./types.js";

export function projectModuleSetupStatusForClient(
  status: ModuleSetupRequirementStatus,
  target: EvidenceProjectionTarget = "daemon-api",
): ModuleSetupRequirementStatus {
  return {
    moduleName: status.moduleName,
    requirementId: status.requirementId,
    kind: status.kind,
    title: status.title,
    ...(status.description !== undefined && {
      description: projectSetupText(status.description, target),
    }),
    required: status.required,
    scope: status.scope,
    ...(status.owner !== undefined && { owner: status.owner }),
    sensitivity: status.sensitivity,
    setup: projectSetupMode(status.setup, target),
    state: status.state,
    reason: status.reason,
    message: projectSetupText(status.message, target),
    ...(status.secretRefs !== undefined && {
      secretRefs: status.secretRefs.map(projectSecretStatus),
    }),
    ...(status.configFields !== undefined && {
      configFields: status.configFields.map(projectConfigField),
    }),
    ...(status.capabilities !== undefined && {
      capabilities: status.capabilities.map((capability) =>
        projectCapabilityStatus(capability, target)
      ),
    }),
    ...(status.pendingAction !== undefined && {
      pendingAction: projectModuleSetupPendingActionForClient(status.pendingAction, target),
    }),
  };
}

export function projectModuleSetupPendingActionForClient(
  action: ModuleSetupPendingAction,
  target: EvidenceProjectionTarget = "daemon-api",
): ModuleSetupPendingAction {
  return {
    actionId: action.actionId,
    moduleName: action.moduleName,
    requirementId: action.requirementId,
    url: projectEvidenceUrl(action.url, target),
    label: action.label,
    status: action.status,
    createdAt: action.createdAt,
    expiresAt: action.expiresAt,
    ...(action.completedAt !== undefined && { completedAt: action.completedAt }),
  };
}

function projectSetupMode(
  setup: ModuleSetupRequirement["setup"],
  target: EvidenceProjectionTarget,
): ModuleSetupRequirement["setup"] {
  if (setup.mode === "none") return { mode: "none" };
  if (setup.mode === "url") {
    return {
      mode: "url",
      url: projectEvidenceUrl(setup.url, target),
      label: setup.label,
      ...(setup.pendingTtlMs !== undefined && { pendingTtlMs: setup.pendingTtlMs }),
    };
  }
  return {
    mode: "form",
    fields: setup.fields.map(projectFormField),
  };
}

function projectFormField(field: ModuleSetupFormField): ModuleSetupFormField {
  return {
    id: field.id,
    label: field.label,
    type: field.type,
    ...(field.valueKind !== undefined && { valueKind: field.valueKind }),
    configPath: field.configPath,
    required: field.required,
    ...(field.placeholder !== undefined && {
      placeholder: field.placeholder,
    }),
    ...(field.helperText !== undefined && {
      helperText: field.helperText,
    }),
    ...(field.options !== undefined && {
      options: field.options.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    }),
  };
}

function projectSecretStatus(status: ModuleSetupSecretStatus): ModuleSetupSecretStatus {
  return {
    name: status.name,
    scope: status.scope,
    present: status.present,
    ...(status.source !== undefined && { source: status.source }),
  };
}

function projectConfigField(field: ModuleSetupConfigFieldStatus): ModuleSetupConfigFieldStatus {
  return {
    id: field.id,
    label: field.label,
    configPath: field.configPath,
    required: field.required,
    present: field.present,
  };
}

function projectCapabilityStatus(
  capability: ModuleSetupCapabilityStatus,
  target: EvidenceProjectionTarget,
): ModuleSetupCapabilityStatus {
  return {
    id: capability.id,
    status: capability.status,
    ...(capability.reason !== undefined && { reason: capability.reason }),
    ...(capability.message !== undefined && {
      message: projectSetupText(capability.message, target),
    }),
  };
}

export function defaultModuleSetupPendingTtlMs(scope: ModuleSetupScope): number {
  return evidenceRetentionDurationMsFor({
    artifactType: "setup-status",
    state: "pending",
    scope: setupRetentionScope(scope),
  });
}

export function summarizeStatuses(
  statuses: readonly ModuleSetupRequirementStatus[],
): Record<ModuleSetupStatusState, number> {
  const summary: Record<ModuleSetupStatusState, number> = {
    ready: 0,
    missing: 0,
    pending: 0,
    expired: 0,
    revoked: 0,
    unknown: 0,
    unavailable: 0,
  };
  for (const status of statuses) summary[status.state] += 1;
  return summary;
}

export function secretRefsFor(req: ModuleSetupRequirement): readonly ModuleSetupSecretRef[] {
  switch (req.kind) {
    case "secret":
    case "oauth":
      return req.secretRefs;
    case "external-url":
      return req.secretRefs ?? [];
    default:
      return [];
  }
}

function setupRetentionScope(scope: ModuleSetupScope): EvidenceRetentionScope {
  return scope === "global" ? "global" : "directory";
}

function projectSetupText(
  value: string,
  target: EvidenceProjectionTarget,
): string {
  return redactionProfileForTarget(target).scrubSecretsAndPii
    ? redactSensitiveValues(value)
    : value;
}
