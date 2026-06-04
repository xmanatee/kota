/**
 * Unit tests for the daemon-side handler assembly path.
 *
 * The selector validates that every `KotaClient` namespace has a
 * registered handler — either from the core stub or from a module's
 * `daemonClient(link)` factory. Missing handlers are a load-time error
 * with no silent fallback, mirroring the local-side missing-coverage
 * error path in `LocalKotaClient`.
 */

import { describe, expect, it } from "vitest";
import {
  assembleDaemonClientHandlers,
  buildCoreStubDaemonClientHandlers,
} from "./daemon-client.js";
import type { DaemonTransport } from "./daemon-transport.js";
import {
  type DaemonClientHandlers,
  KOTA_CLIENT_NAMESPACES,
} from "./kota-client.js";

/**
 * Namespaces already migrated out of the core stub into their owning
 * module's `daemonClient(link)` factory. The stub no longer covers them;
 * `assembleDaemonClientHandlers` requires the matching contributed handler
 * to land before construction.
 */
const STUB_OMITTED_NAMESPACES: ReadonlySet<string> = new Set<string>([
  "doctor",
  "harnessParity",
  "audit",
  "retract",
  "answer",
  "ownerQuestions",
  "modules",
  "modulesAdmin",
  "agents",
  "skills",
  "mcpServer",
  "web",
  "capture",
  "recall",
  "webhook",
  "approvals",
  "secrets",
  "memory",
  "knowledge",
  "history",
  "evalHarness",
  "voice",
  "sessions",
  "daemonOps",
  "projects",
  "config",
  "tasks",
  "workflow",
  "setup",
]);

function makeFakeTransport(): DaemonTransport {
  return {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
    request: async () => null,
    requestStrict: async () => {
      throw new Error("not used");
    },
    fetchRaw: async () => new Response(null, { status: 200 }),
    events: async function* () {
      // empty generator
    },
  };
}

function makeStubDoctor(): DaemonClientHandlers["doctor"] {
  return {
    run: async () => ({ checks: [] }),
    fix: async () => ({ repairs: [] }),
  };
}

function makeStubHarnessParity(): DaemonClientHandlers["harnessParity"] {
  return {
    list: async () => ({ scenarios: [] }),
    run: async () => ({ ok: true, outBaseDir: "", artifacts: [] }),
  };
}

function makeStubAudit(): DaemonClientHandlers["audit"] {
  return {
    list: async () => ({ entries: [] }),
  };
}

function makeStubRetract(): DaemonClientHandlers["retract"] {
  return {
    retract: async () => ({ ok: false, reason: "no_contributors" }),
  };
}

function makeStubSetup(): DaemonClientHandlers["setup"] {
  return {
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
    submitForm: async () => ({ ok: false, reason: "not_found", message: "stub" }),
    storeSecret: async () => ({ ok: false, reason: "not_found", message: "stub" }),
    start: async () => ({ ok: false, reason: "not_found", message: "stub" }),
    complete: async () => ({ ok: false, reason: "not_found", message: "stub" }),
    refresh: async () => ({ ok: false, reason: "not_found", message: "stub" }),
    revoke: async () => ({ ok: false, reason: "not_found", message: "stub" }),
  };
}

function makeStubAnswer(): DaemonClientHandlers["answer"] {
  return {
    answer: async () => ({ ok: false, reason: "no_hits" }),
    log: async () => ({ entries: [] }),
    show: async () => ({ ok: false, reason: "not_found" }),
  };
}

function makeStubOwnerQuestions(): DaemonClientHandlers["ownerQuestions"] {
  return {
    list: async () => ({ questions: [] }),
    answer: async () => ({ ok: false, reason: "not_found" }),
    dismiss: async () => ({ ok: false, reason: "not_found" }),
  };
}

function makeStubModules(): DaemonClientHandlers["modules"] {
  return {
    list: async () => ({ modules: [] }),
  };
}

function makeStubModulesAdmin(): DaemonClientHandlers["modulesAdmin"] {
  return {
    inspect: async () => ({ found: false }),
    reload: async () => ({ ok: false, reason: "not_found" }),
  };
}

function makeStubAgents(): DaemonClientHandlers["agents"] {
  return {
    list: async () => ({ agents: [] }),
    inspect: async () => ({ found: false }),
  };
}

function makeStubSkills(): DaemonClientHandlers["skills"] {
  return {
    list: async () => ({ skills: [] }),
    import: async () => ({
      ok: true,
      skills: [{ name: "stub", path: "stub", sourcePath: "stub", provenance: "stub" }],
    }),
  };
}

function makeStubMcpServer(): DaemonClientHandlers["mcpServer"] {
  return {
    start: async () => ({ ok: false, reason: "daemon_required" }),
  };
}

function makeStubWeb(): DaemonClientHandlers["web"] {
  return {
    start: async () => ({ ok: false, reason: "daemon_required" }),
  };
}

function makeStubCapture(): DaemonClientHandlers["capture"] {
  return {
    capture: async () => ({ ok: false, reason: "no_contributors" }),
  };
}

