import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "./core/events/event-bus.js";
import { NullTransport } from "./core/loop/transport.js";
import { discoverBundledModules } from "./core/modules/bundled-module-discovery.js";
import { ModuleLoader } from "./core/modules/module-loader.js";
import type { KotaModule } from "./core/modules/module-types.js";
import {
  initProviderRegistry,
  RENDERING_PROVIDER_TOKEN,
  resetProviderRegistry,
} from "./core/modules/provider-registry.js";
import type { RenderingProvider, ReplChrome } from "./core/modules/provider-types.js";
import { clearCustomTools } from "./core/tools/index.js";
import { clearCustomGroups, resetGroups } from "./core/tools/tool-groups.js";

let bundledModules: KotaModule[];

function createRuntimeLoader(): ModuleLoader {
  const loader = new ModuleLoader({});
  loader.setBus(new EventBus());
  return loader;
}

const noopChrome: ReplChrome = {
  announceHarness: () => {},
  showHelp: () => {},
  showStatus: () => {},
  showReset: () => {},
  showError: () => {},
  showGoodbye: () => {},
};

function installRenderingCapture(chunks: string[]): void {
  const provider: RenderingProvider = {
    createAgentTransport: () => new NullTransport(),
    createReplChrome: () => noopChrome,
    printDiagnostic: (diagnostic) => {
      chunks.push(diagnostic.detail ? `${diagnostic.message}\n${diagnostic.detail}` : diagnostic.message);
    },
    printPrompt: (prompt) => {
      chunks.push(prompt.kind);
    },
    writeStderr: (text) => {
      chunks.push(text);
    },
  };
  initProviderRegistry().register(RENDERING_PROVIDER_TOKEN, "test", provider);
}

beforeEach(async () => {
  bundledModules = await discoverBundledModules();
  resetProviderRegistry();
  clearCustomTools();
  clearCustomGroups();
  resetGroups();
});

afterEach(() => {
  resetProviderRegistry();
  vi.restoreAllMocks();
  clearCustomTools();
  clearCustomGroups();
  resetGroups();
});

describe("module error resilience", () => {
  it("broken bundled module in loadAll throws after loading remaining modules", async () => {
    const loader = createRuntimeLoader();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const brokenModule: KotaModule = {
      name: "broken",
      onLoad: () => { throw new Error("Module init explosion"); },
    };

    await expect(
      loader.loadAll([brokenModule, ...bundledModules]),
    ).rejects.toThrow("1 bundled module(s) failed to load");

    expect(loader.getLoadedModules()).not.toContain("broken");
    expect(loader.getLoadedModules()).toContain("memory");
    expect(loader.getLoadedModules()).toContain("scheduler");
    expect(loader.getModuleCount()).toBe(bundledModules.length);

    errSpy.mockRestore();
    await loader.unloadAll();
  });

  it("broken installed module in loadAll does not throw", async () => {
    const loader = createRuntimeLoader();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const brokenInstalled: KotaModule = {
      name: "broken-integration",
      onLoad: () => { throw new Error("Missing credentials"); },
    };

    await loader.loadAll(bundledModules, [brokenInstalled]);

    expect(loader.getLoadedModules()).not.toContain("broken-integration");
    expect(loader.getLoadedModules()).toContain("memory");
    expect(loader.getModuleCount()).toBe(bundledModules.length);

    errSpy.mockRestore();
    await loader.unloadAll();
  });

  it("broken module commands() does not prevent other module commands", async () => {
    const loader = createRuntimeLoader();
    const chunks: string[] = [];
    installRenderingCapture(chunks);

    const brokenCommandModule: KotaModule = {
      name: "broken-cmd",
      commands: () => { throw new Error("Command factory explosion"); },
    };

    await loader.loadAll([brokenCommandModule, ...bundledModules]);

    const commandNames = loader.getCommands().map((command) => command.name());
    expect(commandNames).toContain("serve");
    expect(commandNames).toContain("daemon");
    expect(commandNames).toContain("tools");
    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Module "broken-cmd" command registration failed'),
      ]),
    );

    await loader.unloadAll();
  });

  it("broken module routes() does not prevent other module routes", async () => {
    const loader = createRuntimeLoader();
    const chunks: string[] = [];
    installRenderingCapture(chunks);

    const brokenRouteModule: KotaModule = {
      name: "broken-route",
      routes: () => { throw new Error("Route factory explosion"); },
    };

    await loader.loadAll([brokenRouteModule, ...bundledModules]);

    const routes = loader.getRoutes();
    expect(routes.some((route) => route.path === "/api/chat/vercel")).toBe(true);
    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Module "broken-route" route registration failed'),
      ]),
    );

    await loader.unloadAll();
  });
});
