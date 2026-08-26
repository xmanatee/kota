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
  ModuleSetupExecutablePendingAction,
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
    title: projectSetupText(status.title, target),
    ...(status.description !== undefined && {
      description: projectSetupText(status.description, target),
    }),
    required: status.required,
    scope: status.scope,
    ...(status.owner !== undefined && {
      owner: projectSetupText(status.owner, target),
    }),
    sensitivity: status.sensitivity,
    setup: projectSetupMode(status.setup, target),
    state: status.state,
    reason: projectSetupText(status.reason, target),
    message: projectSetupText(status.message, target),
    ...(status.secretRefs !== undefined && {
      secretRefs: status.secretRefs.map((secret) =>
        projectSecretStatus(secret, target)
      ),
    }),
    ...(status.configFields !== undefined && {
      configFields: status.configFields.map((field) =>
        projectConfigField(field, target)
      ),
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
    label: projectSetupText(action.label, target),
    status: action.status,
    createdAt: action.createdAt,
    expiresAt: action.expiresAt,
    ...(action.completedAt !== undefined && { completedAt: action.completedAt }),
  };
}

export function projectModuleSetupActionForAuthorizedStart(
  action: ModuleSetupExecutablePendingAction,
): ModuleSetupExecutablePendingAction {
  const projected = projectModuleSetupPendingActionForClient(action);
  return {
    ...projected,
    url: action.url,
    status: "pending",
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
      label: projectSetupText(setup.label, target),
      ...(setup.pendingTtlMs !== undefined && { pendingTtlMs: setup.pendingTtlMs }),
    };
  }
  return {
    mode: "form",
    fields: setup.fields.map((field) => projectFormField(field, target)),
  };
}

function projectFormField(
  field: ModuleSetupFormField,
  target: EvidenceProjectionTarget,
): ModuleSetupFormField {
  return {
    id: field.id,
    label: projectSetupText(field.label, target),
    type: field.type,
    ...(field.valueKind !== undefined && { valueKind: field.valueKind }),
    configPath: field.configPath,
    required: field.required,
    ...(field.placeholder !== undefined && {
      placeholder: projectSetupText(field.placeholder, target),
    }),
    ...(field.helperText !== undefined && {
      helperText: projectSetupText(field.helperText, target),
    }),
    ...(field.options !== undefined && {
      options: field.options.map((option) => ({
        value: option.value,
        label: projectSetupText(option.label, target),
      })),
    }),
  };
}

function projectSecretStatus(
  status: ModuleSetupSecretStatus,
  target: EvidenceProjectionTarget,
): ModuleSetupSecretStatus {
  return {
    name: status.name,
    scope: status.scope,
    present: status.present,
    ...(status.source !== undefined && {
      source: projectSetupText(status.source, target),
    }),
  };
}

function projectConfigField(
  field: ModuleSetupConfigFieldStatus,
  target: EvidenceProjectionTarget,
): ModuleSetupConfigFieldStatus {
  return {
    id: field.id,
    label: projectSetupText(field.label, target),
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
    ...(capability.reason !== undefined && {
      reason: projectSetupText(capability.reason, target),
    }),
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
