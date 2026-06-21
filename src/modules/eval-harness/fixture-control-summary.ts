
import type { FixtureControlDecisionCounts, FixtureControlDecisionCoverageSummary } from "./fixture-common-types.js";
import { FIXTURE_CONTROL_DECISIONS } from "./fixture-common-types.js";
import type { LoadedFixture } from "./fixture-spec-types.js";

function emptyControlDecisionCounts(): FixtureControlDecisionCounts {
  return {
    act: 0,
    ask: 0,
    refuse: 0,
    stop: 0,
    confirm: 0,
    recover: 0,
  };
}

export function summarizeControlDecisionCoverage(
  fixtures: readonly LoadedFixture[],
): FixtureControlDecisionCoverageSummary {
  const counts = emptyControlDecisionCounts();
  for (const fixture of fixtures) {
    for (const decision of fixture.spec.controlDecisions) {
      counts[decision] += 1;
    }
  }
  const missingDecisions = FIXTURE_CONTROL_DECISIONS.filter(
    (decision) => counts[decision] === 0,
  );
  return {
    counts,
    missingDecisions,
    missingDecisionWarnings: missingDecisions.map((decision) => ({
      decision,
      message: `No eval fixture declares control decision "${decision}".`,
    })),
  };
}
