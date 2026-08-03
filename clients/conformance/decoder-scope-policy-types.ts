import type { KnownLiteral } from './decoder-common';

// MARK: - Scope policy projection

export const SCOPE_POLICY_AREAS = [
  "autonomy",
  "writes",
  "channels",
  "setup",
  "ownerConfirmation",
  "retention",
  "modules",
  "externalEffects",
] as const;
export const SCOPE_POLICY_EXPLANATION_ACTIONS = ["set", "override", "inherit"] as const;
export const SCOPE_POLICY_AUTONOMY_MODES = ["passive", "supervised", "autonomous"] as const;
export const SCOPE_POLICY_WRITE_MODES = ["none", "scope-directory", "paths", "unrestricted"] as const;
export const SCOPE_POLICY_CHANNEL_MODES = ["blocked", "allow-list", "allow-all"] as const;
export const SCOPE_POLICY_SETUP_VISIBILITIES = ["hidden", "metadata", "full"] as const;
export const SCOPE_POLICY_ACTION_POLICIES = ["allow", "confirm", "deny"] as const;
export const SCOPE_POLICY_RETENTION_MODES = ["retain", "expire-after-days"] as const;
export const SCOPE_POLICY_REDACTION_PROFILES = ["full", "sensitive-fields", "none"] as const;
export const SCOPE_POLICY_MODULE_AVAILABILITIES = ["enabled", "setup-required", "disabled"] as const;
export const SCOPE_POLICY_DECISION_KINDS = ["channel-route", "tool-effect"] as const;
export const SCOPE_POLICY_DECISION_OUTCOMES = ["allow", "confirm", "deny", "ignore"] as const;

export type ScopePolicySource = {
  scopeId: string;
  reason: string;
};

export type ScopePolicyDecision = {
  kind: KnownLiteral<typeof SCOPE_POLICY_DECISION_KINDS>;
  target: string;
  outcome: KnownLiteral<typeof SCOPE_POLICY_DECISION_OUTCOMES>;
  source: ScopePolicySource;
  reason: string;
  rendered: string;
};

export type ScopePolicyRouteResponse = {
  revision: number;
  policy: {
    scopeId: string;
    lineage: string[];
    directoryRoot?: string;
    autonomy: {
      defaultMode: KnownLiteral<typeof SCOPE_POLICY_AUTONOMY_MODES>;
      maxMode: KnownLiteral<typeof SCOPE_POLICY_AUTONOMY_MODES>;
      source: ScopePolicySource;
    };
    writes: {
      mode: KnownLiteral<typeof SCOPE_POLICY_WRITE_MODES>;
      paths?: string[];
      source: ScopePolicySource;
    };
    channels: {
      mode: KnownLiteral<typeof SCOPE_POLICY_CHANNEL_MODES>;
      allowedChannels: string[];
      blockedSources: string[];
      ignoredSources: string[];
      source: ScopePolicySource;
    };
    setup: {
      visibility: KnownLiteral<typeof SCOPE_POLICY_SETUP_VISIBILITIES>;
      source: ScopePolicySource;
    };
    ownerConfirmation: {
      localWrite: KnownLiteral<typeof SCOPE_POLICY_ACTION_POLICIES>;
      externalWrite: KnownLiteral<typeof SCOPE_POLICY_ACTION_POLICIES>;
      destructive: KnownLiteral<typeof SCOPE_POLICY_ACTION_POLICIES>;
      source: ScopePolicySource;
    };
    retention:
      | {
          mode: "retain";
          redaction: KnownLiteral<typeof SCOPE_POLICY_REDACTION_PROFILES>;
          source: ScopePolicySource;
        }
      | {
          mode: "expire-after-days";
          maxAgeDays: number;
          redaction: KnownLiteral<typeof SCOPE_POLICY_REDACTION_PROFILES>;
          source: ScopePolicySource;
        };
    modules: {
      defaultAvailability: KnownLiteral<typeof SCOPE_POLICY_MODULE_AVAILABILITIES>;
      overrides: Array<{
        moduleName: string;
        availability: KnownLiteral<typeof SCOPE_POLICY_MODULE_AVAILABILITIES>;
      }>;
      source: ScopePolicySource;
    };
    externalEffects: {
      networkRead: KnownLiteral<typeof SCOPE_POLICY_ACTION_POLICIES>;
      networkWrite: KnownLiteral<typeof SCOPE_POLICY_ACTION_POLICIES>;
      networkDestructive: KnownLiteral<typeof SCOPE_POLICY_ACTION_POLICIES>;
      source: ScopePolicySource;
    };
    explanations: Array<{
      area: KnownLiteral<typeof SCOPE_POLICY_AREAS>;
      scopeId: string;
      action: KnownLiteral<typeof SCOPE_POLICY_EXPLANATION_ACTIONS>;
      message: string;
    }>;
  };
  decisionExamples: ScopePolicyDecision[];
};
