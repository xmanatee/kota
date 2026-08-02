import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { ResolvedScopePolicy } from "./scope-policy-types.js";

export function capScopeAutonomyMode(
  requested: AutonomyMode,
  policy: ResolvedScopePolicy,
): AutonomyMode {
  return autonomyRank(requested) <= autonomyRank(policy.autonomy.maxMode)
    ? requested
    : policy.autonomy.maxMode;
}

function autonomyRank(mode: AutonomyMode): number {
  if (mode === "passive") return 0;
  if (mode === "supervised") return 1;
  return 2;
}
