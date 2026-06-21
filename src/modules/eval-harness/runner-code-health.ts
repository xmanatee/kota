
import {
  type CodeHealthDiagnostics,
  type CodeHealthMeasurement,
  evaluateCodeHealthRound,
  finalizeCodeHealthDiagnostics,
  measureCodeHealth,
} from "./code-health-diagnostics.js";
import type { LoadedFixture } from "./fixture.js";
import type { FixtureRunOutcome } from "./fixture-run.js";

export function codeHealthBaselineFor(
  workingDir: string,
  spec: LoadedFixture["spec"],
): CodeHealthMeasurement | undefined {
  if (spec.codeHealthDiagnostics === undefined) return undefined;
  return measureCodeHealth(workingDir, spec.codeHealthDiagnostics);
}

export function finalCodeHealthFor(params: {
  workingDir: string;
  spec: LoadedFixture["spec"];
  baseline: CodeHealthMeasurement | undefined;
  outcome: FixtureRunOutcome;
}): CodeHealthDiagnostics | undefined {
  if (
    params.spec.codeHealthDiagnostics === undefined ||
    params.baseline === undefined
  ) {
    return undefined;
  }
  const round = evaluateCodeHealthRound({
    config: params.spec.codeHealthDiagnostics,
    workingDir: params.workingDir,
    baseline: params.baseline,
    previous: params.baseline,
    roundId: "final",
    roundIndex: 0,
    outcome: params.outcome,
  });
  return finalizeCodeHealthDiagnostics({
    config: params.spec.codeHealthDiagnostics,
    baseline: params.baseline,
    rounds: [round],
  });
}
