import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateObjectiveMetricsForOutcome,
  type ObjectiveMetricSource,
  type ObjectiveMetricSpec,
  ObjectiveMetricValidationError,
  parseObjectiveMetricSpec,
} from "./objective-metrics.js";
import { TEST_EXECUTION_PROFILE } from "./runner-test-profiles.js";

type FileObjectiveMetricSource = Extract<
  ObjectiveMetricSource,
  { kind: "json-file" | "text-file" }
>;

const FILE_SOURCES: ReadonlyArray<{
  label: string;
  source: FileObjectiveMetricSource;
}> = [
  {
    label: "JSON",
    source: { kind: "json-file", path: "metric.json", pointer: "/score" },
  },
  {
    label: "text",
    source: { kind: "text-file", path: "metric.txt" },
  },
];

const ATTACKS: ReadonlyArray<{
  label: string;
  arrange: (
    root: string,
    workingDir: string,
    source: FileObjectiveMetricSource,
  ) => string;
  expectedMessage: string;
}> = [
  {
    label: "symlinked host target",
    arrange: (root, workingDir, source) => {
      const marker = `sensitive-${source.kind}-host-contents`;
      const hostPath = join(root, `host-${source.kind}.txt`);
      const hostContents =
        source.kind === "json-file"
          ? JSON.stringify({ score: 17, sensitive: marker })
          : `17\n${marker}`;
      writeFileSync(hostPath, hostContents);
      symlinkSync(hostPath, join(workingDir, source.path));
      return marker;
    },
    expectedMessage: "symbolic links",
  },
  {
    label: "oversized sparse artifact",
    arrange: (_root, workingDir, source) => {
      const marker = `sensitive-${source.kind}-sparse-contents`;
      const artifactPath = join(workingDir, source.path);
      writeFileSync(artifactPath, marker);
      truncateSync(artifactPath, 2 * 1024 * 1024);
      return marker;
    },
    expectedMessage: "1048576-byte limit",
  },
  {
    label: "non-regular artifact",
    arrange: (_root, workingDir, source) => {
      mkdirSync(join(workingDir, source.path));
      return `sensitive-${source.kind}-directory-marker`;
    },
    expectedMessage: "not a regular file",
  },
];

function metricSpec(source: ObjectiveMetricSource): ObjectiveMetricSpec {
  return {
    name: "security_score",
    unit: "score",
    direction: "higher_is_better",
    source,
  };
}

async function capturePassingOutcomeError(
  workingDir: string,
  source: FileObjectiveMetricSource,
): Promise<ObjectiveMetricValidationError> {
  try {
    await evaluateObjectiveMetricsForOutcome({
      fixtureId: "untrusted-file-metric",
      metricSpecs: [metricSpec(source)],
      workingDir,
      executionProfile: TEST_EXECUTION_PROFILE,
      runIndex: 0,
      repeatCount: 1,
      outcome: "pass",
    });
  } catch (error) {
    expect(error).toBeInstanceOf(ObjectiveMetricValidationError);
    return error as ObjectiveMetricValidationError;
  }
  throw new Error("Expected passing-outcome metric collection to fail closed");
}

describe("objective metric file security", () => {
  it("requires file sources to use relative paths contained by the fixture", () => {
    for (const path of ["../host-metric.txt", resolve("/host-metric.txt")]) {
      expect(() =>
        parseObjectiveMetricSpec(
          {
            name: "unsafe_path",
            unit: "score",
            direction: "higher_is_better",
            source: { kind: "text-file", path },
          },
          "/fixture",
        ),
      ).toThrow(expect.objectContaining({ reason: "malformed-declaration" }));
    }
  });

  for (const fileSource of FILE_SOURCES) {
    it(`keeps invalid ${fileSource.label} contents out of typed metric errors`, async () => {
      const root = mkdtempSync(join(tmpdir(), "kota-objective-metric-file-error-"));
      const workingDir = join(root, "working");
      mkdirSync(workingDir);
      try {
        const sensitiveMarker = `sensitive-${fileSource.source.kind}-invalid-contents`;
        writeFileSync(join(workingDir, fileSource.source.path), sensitiveMarker);
        const passingError = await capturePassingOutcomeError(
          workingDir,
          fileSource.source,
        );
        expect(passingError).toMatchObject({
          reason:
            fileSource.source.kind === "json-file"
              ? "source-failed"
              : "nonnumeric-value",
        });
        expect(passingError.message).not.toContain(sensitiveMarker);

        const failedEvaluation = await evaluateObjectiveMetricsForOutcome({
          fixtureId: "untrusted-file-metric",
          metricSpecs: [metricSpec(fileSource.source)],
          workingDir,
          executionProfile: TEST_EXECUTION_PROFILE,
          runIndex: 0,
          repeatCount: 1,
          outcome: "fail",
        });
        expect(failedEvaluation.objectiveMetricErrors[0]?.message).not.toContain(
          sensitiveMarker,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    for (const attack of ATTACKS) {
      it(`rejects a ${attack.label} for ${fileSource.label} metrics on passing and failed outcomes`, async () => {
        const root = mkdtempSync(join(tmpdir(), "kota-objective-metric-file-security-"));
        const workingDir = join(root, "working");
        mkdirSync(workingDir);
        try {
          const sensitiveMarker = attack.arrange(root, workingDir, fileSource.source);
          const passingError = await capturePassingOutcomeError(
            workingDir,
            fileSource.source,
          );
          expect(passingError).toMatchObject({ reason: "source-failed" });
          expect(passingError.message).toContain(attack.expectedMessage);
          expect(passingError.message).not.toContain(sensitiveMarker);

          const failedEvaluation = await evaluateObjectiveMetricsForOutcome({
            fixtureId: "untrusted-file-metric",
            metricSpecs: [metricSpec(fileSource.source)],
            workingDir,
            executionProfile: TEST_EXECUTION_PROFILE,
            runIndex: 0,
            repeatCount: 1,
            outcome: "fail",
          });
          expect(failedEvaluation.objectiveMetrics).toEqual([]);
          expect(failedEvaluation.objectiveMetricErrors).toEqual([
            expect.objectContaining({
              reason: "source-failed",
              message: expect.stringContaining(attack.expectedMessage),
            }),
          ]);
          expect(failedEvaluation.objectiveMetricErrors[0]?.message).not.toContain(
            sensitiveMarker,
          );
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      });
    }
  }
});
