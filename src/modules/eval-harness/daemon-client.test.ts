/**
 * EvalHarness namespace daemon-side handler test.
 *
 * The evalHarness namespace migrated out of the core stub into
 * `daemonClient(link)` on the eval-harness module. This test pins the
 * invariants the migration relies on:
 *
 *  1. The eval-harness module exposes a `daemonClient(link)` factory and
 *     the factory returns a handler for the `evalHarness` namespace.
 *  2. `list()` is wired through `DaemonTransport.requestStrict<T>` with
 *     method `GET`, path `/eval/list`, and an undefined body.
 *  3. `run(options)` is wired through `requestStrict<T>` with method
 *     `POST`, path `/api/eval/run`, the full options body (calls with no
 *     options default to `{}`), and a `Number.MAX_SAFE_INTEGER`
 *     `timeoutMs` override that disables the typed link's 2s default
 *     so unbounded eval runs do not abort. The daemon route was reshaped
 *     from the prior `400 + { error }` typed-failure shape to a uniform
 *     `200 + EvalRunResult` discriminated body, matching the skills
 *     migration precedent.
 *  4. `calibration(options)` is wired through `requestStrict<T>` with
 *     method `GET`, path `/eval/calibration${query}`, and an undefined
 *     body. The optional-key insertion order is `windowDays, followUpDays,
 *     thresholdRate, minSample, runsDir`, matching today's pre-migration
 *     `evalCalibrationHttp`. The empty-options call omits the query
 *     string entirely.
 *  5. `EvalRunResult` arms decode correctly through `requestStrict<T>`:
 *     the `ok: true` arm with the full report payload collapses unchanged,
 *     the `no_fixtures` arm collapses unchanged, the
 *     `fixture_provenance` arm collapses unchanged, and objective-metric
 *     validation failures collapse unchanged.
 *  6. `EvalListResult` decodes correctly through `requestStrict<T>` (the
 *     `fixtures` array and coverage summary pass through unchanged).
 *  7. `EvalCalibrationResult` decodes correctly through `requestStrict<T>`
 *     (the `aggregate` and `decision` `Record<string, unknown>` fields
 *     pass through unchanged).
 *  8. Supplying the contribution to the assembly path satisfies coverage.
 *  9. Removing the eval-harness module's daemonClient contribution makes
 *     the assembled client fail loudly with a clear "evalHarness" missing-
 *     handler error.
 */

import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type {
  DaemonRequestInit,
  DaemonTransport,
} from "#core/server/daemon-transport.js";
import type {
  EvalCalibrationResult,
  EvalFixtureSummary,
  EvalListResult,
  EvalRunResult,
} from "./client.js";
import evalHarnessModule from "./index.js";
import type { FixtureDiagnosticsReport } from "./scoring.js";

type RecordedCall = {
  method: string;
  path: string;
  body: unknown;
  init: DaemonRequestInit | undefined;
  shape: "request" | "requestStrict";
};

