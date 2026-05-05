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
    import: async () => ({ ok: true, name: "stub", path: "stub" }),
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
    show: async () => ({ found: false }),
    delete: async () => ({ ok: true }),
    search: async () => ({ ok: true, conversations: [] }),
    reindex: async () => ({ indexed: 0, failed: 0 }),
  };
}

function makeStubEvalHarness(): DaemonClientHandlers["evalHarness"] {
  return {
    list: async () => ({ fixtures: [] }),
    run: async () => ({
      ok: false,
      reason: "no_fixtures",
      message: "stub",
    }),
    calibration: async () => ({ aggregate: {}, decision: {} }),
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
    });
    for (const name of KOTA_CLIENT_NAMESPACES) {
      expect(handlers[name], `assembled client must cover "${name}"`).toBeDefined();
    }
  });

  it("overrides the stub when a module contributes the same namespace", () => {
    const stub = buildCoreStubDaemonClientHandlers(transport);
    const customTasks: DaemonClientHandlers["tasks"] = {
      list: async () => ({ tasks: [] }),
      show: async () => ({ found: false }),
      move: async () => ({ ok: false, reason: "not_found" }),
      create: async () => ({ ok: true, id: "mod", path: "mod" }),
      capture: async () => ({ ok: true, id: "mod", path: "mod" }),
      gc: async () => ({ archived: [], deleted: [] }),
      search: async () => ({ ok: true, tasks: [] }),
      reindex: async () => ({ indexed: 0, failed: 0 }),
    };
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
      tasks: customTasks,
    });
    expect(merged.tasks).toBe(customTasks);
    expect(merged.tasks).not.toBe(stub.tasks);
  });

  it("throws naming each migrated namespace when no module contributes it", () => {
    expect(() => assembleDaemonClientHandlers(transport)).toThrow(
      /missing daemon handler\(s\) for: approvals, secrets, memory, ownerQuestions, history, knowledge, modules, agents, skills, harnessParity, webhook, web, mcpServer, audit, modulesAdmin, doctor, evalHarness, recall, answer, capture, retract/,
    );
  });
});
