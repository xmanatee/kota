/**
 * Shared test helpers for constructing a `DaemonControlClient` whose
 * non-namespace surface (transport, SSE, registerSession, ...) is the only
 * thing under test.
 *
 * As `KotaClient` namespaces migrate from the core stub into their owning
 * module's `daemonClient(link)` factory, those namespaces stop appearing in
 * `buildCoreStubDaemonClientHandlers`. A test that constructs a daemon
 * client purely to exercise an unrelated method must contribute a stub for
 * each migrated namespace; otherwise `assembleDaemonClientHandlers` fails
 * loudly. This module exports a single canonical stub builder so each
 * such test does not have to redeclare the throwing/no-op shapes itself.
 *
 * The stubs return empty results from the methods they implement. They
 * should never be invoked from a test that asserts namespace behavior; if
 * a test needs real behavior for a namespace, contribute a handler that
 * exercises it instead of relying on the stub.
 */
import type { DaemonClientHandlers } from "./kota-client.js";

/**
 * Build a `Partial<DaemonClientHandlers>` covering every namespace that
 * has migrated out of `buildCoreStubDaemonClientHandlers`. Tests that
 * exercise non-namespace daemon behavior should pass this map as the
 * `contributedHandlers` argument to `DaemonControlClient.fromAddress` (or
 * the `assembleDaemonHandlers` factory threaded through `startServer`)
 * so the assembly coverage check is satisfied.
 */
