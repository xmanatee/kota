import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PersistedBaseline } from "./baseline-state.js";
import {
  buildEvalComponentAttribution,
  type EvalComponentAttribution,
  type EvalFixtureRunAttributionEvidence,
} from "./eval-attribution.js";
import {
  codeHealth,
  componentAttribution,
  evidence as defaultEvidence,
  diagnosticsReport,
  fixtureRun,
  runConfiguration,
} from "./eval-attribution-test-data.js";
import type {
  ExecutionProfilePreflightResult,
  ResourceProfile,
} from "./fixture-run.js";
import type { EvalRunConfiguration } from "./run-configuration.js";
import type { FixtureDiagnosticsReport } from "./scoring.js";

export function writePriorReport(
  priorDir: string,
  params: {
    config?: EvalRunConfiguration;
    profile?: ResourceProfile;
    execution?: ExecutionProfilePreflightResult;
    diagnostics?: FixtureDiagnosticsReport;
    attribution?: EvalComponentAttribution;
  } = {},
): PersistedBaseline {
  const config = params.config ?? runConfiguration();
  const report = {
    perFixture: [
      {
        fixtureId: "alpha",
        repeatCount: 3,
        passedAny: true,
        passedAll: true,
        observedPassRate: 1,
      },
    ],
    fixtureDiagnostics: params.diagnostics ?? diagnosticsReport(),
    objectiveMetrics: [],
    codeHealth: codeHealth(),
    runConfiguration: config,
    resourceProfile: params.profile ?? config.components.resourceProfile,
    executionProfile: params.execution ?? config.components.executionProfile,
    componentAttribution:
      params.attribution ?? componentAttribution(priorDir),
  };
  mkdirSync(priorDir, { recursive: true });
  writeFileSync(
    join(priorDir, "eval-set-report.json"),
    JSON.stringify(report, null, 2),
  );
  return {
    aggregate: {
      fixtureCount: 1,
      repeatCount: 3,
      passAtK: 1,
      passHatK: 1,
    },
    resourceProfile: report.resourceProfile,
    runConfiguration: config,
    recordedAt: "2026-04-20T12:00:00.000Z",
    runArtifactBaseDir: priorDir,
  };
}

export function buildAttribution(
  candidateDir: string,
  params: {
    prior?: PersistedBaseline | null;
    config?: EvalRunConfiguration;
    profile?: ResourceProfile;
    execution?: ExecutionProfilePreflightResult;
    diagnostics?: FixtureDiagnosticsReport;
    evidence?: readonly EvalFixtureRunAttributionEvidence[];
  } = {},
) {
  const config = params.config ?? runConfiguration();
  const execution = params.execution ?? config.components.executionProfile;
  return buildEvalComponentAttribution({
    priorBaseline: params.prior ?? null,
    runs: [fixtureRun(config)],
    perFixture: [
      {
        fixtureId: "alpha",
        repeatCount: 3,
        passedAny: true,
        passedAll: true,
        observedPassRate: 1,
      },
    ],
    fixtureDiagnostics: params.diagnostics ?? diagnosticsReport(),
    objectiveMetrics: [],
    codeHealth: codeHealth(),
    runConfiguration: config,
    resourceProfile: params.profile ?? config.components.resourceProfile,
    executionProfile: execution,
    repeatCount: 3,
    runArtifactBaseDir: candidateDir,
    runArtifactEvidence: params.evidence ?? [defaultEvidence()],
  });
}
