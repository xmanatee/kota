import { resolveDefaultModel, resolvePreset } from "#core/model/preset.js";
import type {
  DaemonRequestInit,
  DaemonTransport,
} from "#core/server/daemon-transport.js";
import type {
  EvalCalibrationResult,
  EvalListResult,
  EvalRunResult,
} from "./client.js";
import type { CodeHealthAggregate } from "./code-health-diagnostics.js";
import type { FixtureDiagnosticsReport } from "./scoring.js";

type RecordedBody = Parameters<DaemonTransport["request"]>[2];
type RecordedResponse = object | null;

export type RecordedCall = {
  method: string;
  path: string;
  body: RecordedBody;
  init: DaemonRequestInit | undefined;
  shape: "request" | "requestStrict";
};

export const SAMPLE_CONTROL_DECISION_COVERAGE: EvalListResult["controlDecisionCoverage"] = {
  counts: {
    act: 1,
    ask: 0,
    refuse: 0,
    stop: 0,
    confirm: 0,
    recover: 0,
  },
  missingDecisions: ["ask", "refuse", "stop", "confirm", "recover"],
  missingDecisionWarnings: [
    {
      decision: "ask",
      message: 'No eval fixture declares control decision "ask".',
    },
  ],
};

export const SAMPLE_FIXTURE_DIAGNOSTICS: FixtureDiagnosticsReport = {
  perFixture: [
    {
      fixtureId: "fix-a",
      repeatCount: 3,
      outcomes: ["pass", "pass", "pass"],
      outcomeCounts: {
        pass: 3,
        fail: 0,
        timeout: 0,
        error: 0,
        "configuration-error": 0,
      },
      observedPassRate: 1,
      repeatVariance: 0,
      diagnosticClass: "stable-pass",
      warnings: [],
    },
  ],
  aggregate: {
    fixtureCount: 1,
    stablePass: 1,
    stableFail: 0,
    repeatUnstable: 0,
    insufficientSample: 0,
    nonGating: 0,
    lowSignalWarnings: 0,
  },
};

export const SAMPLE_CODE_HEALTH: CodeHealthAggregate = {
  diagnosticRunCount: 0,
  runsWithWarnings: 0,
  fixturesWithWarnings: 0,
  totalWarnings: 0,
  warningCounts: {
    "duplicated-implementation-chunk": 0,
    "complexity-concentration": 0,
  },
};

export const SAMPLE_CALIBRATION_AGGREGATE: EvalCalibrationResult["aggregate"] = {
  windowStartMs: 0,
  windowEndMs: 1,
  totalRuns: 0,
  byVerdict: {
    pass: 0,
    pass_with_warnings: 0,
    fail: 0,
    absent: 0,
  },
  passContradictionCount: 0,
  passContradictionRate: 0,
  passWithWarningsFollowUpCount: 0,
  passWithWarningsFollowUpRate: 0,
};

export const SAMPLE_CALIBRATION_RESULT: EvalCalibrationResult = {
  aggregate: SAMPLE_CALIBRATION_AGGREGATE,
  decision: {
    status: "insufficient-sample",
    reason: "No calibration samples in test fixture.",
  },
};

const samplePresetResolution = resolvePreset({});
const samplePreset = samplePresetResolution.preset;
const sampleHarness = samplePreset.harness;
const sampleDefaultModel = resolveDefaultModel(samplePreset);

export const SAMPLE_RUN_CONFIGURATION: Extract<
  EvalRunResult,
  { ok: true }
>["runConfiguration"] = {
  fingerprint: "abc123def456",
  summary: {
    activePreset: `${samplePreset.id} (${samplePresetResolution.source}) via ${sampleHarness}`,
    fixtureManifest: "2 fixture(s) fixturehash",
    sourceIdentity: "abc123 (clean, sourcehash)",
    resolvedHarnessModelEvidence: `${sampleHarness}/${sampleDefaultModel} x2`,
    resourceProfile: "test cpu=1/1 memoryMB=1024/1024",
    executionProfile: "verified/container/enforced/verified-profile",
  },
};

export const SAMPLE_COMPONENT_ATTRIBUTION: Extract<
  EvalRunResult,
  { ok: true }
>["componentAttribution"] = {
  summary: "component attribution: comparable eval population with no observed component or fixture outcome deltas",
  artifactPath: "/tmp/eval-runs/run-x/eval-set-report.json",
  baselineStatus: "comparable",
  changedComponents: [],
};

export function makeRecordingTransport(
  responder: (
    method: string,
    path: string,
    body: RecordedBody,
    shape: "request" | "requestStrict",
  ) => RecordedResponse,
): { transport: DaemonTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
    request: async <T>(
      method: string,
      path: string,
      body?: RecordedBody,
      init?: DaemonRequestInit,
    ): Promise<T | null> => {
      calls.push({ method, path, body, init, shape: "request" });
      return responder(method, path, body, "request") as T | null;
    },
    requestStrict: async <T>(
      method: string,
      path: string,
      body?: RecordedBody,
      init?: DaemonRequestInit,
    ): Promise<T> => {
      calls.push({ method, path, body, init, shape: "requestStrict" });
      return responder(method, path, body, "requestStrict") as T;
    },
    fetchRaw: async () => new Response(null, { status: 200 }),
    events: async function* () {
      // empty generator
    },
  };
  return { transport, calls };
}
