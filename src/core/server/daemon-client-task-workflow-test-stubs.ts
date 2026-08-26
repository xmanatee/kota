import type { DaemonClientHandlers } from "#root/client/kota-client.generated.js";

export function buildTaskAndWorkflowTestStubs(): Pick<
  DaemonClientHandlers,
  "tasks" | "workflow"
> {
  return {
    tasks: {
      list: async () => ({ tasks: [] }),
      show: async () => ({ found: false as const }),
      move: async () => ({ ok: false as const, reason: "not_found" as const }),
      create: async () => ({ ok: true as const, id: "stub", path: "stub" }),
      capture: async () => ({ ok: true as const, id: "stub", path: "stub" }),
      gc: async () => ({ removed: [] }),
      search: async () => ({ ok: true as const, tasks: [] }),
      reindex: async () => ({ indexed: 0, failed: 0 }),
    },
    workflow: {
      listRuns: async () => ({ runs: [] }),
      status: async () => ({
        activeRuns: [],
        pendingRuns: [],
        queueLength: 0,
        completedRuns: 0,
        workflows: {},
        paused: false,
        pendingAbort: false,
        concurrency: 4,
      }),
      pause: async () => ({ paused: true, already: false }),
      resume: async () => ({ paused: false, already: false }),
      abort: async () => ({ status: "applied" as const, count: 0 }),
      reload: async () => ({ status: "applied" as const, count: 0 }),
      enable: async () => ({ ok: false as const, reason: "not_found" as const }),
      disable: async () => ({ ok: false as const, reason: "not_found" as const }),
      cancelRun: async () => ({ ok: false as const, reason: "not_found" as const }),
      abortRun: async () => ({ ok: false as const, reason: "not_found" as const }),
      getRun: async () => ({ found: false as const }),
      listDeadLetters: async () => ({
        items: [],
        counts: { open: 0, dismissed: 0, redriven: 0 },
      }),
      getDeadLetter: async () => ({ found: false as const }),
      dismissDeadLetter: async () => ({ ok: false as const, reason: "not_found" as const }),
      redriveDeadLetter: async () => ({ ok: false as const, reason: "not_found" as const }),
      exportDeadLetterDiagnostics: async () => null,
      listDefinitions: async () => ({
        source: "static" as const,
        definitions: [],
      }),
      triggerByName: async () => ({
        ok: false as const,
        reason: "already_queued" as const,
      }),
      trial: async () => ({
        ok: false as const,
        reason: "daemon_required" as const,
        message: "stub",
      }),
      explain: async () => ({
        graph: {
          workflows: [],
          events: [],
          agents: [],
          automation: {
            workflows: [],
            events: [],
            blockers: [],
            downstream: [],
          },
        },
        query: {},
        outcome: "unknown" as const,
        matches: [],
        reasons: [],
      }),
      simulate: async () => ({
        ok: true as const,
        request: {},
        inputs: [],
        summary: {
          total: 0,
          "would-ignore": 0,
          "would-batch": 0,
          "would-queue": 0,
          "would-block": 0,
          "would-ask-owner": 0,
          "would-dlq": 0,
          "would-perform-effect": 0,
          "would-noop": 0,
          unknown: 0,
        },
      }),
    },
  };
}
