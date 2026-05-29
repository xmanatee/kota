import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { KotaClient } from "#core/server/kota-client.js";
import { getCriticPromptHash } from "#modules/autonomy/critic.js";
import {
  EVALUATOR_CALIBRATION_ARTIFACT,
  type EvaluatorCalibrationArtifact,
} from "#modules/autonomy/evaluator-calibration.js";
import { buildEvalCommand } from "./cli.js";
import type {
  EvalHarnessClient,
  EvalListResult,
  EvalRunOptions,
  EvalRunResult,
} from "./client.js";
import type { CodeHealthAggregate } from "./code-health-diagnostics.js";
import {
  listEvalFixtures,
  runEvalCalibration,
  runEvalHarness,
} from "./eval-operations.js";
import type { FixtureDiagnosticsReport } from "./scoring.js";

function makeFakeCtx(projectDir: string): ModuleContext {
  const evalHarness: EvalHarnessClient = {
    async list() {
      return listEvalFixtures(projectDir);
    },
    async run(options) {
      return runEvalHarness(projectDir, options ?? {});
    },
    async calibration(options) {
      return runEvalCalibration(projectDir, options ?? {});
    },
  };
  const client = { evalHarness } as unknown as KotaClient;
  return { cwd: projectDir, client } as unknown as ModuleContext;
}

const EMPTY_CONTROL_DECISION_COVERAGE: EvalListResult["controlDecisionCoverage"] = {
  counts: {
    act: 0,
    ask: 0,
    refuse: 0,
    stop: 0,
    confirm: 0,
    recover: 0,
  },
  missingDecisions: ["act", "ask", "refuse", "stop", "confirm", "recover"],
  missingDecisionWarnings: [
    {
      decision: "act",
      message: 'No eval fixture declares control decision "act".',
    },
    {
      decision: "ask",
      message: 'No eval fixture declares control decision "ask".',
    },
    {
      decision: "refuse",
      message: 'No eval fixture declares control decision "refuse".',
    },
    {
      decision: "stop",
      message: 'No eval fixture declares control decision "stop".',
    },
    {
      decision: "confirm",
      message: 'No eval fixture declares control decision "confirm".',
    },
    {
      decision: "recover",
      message: 'No eval fixture declares control decision "recover".',
    },
  ],
};

const EMPTY_FIXTURE_DIAGNOSTICS: FixtureDiagnosticsReport = {
  perFixture: [],
  aggregate: {
    fixtureCount: 0,
    stablePass: 0,
    stableFail: 0,
    repeatUnstable: 0,
    insufficientSample: 0,
    nonGating: 0,
    lowSignalWarnings: 0,
  },
};

const EMPTY_CODE_HEALTH: CodeHealthAggregate = {
  diagnosticRunCount: 0,
  runsWithWarnings: 0,
  fixturesWithWarnings: 0,
  totalWarnings: 0,
  warningCounts: {
    "source-size-growth": 0,
    "duplicated-implementation-chunk": 0,
    "complexity-concentration": 0,
  },
};

const SAMPLE_RUN_CONFIGURATION: Extract<
  EvalRunResult,
  { ok: true }
>["runConfiguration"] = {
  fingerprint: "abc123def456",
  summary: {
    activePreset: "codex (default) via codex",
    fixtureManifest: "1 fixture(s) fixturehash",
    sourceIdentity: "abc123 (clean, sourcehash)",
    resolvedHarnessModelEvidence: "codex/gpt-5.5 x1",
    resourceProfile: "test cpu=1/1 memoryMB=1024/1024",
    executionProfile: "verified/container/enforced/verified-profile",
  },
};

function makeListCtx(result: EvalListResult): ModuleContext {
  const evalHarness: EvalHarnessClient = {
    async list() {
      return result;
    },
    async run() {
      return {
        ok: true,
        fixtureCount: 0,
        repeatCount: 1,
        passAtK: 1,
        passHatK: 1,
        controlDecisionCoverage: result.controlDecisionCoverage,
        objectiveMetrics: [],
        codeHealth: EMPTY_CODE_HEALTH,
        fixtureDiagnostics: EMPTY_FIXTURE_DIAGNOSTICS,
        runConfiguration: SAMPLE_RUN_CONFIGURATION,
        baselineConfigurationComparison: null,
        runArtifactBaseDir: "/tmp/eval-run",
      };
    },
    async calibration() {
      return { aggregate: {}, decision: {} };
    },
  };
  const client = { evalHarness } as unknown as KotaClient;
  return { cwd: "/tmp/project", client } as unknown as ModuleContext;
}

