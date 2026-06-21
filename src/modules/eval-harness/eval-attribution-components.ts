import type { PersistedBaseline } from "./baseline-store.js";
import type { CodeHealthAggregate } from "./code-health-diagnostics.js";
import {
  component,
  componentStatus,
  evidenceChanged,
  executionModeEvidence,
  fixtureManifestChanged,
  networkPolicyEvidence,
  promptSkillFacts,
  tierEvidence,
  timeoutEnvelopeEvidence,
} from "./eval-attribution-component-helpers.js";
import type {
  EvalAttributionBaselineStatus,
  EvalAttributionComponentEntry,
  EvalAttributionComponentId,
  EvalAttributionDiagnosticSummary,
  EvalFixtureArtifactEvidenceSummary,
  PriorEvalSetReport,
} from "./eval-attribution-types.js";
import { sameStructuredValue, uniqueSorted } from "./eval-attribution-util.js";
import type {
  ExecutionProfilePreflightResult,
  FixtureRun,
  ResourceProfile,
} from "./fixture-run.js";
import { resourceProfilesComparable } from "./fixture-run.js";
import type { AggregateObjectiveMetric } from "./objective-metrics.js";
import type { EvalRunConfiguration } from "./run-configuration.js";

export function buildComponents(params: {
  priorReport: PriorEvalSetReport | null;
  priorBaseline: PersistedBaseline | null;
  currentRuns: readonly FixtureRun[];
  currentRunConfiguration: EvalRunConfiguration;
  currentResourceProfile: ResourceProfile;
  currentExecutionProfile: ExecutionProfilePreflightResult;
  currentMetrics: readonly AggregateObjectiveMetric[];
  currentCodeHealth: CodeHealthAggregate;
  artifactSummaries: readonly EvalFixtureArtifactEvidenceSummary[];
  diagnostics: {
    verifierCalibration: EvalAttributionDiagnosticSummary;
    trajectoryDiagnostics: EvalAttributionDiagnosticSummary;
    contextRetrievalDiagnostics: EvalAttributionDiagnosticSummary;
  };
}): readonly EvalAttributionComponentEntry[] {
  const hasBaseline = params.priorBaseline !== null;
  const priorConfig =
    params.priorReport?.runConfiguration ?? params.priorBaseline?.runConfiguration;
  const currentModelEvidence =
    params.currentRunConfiguration.components.resolvedHarnessModelEvidence;
  const modelCurrentIssue =
    currentModelEvidence.status === "missing" ||
    currentModelEvidence.status === "mixed"
      ? "missing"
      : null;
  const modelChanged =
    priorConfig !== undefined &&
    (!sameStructuredValue(
      priorConfig.components.activePreset,
      params.currentRunConfiguration.components.activePreset,
    ) ||
      !sameStructuredValue(
        priorConfig.components.resolvedHarnessModelEvidence,
        currentModelEvidence,
      ));
  const harnessCurrentIssue =
    params.currentExecutionProfile.backendKind === "missing-isolation-backend" ||
    !params.currentExecutionProfile.gateEligible
      ? "unsupported"
      : null;
  const harnessChanged =
    priorConfig !== undefined &&
    (!sameStructuredValue(
      priorConfig.components.activePreset.harness === undefined
        ? { harness: "" }
        : { harness: priorConfig.components.activePreset.harness },
      { harness: params.currentRunConfiguration.components.activePreset.harness },
    ) ||
      !sameStructuredValue(
        priorConfig.components.executionProfile,
        params.currentRunConfiguration.components.executionProfile,
      ));
  const promptFacts = promptSkillFacts(params.currentRuns);
  const priorPromptDiagnostics =
    params.priorReport?.componentAttribution?.diagnostics.contextRetrievalDiagnostics;
  const promptDiagnosticDelta = evidenceChanged(
    priorPromptDiagnostics,
    params.diagnostics.contextRetrievalDiagnostics,
  );
  const priorVerifier =
    params.priorReport?.componentAttribution?.diagnostics.verifierCalibration;
  const verifierDiagnosticDelta =
    evidenceChanged(priorVerifier, params.diagnostics.verifierCalibration) ||
    (params.priorReport !== null &&
      !sameStructuredValue(params.priorReport.codeHealth, params.currentCodeHealth)) ||
    (params.priorReport !== null &&
      !sameStructuredValue(
        { names: params.priorReport.objectiveMetrics.map((metric) => metric.name).sort() },
        { names: params.currentMetrics.map((metric) => metric.name).sort() },
      ));
  const environmentDiagnosticDelta =
    params.priorReport !== null &&
    params.priorReport.executionProfile.diagnostics.length !==
      params.currentExecutionProfile.diagnostics.length;
  const priorTrajectory =
    params.priorReport?.componentAttribution?.diagnostics.trajectoryDiagnostics;
  const feedbackDiagnosticDelta =
    evidenceChanged(priorTrajectory, params.diagnostics.trajectoryDiagnostics) ||
    params.artifactSummaries.some((summary) => summary.failedPredicateCount > 0);
  const predicateKinds = uniqueSorted(
    params.artifactSummaries.flatMap((summary) => summary.predicateKinds),
  );
  const feedbackMissing =
    params.artifactSummaries.length === 0 ||
    params.currentRunConfiguration.components.resolvedHarnessModelEvidence.status ===
      "missing";

  return [
    component(
      "model-preset",
      componentStatus(hasBaseline, modelCurrentIssue, modelChanged),
      modelChanged
        ? "model, preset, or resolved harness/model evidence changed"
        : "model and preset evidence is recorded",
      [
        `activePreset=${params.currentRunConfiguration.summary.activePreset}`,
        `tierEvidence=${tierEvidence(
          params.currentRunConfiguration.components.activePreset,
        )}`,
        `resolvedHarnessModel=${params.currentRunConfiguration.summary.resolvedHarnessModelEvidence}`,
      ],
      modelChanged ? "candidate explanation: model population changed" : null,
    ),
    component(
      "harness-execution",
      componentStatus(hasBaseline, harnessCurrentIssue, harnessChanged),
      harnessChanged
        ? "harness adapter or execution path changed"
        : "harness adapter and execution path are recorded",
      [
        `harness=${params.currentRunConfiguration.components.activePreset.harness}`,
        `executionMode=${executionModeEvidence(params.currentRuns)}`,
        `executionProfile=${params.currentRunConfiguration.summary.executionProfile}`,
      ],
      harnessChanged
        ? "candidate explanation: adapter or execution backend changed"
        : null,
    ),
    component(
      "prompt-skill-context",
      componentStatus(
        hasBaseline,
        null,
        false,
        promptDiagnosticDelta ||
          promptFacts.failedPromptResolutionCount > 0 ||
          promptFacts.unresolvedSkillCount > 0,
      ),
      promptDiagnosticDelta
        ? "context-retrieval diagnostics changed"
        : "prompt, skill, and context evidence is bounded to declared artifacts",
      [
        `skillAblationRuns=${promptFacts.skillAblationRunCount}`,
        `selectedSkills=${promptFacts.selectedSkills.join(",") || "none"}`,
        `contextWarnings=${params.diagnostics.contextRetrievalDiagnostics.warningCount}`,
      ],
      promptDiagnosticDelta
        ? "candidate explanation: context-retrieval evidence changed"
        : null,
    ),
    component(
      "fixture-verifier",
      componentStatus(
        hasBaseline,
        null,
        fixtureManifestChanged(params.priorReport, params.currentRunConfiguration),
        verifierDiagnosticDelta,
      ),
      fixtureManifestChanged(params.priorReport, params.currentRunConfiguration)
        ? "fixture manifest changed"
        : verifierDiagnosticDelta
          ? "verifier, objective metric, or code-health diagnostics changed"
          : "fixture and verifier evidence is recorded",
      [
        `fixtureManifest=${params.currentRunConfiguration.summary.fixtureManifest}`,
        `verifierWarnings=${params.diagnostics.verifierCalibration.warningCount}`,
        `objectiveMetrics=${params.currentMetrics.length}`,
        `codeHealthWarnings=${params.currentCodeHealth.totalWarnings}`,
      ],
      verifierDiagnosticDelta
        ? "candidate explanation: fixture/verifier diagnostics changed"
        : null,
    ),
    component(
      "environment-resource",
      componentStatus(
        hasBaseline,
        params.currentExecutionProfile.gateEligible ? null : "unsupported",
        params.priorReport !== null &&
          (!resourceProfilesComparable(
            params.priorReport.resourceProfile,
            params.currentResourceProfile,
          ) ||
            !sameStructuredValue(
              params.priorReport.executionProfile,
              params.currentExecutionProfile,
            )),
        environmentDiagnosticDelta,
      ),
      environmentDiagnosticDelta
        ? "execution preflight diagnostics changed"
        : "resource profile and execution preflight are recorded",
      [
        `resourceProfile=${params.currentRunConfiguration.summary.resourceProfile}`,
        `executionProfile=${params.currentRunConfiguration.summary.executionProfile}`,
        `timeoutEnvelope=${timeoutEnvelopeEvidence(params.currentRuns)}`,
        `networkPolicy=${networkPolicyEvidence(
          params.currentExecutionProfile.networkPolicy,
        )}`,
        `preflightDiagnostics=${params.currentExecutionProfile.diagnostics.length}`,
      ],
      environmentDiagnosticDelta
        ? "candidate explanation: environment/preflight evidence changed"
        : null,
    ),
    component(
      "feedback-loop",
      componentStatus(
        hasBaseline,
        feedbackMissing ? "missing" : null,
        false,
        feedbackDiagnosticDelta,
      ),
      feedbackDiagnosticDelta
        ? "feedback-channel diagnostics changed"
        : "feedback channels are summarized from predicate and trajectory artifacts",
      [
        `predicateKinds=${predicateKinds.join(",") || "none"}`,
        `failedPredicates=${params.artifactSummaries.reduce(
          (sum, summary) => sum + summary.failedPredicateCount,
          0,
        )}`,
        `trajectoryWarnings=${params.diagnostics.trajectoryDiagnostics.warningCount}`,
      ],
      feedbackDiagnosticDelta
        ? "candidate explanation: feedback-loop evidence changed"
        : null,
    ),
  ];
}

export function changedComponents(
  components: readonly EvalAttributionComponentEntry[],
  baselineStatus: EvalAttributionBaselineStatus,
): readonly EvalAttributionComponentId[] {
  if (baselineStatus === "no-baseline") return [];
  return components
    .filter((entry) =>
      entry.status === "changed" ||
      entry.status === "diagnostic-delta" ||
      entry.status === "missing" ||
      entry.status === "unsupported",
    )
    .map((entry) => entry.id);
}
