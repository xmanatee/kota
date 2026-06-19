import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { getSecretStore, initSecretStore } from "#core/config/secrets.js";
import { readConfigPath } from "./config-paths.js";
import type {
  ModuleSetupBrowserProfileRequirement,
  ModuleSetupCapabilityStatus,
  ModuleSetupConfigRequirement,
  ModuleSetupExternalUrlRequirement,
  ModuleSetupOAuthRequirement,
  ModuleSetupRequirement,
  ModuleSetupRequirementContribution,
  ModuleSetupRequirementStatus,
  ModuleSetupSecretRef,
  ModuleSetupSecretRequirement,
  ModuleSetupSecretStatus,
  ModuleSetupStatusInput,
  ModuleSetupStatusState,
} from "./types.js";

export function moduleSetupStatusFor(args: ModuleSetupStatusInput): ModuleSetupRequirementStatus {
  const base = baseStatus(args.entry);
  const capabilities = capabilityStatusesFor(args.entry.requirement, args.capabilities);
  if (args.pendingAction?.status === "pending") {
    const expires = new Date(args.pendingAction.expiresAt).getTime();
    if (expires > args.now.getTime()) {
      return withComputed(base, "pending", "url_setup_pending", "Setup URL action is pending", {
        pendingAction: args.pendingAction,
        capabilities,
      });
    }
    return withComputed(base, "expired", "url_setup_expired", "Setup URL action expired", {
      pendingAction: args.pendingAction,
      capabilities,
    });
  }
  if (args.pendingAction?.status === "revoked") {
    return withComputed(base, "revoked", "credentials_revoked", "Credentials were revoked", {
      pendingAction: args.pendingAction,
      capabilities,
    });
  }

  switch (args.entry.requirement.kind) {
    case "config":
      return configStatus(base, args.entry.requirement, args.config, capabilities);
    case "secret":
      return secretStatus(base, args.entry.requirement, capabilities, args.projectDir);
    case "oauth":
      return oauthStatus(base, args.entry.requirement, capabilities, args.projectDir);
    case "browser-profile":
      return browserProfileStatus(base, args.entry.requirement, args.config, capabilities, args.projectDir);
    case "external-url":
      return externalUrlStatus(base, args.entry.requirement, args.config, capabilities, args.projectDir);
    case "capability":
      return capabilityStatus(base, capabilities);
  }
}

function baseStatus(
  entry: ModuleSetupRequirementContribution,
): Omit<ModuleSetupRequirementStatus, "state" | "reason" | "message"> {
  const base = {
    moduleName: entry.moduleName,
    requirementId: entry.requirement.id,
    kind: entry.requirement.kind,
    title: entry.requirement.title,
    required: entry.requirement.required,
    scope: entry.requirement.scope,
    sensitivity: entry.requirement.sensitivity,
    setup: entry.requirement.setup,
  };
  return {
    ...base,
    ...(entry.requirement.description !== undefined && { description: entry.requirement.description }),
    ...(entry.requirement.owner !== undefined && { owner: entry.requirement.owner }),
  };
}

function withComputed(
  base: Omit<ModuleSetupRequirementStatus, "state" | "reason" | "message">,
  state: ModuleSetupStatusState,
  reason: string,
  message: string,
  extra: Partial<Pick<
    ModuleSetupRequirementStatus,
    "secretRefs" | "configFields" | "capabilities" | "pendingAction"
  >> = {},
): ModuleSetupRequirementStatus {
  return { ...base, state, reason, message, ...extra };
}

function configStatus(
  base: Omit<ModuleSetupRequirementStatus, "state" | "reason" | "message">,
  req: ModuleSetupConfigRequirement,
  config: Parameters<typeof readConfigPath>[0],
  capabilities: ModuleSetupCapabilityStatus[],
): ModuleSetupRequirementStatus {
  const fields = req.setup.fields.map((field) => ({
    id: field.id,
    label: field.label,
    configPath: field.configPath,
    required: field.required,
    present: readConfigPath(config, field.configPath) !== undefined,
  }));
  if (fields.some((field) => field.required && !field.present)) {
    return withComputed(base, "missing", "config_missing", "Required configuration is missing", {
      configFields: fields,
      capabilities,
    });
  }
  return withComputed(base, "ready", "config_present", "Required configuration is present", {
    configFields: fields,
    capabilities,
  });
}

function secretStatus(
  base: Omit<ModuleSetupRequirementStatus, "state" | "reason" | "message">,
  req: ModuleSetupSecretRequirement | ModuleSetupOAuthRequirement,
  capabilities: ModuleSetupCapabilityStatus[],
  projectDir: string,
): ModuleSetupRequirementStatus {
  const refs = secretStatuses(req.secretRefs, projectDir);
  if (refs.some((ref) => !ref.present)) {
    return withComputed(base, "missing", "secret_missing", "Required credential is missing", {
      secretRefs: refs,
      capabilities,
    });
  }
  return withComputed(base, "ready", "secret_present", "Required credential reference is present", {
    secretRefs: refs,
    capabilities,
  });
}

