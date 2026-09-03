import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaModule } from "#core/modules/module-types.js";

vi.mock("./lifecycle.js", () => ({
  isPlaywrightAvailable: vi.fn(() => true),
  closeBrowser: vi.fn(async () => {}),
  closeBrowserSession: vi.fn(async () => {}),
  getPage: vi.fn(),
  persistBrowserProfile: vi.fn(async () => {}),
}));

const {
  closeBrowser,
  isPlaywrightAvailable,
} = await import("./lifecycle.js");

describe("browser module", () => {
  let mod: KotaModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = (await import("./index.js")).default;
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

  it("releases the activated browser resource through its disposer", async () => {
    const ctx = {
      cwd: process.cwd(),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      getModuleConfig: vi.fn(() => ({})),
    } as never;
    const activation = await mod.onLoad?.(ctx);
    await activation?.dispose();
    expect(closeBrowser).toHaveBeenCalledOnce();
  });

});
