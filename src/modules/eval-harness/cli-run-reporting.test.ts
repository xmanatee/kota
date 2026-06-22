import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEvalCommand } from "./cli.js";
import {
  makeRunRecordingCtx,
  SAMPLE_RUN_CONFIGURATION,
} from "./cli-test-support.js";
import type { EvalRunOptions } from "./client.js";

describe("kota eval run CLI reporting", () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
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
    expect(text).toContain(SAMPLE_RUN_CONFIGURATION.fingerprint);
    expect(text).toContain(SAMPLE_RUN_CONFIGURATION.summary.activePreset);
    expect(text).toContain("configuration mismatch:");
    expect(text).toContain("fixture-manifest-drift");
    expect(text).toContain("attribution:");
    expect(text).toContain("changed=none");
    expect(text).toContain("/tmp/eval-runs/run-x/eval-set-report.json");
  });
});
