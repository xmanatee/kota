export type {
  RestrictiveScopePolicyChange,
  RestrictiveScopePolicyChangeListener,
  ScopePolicyAuthority,
  ScopePolicySnapshot,
} from "./scope-policy-authority.js";
export { capScopeAutonomyMode } from "./scope-policy-autonomy.js";
export {
  decideScopePolicy,
  defaultScopePolicyDecisionExamples,
  renderScopePolicyDecisionPlain,
} from "./scope-policy-decisions.js";
export {
  defaultScopePolicyFragments,
  resolveScopePolicy,
} from "./scope-policy-resolver.js";
export type {
  ResolvedScopePolicy,
  ScopeActionPolicy,
  ScopeAutonomyPolicy,
  ScopeChannelRoutingPolicy,
  ScopeExternalEffectPolicy,
  ScopeModuleAvailability,
  ScopeModulePolicy,
  ScopeModulePolicyOverride,
  ScopeOwnerConfirmationPolicy,
  ScopePolicyArea,
  ScopePolicyDecision,
  ScopePolicyDecisionOutcome,
  ScopePolicyDecisionQuery,
  ScopePolicyExplanation,
  ScopePolicyFragment,
  ScopePolicyRouteResponse,
  ScopePolicySource,
  ScopePolicyToolEffectQuery,
  ScopeRedactionProfile,
  ScopeRetentionPolicy,
  ScopeSetupVisibility,
  ScopeWriteBoundary,
} from "./scope-policy-types.js";
export { ScopePolicyValidationError } from "./scope-policy-types.js";
export {
  scopePolicyRestrictiveAreas,
  scopePolicyWideningAreas,
} from "./scope-policy-widening.js";
