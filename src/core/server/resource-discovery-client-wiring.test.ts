import { describe, expect, it } from "vitest";
import { DaemonControlClient } from "./daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "./daemon-client-test-stubs.js";
import type { DaemonTransport } from "./daemon-transport.js";
import {
  type DaemonClientHandlers,
  KOTA_CLIENT_NAMESPACES,
  type KotaClient,
  type LocalClientHandlers,
} from "./kota-client.js";
import { buildLocalKotaClient } from "./local-kota-client.js";
import { createScopeScopedKotaClient } from "./project-scoped-kota-client.js";

type ResourceDiscoveryFilter = Parameters<
  KotaClient["resourceDiscovery"]["discover"]
>[1];

type ResourceDiscoveryCapture = {
  query?: string;
  filter?: ResourceDiscoveryFilter;
};

function makeFakeTransport(): DaemonTransport {
  return {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
    request: async () => null,
    requestStrict: async () => {
      throw new Error("test handler should not reach transport");
    },
    fetchRaw: async () => new Response(null, { status: 200 }),
    events: async function* () {},
  };
}

function resourceDiscoveryHandler(
  capture: ResourceDiscoveryCapture,
): KotaClient["resourceDiscovery"] {
  return {
    discover: async (query, filter) => {
      capture.query = query;
      capture.filter = filter;
      return {
        ok: true,
        query,
        hits: [],
        degradation: "keyword_only",
      };
    },
  };
}

function completeDaemonHandlers(
  overrides: Partial<DaemonClientHandlers> = {},
): DaemonClientHandlers {
  return {
    ...buildMigratedNamespaceTestStubs(),
    ...overrides,
  } as DaemonClientHandlers;
}

function completeLocalHandlers(
  overrides: Partial<LocalClientHandlers> = {},
): LocalClientHandlers {
  return {
    ...buildMigratedNamespaceTestStubs(),
    ...overrides,
  } as LocalClientHandlers;
}

describe("resourceDiscovery KotaClient wiring", () => {
  it("declares resourceDiscovery as an observable namespace with migrated daemon test coverage", async () => {
    expect(KOTA_CLIENT_NAMESPACES).toContain("resourceDiscovery");
    const handler = buildMigratedNamespaceTestStubs().resourceDiscovery;
    expect(handler, "observable resourceDiscovery test stub status").toBeDefined();
    if (!handler) {
      throw new Error("resourceDiscovery test stub is missing");
    }

    const result = await handler.discover("find setup metadata");

    expect(result).toMatchObject({
      ok: true,
      query: "find setup metadata",
      degradation: "keyword_only",
    });
  });

  it("exposes the module-contributed resourceDiscovery handler on DaemonControlClient", async () => {
    const capture: ResourceDiscoveryCapture = {};
    const client = DaemonControlClient.fromTransport(
      makeFakeTransport(),
      completeDaemonHandlers({
        resourceDiscovery: resourceDiscoveryHandler(capture),
      }),
    );

    const result = await client.resourceDiscovery.discover("send a Slack approval", {
      limit: 2,
    });

    expect(result.ok, "observable daemon resourceDiscovery status").toBe(true);
    expect(capture).toEqual({
      query: "send a Slack approval",
      filter: { limit: 2 },
    });
  });

  it("exposes resourceDiscovery on the local client with the same result metadata", async () => {
    const capture: ResourceDiscoveryCapture = {};
    const client = buildLocalKotaClient(
      completeLocalHandlers({
        resourceDiscovery: resourceDiscoveryHandler(capture),
      }),
    );

    const result = await client.resourceDiscovery.discover("rank local tools", {
      kinds: ["tool"],
    });

    expect(result.ok, "observable local resourceDiscovery status").toBe(true);
    expect(result).toMatchObject({
      query: "rank local tools",
      degradation: "keyword_only",
    });
    expect(capture).toEqual({
      query: "rank local tools",
      filter: { kinds: ["tool"] },
    });
  });

  it("injects scope metadata into scoped resourceDiscovery calls", async () => {
    const capture: ResourceDiscoveryCapture = {};
    const base = {
      forProject: () => {
        throw new Error("unexpected project scope");
      },
      forScope: () => {
        throw new Error("unexpected nested scope");
      },
      resourceDiscovery: resourceDiscoveryHandler(capture),
    } as unknown as KotaClient;

    const scoped = createScopeScopedKotaClient(base, "scope-rd");
    const result = await scoped.resourceDiscovery.discover("rank scoped skills", {
      limit: 1,
    });

    expect(result.ok, "observable scoped resourceDiscovery status").toBe(true);
    expect(capture).toEqual({
      query: "rank scoped skills",
      filter: { limit: 1, scopeId: "scope-rd" },
    });
  });
});
