
import type { FixtureRun } from "./fixture-run.js";
import { MIN_REPEAT_COUNT_FOR_GATING } from "./noise-band.js";
import { emptyOutcomeCounts, groupCompleteFixtureRuns } from "./scoring-groups.js";
import type {
  FixtureDiagnosticAggregate,
  FixtureDiagnosticClass,
  FixtureDiagnostics,
  FixtureDiagnosticsReport,
  FixtureDiagnosticWarning,
} from "./scoring-types.js";

export function diagnosticsPerFixture(
  runs: readonly FixtureRun[],
): FixtureDiagnostics[] {
  const diagnostics: FixtureDiagnostics[] = [];
  for (const group of groupCompleteFixtureRuns(runs)) {
    const outcomeCounts = emptyOutcomeCounts();
    const outcomes = group.runs.map((run) => {
      outcomeCounts[run.outcome] += 1;
      return run.outcome;
    });
    const passes = outcomeCounts.pass;
    const observedPassRate = passes / group.repeatCount;
    const repeatVariance =
      group.runs.reduce((sum, run) => {
        const value = run.outcome === "pass" ? 1 : 0;
        return sum + (value - observedPassRate) ** 2;
      }, 0) / group.repeatCount;
    const warnings: FixtureDiagnosticWarning[] = [];
    const diagnosticClass: FixtureDiagnosticClass =
      group.repeatCount < MIN_REPEAT_COUNT_FOR_GATING
        ? "insufficient-sample"
        : passes === group.repeatCount
          ? "stable-pass"
          : passes === 0
            ? "stable-fail"
            : "repeat-unstable";

    if (diagnosticClass === "insufficient-sample") {
      warnings.push("insufficient-sample");
    }
    if (diagnosticClass === "repeat-unstable") {
      warnings.push("low-signal-repeat-instability");
    }
    if (group.runs.some((run) => !run.executionProfile.gateEligible)) {
      warnings.push("non-gating-execution-profile");
    }

    diagnostics.push({
      fixtureId: group.fixtureId,
      repeatCount: group.repeatCount,
      outcomes,
      outcomeCounts,
      observedPassRate,
      repeatVariance,
      diagnosticClass,
      warnings,
    });
  }
  return diagnostics;
}

export function aggregateFixtureDiagnostics(
  diagnostics: readonly FixtureDiagnostics[],
): FixtureDiagnosticAggregate {
  const aggregate: FixtureDiagnosticAggregate = {
    fixtureCount: diagnostics.length,
    stablePass: 0,
    stableFail: 0,
    repeatUnstable: 0,
    insufficientSample: 0,
    nonGating: 0,
    lowSignalWarnings: 0,
  };
  for (const diagnostic of diagnostics) {
    if (diagnostic.diagnosticClass === "stable-pass") {
      aggregate.stablePass += 1;
    } else if (diagnostic.diagnosticClass === "stable-fail") {
      aggregate.stableFail += 1;
    } else if (diagnostic.diagnosticClass === "repeat-unstable") {
      aggregate.repeatUnstable += 1;
    } else {
      aggregate.insufficientSample += 1;
    }
    if (diagnostic.warnings.includes("non-gating-execution-profile")) {
      aggregate.nonGating += 1;
    }
    if (diagnostic.warnings.includes("low-signal-repeat-instability")) {
      aggregate.lowSignalWarnings += 1;
    }
  }
  return aggregate;
}

export function computeFixtureDiagnostics(
  runs: readonly FixtureRun[],
): FixtureDiagnosticsReport {
  const perFixture = diagnosticsPerFixture(runs);
  return {
    perFixture,
    aggregate: aggregateFixtureDiagnostics(perFixture),
  };
}
