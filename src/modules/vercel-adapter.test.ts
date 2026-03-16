import { describe, expect, it } from "vitest";
import vercelAdapterModule from "./vercel-adapter.js";

describe("vercel-adapter module", () => {
  it("has correct metadata", () => {
    expect(vercelAdapterModule.name).toBe("vercel-adapter");
    expect(vercelAdapterModule.version).toBe("1.0.0");
    expect(vercelAdapterModule.description).toBeTruthy();
  });

  it("has no tools, commands, or events", () => {
    expect(vercelAdapterModule.tools).toBeUndefined();
    expect(vercelAdapterModule.commands).toBeUndefined();
    expect(vercelAdapterModule.events).toBeUndefined();
  });

  it("registers routes", () => {
    expect(vercelAdapterModule.routes).toBeTypeOf("function");
  });

  it("registers POST /api/chat/vercel route", () => {
    const ctx = {
      cwd: "/tmp",
      verbose: false,
      config: { model: "test-model" } as import("../config.js").KotaConfig,
      registerGroup: () => {},
      getRoutes: () => [],
    };

    const routes = vercelAdapterModule.routes!(ctx);
    expect(routes).toHaveLength(1);
    expect(routes[0].method).toBe("POST");
    expect(routes[0].path).toBe("/api/chat/vercel");
    expect(routes[0].handler).toBeTypeOf("function");
  });
});
