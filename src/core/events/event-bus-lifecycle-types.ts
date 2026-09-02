import type { ScopeId } from "./scope.js";

export type GuardrailsNonRefreshableSession = {
  id: string;
  source: "serve";
  reason: "serve-owned-session";
};

export type SessionGuardrailsReloadSummary = {
  refreshed: number;
  unchanged: number;
  nonRefreshable: GuardrailsNonRefreshableSession[];
};

export type DaemonConfigReloadEvent =
  | {
      timestamp: string;
      scope: "daemon";
      outcome: "success";
      reloadKind: "full" | "module-scoped" | "noop";
      fullReload: boolean;
      changedModules: string[];
      workflowCount: number;
      sessionGuardrails: SessionGuardrailsReloadSummary;
    }
  | {
      timestamp: string;
      scope: "daemon";
      outcome: "failure";
      reloadKind: "failed";
      fullReload: false;
      changedModules: [];
      workflowCount: number;
      errorClass: string;
      errorMessage: string;
    };

export type ScopeLifecycleBlockerKind =
  | "default_scope"
  | "active_run"
  | "session"
  | "pending_approval"
  | "pending_work"
  | "resource_lease"
  | "inspection_failure";

type ScopeLifecycleTransition =
  | "registered"
  | "onboarding-completed"
  | "display-name-updated"
  | "default-changed"
  | "draining"
  | "drain-blocked"
  | "drained"
  | "removed";

type ScopeLifecycleEventIdentity =
  | {
      transition: "onboarding-completed";
      idempotencyKey: string;
    }
  | {
      transition: Exclude<ScopeLifecycleTransition, "onboarding-completed">;
      idempotencyKey?: never;
    };

export type ScopeLifecycleEvent = ScopeLifecycleEventIdentity & {
  affectedScopeId: ScopeId;
  directoryRoot: string;
  displayName: string;
  previousDefaultScopeId?: ScopeId;
  blockerKinds?: ScopeLifecycleBlockerKind[];
};
