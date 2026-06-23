import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { collectReviewScrutinyReport } from "./review-scrutiny.js";

const NOW = "2026-06-23T12:00:00.000Z";

function writeRunMetadata(
  runsDir: string,
  id: string,
  workflow: string,
  overrides: Partial<WorkflowRunMetadata> = {},
): WorkflowRunMetadata {
  const run: WorkflowRunMetadata = {
    id,
    workflow,
    definitionPath: `src/modules/autonomy/workflows/${workflow}/workflow.ts`,
    trigger: { event: "test", schemaRef: null, payload: {} },
    startedAt: NOW,
    completedAt: NOW,
    status: "success",
    runDir: `.kota/runs/${id}`,
    steps: [],
    ...overrides,
  };
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "metadata.json"), JSON.stringify(run), "utf-8");
  return run;
}

function writeJson(runsDir: string, runId: string, file: string, value: object): void {
  writeFileSync(
    join(runsDir, runId, file),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf-8",
  );
}

function progressReview(verdict: string, localScope: object): object {
  return {
    generatedAt: NOW,
    evidence: {},
    reviewInput: {},
    review: {
      verdict,
      summary: "Reviewed the current evidence window.",
      findings: {
        crossScope: { claims: [], followUpTasks: [] },
        localScope,
      },
      ownerQuestions: [],
    },
    actions: { createdTaskIds: [], ownerQuestionIds: [], applied: [], touchedTaskQueue: false },
  };
}

