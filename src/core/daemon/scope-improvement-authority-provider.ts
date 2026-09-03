import {
  defineProviderToken,
  type ProviderToken,
} from "#core/modules/provider-token.js";
import type { ResolvedScopePolicy } from "./scope-policy.js";

export type ScopeImprovementAuthorityProjection = {
  enabled: boolean;
  configuredPosture: "observe" | "propose" | "build";
  posture: "observe" | "propose" | "build";
  review: "disabled" | "owner-questions" | "task-proposals";
  builder: "disabled" | "enabled";
  taskProposalDecision: {
    outcome: "allow" | "confirm" | "deny";
    reason: string;
  };
  builderDecision: {
    outcome: "allow" | "confirm" | "deny";
    reason: string;
  };
};

export interface ScopeImprovementAuthorityProvider {
  inspect(input: {
    scopeRoot: string;
    stateDir: string;
    policy: ResolvedScopePolicy;
  }): ScopeImprovementAuthorityProjection;
}

export const SCOPE_IMPROVEMENT_AUTHORITY_PROVIDER_TYPE:
  ProviderToken<ScopeImprovementAuthorityProvider> =
    defineProviderToken<ScopeImprovementAuthorityProvider>(
      "scope-improvement-authority",
    );
