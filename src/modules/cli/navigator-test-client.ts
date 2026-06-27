import type { PendingApproval } from "#core/daemon/approval-queue.js";
import type { InteractiveSession, WorkflowDefinitionSummary } from "#core/daemon/daemon-control.js";
import type { KotaClient } from "#core/server/kota-client.js";
import type { ModuleListEntry } from "#modules/module-manager/client.js";
import type { WorkflowEnableResult } from "#modules/workflow-ops/client.js";
import type { WorkflowSimulationResult } from "#modules/workflow-ops/simulation/types.js";

const EMPTY_EVAL_CALIBRATION_RESULT: Awaited<
  ReturnType<KotaClient["evalHarness"]["calibration"]>
> = {
  aggregate: {
    windowStartMs: 0,
    windowEndMs: 0,
    totalRuns: 0,
    byVerdict: { pass: 0, pass_with_warnings: 0, fail: 0, absent: 0 },
    passContradictionCount: 0,
    passContradictionRate: 0,
    passWithWarningsFollowUpCount: 0,
    passWithWarningsFollowUpRate: 0,
  },
  decision: {
    status: "insufficient-sample",
    reason: "No calibration samples in test stub.",
  },
};

function emptyExplainResult() {
  return {
    graph: {
      workflows: [],
      events: [],
      agents: [],
      automation: { workflows: [], events: [], blockers: [], downstream: [] },
    },
    query: {},
    outcome: "unknown" as const,
    matches: [],
    reasons: [],
  };
}

function emptySimulationResult(): WorkflowSimulationResult {
  return {
    ok: true,
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
  };
}

