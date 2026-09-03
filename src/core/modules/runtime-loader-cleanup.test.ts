import { describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import type { KotaModule } from "./module-types.js";
import { defineProviderToken, ProviderRegistry } from "./provider-registry.js";
import { loadRuntimeModules } from "./runtime-loader.js";

const discovery = vi.hoisted(() => ({
  bundled: vi.fn<() => Promise<KotaModule[]>>(),
  installed: vi.fn<() => Promise<KotaModule[]>>(),
}));

vi.mock("./bundled-module-discovery.js", () => ({
  discoverBundledModules: discovery.bundled,
  reimportBundledModule: vi.fn(async () => null),
}));
vi.mock("./module-discovery.js", () => ({
  discoverModules: discovery.installed,
  reimportInstalledModule: vi.fn(async () => null),
}));

const TEST_PROVIDER = defineProviderToken<{ ready: true }>("runtime-loader-cleanup");

describe("runtime loader failure cleanup", () => {
  it("withdraws earlier activations when aggregate initialization rejects", async () => {
    const bus = new EventBus();
    const providers = new ProviderRegistry();
    const dispose = vi.fn();
    discovery.installed.mockResolvedValue([]);
    discovery.bundled.mockResolvedValue([
      {
        name: "activated-before-failure",
        onLoad: (ctx) => {
          ctx.registerProvider(TEST_PROVIDER, { ready: true });
          ctx.events.subscribeExternal("runtime-loader.cleanup", () => {});
          return { dispose };
        },
      },
      {
        name: "failing-bundled-module",
        dependencies: ["activated-before-failure"],
        onLoad: () => {
          throw new Error("bundled activation failed");
        },
      },
    ]);

    await expect(loadRuntimeModules({
      config: {},
      cwd: process.cwd(),
      eventBus: bus,
      providerRegistry: providers,
    })).rejects.toThrow("bundled activation failed");

    expect(dispose).toHaveBeenCalledOnce();
    expect(providers.get(TEST_PROVIDER)).toBeNull();
    expect(bus.listenerCount("runtime-loader.cleanup")).toBe(0);
  });
});
