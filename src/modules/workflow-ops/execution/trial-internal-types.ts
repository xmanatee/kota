import type { KotaConfig } from "#core/config/config.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { ToolEffect } from "#core/tools/effect.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import type {
  WorkflowTrialAttemptReport,
  WorkflowTrialOptions,
  WorkflowTrialPayload,
} from "../client.js";

export type FileSnapshot = Map<string, string>;

export type WorkflowTrialRuntime = {
  config: KotaConfig;
  eventBus?: EventBus;
  workflows: RegisteredWorkflowDefinitionInput[];
  resolveAgentDef?: ModuleContext["resolveAgentDef"];
  resolveSkillsPrompt?: ModuleContext["resolveSkillsPrompt"];
  unload?: () => Promise<void>;
};

export type WorkflowTrialRuntimeFactory = (
  trialWorkspaceRoot: string,
  sourceScopeRoot?: string,
) => Promise<WorkflowTrialRuntime>;

export type RunWorkflowTrialArgs = {
  sourceScopeRoot: string;
  workflowName: string;
  options?: WorkflowTrialOptions;
  runtimeFactory: WorkflowTrialRuntimeFactory;
};

export type TrialVariant = {
  label: string;
  workflow: string;
  payload: WorkflowTrialPayload;
};

export type QueuedWorkflowReport = WorkflowTrialAttemptReport["queuedWorkflows"][number];
export type WorkflowRuntimePayload = WorkflowRunTrigger["payload"];
export type TrialScopeResolution =
  | { ok: true; sourceScopeRoot: string; scopeId: string }
  | { ok: false; scopeId: string; message: string };
export type TrialResolvedToolEffect = {
  effect: ToolEffect;
  manifest?: {
    moduleName: string;
    effectId: string;
    categories: readonly string[];
    capabilityIds: readonly string[];
  };
};

export class WorkflowTrialRequestError extends Error {
  constructor(
    message: string,
    readonly reason: "invalid_request" | "unknown_workflow",
  ) {
    super(message);
  }
}