export function emptyClient(overrides: Partial<KotaClient> = {}): KotaClient {
  const stub = <T>(value: T) => async () => value;
  const base: KotaClient = {
    forProject: () => {
      throw new Error("not implemented in test");
    },
    workflow: {
      listRuns: stub({ runs: [] }),
      status: async () => {
        throw new Error("not implemented in test");
      },
      getRun: stub({ found: false }),
      listDefinitions: stub({ source: "static", definitions: [] as WorkflowDefinitionSummary[] }),
      pause: stub({ paused: true, already: false }),
      resume: stub({ paused: false, already: false }),
      abort: stub({ status: "applied", count: 0 }),
      reload: stub({ status: "applied", count: 0 }),
      triggerByName: stub({ ok: true, path: "queue", queued: "x" }),
      trial: stub({ ok: false, reason: "daemon_required", message: "stub" }),
      explain: stub(emptyExplainResult()),
      simulate: stub(emptySimulationResult()),
      enable: stub({ ok: true } as WorkflowEnableResult),
      disable: stub({ ok: true } as WorkflowEnableResult),
      cancelRun: stub({ ok: true }),
      abortRun: stub({ ok: true }),
      listDeadLetters: stub({ items: [], counts: { open: 0, dismissed: 0, redriven: 0 } }),
      getDeadLetter: stub({ found: false }),
      dismissDeadLetter: stub({ ok: false, reason: "not_found" }),
      redriveDeadLetter: stub({ ok: false, reason: "not_found" }),
      exportDeadLetterDiagnostics: stub(null),
    },
    approvals: {
      list: stub({ approvals: [] as PendingApproval[] }),
      approve: stub({ ok: false, reason: "not_found" }),
      reject: stub({ ok: false, reason: "not_found" }),
    },
    secrets: {
      list: stub({ secrets: [] }),
      get: stub({ found: false }),
      set: stub({ ok: true }),
      remove: stub({ ok: true }),
    },
    tasks: {
      list: stub({ tasks: [] }),
      show: stub({ found: false }),
      move: stub({ ok: false, reason: "not_found" }),
      create: stub({ ok: false, reason: "invalid_slug" }),
      capture: stub({ ok: false, reason: "invalid_slug" }),
      gc: stub({ archived: [], deleted: [] }),
      search: stub({ ok: true, tasks: [] }),
      reindex: stub({ indexed: 0, failed: 0 }),
    },
    memory: {
      list: stub({ entries: [] }),
      add: stub({ id: "m1" }),
      delete: stub({ ok: true }),
      search: stub({ ok: true, entries: [] }),
      reindex: stub({ indexed: 0, failed: 0 }),
    },
    ownerDecisions: {
      list: stub({ decisions: [] }),
      show: stub({ found: false }),
      answer: stub({ ok: false, reason: "not_found" }),
      cancel: stub({ ok: false, reason: "not_found" }),
    },
    ownerQuestions: {
      list: stub({ questions: [] }),
      answer: stub({ ok: false, reason: "not_found" }),
      dismiss: stub({ ok: false, reason: "not_found" }),
    },
    history: {
      list: stub({ conversations: [] }),
      listDiscoveredProjectRecords: stub({ conversations: [] }),
      show: stub({ found: false }),
      delete: stub({ ok: true }),
      search: stub({ ok: true, conversations: [] }),
      reindex: stub({ indexed: 0, failed: 0 }),
    },
    inboundSignals: {
      listRoutes: stub({ routes: [], validation: { ok: true, routes: [] } }),
      validateRoutes: stub({ ok: true, routes: [] }),
    },
    knowledge: {
      list: stub({ entries: [] }),
      show: stub({ found: false }),
      search: stub({ ok: true, entries: [] }),
      add: stub({ id: "k1" }),
      delete: stub({ ok: true }),
      reindex: stub({ indexed: 0, failed: 0 }),
    },
    sessions: {
      list: stub({ sessions: [] as InteractiveSession[] }),
      setAutonomyMode: stub({ ok: false, reason: "not_found" }),
    },
    modules: { list: stub({ modules: [] as ModuleListEntry[] }) },
    agents: { list: stub({ agents: [] }), inspect: stub({ found: false }) },
    skills: {
      list: stub({ skills: [] }),
      import: stub({ ok: false, reason: "missing_name", message: "stub" }),
    },
    harnessParity: {
      list: stub({ scenarios: [] }),
      run: stub({ ok: false, reason: "no_scenarios", message: "stub" }),
      matrix: stub({
        ok: false,
        reason: "no_scenarios",
        message: "stub",
      }),
    },
    webhook: {
      list: stub({ entries: [] }),
      secretGenerate: stub({ workflow: "stub", secret: "stub", overwrote: false }),
      secretRemove: stub({ ok: true, workflow: "stub", removed: false }),
    },
    voice: {
      transcribe: stub({ ok: false, reason: "daemon_required" }),
      synthesize: stub({ ok: false, reason: "daemon_required" }),
    },
    web: { start: stub({ ok: false, reason: "daemon_required" }) },
    mcpServer: { start: stub({ ok: false, reason: "daemon_required" }) },
    audit: { list: stub({ entries: [] }) },
    config: {
      validate: stub({ sources: [], warnings: [], resolved: {} }),
      get: stub({ found: false, reason: "not_found" }),
      set: stub({ ok: true, unknownKey: false, topKey: "stub", value: null }),
      schemaPath: stub({ path: "/stub" }),
      schemaContent: stub({ content: "{}" }),
    },
    modulesAdmin: {
      inspect: stub({ found: false }),
      reload: stub({ ok: false, reason: "daemon_required" }),
    },
    daemonOps: {
      status: stub({ state: "not_running", managed: false }),
      pid: stub({ state: "not_running" }),
      stop: stub({ ok: false, reason: "not_running" }),
      reload: stub({ ok: false, reason: "not_running" }),
    },
    projects: {
      list: stub({ ok: false, reason: "daemon_required" }),
      use: stub({ ok: false, reason: "daemon_required" }),
    },
    ui: {
      listSurfaces: stub({ protocolVersion: "ui.surface.v1", surfaces: [] }),
      executeAction: stub({ ok: false, reason: "not_found", message: "stub" }),
      watchEvents: async function* () {},
    },
    doctor: { run: stub({ checks: [] }), fix: stub({ repairs: [] }) },
    evalHarness: {
      list: stub({
        fixtures: [],
        controlDecisionCoverage: {
          counts: { act: 0, ask: 0, refuse: 0, stop: 0, confirm: 0, recover: 0 },
          missingDecisions: ["act", "ask", "refuse", "stop", "confirm", "recover"],
          missingDecisionWarnings: [],
        },
      }),
      run: stub({ ok: false, reason: "no_fixtures", message: "stub" }),
      calibration: stub(EMPTY_EVAL_CALIBRATION_RESULT),
    },
    recall: { recall: stub({ ok: true, hits: [] }) },
    resourceDiscovery: {
      discover: stub({
        ok: true,
        query: "",
        hits: [],
        degradation: "keyword_only",
      }),
    },
    answer: {
      answer: stub({ ok: false, reason: "no_hits" }),
      log: stub({ entries: [] }),
      show: stub({ ok: false, reason: "not_found" }),
    },
    capture: { capture: stub({ ok: false, reason: "no_contributors" }) },
    retract: { retract: stub({ ok: false, reason: "no_contributors" }) },
    setup: {
      list: stub({
        requirements: [],
        summary: { ready: 0, missing: 0, pending: 0, expired: 0, revoked: 0, unknown: 0, unavailable: 0 },
      }),
      submitForm: stub({ ok: false, reason: "not_found", message: "stub" }),
      storeSecret: stub({ ok: false, reason: "not_found", message: "stub" }),
      start: stub({ ok: false, reason: "not_found", message: "stub" }),
      complete: stub({ ok: false, reason: "not_found", message: "stub" }),
      refresh: stub({ ok: false, reason: "not_found", message: "stub" }),
      revoke: stub({ ok: false, reason: "not_found", message: "stub" }),
    },
  };
  return { ...base, ...overrides };
}
