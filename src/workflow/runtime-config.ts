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
   * Maximum number of workflows that may run simultaneously.
   * Different workflows can overlap up to this limit; the same workflow is
   * always serialised (at most one active instance per workflow name).
   * Defaults to 1 (no concurrency) so existing deployments are unaffected.
   */
  maxConcurrentRuns?: number;
  onLog?: (message: string) => void;
  workflows?: readonly RegisteredWorkflowDefinitionInput[];
};