function oauthStatus(
  base: Omit<ModuleSetupRequirementStatus, "state" | "reason" | "message">,
  req: ModuleSetupOAuthRequirement,
  capabilities: ModuleSetupCapabilityStatus[],
  projectDir: string,
): ModuleSetupRequirementStatus {
  const refs = secretStatuses(req.secretRefs, projectDir);
  if (refs.some((ref) => !ref.present)) {
    return withComputed(base, "missing", "secret_missing", "Required credential is missing", {
      secretRefs: refs,
      capabilities,
    });
  }
  const failed = capabilities.find((capability) => capability.status !== "ready");
  if (!failed) {
    return withComputed(base, "ready", "oauth_ready", "OAuth credential is ready", {
      secretRefs: refs,
      capabilities,
    });
  }
  const state =
    failed.reason === "not_reported"
      ? "unknown"
      : failed.status === "init_failed"
        ? "unavailable"
        : "expired";
  return withComputed(
    base,
    state,
    failed.reason ?? "oauth_reauth_required",
    failed.message ?? "OAuth credential needs reauthorization",
    { secretRefs: refs, capabilities },
  );
}

function browserProfileStatus(
  base: Omit<ModuleSetupRequirementStatus, "state" | "reason" | "message">,
  req: ModuleSetupBrowserProfileRequirement,
  config: Parameters<typeof readConfigPath>[0],
  capabilities: ModuleSetupCapabilityStatus[],
  projectDir: string,
): ModuleSetupRequirementStatus {
  const configured = readConfigPath(config, req.storageStateConfigPath);
  const fields = req.setup.fields.map((field) => ({
    id: field.id,
    label: field.label,
    configPath: field.configPath,
    required: field.required,
    present: readConfigPath(config, field.configPath) !== undefined,
  }));
  if (typeof configured !== "string" || configured.length === 0) {
    return withComputed(base, "missing", "browser_profile_missing", "Browser profile path is not configured", {
      configFields: fields,
      capabilities,
    });
  }
  const path = isAbsolute(configured) ? configured : resolve(projectDir, configured);
  if (!existsSync(path)) {
    return withComputed(base, "unavailable", "browser_profile_file_missing", "Browser profile file does not exist", {
      configFields: fields,
      capabilities,
    });
  }
  return withComputed(base, "ready", "browser_profile_ready", "Browser profile file is configured", {
    configFields: fields,
    capabilities,
  });
}

function externalUrlStatus(
  base: Omit<ModuleSetupRequirementStatus, "state" | "reason" | "message">,
  req: ModuleSetupExternalUrlRequirement,
  config: Parameters<typeof readConfigPath>[0],
  capabilities: ModuleSetupCapabilityStatus[],
  projectDir: string,
): ModuleSetupRequirementStatus {
  const refs = req.secretRefs ? secretStatuses(req.secretRefs, projectDir) : [];
  if (refs.some((ref) => !ref.present)) {
    return withComputed(base, "missing", "secret_missing", "Required credential is missing", {
      secretRefs: refs,
      capabilities,
    });
  }
  const missingConfig = (req.completionConfigPaths ?? []).some(
    (path) => readConfigPath(config, path) === undefined,
  );
  if (missingConfig) {
    return withComputed(base, "missing", "external_setup_incomplete", "External setup has not been completed", {
      secretRefs: refs,
      capabilities,
    });
  }
  if (refs.length > 0 || (req.completionConfigPaths ?? []).length > 0) {
    return withComputed(base, "ready", "external_setup_complete", "External setup is complete", {
      secretRefs: refs,
      capabilities,
    });
  }
  return withComputed(base, "unknown", "external_setup_untracked", "External setup has no local completion check", {
    capabilities,
  });
}

function capabilityStatus(
  base: Omit<ModuleSetupRequirementStatus, "state" | "reason" | "message">,
  capabilities: ModuleSetupCapabilityStatus[],
): ModuleSetupRequirementStatus {
  if (capabilities.length === 0) {
    return withComputed(base, "unknown", "capability_status_missing", "Capability status is not reported");
  }
  if (capabilities.every((capability) => capability.status === "ready")) {
    return withComputed(base, "ready", "capability_ready", "Required capability is ready", { capabilities });
  }
  return withComputed(base, "unavailable", "capability_unavailable", "Required capability is unavailable", {
    capabilities,
  });
}

function capabilityStatusesFor(
  req: ModuleSetupRequirement,
  capabilities: readonly ModuleSetupCapabilityStatus[],
): ModuleSetupCapabilityStatus[] {
  const ids = req.kind === "capability" ? req.capabilityIds : req.health?.capabilityIds ?? [];
  return ids.map((id) => capabilities.find((capability) => capability.id === id) ?? {
    id,
    status: "unavailable" as const,
    reason: "not_reported",
    message: "Capability readiness source did not report this id.",
  });
}

function secretStatuses(
  refs: readonly ModuleSetupSecretRef[],
  projectDir: string,
): ModuleSetupSecretStatus[] {
  const store = getSecretStore() ?? initSecretStore(projectDir);
  const listed = store.list();
  return refs.map((ref) => {
    const found = listed.find((entry) => entry.name === ref.name);
    return {
      ...ref,
      present: found !== undefined,
      ...(found !== undefined && { source: found.source }),
    };
  });
}
