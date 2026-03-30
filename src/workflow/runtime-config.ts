import type { KotaConfig } from "../config.js";
import type { EventBus } from "../event-bus.js";
import type { RegisteredWorkflowDefinitionInput } from "./types.js";

export type WorkflowRuntimeConfig = {
  bus: EventBus;
  projectDir?: string;
  model?: string;
  verbose?: boolean;
  config?: KotaConfig;
  idleIntervalMs?: number;
  /**
   * Maximum number of agent-step workflows that may run simultaneously.
   * Defaults to 1 so the default experience is serialized agent runs.
   */
  agentConcurrency?: number;
  /**
   * Maximum number of code-only (no agent step) workflows that may run
   * simultaneously. Code-only workflows run independently of agent-step
   * workflows and each other up to this cap. Defaults to 4.
   */
  codeConcurrency?: number;
  onLog?: (message: string) => void;
  workflows?: readonly RegisteredWorkflowDefinitionInput[];
};
