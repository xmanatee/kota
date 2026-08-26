import { describe, expect, it } from "vitest";
import {
  KOTA_CLIENT_NAMESPACES,
} from "#root/client/kota-client.generated.js";
import {
  assembleDaemonClientHandlers,
  buildCoreStubDaemonClientHandlers,
} from "./daemon-client.js";
import { completeDaemonClientHandlers } from "./daemon-client-test-support.js";
import type { DaemonTransport } from "./daemon-transport.js";

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

  it("assembly succeeds when migrated namespaces are contributed by a module", () => {
    const handlers = assembleDaemonClientHandlers(
      transport,
      completeDaemonClientHandlers(),
    );
    for (const name of KOTA_CLIENT_NAMESPACES) {
      expect(handlers[name], `assembled client must cover "${name}"`).toBeDefined();
    }
  });

  it("module-contributed handlers land verbatim on the assembled map", () => {
    const customWorkflow = completeDaemonClientHandlers().workflow;
    if (!customWorkflow) throw new Error("test stub builder must include workflow");
    const merged = assembleDaemonClientHandlers(transport, {
      ...completeDaemonClientHandlers(),
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
      `missing daemon handler(s) for: ${KOTA_CLIENT_NAMESPACES.join(", ")}`,
    );
  });
});
