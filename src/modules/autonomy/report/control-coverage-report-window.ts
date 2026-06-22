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
  type ControlMonitorCoverageReport,
} from "./control-coverage-report.js";
import { renderControlCoverage } from "./render-control-coverage.js";

export type AutonomyReportDataWithControlCoverage = AutonomyReportData & {
  controlCoverage: ControlMonitorCoverageReport;
};

export type ControlCoverageReportWindowInput = {
  runsDir: string;
  windowStartMs: number;
  windowEndMs: number;
};

export function buildControlCoverageReportForWindow(
  input: ControlCoverageReportWindowInput,
): ControlMonitorCoverageReport {
  const runs = loadRunsInWindow(input.runsDir, input.windowStartMs).filter(
    (run) => Date.parse(run.startedAt) <= input.windowEndMs,
  );
  return buildControlCoverageReport(runs, input.runsDir);
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