function makeRunRecordingCtx(
  calls: EvalRunOptions[],
  resultOverrides: Partial<Extract<EvalRunResult, { ok: true }>> = {},
): ModuleContext {
  const evalHarness: EvalHarnessClient = {
    async list() {
      return {
        fixtures: [],
        controlDecisionCoverage: EMPTY_CONTROL_DECISION_COVERAGE,
      };
    },
    async run(options) {
      calls.push(options ?? {});
      return {
        ok: true,
        fixtureCount: 1,
        repeatCount: options?.repeatCount ?? 1,
        passAtK: 1,
        passHatK: 1,
        controlDecisionCoverage: EMPTY_CONTROL_DECISION_COVERAGE,
        objectiveMetrics: [],
        codeHealth: EMPTY_CODE_HEALTH,
        fixtureDiagnostics: EMPTY_FIXTURE_DIAGNOSTICS,
        runConfiguration: SAMPLE_RUN_CONFIGURATION,
        baselineConfigurationComparison: null,
        runArtifactBaseDir: "/tmp/eval-run",
        ...resultOverrides,
      };
    },
    async calibration() {
      return { aggregate: {}, decision: {} };
    },
  };
  const client = { evalHarness } as unknown as KotaClient;
  return { cwd: "/tmp/project", client } as unknown as ModuleContext;
}

describe("kota eval list CLI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits fixture control decisions and aggregate coverage as JSON", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });
    const result: EvalListResult = {
      fixtures: [
        {
          id: "builder-smoke",
          description: "builder smoke",
          role: "builder",
          workflowName: "builder",
          controlDecisions: ["act"],
          tags: ["smoke"],
        },
      ],
      controlDecisionCoverage: {
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
      },
    };
    const cmd = buildEvalCommand(makeListCtx(result));

    await cmd.parseAsync(["list", "--json"], { from: "user" });

    const parsed = JSON.parse(logs.join("\n")) as EvalListResult;
    expect(parsed.fixtures[0]).toMatchObject({
      id: "builder-smoke",
      controlDecisions: ["act"],
    });
    expect(parsed.controlDecisionCoverage.counts.act).toBe(1);
    expect(parsed.controlDecisionCoverage.missingDecisionWarnings[0]).toEqual({
      decision: "ask",
      message: 'No eval fixture declares control decision "ask".',
    });
  });

  it("prints compact coverage counts and missing-decision warnings", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      writes.push(String(data));
      return true;
    });
    const cmd = buildEvalCommand(
      makeListCtx({
        fixtures: [
          {
            id: "stop-fixture",
            description: "stop coverage",
            role: "builder",
            workflowName: "builder",
            controlDecisions: ["stop"],
            tags: [],
          },
        ],
        controlDecisionCoverage: {
          counts: {
            act: 0,
            ask: 0,
            refuse: 0,
            stop: 1,
            confirm: 0,
            recover: 0,
          },
          missingDecisions: ["act"],
          missingDecisionWarnings: [
            {
              decision: "act",
              message: 'No eval fixture declares control decision "act".',
            },
          ],
        },
      }),
    );

    await cmd.parseAsync(["list"], { from: "user" });

    const text = writes.join("\n");
    expect(text).toContain("control decisions:");
    expect(text).toContain("stop=1");
    expect(text).toContain("missing control-decision coverage: act");
    expect(text).toContain("decisions=stop");
  });
});

function seedCalibration(
  runsDir: string,
  runId: string,
  completedAt: string,
  verdict: EvaluatorCalibrationArtifact["verdict"],
  sourceFilesChanged: string[],
): void {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  const artifact: EvaluatorCalibrationArtifact = {
    runId,
    workflow: "builder",
    completedAt,
    verdict,
    warningCount: 0,
    criticalIssueCount: 0,
    repairIterations: 1,
    finalIterationFailures: [],
    criticFailureCount: 0,
    terminalRunStatus: "success",
    taskId: null,
    taskFinalState: null,
    sourceFilesChanged,
    // CLI calibration aggregation runs through the live `getCriticPromptHash`,
    // so seeded artifacts must declare the same hash to be visible.
    criticPromptHash: getCriticPromptHash(),
  };
  writeFileSync(
    join(runDir, EVALUATOR_CALIBRATION_ARTIFACT),
    JSON.stringify(artifact, null, 2),
  );
}

