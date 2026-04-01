/**
 * Public testing API — utilities for unit-testing KOTA workflow definitions.
 *
 * Import from "kota/testing" in your test files:
 *
 *   import { WorkflowTestHarness } from "kota/testing";
 *
 * These exports are stable; internal KOTA types are not part of this contract.
 */

export type {
  HarnessOptions,
  HarnessRunResult,
  HarnessStepResult,
  HarnessTrigger,
} from "./index.js";
export { WorkflowTestHarness } from "./index.js";