export function buildMigratedNamespaceTestStubs(): Partial<DaemonClientHandlers> {
  return {
    doctor: {
      run: async () => ({ checks: [] }),
      fix: async () => ({ repairs: [] }),
    },
    harnessParity: {
      list: async () => ({ scenarios: [] }),
      run: async () => ({ ok: true, outBaseDir: "", artifacts: [] }),
    },
    audit: {
      list: async () => ({ entries: [] }),
    },
    retract: {
      retract: async () => ({ ok: false, reason: "no_contributors" }),
    },
    setup: {
      list: async () => ({
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
      submitForm: async () => ({
        ok: false as const,
        reason: "not_found" as const,
        message: "stub",
      }),
      storeSecret: async () => ({
        ok: false as const,
        reason: "not_found" as const,
        message: "stub",
      }),
      start: async () => ({
        ok: false as const,
        reason: "not_found" as const,
        message: "stub",
      }),
      complete: async () => ({
        ok: false as const,
        reason: "not_found" as const,
        message: "stub",
      }),
      refresh: async () => ({
        ok: false as const,
        reason: "not_found" as const,
        message: "stub",
      }),
      revoke: async () => ({
        ok: false as const,
        reason: "not_found" as const,
        message: "stub",
      }),
    },
    answer: {
      answer: async () => ({ ok: false, reason: "no_hits" }),
      log: async () => ({ entries: [] }),
      show: async () => ({ ok: false, reason: "not_found" }),
    },
    ownerDecisions: {
      list: async () => ({ decisions: [] }),
      show: async () => ({ found: false as const }),
      answer: async () => ({ ok: false as const, reason: "not_found" as const }),
      cancel: async () => ({ ok: false as const, reason: "not_found" as const }),
    },
    ownerQuestions: {
      list: async () => ({ questions: [] }),
      answer: async () => ({ ok: false, reason: "not_found" }),
      dismiss: async () => ({ ok: false, reason: "not_found" }),
    },
    modules: {
      list: async () => ({ modules: [] }),
    },
    modulesAdmin: {
      inspect: async () => ({ found: false }),
      reload: async () => ({ ok: false, reason: "not_found" }),
    },
    agents: {
      list: async () => ({ agents: [] }),
      inspect: async () => ({ found: false }),
    },
    skills: {
      list: async () => ({ skills: [] }),
      import: async () => ({
        ok: true,
        skills: [{ name: "stub", path: "stub", sourcePath: "stub", provenance: "stub" }],
      }),
    },
    mcpServer: {
      start: async () => ({ ok: false, reason: "daemon_required" as const }),
    },
    web: {
      start: async () => ({ ok: false, reason: "daemon_required" as const }),
    },
    capture: {
      capture: async () => ({ ok: false, reason: "no_contributors" as const }),
    },
    recall: {
      recall: async () => ({ ok: false, reason: "semantic_unavailable" as const }),
    },
    webhook: {
      list: async () => ({ entries: [] }),
      secretGenerate: async (workflow: string) => ({
        workflow,
        secret: "stub-secret",
        overwrote: false,
      }),
      secretRemove: async (workflow: string) => ({
        ok: true as const,
        workflow,
        removed: false as const,
      }),
    },
    approvals: {
      list: async () => ({ approvals: [] }),
      approve: async () => ({ ok: false as const, reason: "not_found" as const }),
      reject: async () => ({ ok: false as const, reason: "not_found" as const }),
    },
    secrets: {
      list: async () => ({ secrets: [] }),
      get: async () => ({ found: false as const }),
      set: async () => ({ ok: true as const }),
      remove: async () => ({ ok: false as const, reason: "not_found" as const }),
    },
    memory: {
      list: async () => ({ entries: [] }),
      add: async () => ({ id: "stub" }),
      delete: async () => ({ ok: true as const }),
      search: async () => ({ ok: true as const, entries: [] }),
      reindex: async () => ({ indexed: 0, failed: 0 }),
    },
    knowledge: {
      list: async () => ({ entries: [] }),
      show: async () => ({ found: false as const }),
      search: async () => ({ ok: true as const, entries: [] }),
      add: async () => ({ id: "stub" }),
      delete: async () => ({ ok: true as const }),
      reindex: async () => ({ indexed: 0, failed: 0 }),
    },
    history: {
      list: async () => ({ conversations: [] }),
      listDiscoveredProjectRecords: async () => ({ conversations: [] }),
      show: async () => ({ found: false as const }),
      delete: async () => ({ ok: true as const }),
      search: async () => ({ ok: true as const, conversations: [] }),
      reindex: async () => ({ indexed: 0, failed: 0 }),
    },
    evalHarness: {
      list: async () => ({
        fixtures: [],
        controlDecisionCoverage: {
          counts: { act: 0, ask: 0, refuse: 0, stop: 0, confirm: 0, recover: 0 },
          missingDecisions: ["act", "ask", "refuse", "stop", "confirm", "recover"],
          missingDecisionWarnings: [],
        },
      }),
      run: async () => ({
        ok: false as const,
        reason: "no_fixtures" as const,
        message: "stub",
      }),
      calibration: async () => ({ aggregate: {}, decision: {} }),
    },
    voice: {
      transcribe: async () => ({
        ok: false as const,
        reason: "transport_error" as const,
        status: 503,
        message: "stub",
      }),
      synthesize: async () => ({
        ok: false as const,
        reason: "transport_error" as const,
        status: 503,
        message: "stub",
      }),
    },
    sessions: {
      list: async () => ({ sessions: [] }),
      setAutonomyMode: async () => ({
        ok: false as const,
        reason: "daemon_required" as const,
      }),
    },
    daemonOps: {
      status: async () => ({
        state: "not_running" as const,
        managed: false,
      }),
      pid: async () => ({ state: "not_running" as const }),
      stop: async () => ({ ok: false as const, reason: "not_running" as const }),
      reload: async () => ({
        ok: false as const,
        reason: "reload_failed" as const,
      }),
    },
    projects: {
      list: async () => ({ ok: false as const, reason: "daemon_required" as const }),
      use: async () => ({ ok: false as const, reason: "daemon_required" as const }),
    },
    config: {
      validate: async () => ({ sources: [], warnings: [], resolved: {} }),
      get: async () => ({ found: false as const, reason: "not_found" as const }),
      set: async () => ({
        ok: true as const,
        unknownKey: false,
        topKey: "stub",
        value: null,
      }),
      schemaPath: async () => ({ path: "" }),
      schemaContent: async () => ({ content: "" }),
    },
    tasks: {
      list: async () => ({ tasks: [] }),
      show: async () => ({ found: false as const }),
      move: async () => ({ ok: false as const, reason: "not_found" as const }),
      create: async () => ({ ok: true as const, id: "stub", path: "stub" }),
      capture: async () => ({ ok: true as const, id: "stub", path: "stub" }),
      gc: async () => ({ archived: [], deleted: [] }),
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
        agentConcurrency: 1,
        codeConcurrency: 4,
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
    },
  };
}