describe("kota eval run CLI", () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("threads deliberate container selection into the eval run options", async () => {
    const calls: EvalRunOptions[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const cmd = buildEvalCommand(makeRunRecordingCtx(calls));

    await cmd.parseAsync(
      [
        "run",
        "--fixture",
        "builder-smoke",
        "--repeats",
        "1",
        "--host-class",
        "ci-container",
        "--cpu-allocation",
        "2",
        "--cpu-kill",
        "2",
        "--memory-allocation-mb",
        "1024",
        "--memory-kill-threshold-mb",
        "2048",
        "--isolation",
        "container",
        "--container-executable",
        "docker",
        "--container-image",
        "node:22-bookworm",
        "--container-kota-binary-path",
        "/opt/kota/bin/kota.mjs",
      ],
      { from: "user" },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      fixtureIds: ["builder-smoke"],
      repeatCount: 1,
      hostClass: "ci-container",
      cpuAllocationCores: 2,
      cpuKillThresholdCores: 2,
      memoryAllocationMB: 1024,
      memoryKillThresholdMB: 2048,
      isolationBackend: {
        kind: "container",
        executable: "docker",
        image: "node:22-bookworm",
        kotaBinaryPath: "/opt/kota/bin/kota.mjs",
        networkPolicy: { kind: "offline" },
      },
    });
  });

  it("threads provider-egress container policy into eval run options", async () => {
    const calls: EvalRunOptions[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const cmd = buildEvalCommand(makeRunRecordingCtx(calls));

    await cmd.parseAsync(
      [
        "run",
        "--repeats",
        "1",
        "--isolation",
        "container",
        "--container-executable",
        "docker",
        "--container-image",
        "node:22-bookworm",
        "--container-kota-binary-path",
        "/opt/kota/bin/kota.mjs",
        "--container-network-policy",
        "provider-egress",
        "--provider-egress-network",
        "kota-provider-egress",
        "--provider-egress-proxy",
        "http://provider-proxy:8080",
        "--provider-egress-provider",
        "openai",
      ],
      { from: "user" },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].isolationBackend).toEqual({
      kind: "container",
      executable: "docker",
      image: "node:22-bookworm",
      kotaBinaryPath: "/opt/kota/bin/kota.mjs",
      networkPolicy: {
        kind: "provider-egress",
        provider: "openai",
        enforcement: {
          kind: "docker-internal-proxy",
          networkName: "kota-provider-egress",
          proxyUrl: "http://provider-proxy:8080",
        },
      },
    });
  });

  it("prints fixture diagnostics and repeat-unstable fixture rows", async () => {
    const calls: EvalRunOptions[] = [];
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      writes.push(String(data));
      return true;
    });
    const cmd = buildEvalCommand(
      makeRunRecordingCtx(calls, {
        fixtureCount: 2,
        repeatCount: 3,
        passAtK: 1,
        passHatK: 0.5,
        fixtureDiagnostics: {
          perFixture: [
            {
              fixtureId: "alpha",
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
            {
              fixtureId: "beta",
              repeatCount: 3,
              outcomes: ["pass", "fail", "fail"],
              outcomeCounts: {
                pass: 1,
                fail: 2,
                timeout: 0,
                error: 0,
                "configuration-error": 0,
              },
              observedPassRate: 1 / 3,
              repeatVariance: 2 / 9,
              diagnosticClass: "repeat-unstable",
              warnings: ["low-signal-repeat-instability"],
            },
          ],
          aggregate: {
            fixtureCount: 2,
            stablePass: 1,
            stableFail: 0,
            repeatUnstable: 1,
            insufficientSample: 0,
            nonGating: 0,
            lowSignalWarnings: 1,
          },
        },
      }),
    );

    await cmd.parseAsync(["run", "--repeats", "3"], { from: "user" });

    const text = writes.join("\n");
    expect(text).toContain("pass@k=100.0%");
    expect(text).toContain("pass^k=50.0%");
    expect(text).toContain("fixture diagnostics:");
    expect(text).toContain("stable-pass=1");
    expect(text).toContain("repeat-unstable=1");
    expect(text).toContain("repeat-unstable");
    expect(text).toContain("beta");
    expect(text).toContain("outcomes=pass,fail,fail");
    expect(text).toContain("warnings=low-signal-repeat-instability");
  });

  it("prints compact code-health warning counts when diagnostics ran", async () => {
    const calls: EvalRunOptions[] = [];
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      writes.push(String(data));
      return true;
    });
    const cmd = buildEvalCommand(
      makeRunRecordingCtx(calls, {
        codeHealth: {
          diagnosticRunCount: 2,
          runsWithWarnings: 1,
          fixturesWithWarnings: 1,
          totalWarnings: 2,
          warningCounts: {
            "source-size-growth": 1,
            "duplicated-implementation-chunk": 1,
            "complexity-concentration": 0,
          },
        },
      }),
    );

    await cmd.parseAsync(["run", "--repeats", "2"], { from: "user" });

    const text = writes.join("\n");
    expect(text).toContain("code health:");
    expect(text).toContain("diagnostic-runs=2");
    expect(text).toContain("source-size-growth=1");
    expect(text).toContain("duplicated-implementation-chunk=1");
  });

  it("prints run-configuration fingerprint summary and mismatch reason", async () => {
    const calls: EvalRunOptions[] = [];
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      writes.push(String(data));
      return true;
    });
    const cmd = buildEvalCommand(
      makeRunRecordingCtx(calls, {
        baselineConfigurationComparison: {
          status: "mismatch",
          reason: "fixture-manifest-drift",
          message: "fixture ids or loaded fixture specs changed",
          priorFingerprint: "prior",
          candidateFingerprint: SAMPLE_RUN_CONFIGURATION.fingerprint,
          priorSummary: SAMPLE_RUN_CONFIGURATION.summary,
          candidateSummary: SAMPLE_RUN_CONFIGURATION.summary,
        },
      }),
    );

    await cmd.parseAsync(["run", "--repeats", "1"], { from: "user" });

    const text = writes.join("\n");
    expect(text).toContain("configuration:");
    expect(text).toContain("abc123def456");
    expect(text).toContain("codex (default) via codex");
    expect(text).toContain("configuration mismatch:");
    expect(text).toContain("fixture-manifest-drift");
  });

  it("rejects container fields unless the operator selects container isolation", async () => {
    const calls: EvalRunOptions[] = [];
    const cmd = buildEvalCommand(makeRunRecordingCtx(calls));

    await expect(
      cmd.parseAsync(
        [
          "run",
          "--container-executable",
          "docker",
          "--container-image",
          "node:22",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow(/require --isolation container/);
    expect(calls).toHaveLength(0);
  });
});

describe("kota eval calibration CLI", () => {
  let projectDir: string;
  let runsDir: string;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "cal-cli-"));
    runsDir = join(projectDir, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
    process.exitCode = 0;
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("aggregates seeded artifacts and prints human-readable summary", async () => {
    const nowIso = new Date().toISOString();
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    seedCalibration(runsDir, "run-a", hourAgo, "pass", ["src/core/a.ts"]);
    seedCalibration(runsDir, "run-b", nowIso, "fail", ["src/core/a.ts"]);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });
    vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      logs.push(String(data));
      return true;
    });

    const cmd = buildEvalCommand(makeFakeCtx(projectDir));
    await cmd.parseAsync(
      ["calibration", "--min-sample", "1", "--threshold-rate", "0.9"],
      { from: "user" },
    );

    const text = logs.join("\n");
    expect(text).toContain("evaluator calibration");
    expect(text).toContain("total runs=2");
    expect(text).toContain("pass=1");
    expect(text).toContain("pass contradiction: 1/1");
  });

  it("sets exitCode=2 and emits JSON when gated", async () => {
    const nowIso = new Date().toISOString();
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    seedCalibration(runsDir, "run-a", hourAgo, "pass", ["src/core/a.ts"]);
    seedCalibration(runsDir, "run-b", nowIso, "fail", ["src/core/a.ts"]);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });

    const cmd = buildEvalCommand(makeFakeCtx(projectDir));
    await cmd.parseAsync(
      [
        "calibration",
        "--min-sample",
        "1",
        "--threshold-rate",
        "0.25",
        "--json",
      ],
      { from: "user" },
    );

    expect(process.exitCode).toBe(2);
    const parsed = JSON.parse(logs.join("\n")) as {
      aggregate: { passContradictionCount: number };
      decision: { status: string };
    };
    expect(parsed.aggregate.passContradictionCount).toBe(1);
    expect(parsed.decision.status).toBe("gated");
  });

  it("reports insufficient-sample when fewer pass verdicts than minSample", async () => {
    const nowIso = new Date().toISOString();
    seedCalibration(runsDir, "run-a", nowIso, "pass", ["src/core/a.ts"]);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });
    vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      logs.push(String(data));
      return true;
    });

    const cmd = buildEvalCommand(makeFakeCtx(projectDir));
    await cmd.parseAsync(
      ["calibration", "--min-sample", "8", "--threshold-rate", "0.25"],
      { from: "user" },
    );

    expect(process.exitCode).toBe(0);
    const text = logs.join("\n");
    expect(text).toContain("insufficient-sample");
  });
});
