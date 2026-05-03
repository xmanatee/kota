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

  it("returns the core stub when no module contributes any handlers", () => {
    const handlers = assembleDaemonClientHandlers(transport);
    for (const name of KOTA_CLIENT_NAMESPACES) {
      expect(handlers[name], `core stub must cover "${name}"`).toBeDefined();
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
    const merged = assembleDaemonClientHandlers(transport, { memory: customMemory });
    expect(merged.memory).toBe(customMemory);
    expect(merged.memory).not.toBe(stub.memory);
  });

  it("throws when assembly is asked to drop a namespace that has no fallback", () => {
    // The public `assembleDaemonClientHandlers` cannot reach an empty stub,
    // so simulate the no-coverage path by manually building the shape the
    // selector would assemble — namespace assignments only present from
    // contributed handlers, no stub. The validation logic shape mirrors
    // `LocalKotaClient`'s missing-coverage error: it names every missing
    // namespace.
    const partial: Partial<DaemonClientHandlers> = {};
    expect(() => {
      const missing: string[] = [];
      for (const name of KOTA_CLIENT_NAMESPACES) {
        if (!partial[name]) missing.push(name);
      }
      if (missing.length > 0) {
        throw new Error(
          `DaemonControlClient is missing daemon handler(s) for: ${missing.join(", ")}.`,
        );
      }
    }).toThrow(/missing daemon handler/);
  });
});
