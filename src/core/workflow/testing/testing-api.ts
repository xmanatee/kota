/**
 * Public behavior-scenario API for workflow contributors.
 *
 * Scenarios pass definitions through the production validator and executor.
 * Tests may replace only declared host ports and provide adapter outputs;
 * branching, retries, concurrency, persistence, and recovery remain owned by
 * production runtime code.
 */
export type {
  WorkflowScenarioOptions,
  WorkflowScenarioResult,
  WorkflowScenarioStepResult,
  WorkflowScenarioTrigger,
} from "./index.js";
export { WorkflowScenarioDriver } from "./index.js";
