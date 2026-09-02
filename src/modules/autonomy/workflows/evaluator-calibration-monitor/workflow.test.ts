import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import { getCriticPromptHash } from "#modules/autonomy/critic.js";
import {
  EVALUATOR_CALIBRATION_ARTIFACT,
  EVALUATOR_CALIBRATION_DISPOSITIONS_ARTIFACT,
  type EvaluatorCalibrationArtifact,
} from "#modules/autonomy/evaluator-calibration.js";
import { projectAutonomyHealthEvidenceRefsForReview } from "#modules/autonomy/health-review-evidence-policy.js";
import {
  type AutonomyHealthSignal,
  autonomyHealthSignal,
} from "#modules/autonomy/health-signal.js";
import evaluatorCalibrationMonitor from "./workflow.js";

function seedCalibration(
  runsDir: string,
  runId: string,
  completedAt: string,
  verdict: EvaluatorCalibrationArtifact["verdict"],
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
    terminalRunStatus: verdict === "fail" ? "failed" : "success",
    taskId: null,
    taskFinalState: null,
    sourceRevision: "1111111111111111111111111111111111111111",
    sourceFilesChanged: ["src/core/a.ts"],
    criticPromptHash: getCriticPromptHash(),
  };
  writeFileSync(
    join(runDir, EVALUATOR_CALIBRATION_ARTIFACT),
    JSON.stringify(artifact, null, 2),
  );
}

const builderCompletionTrigger = {
  event: "workflow.completed",
  payload: {
    workflow: "builder",
    runId: "run-newer",
    status: "success",
    triggerEvent: "autonomy.queue.available",
    durationMs: 1_000,
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    runDir: ".kota/runs/run-newer",
    tags: ["monitored"],
  },
} as const;

