import type { CapabilityReadinessSource } from "#core/daemon/capability-readiness.js";
import type { ModuleSetupRequirement } from "#core/modules/setup-requirements.js";
import { containedEvaluationProfiles } from "./contained-evaluation.js";

const grantCapability = "eval-harness.contained-grants";
export const containedSetupRequirements: ModuleSetupRequirement[] = [{
  id: "contained-host-grants", kind: "capability", title: "Contained evaluation host grants",
  description: "Prepare the deployment recipe in deploy/contained-evaluation/README.md and install its reviewed KOTA_EVAL_CONTAINED_PROFILES through kota daemon install. Host activation is required before workers can use the grants.",
  required: false, scope: "scope", owner: "eval-harness", sensitivity: "none",
  setup: { mode: "none" }, capabilityIds: [grantCapability],
}];

export function containedSetupReadiness(scopeRoot: string, env: NodeJS.ProcessEnv = process.env): CapabilityReadinessSource {
  return { moduleName: "eval-harness", probe() {
    const base = { id: grantCapability, moduleName: "eval-harness" };
    try {
      const profiles = containedEvaluationProfiles(scopeRoot, env);
      if (!Object.keys(profiles).length) return [{ ...base, status: "unavailable", reason: "no_scope_grant", message: "No contained evaluation profile authorizes this canonical scope. Install an operator-reviewed scope grant using the deployment recipe." }];
      return [{ ...base, status: "ready", reason: "scope_grants_configured", message: "Scope grants are configured. Image, adapter authentication and restricted network preflight still run before inference; this is not live containment or model-quality evidence." }];
    } catch {
      return [{ ...base, status: "unavailable", reason: "host_grants_missing_or_invalid", message: "KOTA_EVAL_CONTAINED_PROFILES is missing or invalid in this host. Validate the deployment recipe, then install the reviewed environment through kota daemon install. Worker requests cannot grant host access." }];
    }
  } };
}
