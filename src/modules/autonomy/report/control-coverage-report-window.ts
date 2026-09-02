import { join } from "node:path";
import {
  PRUNED_RUN_REFERENCES_FILE,
  readPrunedWorkflowRunReferences,
} from "#core/workflow/run-store-retention.js";
import {
  blank,
  heading,
  type RenderNode,
  stack,
} from "#modules/rendering/primitives.js";
import { loadRunsInWindow } from "#modules/workflow-ops/runs/workflow-history.js";
import type { AutonomyReportData } from "./aggregate.js";
import {
  buildControlCoverageReport,
  type ControlCoverageEvidenceGap,
  type ControlMonitorCoverageReport,
  policyPrunedControlCoverageEvidenceGapsForWindow,
} from "./control-coverage-report.js";
import { renderControlCoverage } from "./render-control-coverage.js";

export type AutonomyReportDataWithControlCoverage = AutonomyReportData & {
  controlCoverage: ControlMonitorCoverageReport;
};

export type ControlCoverageReportWindowInput = {
  runsDir: string;
  stateDir: string;
  scopeRoot: string;
  windowStartMs: number;
  windowEndMs: number;
};

function prunedRunEvidenceGapsForWindow(
  input: ControlCoverageReportWindowInput,
): ControlCoverageEvidenceGap[] {
  try {
    return policyPrunedControlCoverageEvidenceGapsForWindow(
      readPrunedWorkflowRunReferences(input.runsDir),
      input.windowStartMs,
      input.windowEndMs,
    );
  } catch (error) {
    return [
      {
        kind: "producer-missing",
        reasonCode: "producer-missing",
        ref: join(".kota", "runs", PRUNED_RUN_REFERENCES_FILE),
        summary: `Pruned run references could not be read: ${String(error)}`,
      },
    ];
  }
}

export function buildControlCoverageReportForWindow(
  input: ControlCoverageReportWindowInput,
): ControlMonitorCoverageReport {
  const runs = loadRunsInWindow(input.runsDir, input.windowStartMs, {
    stateDir: input.stateDir,
    scopeRoot: input.scopeRoot,
  }).filter(
    (run) => Date.parse(run.startedAt) <= input.windowEndMs,
  );
  return buildControlCoverageReport(runs, input.runsDir, {
    evidenceGaps: prunedRunEvidenceGapsForWindow(input),
  });
}

export function attachControlCoverageToReport(
  data: AutonomyReportData,
  input: ControlCoverageReportWindowInput,
): AutonomyReportDataWithControlCoverage {
  return {
    ...data,
    controlCoverage: buildControlCoverageReportForWindow(input),
  };
}

export function renderAutonomyReportWithControlCoverage(
  data: AutonomyReportDataWithControlCoverage,
  baseReport: RenderNode,
): RenderNode {
  return stack(
    baseReport,
    blank(),
    heading("Control coverage", 2),
    ...renderControlCoverage(data.controlCoverage),
  );
}
