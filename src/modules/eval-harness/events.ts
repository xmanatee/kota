/**
 * Typed event declarations owned by the eval-harness module.
 *
 * Cross-module subscribers (telemetry exporters, regression notifiers) import
 * these declarations to get a typed handler. Workflow trigger validation
 * resolves filter field names against `fields` here.
 */

import { defineModuleEvent } from "#core/events/module-event.js";

export type EvalHarnessSetCompletedPayload = {
  fixtureCount: number;
  repeatCount: number;
  passAtK: number;
  passHatK: number;
  hostClass: string;
  runArtifactBaseDir: string;
  startedAt: string;
  completedAt: string;
};

/**
 * Eval-harness eval-set run completed. The aggregate score lives on this
 * event; the harness intentionally does not maintain a parallel metrics
 * store. Operators wire telemetry exporters to this event to publish
 * `pass@k` / `pass^k` trends.
 */
export const evalHarnessSetCompleted =
  defineModuleEvent<EvalHarnessSetCompletedPayload>(
    "eval-harness.set.completed",
    [
      "fixtureCount",
      "repeatCount",
      "passAtK",
      "passHatK",
      "hostClass",
      "runArtifactBaseDir",
      "startedAt",
      "completedAt",
    ],
  );
