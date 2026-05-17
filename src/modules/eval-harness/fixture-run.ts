/**
 * Fixture-run contract for the autonomy eval harness.
 *
 * Every harness fixture produces one or more FixtureRun records. The shape is
 * deliberately opinionated: every run records its resource profile, its index
 * within the repeat set, and a timing envelope so that later scoring can
 * distinguish real regressions from host drift.
 */

/**
 * Container resource configuration observed for a single fixture run.
 *
 * `*Allocation` is the guaranteed resource floor (e.g. Docker cpuset / memory
 * reservation). `*KillThreshold` is the hard ceiling that would terminate the
 * run (e.g. cgroup hard cap). They are kept as separate fields on purpose:
 * the Anthropic Mar 2026 infrastructure-noise post shows that collapsing them
 * to a single cap can swing a score by more than a model-level gap.
 */
export type ResourceProfile = {
  cpuAllocationCores: number;
  cpuKillThresholdCores: number;
  memoryAllocationMB: number;
  memoryKillThresholdMB: number;
  /**
   * Free-form host class label (e.g. "laptop-m3", "ci-standard-4x16") that
   * operators use to partition runs before comparing scores.
   */
  hostClass: string;
};

export type TimingEnvelope = {
  /** ISO 8601 timestamp when the run started. */
  startedAt: string;
  /** Observed wall-clock duration of the run in milliseconds. */
  durationMs: number;
  /** Explicit budget for this run in milliseconds (the planned kill deadline). */
  budgetMs: number;
};

export type FixtureRunOutcome =
  | "pass"
  | "fail"
  | "timeout"
  | "error"
  | "configuration-error";

export type FixtureRun = {
  fixtureId: string;
  /** 0-based index of this run within a repeat set for the same fixture. */
  runIndex: number;
  /** Total number of runs planned for this fixture in this repeat set. */
  repeatCount: number;
  outcome: FixtureRunOutcome;
  resourceProfile: ResourceProfile;
  timing: TimingEnvelope;
  /** Absolute path to the run artifact directory under `.kota/runs/`. */
  runArtifactPath: string;
};

/**
 * Two resource profiles are comparable when they share the same host class
 * and their allocation and kill-threshold values match. Fixture scores from
 * non-comparable profiles must not be diffed directly — the Mar 2026 post
 * documents >3pp swings from config drift alone.
 */
export function resourceProfilesComparable(
  a: ResourceProfile,
  b: ResourceProfile,
): boolean {
  return (
    a.hostClass === b.hostClass &&
    a.cpuAllocationCores === b.cpuAllocationCores &&
    a.cpuKillThresholdCores === b.cpuKillThresholdCores &&
    a.memoryAllocationMB === b.memoryAllocationMB &&
    a.memoryKillThresholdMB === b.memoryKillThresholdMB
  );
}
