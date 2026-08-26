import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonLiveStatus } from "#core/daemon/daemon-control.js";
import { formatDaemonStatus } from "./index.js";

function makeLiveStatus(overrides: Partial<DaemonLiveStatus> = {}): DaemonLiveStatus {
  return {
    pid: 12345,
    startedAt: new Date(Date.now() - 3_600_000).toISOString(),
    running: true,
    workflow: {
      activeRuns: [],
      pendingRuns: [],
      queueLength: 0,
      completedRuns: 10,
      paused: false,
      concurrency: 4,
      workflows: {},
    },
    sessions: [],
    channels: [],
    ...overrides,
  };
}

describe("formatDaemonStatus", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T01:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("shows relative uptime instead of raw seconds", () => {
    const status = makeLiveStatus({ startedAt: "2026-01-01T00:00:00Z" });
    const output = formatDaemonStatus(status, false);
    expect(output).toContain("up 1h 0m");
    expect(output).not.toContain("3600s");
  });

  it("shows relative time for start instead of ISO timestamp", () => {
    const status = makeLiveStatus({ startedAt: "2026-01-01T00:00:00Z" });
    const output = formatDaemonStatus(status, false);
    expect(output).toContain("1h ago");
    expect(output).not.toContain("2026-01-01T00:00:00");
  });

  it("shows active runs with workflow name and duration", () => {
    const status = makeLiveStatus({
      workflow: {
        activeRuns: [{ runId: "2026-04-15T13-13-57-840Z-builder-i8tz5a", workflow: "builder", startedAt: "2026-01-01T00:58:00Z" }],
        pendingRuns: [],
        queueLength: 0,
        completedRuns: 0,
        paused: false,
        concurrency: 4,
        workflows: {},
      },
    });
    const output = formatDaemonStatus(status, false);
    expect(output).toMatch(/Activity\s+-+/);
    expect(output).toMatch(/^\s*Active\s+Duration\s+Run/m);
    expect(output).toContain("builder");
    expect(output).toContain("2m 0s");
  });

  it("abbreviates run IDs in active runs", () => {
    const status = makeLiveStatus({
      workflow: {
        activeRuns: [{ runId: "2026-04-15T13-13-57-840Z-builder-i8tz5a", workflow: "builder", startedAt: "2026-01-01T00:58:00Z" }],
        pendingRuns: [],
        queueLength: 0,
        completedRuns: 0,
        paused: false,
        concurrency: 4,
        workflows: {},
      },
    });
    const output = formatDaemonStatus(status, false);
    expect(output).toContain("i8tz5a");
    expect(output).not.toContain("2026-04-15T13-13-57-840Z-builder-i8tz5a");
  });

  it("shows pending runs summarized with overflow count", () => {
    const pending = Array.from({ length: 8 }, (_, i) => ({
      workflowName: `workflow-${i}`,
      trigger: { type: "event" as const, event: "test", schemaRef: null, payload: {} },
      enqueuedAtMs: Date.now(),
      notBeforeMs: 0,
    }));
    const status = makeLiveStatus({
      workflow: {
        activeRuns: [],
        pendingRuns: pending,
        queueLength: 8,
        completedRuns: 0,
        paused: false,
        concurrency: 4,
        workflows: {},
      },
    });
    const output = formatDaemonStatus(status, false);
    expect(output).toMatch(/Pending\s+\(\+3 more\)/);
    expect(output).toContain("workflow-0");
    expect(output).not.toContain("workflow-7");
    expect(output).toContain("0 active · 8 pending");
  });

  it("shows whether the OS service unit is installed", () => {
    const status = makeLiveStatus();
    expect(formatDaemonStatus(status, true)).toContain("yes (OS service installed)");
    expect(formatDaemonStatus(status, false)).toMatch(/Service:\s+not installed/);
  });

  it("shows paused status", () => {
    const status = makeLiveStatus({
      workflow: {
        activeRuns: [],
        pendingRuns: [],
        queueLength: 0,
        completedRuns: 0,
        paused: true,
        concurrency: 4,
        workflows: {},
      },
    });
    const output = formatDaemonStatus(status, false);
    expect(output).toMatch(/Paused:\s+yes/);
  });

  it("renders state and activity as visually separated dashboard sections", () => {
    const status = makeLiveStatus({
      startedAt: "2026-01-01T00:00:00Z",
      workflow: {
        activeRuns: [
          { runId: "2026-04-15T13-13-57-840Z-builder-i8tz5a", workflow: "builder", startedAt: "2026-01-01T00:55:00Z" },
        ],
        pendingRuns: [
          { workflowName: "explorer", trigger: { event: "test", schemaRef: null, payload: {} }, enqueuedAtMs: Date.now(), notBeforeMs: 0, runId: "2026-04-15T14-00-00-000Z-explorer-abc123" },
        ],
        queueLength: 1,
        completedRuns: 4,
        paused: false,
        concurrency: 4,
        workflows: {},
      },
    });
    const output = formatDaemonStatus(status, false);
    const lines = output.split("\n");
    const stateLine = lines.findIndex((l) => /^State\s/.test(l));
    const activityLine = lines.findIndex((l) => /^Activity\s/.test(l));
    expect(stateLine).toBeGreaterThanOrEqual(0);
    expect(activityLine).toBeGreaterThan(stateLine);
    expect(lines[activityLine - 1]).toBe("");
    expect(lines[activityLine - 2]).toBe("");

    const stateOccurrences = lines.filter((l) => /^State\s/.test(l)).length;
    const activityOccurrences = lines.filter((l) => /^Activity\s/.test(l)).length;
    expect(stateOccurrences).toBe(1);
    expect(activityOccurrences).toBe(1);

    expect(output).not.toMatch(/Work\s*$/m);
    expect(output).not.toMatch(/Cost.*Defs/);
    expect(output).not.toMatch(/^\s+Cost:/m);
    expect(output).toContain("1 active · 1 pending · 4 completed");
  });

  it("surfaces a paused notice section above state when scheduler is paused", () => {
    const status = makeLiveStatus({
      workflow: {
        activeRuns: [],
        pendingRuns: [],
        queueLength: 0,
        completedRuns: 0,
        paused: true,
        concurrency: 4,
        workflows: {},
      },
    });
    const output = formatDaemonStatus(status, false);
    const lines = output.split("\n");
    const noticeIdx = lines.findIndex((l) => /^Notice\s/.test(l));
    const stateIdx = lines.findIndex((l) => /^State\s/.test(l));
    expect(noticeIdx).toBeGreaterThanOrEqual(0);
    expect(stateIdx).toBeGreaterThan(noticeIdx);
    expect(output).toContain("workflow scheduler paused");
  });
});
