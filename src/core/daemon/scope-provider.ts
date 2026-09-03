import {
  defineProviderToken,
  type ProviderToken,
} from "#core/modules/provider-registry.js";
import type { SetActiveScopeResult, UnknownScopeError } from "./daemon-control-types.js";
import type { ScopeAuthorityOperatorActionValue } from "./scope-authority-types.js";
import type {
  ScopeDrainResult,
  ScopeRemovalResult,
} from "./scope-lifecycle-types.js";
import type {
  ScopeOnboardingApplyResult,
  ScopeOnboardingChoices,
  ScopeOnboardingInspection,
  ScopeOnboardingOperation,
  ScopeOnboardingPlan,
  ScopeOnboardingPlanResult,
} from "./scope-onboarding-types.js";
import type { ScopeId, ScopeRegistryProjection } from "./scope-registry.js";
import type { ScopeRuntime } from "./scope-runtime.js";

export type DaemonScopeRuntime = Pick<
  ScopeRuntime,
  | "scope"
  | "authorityConfigPath"
  | "approvalQueue"
  | "secretStore"
  | "ownerDecisionStore"
  | "ownerQuestionQueue"
  | "scopePolicyAuthority"
>;

export type DaemonScopeRuntimeResolution =
  | { ok: true; runtime: DaemonScopeRuntime }
  | { ok: false; error: UnknownScopeError };

export type DaemonScopeProvider = {
  getScopeRegistryProjection(): ScopeRegistryProjection;
  getActiveScopeId(): ScopeId | null;
  setActiveScopeId?(scopeId: ScopeId | null): SetActiveScopeResult;
  resolveScopeRuntime(
    scopeId?: string | null,
  ): DaemonScopeRuntimeResolution;
  operator?: {
    inspectOnboarding(directoryRoot: string): Promise<ScopeOnboardingInspection>;
    planOnboarding(
      directoryRoot: string,
      choices?: ScopeOnboardingChoices,
    ): Promise<ScopeOnboardingPlanResult>;
    applyOnboarding(
      plan: ScopeOnboardingPlan,
      operatorAction: ScopeAuthorityOperatorActionValue,
    ): Promise<ScopeOnboardingApplyResult>;
    getOnboardingStatus(operationId: string): Promise<ScopeOnboardingOperation | null>;
    retryOnboarding(
      operationId: string,
      operatorAction: ScopeAuthorityOperatorActionValue,
    ): Promise<ScopeOnboardingApplyResult>;
    cancelOnboarding(operationId: string): Promise<ScopeOnboardingApplyResult>;
    drain(scopeId: ScopeId): Promise<ScopeDrainResult>;
    remove(scopeId: ScopeId): Promise<ScopeRemovalResult>;
  };
};

export const DAEMON_SCOPE_PROVIDER_TYPE: ProviderToken<DaemonScopeProvider> =
  defineProviderToken<DaemonScopeProvider>("daemon-scope");
