/**
 * Public testing API — utilities for unit-testing KOTA workflow definitions.
 *
 * Import from "kota/testing" in your test files:
 *
 *   import { WorkflowTestHarness } from "kota/testing";
 *
 * These exports are stable; internal KOTA types are not part of this contract.
 *
 * ## Supported step types
 *
 * - `code` — executes the real `run` function via a mock WorkflowStepContext.
 * - `agent` — requires a mock in `HarnessOptions.stepMocks`; missing mock throws.
 * - `tool` — uses `stepMocks[id]` when present; falls back to `contextOverrides.runTool`.
 * - `emit` — calls context.emit; result recorded in `HarnessRunResult.emitted`.
 * - `restart` — calls context.requestRestart; recorded in `HarnessRunResult.restartRequested`.
 * - `trigger` — uses `stepMocks[id]` when present; falls back to `contextOverrides.triggerWorkflow`.
 * - `approval` — auto-approves by default; pass `{ approved: false, reason }` via `stepMocks[id]` to simulate rejection.
 * - `parallel` — runs child steps serially by default; concurrent when `HarnessOptions.parallel: true`.
 * - `branch` — evaluates the condition and runs the taken arm; skipped arm steps are recorded as skipped.
 * - `foreach` — resolves items, binds each item to `context.foreach[as]`, and runs inner steps per iteration.
 *   Inner code steps access the current item via `ctx.foreach.<asName>`. Respects `continueOnFailure`.
 *   Serial by default; concurrent when `HarnessOptions.parallel: true` and `step.maxConcurrency > 1`.
 *   Result output is `{ items: number, results: Array<{ index, status, steps }> }`.
 */


export type { ModuleHarnessOptions } from "../module-testing/index.js";
export { ModuleTestHarness } from "../module-testing/index.js";
export type {
  HarnessOptions,
  HarnessRunResult,
  HarnessStepResult,
  HarnessTrigger,
} from "./index.js";
export { WorkflowTestHarness } from "./index.js";
