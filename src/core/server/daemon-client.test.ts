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
    });
    for (const name of KOTA_CLIENT_NAMESPACES) {
      expect(handlers[name], `assembled client must cover "${name}"`).toBeDefined();
    }
  });

  it("overrides the stub when a module contributes the same namespace", () => {
    const stub = buildCoreStubDaemonClientHandlers(transport);
    const customMemory: DaemonClientHandlers["memory"] = {
      list: async () => ({ entries: [] }),
      add: async () => ({ id: "mod" }),
      delete: async () => ({ ok: true }),
      search: async () => ({ ok: true, entries: [] }),
      reindex: async () => ({ indexed: 0, failed: 0 }),
    };
    const merged = assembleDaemonClientHandlers(transport, {
      doctor: makeStubDoctor(),
      memory: customMemory,
    });
    expect(merged.memory).toBe(customMemory);
    expect(merged.memory).not.toBe(stub.memory);
  });

  it("throws naming each migrated namespace when no module contributes it", () => {
    expect(() => assembleDaemonClientHandlers(transport)).toThrow(
      /missing daemon handler\(s\) for: doctor/,
    );
  });
});
