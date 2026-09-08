/**
 * Public behavior-scenario API for workflow contributors.
 *
 * Scenarios use production validation, execution, lifecycle and integration.
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
