import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "#core/modules/provider-registry.js";
import {
  CAPABILITY_READINESS_PROVIDER_TYPE,
  type CapabilityReadiness,
  type CapabilityReadinessSource,
  probeCapabilityReadiness,
} from "./capability-readiness.js";

function makeSource(
  moduleName: string,
  reports: CapabilityReadiness[],
  options: { throws?: boolean } = {},
): CapabilityReadinessSource {
  return {
    moduleName,
    probe(): CapabilityReadiness[] {
      if (options.throws) throw new Error("probe boom");
      return reports;
    },
  };
}

describe("probeCapabilityReadiness", () => {
  it("aggregates ready and unavailable reports across modules", async () => {
    const registry = new ProviderRegistry();
    registry.register(
      CAPABILITY_READINESS_PROVIDER_TYPE,
      "knowledge",
      makeSource("knowledge", [
        { id: "knowledge.search", moduleName: "knowledge", status: "ready" },
        {
          id: "knowledge.semantic_search",
          moduleName: "knowledge",
          status: "unavailable",
          reason: "embedding_unsupported",
        },
      ]),
    );
    registry.register(
      CAPABILITY_READINESS_PROVIDER_TYPE,
      "memory",
      makeSource("memory", [
        { id: "memory.search", moduleName: "memory", status: "ready" },
      ]),
    );

    const response = await probeCapabilityReadiness(registry);
    expect(response.capabilities.map((c) => c.id)).toEqual([
      "knowledge.search",
      "knowledge.semantic_search",
      "memory.search",
    ]);
    expect(response.summary).toEqual({ ready: 2, unavailable: 1, init_failed: 0 });
  });

  it("surfaces a thrown source as a single init_failed entry without dropping siblings", async () => {
    const registry = new ProviderRegistry();
    registry.register(
      CAPABILITY_READINESS_PROVIDER_TYPE,
      "boom",
      makeSource("boom", [], { throws: true }),
    );
    registry.register(
      CAPABILITY_READINESS_PROVIDER_TYPE,
      "memory",
      makeSource("memory", [
        { id: "memory.search", moduleName: "memory", status: "ready" },
      ]),
    );

    const response = await probeCapabilityReadiness(registry);
    expect(response.summary.init_failed).toBe(1);
    expect(response.summary.ready).toBe(1);
    const probeFailed = response.capabilities.find((c) => c.id === "boom.__probe__");
    expect(probeFailed).toBeDefined();
    expect(probeFailed?.reason).toBe("probe_threw");
    expect(probeFailed?.message).toContain("probe boom");
  });

  it("collapses duplicate ids into one init_failed row that names both modules", async () => {
    const registry = new ProviderRegistry();
    registry.register(
      CAPABILITY_READINESS_PROVIDER_TYPE,
      "first",
      makeSource("first", [
        { id: "knowledge.search", moduleName: "first", status: "ready" },
      ]),
    );
    registry.register(
      CAPABILITY_READINESS_PROVIDER_TYPE,
      "second",
      makeSource("second", [
        { id: "knowledge.search", moduleName: "second", status: "ready" },
      ]),
    );

    const response = await probeCapabilityReadiness(registry);
    const dup = response.capabilities.find((c) => c.id === "knowledge.search");
    expect(dup?.status).toBe("init_failed");
    expect(dup?.reason).toBe("duplicate_id");
    expect(dup?.moduleName).toContain("first");
    expect(dup?.moduleName).toContain("second");
  });

  it("returns empty response when no sources are registered", async () => {
    const registry = new ProviderRegistry();
    const response = await probeCapabilityReadiness(registry);
    expect(response.capabilities).toEqual([]);
    expect(response.summary).toEqual({ ready: 0, unavailable: 0, init_failed: 0 });
  });
});
