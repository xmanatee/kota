import { describe, expect, it } from "vitest";
import { ModuleStorage } from "../../module-storage.js";
import type { ModuleContext } from "../../module-types.js";
import vercelAdapterModule from "./index.js";

describe("vercel-adapter module", () => {
  it("has correct metadata", () => {
    expect(vercelAdapterModule.name).toBe("vercel-adapter");
    expect(vercelAdapterModule.version).toBe("1.0.0");
    expect(vercelAdapterModule.description).toBeTruthy();
  });

  it("has no tools or commands", () => {
    expect(vercelAdapterModule.tools).toBeUndefined();
    expect(vercelAdapterModule.commands).toBeUndefined();
  });

  it("registers routes", () => {
    expect(vercelAdapterModule.routes).toBeTypeOf("function");
  });

  it("registers POST /api/chat/vercel route", () => {
    const ctx: ModuleContext = {
      cwd: "/tmp",
      verbose: false,
      config: { model: "test-model" } as import("../../config.js").KotaConfig,
      storage: new ModuleStorage("/tmp", "vercel-adapter"),
      registerGroup: () => {},
      getRoutes: () => [],
      getContributedWorkflows: () => [],
  getContributedChannels: () => [],
  getModuleSummaries: () => [],
      getModuleConfig: () => undefined,
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getSecret: () => null,
      listTools: () => [],
      events: { emit: () => {}, subscribe: () => () => {} },
      createSession: () => ({ send: async () => "", close: () => {} }),
      registerProvider: () => {},
      getProvider: () => null,
      callTool: async () => ({ content: "" }),
      registerMiddleware: () => {},
    registerDynamicStateProvider: () => {},
    };

    const routes = vercelAdapterModule.routes!(ctx);
    expect(routes).toHaveLength(1);
    expect(routes[0].method).toBe("POST");
    expect(routes[0].path).toBe("/api/chat/vercel");
    expect(routes[0].handler).toBeTypeOf("function");
  });
});
