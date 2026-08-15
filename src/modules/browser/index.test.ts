import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaModule } from "#core/modules/module-types.js";
import { riskFromEffect } from "#core/tools/effect.js";

vi.mock("./lifecycle.js", () => ({
  isPlaywrightAvailable: vi.fn(() => true),
  closeBrowser: vi.fn(async () => {}),
  closeBrowserSession: vi.fn(async () => {}),
  getPage: vi.fn(),
  configureBrowserProfile: vi.fn(),
  getConfiguredBrowserProfile: vi.fn(() => ({
    storageStatePath: null,
    persist: false,
    headless: true,
    networkProfile: { name: "public-untrusted" },
  })),
  persistBrowserProfile: vi.fn(async () => {}),
}));

const {
  closeBrowser,
  configureBrowserProfile,
  isPlaywrightAvailable,
} = await import("./lifecycle.js");

describe("browser module", () => {
  let mod: KotaModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = (await import("./index.js")).default;
  });

  it("has correct metadata", () => {
    expect(mod.name).toBe("browser");
    expect(mod.version).toBe("1.0.0");
    expect(mod.description).toBeTruthy();
  });

  it("contributes expected tools", () => {
    const tools = Array.isArray(mod.tools) ? mod.tools : [];
    const names = tools.map((tool) => tool.tool.name);
    expect(names).toContain("browser_navigate");
    expect(names).toContain("browser_click");
    expect(names).toContain("browser_type");
    expect(names).toContain("browser_screenshot");
    expect(names).toContain("browser_evaluate");
    expect(names).toContain("browser_get_text");
    expect(names).toContain("x_post_read");
    expect(names).toContain("rendered_article_read");
    expect(names).toContain("browser_close");
  });

  it("contributes the browser operator command", () => {
    const commands =
      mod.commands?.({
        cwd: process.cwd(),
        getModuleConfig: vi.fn(() => ({})),
        callTool: vi.fn(),
      } as never) ?? [];
    expect(commands.map((command) => command.name())).toContain("browser");
    const browser = commands.find((command) => command.name() === "browser");
    expect(browser?.commands.map((command) => command.name())).toContain(
      "source-access-report",
    );
  });

  it("classifies interactive tools as dangerous", () => {
    const tools = Array.isArray(mod.tools) ? mod.tools : [];
    const interactive = tools.filter(
      (tool) => tool.tool.name !== "browser_close",
    );
    for (const tool of interactive) {
      expect(riskFromEffect(tool.effect)).toBe("dangerous");
    }
  });

  it("classifies browser_close as safe-or-moderate", () => {
    const tools = Array.isArray(mod.tools) ? mod.tools : [];
    const close = tools.find((tool) => tool.tool.name === "browser_close");
    expect(close).toBeDefined();
    expect(["safe", "moderate"]).toContain(riskFromEffect(close!.effect));
  });

  it("puts all tools in the browser group", () => {
    const tools = Array.isArray(mod.tools) ? mod.tools : [];
    for (const tool of tools) {
      expect(tool.group).toBe("browser");
    }
  });

  it("logs warning when playwright is not installed", () => {
    vi.mocked(isPlaywrightAvailable).mockReturnValue(false);
    const warn = vi.fn();
    const ctx = {
      cwd: process.cwd(),
      log: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() },
      registerCleanupHook: vi.fn(),
      getModuleConfig: vi.fn(() => ({})),
    } as never;
    mod.onLoad?.(ctx);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Playwright is not installed"),
    );
  });

  it("does not warn when playwright is installed", () => {
    vi.mocked(isPlaywrightAvailable).mockReturnValue(true);
    const warn = vi.fn();
    const ctx = {
      cwd: process.cwd(),
      log: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() },
      registerCleanupHook: vi.fn(),
      getModuleConfig: vi.fn(() => ({})),
    } as never;
    mod.onLoad?.(ctx);
    expect(warn).not.toHaveBeenCalled();
  });

  it("registers cleanup hook on load", () => {
    const registerCleanupHook = vi.fn();
    const ctx = {
      cwd: process.cwd(),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerCleanupHook,
      getModuleConfig: vi.fn(() => ({})),
    } as never;
    mod.onLoad?.(ctx);
    expect(registerCleanupHook).toHaveBeenCalledWith(expect.any(Function));
  });

  it("binds an absolute profile to the scope that loaded its configuration", () => {
    const cwd = process.cwd();
    const ctx = {
      cwd,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerCleanupHook: vi.fn(),
      getModuleConfig: vi.fn(() => ({
        storageStatePath: "/secure/profile.json",
      })),
    } as never;

    mod.onLoad?.(ctx);

    expect(configureBrowserProfile).toHaveBeenCalledWith(
      expect.objectContaining({ storageStatePath: "/secure/profile.json" }),
      {
        scopeId: expect.any(String),
        projectDir: cwd,
      },
    );
  });

  it("closes browser on unload", async () => {
    await mod.onUnload?.();
    expect(closeBrowser).toHaveBeenCalled();
  });
});

describe("browser tool schemas", () => {
  let mod: KotaModule;

  beforeEach(async () => {
    mod = (await import("./index.js")).default;
  });

  it("declares required interactive inputs", () => {
    const tools = Array.isArray(mod.tools) ? mod.tools : [];
    const required = (name: string) =>
      tools.find((tool) => tool.tool.name === name)?.tool.input_schema.required;

    expect(required("browser_navigate")).toContain("url");
    expect(required("browser_click")).toContain("selector");
    expect(required("browser_type")).toEqual(
      expect.arrayContaining(["selector", "text"]),
    );
    expect(required("browser_evaluate")).toContain("expression");
  });

  it("gives every tool an object input schema", () => {
    const tools = Array.isArray(mod.tools) ? mod.tools : [];
    for (const tool of tools) {
      expect(tool.tool.input_schema.type).toBe("object");
      expect(tool.tool.input_schema.properties).toBeDefined();
    }
  });
});