function makeStubRecall(): DaemonClientHandlers["recall"] {
  return {
    recall: async () => ({ ok: false, reason: "semantic_unavailable" }),
  };
}

function makeStubWebhook(): DaemonClientHandlers["webhook"] {
  return {
    list: async () => ({ entries: [] }),
    secretGenerate: async (workflow: string) => ({
      workflow,
      secret: "stub-secret",
      overwrote: false,
    }),
    secretRemove: async (workflow: string) => ({
      ok: true,
      workflow,
      removed: false,
    }),
  };
}

function makeStubApprovals(): DaemonClientHandlers["approvals"] {
  return {
    list: async () => ({ approvals: [] }),
    approve: async () => ({ ok: false, reason: "not_found" }),
    reject: async () => ({ ok: false, reason: "not_found" }),
  };
}

function makeStubSecrets(): DaemonClientHandlers["secrets"] {
  return {
    list: async () => ({ secrets: [] }),
    get: async () => ({ found: false }),
    set: async () => ({ ok: true }),
    remove: async () => ({ ok: false, reason: "not_found" }),
  };
}

function makeStubMemory(): DaemonClientHandlers["memory"] {
  return {
    list: async () => ({ entries: [] }),
    add: async () => ({ id: "stub" }),
    delete: async () => ({ ok: true }),
    search: async () => ({ ok: true, entries: [] }),
    reindex: async () => ({ indexed: 0, failed: 0 }),
  };
}

function makeStubKnowledge(): DaemonClientHandlers["knowledge"] {
  return {
    list: async () => ({ entries: [] }),
    show: async () => ({ found: false }),
    search: async () => ({ ok: true, entries: [] }),
    add: async () => ({ id: "stub" }),
    delete: async () => ({ ok: true }),
    reindex: async () => ({ indexed: 0, failed: 0 }),
  };
}

function makeStubHistory(): DaemonClientHandlers["history"] {
  return {
    list: async () => ({ conversations: [] }),
    listDiscoveredProjectRecords: async () => ({ conversations: [] }),
    show: async () => ({ found: false }),
    delete: async () => ({ ok: true }),
    search: async () => ({ ok: true, conversations: [] }),
    reindex: async () => ({ indexed: 0, failed: 0 }),
  };
}

function makeStubEvalHarness(): DaemonClientHandlers["evalHarness"] {
  return {
    list: async () => ({
      fixtures: [],
      controlDecisionCoverage: {
        counts: { act: 0, ask: 0, refuse: 0, stop: 0, confirm: 0, recover: 0 },
        missingDecisions: ["act", "ask", "refuse", "stop", "confirm", "recover"],
        missingDecisionWarnings: [],
      },
    }),
    run: async () => ({
      ok: false,
      reason: "no_fixtures",
      message: "stub",
    }),
    calibration: async () => ({ aggregate: {}, decision: {} }),
  };
}

function makeStubVoice(): DaemonClientHandlers["voice"] {
  return {
    transcribe: async () => ({
      ok: false,
      reason: "transport_error",
      status: 503,
      message: "stub",
    }),
    synthesize: async () => ({
      ok: false,
      reason: "transport_error",
      status: 503,
      message: "stub",
    }),
  };
}

function makeStubSessions(): DaemonClientHandlers["sessions"] {
  return {
    list: async () => ({ sessions: [] }),
    setAutonomyMode: async () => ({ ok: false, reason: "daemon_required" }),
  };
}

function makeStubDaemonOps(): DaemonClientHandlers["daemonOps"] {
  return {
    status: async () => ({ state: "not_running", managed: false }),
    pid: async () => ({ state: "not_running" }),
    stop: async () => ({ ok: false, reason: "not_running" }),
    reload: async () => ({ ok: false, reason: "reload_failed" }),
  };
}

function makeStubProjects(): DaemonClientHandlers["projects"] {
  return {
    list: async () => ({ ok: false, reason: "daemon_required" }),
    use: async () => ({ ok: false, reason: "daemon_required" }),
  };
}

function makeStubConfig(): DaemonClientHandlers["config"] {
  return {
    validate: async () => ({ sources: [], warnings: [], resolved: {} }),
    get: async () => ({ found: false, reason: "not_found" }),
    set: async () => ({
      ok: true,
      unknownKey: false,
      topKey: "stub",
      value: null,
    }),
    schemaPath: async () => ({ path: "" }),
    schemaContent: async () => ({ content: "" }),
  };
}

function makeStubTasks(): DaemonClientHandlers["tasks"] {
  return {
    list: async () => ({ tasks: [] }),
    show: async () => ({ found: false }),
    move: async () => ({ ok: false, reason: "not_found" }),
    create: async () => ({ ok: true, id: "stub", path: "stub" }),
    capture: async () => ({ ok: true, id: "stub", path: "stub" }),
    gc: async () => ({ archived: [], deleted: [] }),
    search: async () => ({ ok: true, tasks: [] }),
    reindex: async () => ({ indexed: 0, failed: 0 }),
  };
}

