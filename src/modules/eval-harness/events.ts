/**
 * Typed event declarations owned by the eval-harness module.
 *
 * Cross-module subscribers (telemetry exporters, regression notifiers) import
 * these declarations to get a typed handler. Workflow trigger validation
 * resolves filter field names against `fields` here.
 */

import { defineProjectScopedModuleEvent } from "#core/events/project-scope.js";
import type { EvalRunConfigurationSummary } from "./run-configuration.js";
import type { FixtureDiagnosticAggregate } from "./scoring.js";

export type EvalHarnessSetCompletedPayload = {
  fixtureCount: number;
  repeatCount: number;
  passAtK: number;
  passHatK: number;
  fixtureDiagnostics: FixtureDiagnosticAggregate;
  hostClass: string;
  runArtifactBaseDir: string;
  runConfigurationFingerprint: string;
  runConfigurationSummary: EvalRunConfigurationSummary;
  startedAt: string;
  completedAt: string;
};

/**
 * Eval-harness eval-set run completed. The aggregate score lives on this
 * event; the harness intentionally does not maintain a parallel metrics
 * store. Operators wire telemetry exporters to this event to publish
 * `pass@k` / `pass^k` trends.
 *
 * Project-scoped: each eval run belongs to exactly one directory scope, so
 * subscribers can filter aggregate telemetry per scope. The helper prepends
 * canonical `scopeId` and compatibility `projectId` to the declared field set;
 * emitters route through a {@link ProjectScopedEventBus}, which injects both.
 */
export const evalHarnessSetCompleted =
  defineProjectScopedModuleEvent<EvalHarnessSetCompletedPayload>(
    "eval-harness.set.completed",
    [
      "fixtureCount",
      "repeatCount",
      "passAtK",
      "passHatK",
      "fixtureDiagnostics",
      "hostClass",
      "runArtifactBaseDir",
      "runConfigurationFingerprint",
      "runConfigurationSummary",
      "startedAt",
      "completedAt",
    ],
  );
