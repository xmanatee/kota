import type { ResourceProfile } from "./fixture-run.js";
import type { EvalRunConfiguration } from "./run-configuration.js";
import type { AggregateScore } from "./scoring.js";

export const EVAL_HARNESS_CADENCE_BASELINE_STATE_KEY =
  "eval-harness/cadence-baseline";

export type PersistedBaseline = {
  aggregate: AggregateScore;
  resourceProfile: ResourceProfile;
  runConfiguration: EvalRunConfiguration;
  /** ISO timestamp of the cadence run that recorded this baseline. */
  recordedAt: string;
  /** Absolute path to the run-artifact directory that produced it. */
  runArtifactBaseDir: string;
};
