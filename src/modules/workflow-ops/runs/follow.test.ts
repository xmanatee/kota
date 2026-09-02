import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowLiveStatus } from "#core/daemon/daemon-control.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";

const transportMocks = vi.hoisted(() => ({
  getDaemonTransport: vi.fn(),
}));

vi.mock("#core/server/daemon-transport.js", () => ({
  getDaemonTransport: transportMocks.getDaemonTransport,
}));

import { registerFollowCommand } from "./follow.js";

describe("workflow follow", () => {
  const runId = "2026-09-02T00-00-00-000Z-builder-active";
  let previousCwd: string;
  let scopeRoot: string;

  beforeEach(() => {
    previousCwd = process.cwd();
    scopeRoot = join(
      tmpdir(),
      `kota-follow-sse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(scopeRoot, { recursive: true });
    process.chdir(scopeRoot);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    rmSync(scopeRoot, { recursive: true, force: true });
    transportMocks.getDaemonTransport.mockReset();
  });

  function writeTerminalMetadata(): void {
    const runDir = join(scopeRoot, ".kota", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify({
        id: runId,
        workflow: "builder",
        definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
        trigger: { event: "manual", schemaRef: null, payload: {} },
        startedAt: "2026-09-02T00:00:00.000Z",
        status: "success",
        runDir: `.kota/runs/${runId}`,
        steps: [],
      }),
    );
  }

  it("fails before opening SSE when daemon status identifies an active run without metadata", async () => {
    const status: WorkflowLiveStatus = {
      activeRuns: [
        {
          runId,
          workflow: "builder",
          startedAt: "2026-09-02T00:00:00.000Z",
        },
      ],
      pendingRuns: [],
      queueLength: 0,
      completedRuns: 0,
      authorityCriticalRunIds: [runId],
      operationallyActiveRunIds: [runId],
      terminalRunIds: [],
      workflows: {},
      paused: false,
      concurrency: 1,
    };
    const events = vi.fn();
    transportMocks.getDaemonTransport.mockReturnValue({
      request: vi.fn(async () => status),
      events,
    } as unknown as DaemonTransport);
    const command = new Command("workflow");
    command.exitOverride();
    registerFollowCommand(command);

    await expect(
      command.parseAsync(["follow", runId], { from: "user" }),
    ).rejects.toThrow(
      "metadata file is missing for an authority-critical workflow run",
    );
    expect(events).not.toHaveBeenCalled();
  });

  it("accepts terminal evidence retained only for pending publication", async () => {
    writeTerminalMetadata();
    const status: WorkflowLiveStatus = {
      activeRuns: [],
      pendingRuns: [],
      queueLength: 0,
      completedRuns: 0,
      authorityCriticalRunIds: [runId],
      operationallyActiveRunIds: [],
      terminalRunIds: [runId],
      workflows: {},
      paused: false,
      concurrency: 1,
    };
    const events = vi.fn();
    transportMocks.getDaemonTransport.mockReturnValue({
      request: vi.fn(async () => status),
      events,
    } as unknown as DaemonTransport);
    const command = new Command("workflow");
    command.exitOverride();
    registerFollowCommand(command);

    await expect(
      command.parseAsync(["follow", runId], { from: "user" }),
    ).resolves.toBe(command);
    expect(events).not.toHaveBeenCalled();
  });

  it("accepts finalized execution evidence selected from daemon active status", async () => {
    writeTerminalMetadata();
    const status: WorkflowLiveStatus = {
      activeRuns: [{
        runId,
        workflow: "builder",
        startedAt: "2026-09-02T00:00:00.000Z",
      }],
      pendingRuns: [],
      queueLength: 0,
      completedRuns: 0,
      authorityCriticalRunIds: [runId],
      operationallyActiveRunIds: [runId],
      terminalRunIds: [],
      workflows: {},
      paused: false,
      concurrency: 1,
    };
    const events = vi.fn();
    transportMocks.getDaemonTransport.mockReturnValue({
      request: vi.fn(async () => status),
      events,
    } as unknown as DaemonTransport);
    const command = new Command("workflow");
    command.exitOverride();
    registerFollowCommand(command);

    await expect(
      command.parseAsync(["follow", runId], { from: "user" }),
    ).resolves.toBe(command);
    expect(events).not.toHaveBeenCalled();
  });

  it("accepts finalized execution evidence while offline SQLite authority owns the run", async () => {
    writeTerminalMetadata();
    const state = new RunStateDatabase(join(scopeRoot, ".kota"));
    try {
      state.registerScope({
        id: "scope-follow-offline",
        rootPath: realpathSync(scopeRoot),
        createdAt: "2026-09-02T00:00:00.000Z",
      });
      state.admitRun({
        id: runId,
        scopeId: "scope-follow-offline",
        workflow: "builder",
        repository: "read",
        trigger: { event: "manual", schemaRef: null, payload: {} },
        resources: [],
        admittedAt: "2026-09-02T00:00:01.000Z",
      });
      state.requireRunAttention(runId, "recovery required", []);
    } finally {
      state.close();
    }
    transportMocks.getDaemonTransport.mockReturnValue(null);
    const command = new Command("workflow");
    command.exitOverride();
    registerFollowCommand(command);

    await expect(
      command.parseAsync(["follow", runId], { from: "user" }),
    ).resolves.toBe(command);
  });

  it("refuses to follow when daemon status omits durable authority", async () => {
    const status: WorkflowLiveStatus = {
      activeRuns: [],
      pendingRuns: [],
      queueLength: 0,
      completedRuns: 0,
      workflows: {},
      paused: false,
      concurrency: 1,
    };
    const events = vi.fn();
    transportMocks.getDaemonTransport.mockReturnValue({
      request: vi.fn(async () => status),
      events,
    } as unknown as DaemonTransport);
    const command = new Command("workflow");
    command.exitOverride();
    registerFollowCommand(command);

    await expect(
      command.parseAsync(["follow", runId], { from: "user" }),
    ).rejects.toThrow(
      "requires the canonical durable run authority from workflow status",
    );
    expect(events).not.toHaveBeenCalled();
  });
});