function makeStubWorkflow(): DaemonClientHandlers["workflow"] {
  return {
    listRuns: async () => ({ runs: [] }),
    status: async () => ({
      activeRuns: [],
      pendingRuns: [],
      queueLength: 0,
      completedRuns: 0,
      workflows: {},
      paused: false,
      agentConcurrency: 1,
      codeConcurrency: 4,
      pendingAbort: false,
    }),
    pause: async () => ({ paused: true, already: false }),
    resume: async () => ({ paused: false, already: false }),
    abort: async () => ({ status: "applied", count: 0 }),
    reload: async () => ({ status: "applied", count: 0 }),
    enable: async () => ({ ok: true }),
    disable: async () => ({ ok: true }),
    cancelRun: async () => ({ ok: true }),
    abortRun: async () => ({ ok: true }),
    getRun: async () => ({ found: false }),
    listDefinitions: async () => ({ source: "daemon", definitions: [] }),
    triggerByName: async () => ({ ok: true, path: "daemon", queued: "x" }),
    trial: async () => ({ ok: false, reason: "daemon_required", message: "stub" }),
  };
}

describe("assembleDaemonClientHandlers", () => {
  const transport = makeFakeTransport();

  it("the core stub covers every non-migrated namespace", () => {
    const stub = buildCoreStubDaemonClientHandlers(transport);
    for (const name of KOTA_CLIENT_NAMESPACES) {
      if (STUB_OMITTED_NAMESPACES.has(name)) {
        expect(
          stub[name],
          `migrated namespace "${name}" must not appear in the core stub`,
        ).toBeUndefined();
        continue;
      }
      expect(stub[name], `core stub must cover "${name}"`).toBeDefined();
    }
  });

  it("assembly succeeds when migrated namespaces are contributed by a module", () => {
    const handlers = assembleDaemonClientHandlers(transport, {
      doctor: makeStubDoctor(),
      harnessParity: makeStubHarnessParity(),
      audit: makeStubAudit(),
      retract: makeStubRetract(),
      answer: makeStubAnswer(),
      ownerQuestions: makeStubOwnerQuestions(),
      modules: makeStubModules(),
      modulesAdmin: makeStubModulesAdmin(),
      agents: makeStubAgents(),
      skills: makeStubSkills(),
      mcpServer: makeStubMcpServer(),
      web: makeStubWeb(),
      capture: makeStubCapture(),
      recall: makeStubRecall(),
      webhook: makeStubWebhook(),
      approvals: makeStubApprovals(),
      secrets: makeStubSecrets(),
      memory: makeStubMemory(),
      knowledge: makeStubKnowledge(),
      history: makeStubHistory(),
      evalHarness: makeStubEvalHarness(),
      voice: makeStubVoice(),
      sessions: makeStubSessions(),
      daemonOps: makeStubDaemonOps(),
      projects: makeStubProjects(),
      config: makeStubConfig(),
      tasks: makeStubTasks(),
      workflow: makeStubWorkflow(),
      setup: makeStubSetup(),
    });
    for (const name of KOTA_CLIENT_NAMESPACES) {
      expect(handlers[name], `assembled client must cover "${name}"`).toBeDefined();
    }
  });

  it("module-contributed handlers land verbatim on the assembled map", () => {
    const customWorkflow = makeStubWorkflow();
    const merged = assembleDaemonClientHandlers(transport, {
      doctor: makeStubDoctor(),
      harnessParity: makeStubHarnessParity(),
      audit: makeStubAudit(),
      retract: makeStubRetract(),
      answer: makeStubAnswer(),
      ownerQuestions: makeStubOwnerQuestions(),
      modules: makeStubModules(),
      modulesAdmin: makeStubModulesAdmin(),
      agents: makeStubAgents(),
      skills: makeStubSkills(),
      mcpServer: makeStubMcpServer(),
      web: makeStubWeb(),
      capture: makeStubCapture(),
      recall: makeStubRecall(),
      webhook: makeStubWebhook(),
      approvals: makeStubApprovals(),
      secrets: makeStubSecrets(),
      memory: makeStubMemory(),
      knowledge: makeStubKnowledge(),
      history: makeStubHistory(),
      evalHarness: makeStubEvalHarness(),
      voice: makeStubVoice(),
      sessions: makeStubSessions(),
      daemonOps: makeStubDaemonOps(),
      projects: makeStubProjects(),
      config: makeStubConfig(),
      tasks: makeStubTasks(),
      workflow: customWorkflow,
      setup: makeStubSetup(),
    });
    expect(merged.workflow).toBe(customWorkflow);
  });

  it("the core stub is empty now that every namespace has migrated", () => {
    const stub = buildCoreStubDaemonClientHandlers(transport);
    expect(Object.keys(stub)).toEqual([]);
  });

  it("throws naming each migrated namespace when no module contributes it", () => {
    expect(() => assembleDaemonClientHandlers(transport)).toThrow(
      /missing daemon handler\(s\) for: workflow, approvals, secrets, tasks, memory, ownerQuestions, history, knowledge, sessions, modules, agents, skills, harnessParity, webhook, voice, web, mcpServer, audit, config, modulesAdmin, daemonOps, projects, doctor, evalHarness, recall, answer, capture, retract, setup/,
    );
  });
});