describe("review scrutiny aggregation", () => {
  let projectDir: string;
  let runsDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `review-scrutiny-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    runsDir = join(projectDir, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("records a critic pass with warnings as non-thin scrutiny", () => {
    const run = writeRunMetadata(runsDir, "builder-run", "builder");
    writeJson(runsDir, run.id, "critic-review.json", {
      verdict: "pass_with_warnings",
      critical_issues: [],
      warnings: ["Follow-up task already tracks the caveat."],
      summary: "Complete with a traced warning.",
    });

    const report = collectReviewScrutinyReport({ runsDir, runs: [run] });

    expect(report.records).toHaveLength(1);
    expect(report.records[0]).toMatchObject({
      surface: "critic",
      decision: "pass_with_warnings",
      thinAcceptance: false,
      signals: { issueCount: 0, warningCount: 1 },
      absentMetrics: [
        "evidenceIdCount",
        "findingCount",
        "followUpTaskCount",
      ],
    });
    expect(Object.hasOwn(report.records[0]?.signals ?? {}, "issueCount")).toBe(true);
    expect(report.records[0]?.signals.evidenceIdCount).toBeUndefined();
    expect(report.absentMetricCount).toBe(3);
    expect(report.absentMetricRefs[0]).toMatchObject({
      runId: run.id,
      surface: "critic",
      metrics: [
        "evidenceIdCount",
        "findingCount",
        "followUpTaskCount",
      ],
    });
    expect(report.thinAcceptances).toBe(0);
  });

  it("records a clean critic pass with file-line citations as non-thin", () => {
    const run = writeRunMetadata(runsDir, "builder-cited-run", "builder");
    writeJson(runsDir, run.id, "critic-review.json", {
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Done When coverage is visible in src/modules/autonomy/critic.ts:98.",
    });

    const report = collectReviewScrutinyReport({ runsDir, runs: [run] });

    expect(report.records[0]).toMatchObject({
      surface: "critic",
      decision: "pass",
      thinAcceptance: false,
      signals: {
        issueCount: 0,
        warningCount: 0,
        citedFileLineCount: 1,
      },
      absentMetrics: [
        "evidenceIdCount",
        "findingCount",
        "followUpTaskCount",
      ],
    });
    expect(report.thinAcceptances).toBe(0);
  });

  it("links task-backed critic reviews from run-summary and step outputs", () => {
    const summaryRun = writeRunMetadata(runsDir, "summary-builder-run", "builder");
    writeJson(runsDir, summaryRun.id, "run-summary.json", {
      taskId: "task-from-run-summary",
    });
    writeJson(runsDir, summaryRun.id, "critic-review.json", {
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Accepted with no findings.",
    });

    const stepRun = writeRunMetadata(runsDir, "step-builder-run", "builder", {
      steps: [
        {
          id: "write-run-summary",
          type: "code",
          status: "success",
          startedAt: NOW,
          completedAt: NOW,
          durationMs: 1,
          output: { taskId: "task-from-step-output" },
        },
      ],
    });
    writeJson(runsDir, stepRun.id, "critic-review.json", {
      verdict: "pass_with_warnings",
      critical_issues: [],
      warnings: ["Tracked follow-up exists."],
      summary: "Accepted with a warning.",
    });

    const report = collectReviewScrutinyReport({
      runsDir,
      runs: [summaryRun, stepRun],
    });

    expect(report.records.map((record) => record.taskId)).toEqual([
      "task-from-run-summary",
      "task-from-step-output",
    ]);
    expect(report.thinAcceptanceRefs[0]).toMatchObject({
      runId: summaryRun.id,
      taskId: "task-from-run-summary",
    });
  });

  it("records progress-reviewer on-track reviews with cited evidence as non-thin", () => {
    const run = writeRunMetadata(runsDir, "progress-run", "progress-reviewer");
    writeJson(
      runsDir,
      run.id,
      "progress-review.json",
      progressReview("on-track", {
        claims: [
          {
            id: "local-pass",
            claim: "The recent builder run closed the task.",
            evidenceIds: ["run:builder-1", "task:task-a"],
            confidence: "high",
          },
        ],
        followUpTasks: [],
      }),
    );

    const report = collectReviewScrutinyReport({ runsDir, runs: [run] });

    expect(report.records[0]).toMatchObject({
      surface: "progress-reviewer",
      decision: "on-track",
      thinAcceptance: false,
      signals: { evidenceIdCount: 2, findingCount: 1 },
    });
  });

  it("flags progress-reviewer on-track reviews with no findings or evidence as thin", () => {
    const run = writeRunMetadata(runsDir, "thin-progress-run", "progress-reviewer");
    writeJson(
      runsDir,
      run.id,
      "progress-review.json",
      progressReview("on-track", { claims: [], followUpTasks: [] }),
    );

    const report = collectReviewScrutinyReport({ runsDir, runs: [run] });

    expect(report.thinAcceptances).toBe(1);
    expect(report.thinAcceptanceRefs).toEqual([
      {
        runId: run.id,
        workflow: "progress-reviewer",
        surface: "progress-reviewer",
        decision: "on-track",
        artifact: "progress-review.json",
      },
    ]);
  });

  it("counts concrete PR review file-line citations on approvals", () => {
    const run = writeRunMetadata(runsDir, "pr-run", "pr-reviewer", {
      steps: [
        {
          id: "prepare-comment",
          type: "code",
          status: "success",
          startedAt: NOW,
          completedAt: NOW,
          durationMs: 1,
          output: {
            repo: "owner/repo",
            prNumber: 42,
            recommendation: "approve",
            body: "Looks covered by src/modules/foo.ts:12 and clients/web/App.tsx#L44.",
          },
        },
      ],
    });

    const report = collectReviewScrutinyReport({ runsDir, runs: [run] });

    expect(report.records[0]).toMatchObject({
      surface: "pr-reviewer",
      decision: "approve",
      thinAcceptance: false,
      pr: { repo: "owner/repo", number: 42 },
      signals: { citedFileLineCount: 2 },
    });
  });

  it("counts malformed or old reviewer artifacts as unsupported without crashing", () => {
    const run = writeRunMetadata(runsDir, "old-run", "builder");
    writeFileSync(join(runsDir, run.id, "critic-review.json"), "{not-json", "utf-8");

    const report = collectReviewScrutinyReport({ runsDir, runs: [run] });

    expect(report.records).toEqual([]);
    expect(report.unsupportedArtifacts).toBe(1);
    expect(report.unsupported[0]).toMatchObject({
      runId: run.id,
      workflow: "builder",
      artifact: "critic-review.json",
    });
  });

  it("counts partial critic verdict artifacts as unsupported", () => {
    const run = writeRunMetadata(runsDir, "partial-run", "builder");
    writeJson(runsDir, run.id, "critic-review.json", {
      verdict: "pass",
    });

    const report = collectReviewScrutinyReport({ runsDir, runs: [run] });

    expect(report.records).toEqual([]);
    expect(report.unsupportedArtifacts).toBe(1);
    expect(report.unsupported[0]).toMatchObject({
      runId: run.id,
      workflow: "builder",
      artifact: "critic-review.json",
      reason: "unsupported critic verdict fields",
    });
  });
});
