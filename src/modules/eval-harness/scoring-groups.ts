
import type { FixtureRun } from "./fixture-run.js";
import type { FixtureOutcomeCounts } from "./scoring-types.js";

export class FixtureConfigurationScoringError extends Error {
  readonly fixtureId: string;
  readonly runIndex: number;

  constructor(run: FixtureRun) {
    super(
      `Fixture "${run.fixtureId}" runIndex ${run.runIndex} ended with configuration-error${
        run.configurationError !== undefined ? `: ${run.configurationError.detail}` : ""
      }; fix the fixture before computing pass@k/pass^k.`,
    );
    this.name = "FixtureConfigurationScoringError";
    this.fixtureId = run.fixtureId;
    this.runIndex = run.runIndex;
  }
}

type FixtureRunGroup = {
  fixtureId: string;
  repeatCount: number;
  runs: FixtureRun[];
};

export function emptyOutcomeCounts(): FixtureOutcomeCounts {
  return {
    pass: 0,
    fail: 0,
    timeout: 0,
    error: 0,
    "configuration-error": 0,
  };
}

/**
 * Group runs by fixtureId and validate complete repeat sets. A partial set
 * fails loudly rather than scoring or diagnosing a half-run as a flaky pass.
 */
export function groupCompleteFixtureRuns(
  runs: readonly FixtureRun[],
): FixtureRunGroup[] {
  if (runs.length === 0) return [];
  const grouped = new Map<string, FixtureRun[]>();
  for (const run of runs) {
    if (run.outcome === "configuration-error") {
      throw new FixtureConfigurationScoringError(run);
    }
    const bucket = grouped.get(run.fixtureId);
    if (bucket) {
      bucket.push(run);
    } else {
      grouped.set(run.fixtureId, [run]);
    }
  }

  const groups: FixtureRunGroup[] = [];
  for (const [fixtureId, bucket] of grouped) {
    const repeatCount = bucket[0].repeatCount;
    if (bucket.length !== repeatCount) {
      throw new Error(
        `Fixture "${fixtureId}" has ${bucket.length} runs but repeatCount=${repeatCount}; expected a complete repeat set.`,
      );
    }
    const seenIndices = new Set<number>();
    for (const run of bucket) {
      if (run.repeatCount !== repeatCount) {
        throw new Error(
          `Fixture "${fixtureId}" has mixed repeatCount values (${run.repeatCount} vs ${repeatCount}).`,
        );
      }
      if (run.runIndex < 0 || run.runIndex >= repeatCount) {
        throw new Error(
          `Fixture "${fixtureId}" runIndex ${run.runIndex} outside [0, ${repeatCount}).`,
        );
      }
      if (seenIndices.has(run.runIndex)) {
        throw new Error(
          `Fixture "${fixtureId}" has duplicate runIndex ${run.runIndex}.`,
        );
      }
      seenIndices.add(run.runIndex);
    }

    groups.push({
      fixtureId,
      repeatCount,
      runs: [...bucket].sort((a, b) => a.runIndex - b.runIndex),
    });
  }

  return groups;
}