const SAMPLE_CONTROL_DECISION_COVERAGE: EvalListResult["controlDecisionCoverage"] = {
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

const SAMPLE_FIXTURE_DIAGNOSTICS: FixtureDiagnosticsReport = {
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

function makeRecordingTransport(
  responder: (
    method: string,
    path: string,
    body: unknown,
    shape: "request" | "requestStrict",
  ) => unknown,
): { transport: DaemonTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
    request: async <T>(
      method: string,
      path: string,
      body?: unknown,
      init?: DaemonRequestInit,
    ): Promise<T | null> => {
      calls.push({ method, path, body, init, shape: "request" });
      return responder(method, path, body, "request") as T | null;
    },
    requestStrict: async <T>(
      method: string,
      path: string,
      body?: unknown,
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

describe("eval-harness module daemonClient(link)", () => {
  it("contributes an evalHarness namespace handler", () => {
    expect(evalHarnessModule.daemonClient).toBeTypeOf("function");
    const link = makeRecordingTransport(() => null).transport;
    const contributed = evalHarnessModule.daemonClient!(link);
    expect(contributed.evalHarness).toBeDefined();
    expect(typeof contributed.evalHarness!.list).toBe("function");
    expect(typeof contributed.evalHarness!.run).toBe("function");
    expect(typeof contributed.evalHarness!.calibration).toBe("function");
  });

  it("routes list() through GET /eval/list via requestStrict<T> with no body", async () => {
    const fixtures: EvalFixtureSummary[] = [
      {
        id: "fix-a",
        description: "first",
        role: "builder",
        workflowName: "builder",
        controlDecisions: ["act"],
        tags: ["alpha"],
      },
    ];
    const wirePayload: EvalListResult = {
      fixtures,
      controlDecisionCoverage: SAMPLE_CONTROL_DECISION_COVERAGE,
    };
    const { transport, calls } = makeRecordingTransport(() => wirePayload);
    const contributed = evalHarnessModule.daemonClient!(transport);
    const result = await contributed.evalHarness!.list();
    expect(result).toEqual(wirePayload);
    expect(result.fixtures[0]).toEqual(fixtures[0]);
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/eval/list",
        body: undefined,
        init: undefined,
        shape: "requestStrict",
      },
    ]);
  });

  it("routes run() with no options through POST /api/eval/run via requestStrict<T> with {} body and MAX_SAFE_INTEGER timeoutMs", async () => {
    const wireResult: EvalRunResult = {
      ok: true,
      fixtureCount: 2,
      repeatCount: 3,
      passAtK: 1,
      passHatK: 1,
      controlDecisionCoverage: SAMPLE_CONTROL_DECISION_COVERAGE,
      objectiveMetrics: [],
      fixtureDiagnostics: SAMPLE_FIXTURE_DIAGNOSTICS,
      runArtifactBaseDir: "/tmp/eval-runs/run-x",
    };
    const { transport, calls } = makeRecordingTransport(() => wireResult);
    const contributed = evalHarnessModule.daemonClient!(transport);
    const result = await contributed.evalHarness!.run();
    expect(result).toEqual(wireResult);
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/eval/run",
        body: {},
        init: { timeoutMs: Number.MAX_SAFE_INTEGER },
        shape: "requestStrict",
      },
    ]);
  });

  it("routes run(options) with every key set through POST /api/eval/run with the full body", async () => {
    const wireResult: EvalRunResult = {
      ok: true,
      fixtureCount: 1,
      repeatCount: 1,
      passAtK: 1,
      passHatK: 1,
      controlDecisionCoverage: SAMPLE_CONTROL_DECISION_COVERAGE,
      objectiveMetrics: [],
      fixtureDiagnostics: SAMPLE_FIXTURE_DIAGNOSTICS,
      runArtifactBaseDir: "/tmp/eval-runs/run-y",
    };
    const { transport, calls } = makeRecordingTransport(() => wireResult);
    const contributed = evalHarnessModule.daemonClient!(transport);
    const options = {
      fixtureIds: ["fix-a", "fix-b"],
      repeatCount: 5,
      hostClass: "ci",
      cpuAllocationCores: 4,
      cpuKillThresholdCores: 6,
      memoryAllocationMB: 8192,
      memoryKillThresholdMB: 16384,
      keepWorkingDirs: true,
      isolationBackend: {
        kind: "container" as const,
        executable: "docker",
        image: "node:22-bookworm",
        kotaBinaryPath: "/opt/kota/bin/kota.mjs",
      },
    };
    await contributed.evalHarness!.run(options);
    expect(calls[0]!.body).toEqual(options);
    expect(calls[0]!.init).toEqual({ timeoutMs: Number.MAX_SAFE_INTEGER });
  });

  it("decodes the EvalRunResult no_fixtures arm unchanged", async () => {
    const wireResult: EvalRunResult = {
      ok: false,
      reason: "no_fixtures",
      message: "No fixtures under \"/tmp/fixtures\".",
    };
    const { transport } = makeRecordingTransport(() => wireResult);
    const contributed = evalHarnessModule.daemonClient!(transport);
    const result = await contributed.evalHarness!.run();
    expect(result).toEqual(wireResult);
  });

  it("decodes the EvalRunResult fixture_provenance arm unchanged", async () => {
    const wireResult: EvalRunResult = {
      ok: false,
      reason: "fixture_provenance",
      message: "fixture spec missing source provenance",
    };
    const { transport } = makeRecordingTransport(() => wireResult);
    const contributed = evalHarnessModule.daemonClient!(transport);
    const result = await contributed.evalHarness!.run();
    expect(result).toEqual(wireResult);
  });

  it("decodes the EvalRunResult objective_metric_validation arm unchanged", async () => {
    const wireResult: EvalRunResult = {
      ok: false,
      reason: "objective_metric_validation",
      validationReason: "nonnumeric-value",
      message: "objective metric was nonnumeric",
    };
    const { transport } = makeRecordingTransport(() => wireResult);
    const contributed = evalHarnessModule.daemonClient!(transport);
    const result = await contributed.evalHarness!.run();
    expect(result).toEqual(wireResult);
  });

  it("routes calibration() with no options through GET /eval/calibration with no query string", async () => {
    const wireResult: EvalCalibrationResult = {
      aggregate: { totalRuns: 0 },
      decision: { status: "noop" },
    };
    const { transport, calls } = makeRecordingTransport(() => wireResult);
    const contributed = evalHarnessModule.daemonClient!(transport);
    const result = await contributed.evalHarness!.calibration();
    expect(result).toEqual(wireResult);
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/eval/calibration",
        body: undefined,
        init: undefined,
        shape: "requestStrict",
      },
    ]);
  });

  it("threads calibration() options into URLSearchParams in windowDays, followUpDays, thresholdRate, minSample, runsDir insertion order", async () => {
    const wireResult: EvalCalibrationResult = {
      aggregate: {},
      decision: {},
    };
    const { transport, calls } = makeRecordingTransport(() => wireResult);
    const contributed = evalHarnessModule.daemonClient!(transport);
    await contributed.evalHarness!.calibration({
      windowDays: 7,
      followUpDays: 3,
      thresholdRate: 0.5,
      minSample: 4,
      runsDir: "/tmp/runs dir",
    });
    expect(calls[0]!.path).toBe(
      "/eval/calibration?windowDays=7&followUpDays=3&thresholdRate=0.5&minSample=4&runsDir=%2Ftmp%2Fruns+dir",
    );
  });

  it("decodes EvalCalibrationResult Record<string, unknown> fields unchanged", async () => {
    const wireResult: EvalCalibrationResult = {
      aggregate: {
        totalRuns: 12,
        nested: { a: [1, 2, 3], b: "x" },
      },
      decision: {
        status: "gated",
        reason: "contradiction-rate-above-threshold",
      },
    };
    const { transport } = makeRecordingTransport(() => wireResult);
    const contributed = evalHarnessModule.daemonClient!(transport);
    const result = await contributed.evalHarness!.calibration({ windowDays: 7 });
    expect(result).toEqual(wireResult);
  });

  it("the assembly path fails loudly when the eval-harness module's daemonClient(link) is removed", () => {
    const { transport } = makeRecordingTransport(() => null);
    const others = buildMigratedNamespaceTestStubs();
    delete others.evalHarness;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /evalHarness/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });

  it("supplying the eval-harness module's contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = evalHarnessModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.evalHarness;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });
});
