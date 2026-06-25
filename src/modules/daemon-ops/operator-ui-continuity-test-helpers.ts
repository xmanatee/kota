import type { ContinuityProjectionInput } from "./operator-ui.js";
import type { StatusSnapshot } from "./status-cli.js";

function status(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    daemonRunning: false,
    activeRuns: 0,
    queuedRuns: 0,
    workflowPaused: false,
    sessions: 0,
    pendingApprovals: 0,
    projectDir: "/repo",
    projectName: "repo",
    controlFile: { kind: "missing" },
    historicalWorkflow: {
      activeRuns: 0,
      queuedRuns: 2,
      workflowPaused: false,
    },
    ...overrides,
  };
}

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function continuityInput(
  overrides: Partial<ContinuityProjectionInput> = {},
): ContinuityProjectionInput {
  return {
    status: status({
      daemonRunning: true,
      scopedProject: {
        projectId: "p-kota-fixture-default",
        displayName: "kota",
        projectDir: "/repo",
      },
    }),
    tasks: ok({
      tasks: [
        {
          id: "task-active-work",
          priority: "p2",
          title: "Improve operator continuity",
          state: "doing",
          waitingOnTasks: [],
        },
      ],
    }),
    workflowStatus: ok({
      activeRuns: [
        {
          runId: "2026-06-25T10-00-00-000Z-builder-active",
          workflow: "builder",
          startedAt: "2026-06-25T10:00:00.000Z",
        },
      ],
      pendingRuns: [],
      queueLength: 0,
      completedRuns: 4,
      workflows: {},
      paused: false,
      agentConcurrency: 1,
      codeConcurrency: 4,
      pendingAbort: false,
    }),
    runs: ok({
      runs: [
        {
          id: "2026-06-25T09-00-00-000Z-builder-success",
          workflow: "builder",
          status: "success",
          triggerEvent: "autonomy.queue.available",
          triggerSchemaRef: null,
          startedAt: "2026-06-25T09:00:00.000Z",
        },
      ],
    }),
    definitions: ok({
      source: "daemon",
      definitions: [
        {
          name: "daily-digest",
          enabled: true,
          stepCount: 2,
          triggers: [{ type: "cron", schedule: "0 9 * * *" }],
        },
      ],
    }),
    approvals: ok({ approvals: [] }),
    ownerQuestions: ok({ questions: [] }),
    ownerDecisions: ok({ decisions: [] }),
    setup: ok({
      requirements: [],
      summary: {
        ready: 0,
        missing: 0,
        pending: 0,
        expired: 0,
        revoked: 0,
        unknown: 0,
        unavailable: 0,
      },
    }),
    memory: ok({
      entries: [
        {
          id: "mem-1",
          created: "2026-06-25T08:00:00.000Z",
          content: "Recent work changed the continuity surface.",
        },
      ],
    }),
    knowledge: ok({
      entries: [
        {
          id: "kn-1",
          title: "Continuity design notes",
          type: "decision",
          tags: [],
          status: "active",
          created: "2026-06-25T08:00:00.000Z",
          updated: "2026-06-25T08:00:00.000Z",
          content: "Keep clients on the daemon contract.",
          meta: {},
        },
      ],
    }),
    ...overrides,
  };
}