describe("evaluator-calibration-monitor workflow", () => {
  let workspaceRoot: string;
  let runsDir: string;
  const originalThreshold = process.env.KOTA_EVALUATOR_CALIBRATION_THRESHOLD_RATE;
  const originalMinSample = process.env.KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE;
  const originalPwwMinSample = process.env.KOTA_EVALUATOR_CALIBRATION_PWW_MIN_SAMPLE;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "cal-monitor-"));
    runsDir = join(workspaceRoot, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
    process.env.KOTA_EVALUATOR_CALIBRATION_THRESHOLD_RATE = "0.25";
    process.env.KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE = "1";
    process.env.KOTA_EVALUATOR_CALIBRATION_PWW_MIN_SAMPLE = "100";
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
    const restore = (name: string, value: string | undefined): void => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore("KOTA_EVALUATOR_CALIBRATION_THRESHOLD_RATE", originalThreshold);
    restore("KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE", originalMinSample);
    restore("KOTA_EVALUATOR_CALIBRATION_PWW_MIN_SAMPLE", originalPwwMinSample);
  });

  it("registers as a read-only observer of completed builder runs", () => {
    const registered = registerWorkflowDefinition(
      "src/modules/autonomy/workflows/evaluator-calibration-monitor/workflow.ts",
      evaluatorCalibrationMonitor,
    );
    expect(registered.repository).toBe("none");
    expect(registered.triggers.map((trigger) => trigger.event)).toEqual([
      "workflow.completed",
    ]);
  });

  it("publishes gated evidence without creating repository work", async () => {
    const now = Date.now();
    seedCalibration(
      runsDir,
      "run-older",
      new Date(now - 5 * 60 * 60 * 1_000).toISOString(),
      "pass",
    );
    seedCalibration(
      runsDir,
      "run-newer",
      new Date(now - 60 * 60 * 1_000).toISOString(),
      "fail",
    );
    const dispositionsDir = join(
      runsDir,
      "run-review",
      "evidence",
      "artifacts",
    );
    mkdirSync(dispositionsDir, { recursive: true });
    writeFileSync(
      join(dispositionsDir, EVALUATOR_CALIBRATION_DISPOSITIONS_ARTIFACT),
      JSON.stringify({
        schemaVersion: 1,
        records: [{
          base: {
            runId: "run-older",
            sourceRevision: "1111111111111111111111111111111111111111",
          },
          later: {
            runId: "run-newer",
            sourceRevision: "1111111111111111111111111111111111111111",
          },
          disposition: {
            kind: "accepted-overlap",
            rationale: "The overlap was reviewed and accepted as unrelated behavior.",
            decidedAt: new Date(now - 30 * 60 * 1_000).toISOString(),
          },
        }],
        unavailableSources: [],
      }),
    );

    const result = await new WorkflowScenarioDriver(evaluatorCalibrationMonitor, {
      workspaceRoot,
      trigger: builderCompletionTrigger,
    }).run();

    expect(result.status).toBe("success");
    expect(
      result.emitted.filter(
        (event) => event.event === "evaluator-calibration.regression.detected",
      ),
    ).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          driftKinds: ["pass-contradiction"],
          passContradictionCount: 1,
          passContradictions: [{
            base: expect.objectContaining({ runId: "run-older" }),
            later: expect.objectContaining({ runId: "run-newer" }),
            laterFailure: { verdict: "fail", terminalRunStatus: "failed" },
            overlappingSourcePaths: ["src/core/a.ts"],
            disposition: expect.objectContaining({ kind: "accepted-overlap" }),
          }],
        }),
      }),
    ]);
    expect(
      result.emitted.filter((event) => event.event === autonomyHealthSignal.name),
    ).toHaveLength(1);
    expect(existsSync(join(workspaceRoot, "data", "tasks"))).toBe(false);

    const observation = JSON.parse(
      readFileSync(
        join(result.runDirPath, "evaluator-calibration-observation.json"),
        "utf-8",
      ),
    ) as Record<string, unknown>;
    expect(observation).toMatchObject({
      runId: basename(result.runDirPath),
      sourceRunId: "run-newer",
      status: "gated",
      driftKinds: ["pass-contradiction"],
      aggregate: expect.objectContaining({
        passContradictions: [
          expect.objectContaining({
            base: expect.objectContaining({ runId: "run-older" }),
            later: expect.objectContaining({ runId: "run-newer" }),
            disposition: expect.objectContaining({ kind: "accepted-overlap" }),
          }),
        ],
      }),
    });
    const healthSignal = result.emitted.find(
      (event) => event.event === autonomyHealthSignal.name,
    );
    const healthPayload = healthSignal?.payload as AutonomyHealthSignal | undefined;
    expect(healthPayload?.summary).toContain(
      "run-older@111111111111 -> run-newer@111111111111",
    );
    expect(healthPayload?.summary).toContain(
      "disposition=accepted-overlap rationale=The overlap was reviewed",
    );
    expect(healthPayload?.evidenceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "event",
          ref: expect.stringContaining(
            "run-older@1111111111111111111111111111111111111111->run-newer",
          ),
          summary: expect.stringContaining(
            "laterFailure=fail/failed paths=src/core/a.ts " +
              "disposition=accepted-overlap rationale=The overlap was reviewed",
          ),
        }),
      ]),
    );
    expect(
      projectAutonomyHealthEvidenceRefsForReview(
        healthPayload?.evidenceRefs ?? [],
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "event",
          summary: expect.stringContaining("disposition=accepted-overlap"),
        }),
      ]),
    );
    expect(observation).not.toHaveProperty("proposal");
    expect(observation).not.toHaveProperty("applied");
  });

  it("records healthy calibration without emitting a regression", async () => {
    process.env.KOTA_EVALUATOR_CALIBRATION_THRESHOLD_RATE = "0.9";
    process.env.KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE = "2";
    const now = Date.now();
    seedCalibration(
      runsDir,
      "run-older",
      new Date(now - 2 * 60 * 60 * 1_000).toISOString(),
      "pass",
    );
    seedCalibration(
      runsDir,
      "run-newer",
      new Date(now - 60 * 60 * 1_000).toISOString(),
      "pass",
    );

    const result = await new WorkflowScenarioDriver(evaluatorCalibrationMonitor, {
      workspaceRoot,
      trigger: builderCompletionTrigger,
    }).run();

    expect(
      result.emitted.filter(
        (event) => event.event === "evaluator-calibration.regression.detected",
      ),
    ).toHaveLength(0);
    const observation = JSON.parse(
      readFileSync(
        join(result.runDirPath, "evaluator-calibration-observation.json"),
        "utf-8",
      ),
    ) as Record<string, unknown>;
    expect(observation).toMatchObject({ status: "under-threshold", driftKinds: [] });
  });
});
