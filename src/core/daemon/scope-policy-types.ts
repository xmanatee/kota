import type { ScopeId } from "#core/events/project-scope.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { ToolEffectKind, ToolEffectScope } from "#core/tools/effect.js";

export class ScopePolicyValidationError extends Error {
  constructor(
    message: string,
    readonly conflict?: {
      kind: "parent-widening";
      scopeId: ScopeId;
      parentScopeId: ScopeId;
      area: ScopePolicyArea;
    },
  ) {
    super(message);
    this.name = "ScopePolicyValidationError";
  }
}

export type ScopePolicyArea =
  | "autonomy"
  | "writes"
  | "channels"
  | "setup"
  | "ownerConfirmation"
  | "retention"
  | "modules"
  | "externalEffects";

export type ScopeActionPolicy = "allow" | "confirm" | "deny";
export type ScopePolicyDecisionOutcome = ScopeActionPolicy | "ignore";
export type ScopeModuleAvailability = "enabled" | "setup-required" | "disabled";
export type ScopeSetupVisibility = "hidden" | "metadata" | "full";
export type ScopeRedactionProfile = "full" | "sensitive-fields" | "none";

export type ScopeWriteBoundary =
  | { mode: "none" }
  | { mode: "scope-directory" }
  | { mode: "paths"; paths: readonly string[] }
  | { mode: "unrestricted" };

export type ScopeChannelRoutingPolicy = {
  mode: "blocked" | "allow-list" | "allow-all";
  allowedChannels: readonly string[];
  blockedSources: readonly string[];
  ignoredSources: readonly string[];
};

export type ScopeRetentionPolicy =
  | { mode: "retain"; redaction: ScopeRedactionProfile }
  | { mode: "expire-after-days"; maxAgeDays: number; redaction: ScopeRedactionProfile };

export type ScopeAutonomyPolicy = {
  defaultMode: AutonomyMode;
  maxMode: AutonomyMode;
};

export type ScopeOwnerConfirmationPolicy = {
  localWrite: ScopeActionPolicy;
  externalWrite: ScopeActionPolicy;
  destructive: ScopeActionPolicy;
};

export type ScopeExternalEffectPolicy = {
  networkRead: ScopeActionPolicy;
  networkWrite: ScopeActionPolicy;
  networkDestructive: ScopeActionPolicy;
};

export type ScopeModulePolicyOverride = {
  moduleName: string;
  availability: ScopeModuleAvailability;
};

export type ScopeModulePolicy = {
  defaultAvailability: ScopeModuleAvailability;
  overrides: readonly ScopeModulePolicyOverride[];
};

export type ScopePolicySource = {
  scopeId: ScopeId;
  reason: string;
};

export type ScopePolicyExplanation = {
  area: ScopePolicyArea;
  scopeId: ScopeId;
  action: "set" | "override" | "inherit";
  message: string;
};

export type ResolvedScopePolicy = {
  scopeId: ScopeId;
  lineage: readonly ScopeId[];
  directoryRoot?: string;
  autonomy: ScopeAutonomyPolicy & { source: ScopePolicySource };
  writes: ScopeWriteBoundary & { source: ScopePolicySource };
  channels: ScopeChannelRoutingPolicy & { source: ScopePolicySource };
  setup: { visibility: ScopeSetupVisibility; source: ScopePolicySource };
  ownerConfirmation: ScopeOwnerConfirmationPolicy & { source: ScopePolicySource };
  retention: ScopeRetentionPolicy & { source: ScopePolicySource };
  modules: ScopeModulePolicy & { source: ScopePolicySource };
  externalEffects: ScopeExternalEffectPolicy & { source: ScopePolicySource };
  explanations: readonly ScopePolicyExplanation[];
};

export type ScopeAutonomyPolicyFragment = Partial<ScopeAutonomyPolicy>;
export type ScopeChannelRoutingPolicyFragment = Partial<ScopeChannelRoutingPolicy>;
export type ScopeOwnerConfirmationPolicyFragment = Partial<ScopeOwnerConfirmationPolicy>;
export type ScopeExternalEffectPolicyFragment = Partial<ScopeExternalEffectPolicy>;
export type ScopeModulePolicyFragment = {
  defaultAvailability?: ScopeModuleAvailability;
  overrides?: readonly ScopeModulePolicyOverride[];
};

export type ScopePolicyFragment = {
  scopeId: ScopeId;
  reason: string;
  allowChildWidening?: readonly ScopePolicyArea[];
  autonomy?: ScopeAutonomyPolicyFragment;
  writes?: ScopeWriteBoundary;
  channels?: ScopeChannelRoutingPolicyFragment;
  setup?: { visibility?: ScopeSetupVisibility };
  ownerConfirmation?: ScopeOwnerConfirmationPolicyFragment;
  retention?: ScopeRetentionPolicy;
  modules?: ScopeModulePolicyFragment;
  externalEffects?: ScopeExternalEffectPolicyFragment;
};

export type ScopePolicyToolEffectQuery =
  | {
      kind: "tool-effect";
      toolName: string;
      effectKind: Exclude<ToolEffectKind, "write" | "destructive">;
      effectScope: ToolEffectScope;
    }
  | {
      kind: "tool-effect";
      toolName: string;
      effectKind: "write" | "destructive";
      effectScope: Exclude<ToolEffectScope, "local-fs">;
    }
  | {
      kind: "tool-effect";
      toolName: string;
      effectKind: "write" | "destructive";
      effectScope: "local-fs";
      /**
       * The complete filesystem target for path-bound tools. Opaque execution
       * tools leave this absent because a cwd does not bound paths referenced
       * by arbitrary code or shell commands.
       */
      targetPath?: string;
    };

export type ScopePolicyDecisionQuery =
  | {
      kind: "channel-route";
      channel: string;
      source: string;
    }
  | ScopePolicyToolEffectQuery;

export type ScopePolicyDecision = {
  kind: ScopePolicyDecisionQuery["kind"];
  target: string;
  outcome: ScopePolicyDecisionOutcome;
  source: ScopePolicySource;
  reason: string;
  rendered: string;
};

export type ScopePolicyRouteResponse = {
  policy: ResolvedScopePolicy;
  decisionExamples: readonly ScopePolicyDecision[];
};
