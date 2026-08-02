import type { ScopeSetupVisibility } from "#core/daemon/scope-policy.js";
import { projectModuleSetupStatusForClient } from "./status-utils.js";
import type {
  ModuleSetupFailureResult,
  ModuleSetupRequirementStatus,
} from "./types.js";

export function projectSetupStatusForVisibility(
  status: ModuleSetupRequirementStatus,
  visibility: ScopeSetupVisibility,
): ModuleSetupRequirementStatus {
  const projected = projectModuleSetupStatusForClient(status);
  if (visibility === "full") return projected;
  return {
    moduleName: projected.moduleName,
    requirementId: projected.requirementId,
    kind: projected.kind,
    title: projected.title,
    required: projected.required,
    scope: projected.scope,
    sensitivity: projected.sensitivity,
    setup: { mode: "none" },
    state: projected.state,
    reason: projected.reason,
    message: projected.message,
  };
}

export function setupPolicyDenied(visibility: ScopeSetupVisibility): ModuleSetupFailureResult {
  return {
    ok: false,
    reason: "policy_denied",
    message: `Scope setup visibility is ${visibility}; full visibility is required`,
  };
}
