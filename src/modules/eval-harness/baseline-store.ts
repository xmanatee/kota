/**
 * Persistent accepted-baseline store for the eval-harness cadence.
 *
 * The weekly cadence workflow materializes this file the first time it runs
 * and rolls it forward on every subsequent `not-gated` decision. On a
 * `gated` decision the prior baseline is held so the next cadence still has
 * a meaningful comparison point until the regression is acknowledged.
 *
 * The baseline lives under `.kota/` (one KOTA state root per project) and is
 * intentionally never committed — it is runtime state scoped to one
 * deployment's host class and calibration, not shared repo truth.
 */

import { join } from "node:path";
import {
  readOptionalJsonFile,
  writeJsonFileAtomic,
} from "#core/util/json-file.js";
import type { ResourceProfile } from "./fixture-run.js";
import type { EvalRunConfiguration } from "./run-configuration.js";
import type { AggregateScore } from "./scoring.js";

export type PersistedBaseline = {
  aggregate: AggregateScore;
  resourceProfile: ResourceProfile;
  runConfiguration: EvalRunConfiguration;
  /** ISO timestamp of the cadence run that recorded this baseline. */
  recordedAt: string;
  /** Absolute path to the run-artifact directory that produced it. */
  runArtifactBaseDir: string;
};

const BASELINE_RELATIVE_PATH = ".kota/eval-harness/baseline.json";

export function baselineFilePath(projectDir: string): string {
  return join(projectDir, BASELINE_RELATIVE_PATH);
}

export function loadBaseline(projectDir: string): PersistedBaseline | null {
  return readOptionalJsonFile<PersistedBaseline>(baselineFilePath(projectDir));
}

export function saveBaseline(
  projectDir: string,
  baseline: PersistedBaseline,
): void {
  writeJsonFileAtomic(baselineFilePath(projectDir), baseline);
}
