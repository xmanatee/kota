import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDecisionAttributionReport } from "./decision-attribution.js";
import {
  builderTrigger,
  NOW,
  ownerInterventions,
  ownerRecord,
  recordByRun,
  run,
  task,
  writeEvidence,
  writeWriterIntegration,
} from "./decision-attribution.test-support.js";

describe("buildDecisionAttributionReport", () => {
  let projectDir: string;
  let runsDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `decision-attribution-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    runsDir = join(projectDir, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("classifies attribution, hard success, and weak-evidence cases from visible artifacts", () => {
    const ownerProduct = task("task-owner-product", {
      taskClass: "Product",
      body: "## Source / Intent\n\nOwner requested the report output.\n",
    });
    const kotaPlanned = task("task-kota-planned", {
      body: "## Problem\n\nReview-scrutiny generated this repair task.\n",
    });
    const mixed = task("task-mixed", {
      body: "## Source / Intent\n\nOwner requested a follow-up from an explorer run.\n",
    });
    const weakProduct = task("task-weak-product", {
      taskClass: "Product",
      body: "## Source / Intent\n\nOwner requested a CLI improvement.\n",
    });
    const tasks = new Map(
      [ownerProduct, kotaPlanned, mixed, weakProduct].map((entry) => [
        entry.id,
        entry,
      ]),
    );

    writeWriterIntegration(runsDir, "run-owner-product");
    writeEvidence(runsDir, "run-owner-product", "operator-journey-transcript.txt");
    writeWriterIntegration(runsDir, "run-kota-planned");
    writeWriterIntegration(runsDir, "run-mixed");
    writeWriterIntegration(runsDir, "run-weak-product");

    const report = buildDecisionAttributionReport({
      runs: [
        run("run-owner-product", {
          trigger: builderTrigger(ownerProduct.id),
          steps: [
            {
              id: "validation",
              type: "code",
              status: "success",
              startedAt: NOW,
              completedAt: NOW,
              durationMs: 1,
            },
          ],
        }),
        run("run-kota-planned", { trigger: builderTrigger(kotaPlanned.id) }),
        run("run-mixed", { trigger: builderTrigger(mixed.id) }),
        run("run-unknown", { workflow: "manual-review" }),
        run("run-weak-product", {
          trigger: builderTrigger(weakProduct.id),
          steps: [
            {
              id: "test",
              type: "code",
              status: "success",
              startedAt: NOW,
              completedAt: NOW,
              durationMs: 1,
            },
          ],
        }),
        run("run-failed-tests", {
          status: "failed",
          steps: [
            {
              id: "test",
              type: "code",
              status: "failed",
              startedAt: NOW,
              completedAt: NOW,
              durationMs: 1,
              output: { repairIterations: [{ failures: [{ id: "test" }] }] },
            },
          ],
        }),
      ],
      runsDir,
      taskById: tasks,
      reviewRecords: [
        {
          schemaVersion: 2,
          surface: "critic",
          runId: "run-owner-product",
          workflow: "builder",
          generatedAt: NOW,
          artifact: "critic-review.json",
          taskId: ownerProduct.id,
          decision: "pass",
          signals: { issueCount: 0, warningCount: 0, reviewBodyLength: 20 },
          absentMetrics: [],
          thinAcceptance: false,
        },
        {
          schemaVersion: 2,
          surface: "critic",
          runId: "run-failed-tests",
          workflow: "builder",
          generatedAt: NOW,
          artifact: "critic-review.json",
          decision: "fail",
          signals: { issueCount: 1, warningCount: 0, reviewBodyLength: 20 },
          absentMetrics: [],
          thinAcceptance: false,
        },
      ],
      ownerInterventions: ownerInterventions([
        ownerRecord("owner-mixed", {
          runId: "run-mixed",
          taskId: mixed.id,
          outcomeBucket: "freeform-correction",
          answerBehavior: "workflow-resume",
        }),
      ]),
    });

    const records = recordByRun(report.records);
    expect(records.get("run-owner-product")).toMatchObject({
      workMode: "Product",
      planning: "owner",
      execution: "kota",
    });
    expect(records.get("run-owner-product")?.hardSuccessSignals).toEqual([
      "accepted-critic-verdict",
      "committed-task-completion",
      "passing-validation",
      "rendered-product-evidence",
    ]);
    expect(records.get("run-kota-planned")).toMatchObject({
      planning: "kota",
      planningContext: "insufficient",
    });
    expect(records.get("run-mixed")).toMatchObject({
      planning: "mixed",
      execution: "mixed",
      troubleSignals: ["owner-correction"],
    });
    expect(records.get("run-unknown")).toMatchObject({
      planning: "unknown",
      execution: "unknown",
      troubleSignals: ["claimed-success-without-hard-evidence"],
    });
    expect(records.get("run-weak-product")?.hardSuccessSignals).toContain(
      "passing-validation",
    );
    expect(records.get("run-weak-product")?.hardSuccessSignals).not.toContain(
      "rendered-product-evidence",
    );
    expect(records.get("run-weak-product")?.troubleSignals).toContain(
      "weak-product-success-evidence",
    );
    expect(records.get("run-failed-tests")?.troubleSignals).toEqual([
      "failed-critic-verdict",
      "failed-run",
      "failed-tests",
      "repair-loop-exhaustion",
      "repeated-retries",
    ]);
    expect(report.warnings.map((warning) => warning.kind)).toEqual([
      "kota-planning-without-context",
      "success-lacks-hard-evidence",
    ]);
  });
});
