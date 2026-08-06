import {
  type AutonomyMode,
  capAutonomyMode,
} from "#core/tools/autonomy-mode.js";
import type { ResolvedScopePolicy } from "./scope-policy-types.js";

export function capScopeAutonomyMode(
  requested: AutonomyMode,
  policy: ResolvedScopePolicy,
): AutonomyMode {
  return capAutonomyMode(requested, policy.autonomy.maxMode);
}
