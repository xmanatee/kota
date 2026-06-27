import { describe, expect, it } from "vitest";
import {
  assembleDaemonClientHandlers,
  buildCoreStubDaemonClientHandlers,
} from "./daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "./daemon-client-test-stubs.js";
import type { DaemonTransport } from "./daemon-transport.js";
import {
  KOTA_CLIENT_NAMESPACES,
} from "./kota-client.js";

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

describe("assembleDaemonClientHandlers", () => {
  const transport = makeFakeTransport();

  it("the core stub covers every non-migrated namespace", () => {
    const stub = buildCoreStubDaemonClientHandlers(transport);
    for (const name of KOTA_CLIENT_NAMESPACES) {
      expect(
        stub[name],
        `migrated namespace "${name}" must not appear in the core stub`,
      ).toBeUndefined();
    }
  });

  it("assembly succeeds when migrated namespaces are contributed by a module", () => {
    const handlers = assembleDaemonClientHandlers(
      transport,
      buildMigratedNamespaceTestStubs(),
    );
    for (const name of KOTA_CLIENT_NAMESPACES) {
      expect(handlers[name], `assembled client must cover "${name}"`).toBeDefined();
    }
  });

  it("shared migrated stubs include observable harness-parity matrix status", async () => {
    const stubs = buildMigratedNamespaceTestStubs();
    const result = await stubs.harnessParity?.matrix();
    expect(result?.ok, "observable matrix status").toBe(true);
    if (!result?.ok) throw new Error("matrix stub must report ok status");
    expect(result.aggregate.runnableGroupCount).toBe(0);
    expect(result.shadowComparisons).toEqual([]);
  });

  it("module-contributed handlers land verbatim on the assembled map", () => {
    const customWorkflow = buildMigratedNamespaceTestStubs().workflow;
    if (!customWorkflow) throw new Error("test stub builder must include workflow");
    const merged = assembleDaemonClientHandlers(transport, {
      ...buildMigratedNamespaceTestStubs(),
      workflow: customWorkflow,
    });
    expect(merged.workflow).toBe(customWorkflow);
  });

  it("the core stub is empty now that every namespace has migrated", () => {
    const stub = buildCoreStubDaemonClientHandlers(transport);
    expect(Object.keys(stub)).toEqual([]);
  });

  it("throws naming each migrated namespace when no module contributes it", () => {
    expect(() => assembleDaemonClientHandlers(transport)).toThrow(
      /missing daemon handler\(s\) for: workflow, approvals, secrets, tasks, memory, ownerDecisions, ownerQuestions, history, inboundSignals, knowledge, sessions, modules, agents, skills, harnessParity, webhook, voice, web, mcpServer, audit, config, modulesAdmin, daemonOps, projects, ui, doctor, evalHarness, recall, resourceDiscovery, answer, capture, retract, setup/,
    );
  });
});
