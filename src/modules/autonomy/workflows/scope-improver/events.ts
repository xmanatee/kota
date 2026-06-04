import { defineProjectScopedModuleEvent } from "#core/events/project-scope.js";

export type ScopeImprovementRequest = {
  reason?: string;
  requestedBy?: string;
  windowMs?: number;
};

export const scopeImprovementRequested =
  defineProjectScopedModuleEvent<ScopeImprovementRequest>(
    "autonomy.scope-improvement.requested",
    ["reason", "requestedBy", "windowMs"],
  );
