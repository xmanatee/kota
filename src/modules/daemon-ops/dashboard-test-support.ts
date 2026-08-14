import { renderToString } from "#modules/rendering/transport.js";
import type {
  DashboardSnapshot,
  formatStatsGrid,
} from "./dashboard.js";

export function stripAnsi(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching ESC.
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

export function renderGridLines(
  lines: ReturnType<typeof formatStatsGrid>,
): string[] {
  return lines.map((node) => stripAnsi(renderToString(node)));
}

export function makeSnapshot(
  overrides: Partial<DashboardSnapshot> = {},
): DashboardSnapshot {
  return {
    pid: 12345,
    startedAt: new Date(Date.now() - 3_600_000).toISOString(),
    running: true,
    stopping: false,
    completedRuns: 42,
    activeRuns: [],
    pendingRuns: [],
    dispatchPaused: false,
    definitionCount: 5,
    sessionCount: 2,
    ...overrides,
  };
}

export function pendingRun(
  workflowName: string,
  notBeforeMs = Date.now(),
): DashboardSnapshot["pendingRuns"][number] {
  return {
    runId: `2026-04-21T17-01-09-667Z-${workflowName}-w8047d`,
    workflowName,
    trigger: { event: "workflow.completed", schemaRef: null, payload: {} },
    enqueuedAtMs: Date.now() - 60_000,
    notBeforeMs,
  };
}
