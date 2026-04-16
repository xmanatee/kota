/**
 * Workflow graph data types — reusable by CLI, HTTP API, and client apps.
 *
 * These types describe the assembled workflow/trigger/event topology without
 * coupling to any particular rendering format.
 */

export type TriggerSummary = {
  event: string;
  filter?: string;
  schedule?: string;
  intervalMs?: number;
  watch?: string[];
  cooldownMs?: number;
  webhook?: boolean;
};

export type StepSummary = {
  id: string;
  type: "tool" | "agent" | "emit" | "restart" | "code" | "trigger" | "parallel" | "branch" | "foreach" | "approval";
  agentName?: string;
  model?: string;
  tool?: string;
  event?: string;
  targetWorkflow?: string;
  hasCondition: boolean;
  children?: StepSummary[];
};

export type WorkflowNode = {
  name: string;
  description?: string;
  enabled: boolean;
  tags: readonly string[];
  dailyBudgetUsd?: number;
  costLimitUsd?: number;
  concurrencyGroup?: string;
  triggers: TriggerSummary[];
  steps: StepSummary[];
  /** Event names this workflow listens to (derived from triggers). */
  listensTo: { event: string; filter?: string }[];
  /** Event names this workflow emits (derived from emit steps). */
  emits: string[];
  /** Workflow names this workflow triggers directly (derived from trigger steps). */
  directTriggers: string[];
  /** Agent names used by this workflow's agent steps. */
  agents: string[];
};

export type EventNode = {
  name: string;
  producers: string[];
  consumers: string[];
};

export type WorkflowGraph = {
  workflows: WorkflowNode[];
  events: EventNode[];
  /** All distinct agent names referenced across workflows. */
  agents: string[];
};
