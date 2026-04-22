import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type State = {
  capturedContextOptions: Array<{ storageState?: string }>;
  lastContextStorageWrite: string | null;
};

const { state } = vi.hoisted(() => ({
  state: {
    capturedContextOptions: [] as Array<{ storageState?: string }>,
    lastContextStorageWrite: null as string | null,
  } as State,
}));

vi.mock("./playwright-loader.js", async () => {
  return {
    loadPlaywrightModule: vi.fn(async () => mockPlaywright()),
  };
});

function mockPlaywright() {
  return {
    chromium: {
      launch: async () => makeBrowser(),
    },
  };
}

function makeBrowser() {
  return {
    isConnected: () => true,
    newContext: async (options?: { storageState?: string }) => {
      state.capturedContextOptions.push(options ?? {});
      let loadedCookie: string | null = null;
      if (options?.storageState) {
        try {
          const parsed = JSON.parse(readFileSync(options.storageState, "utf8"));
          loadedCookie = parsed.authCookie ?? null;
        } catch {
          loadedCookie = null;
        }
      }
      return makeContext(loadedCookie);
    },
    close: async () => undefined,
  };
}

function makeContext(loadedCookie: string | null) {
  return {
    newPage: async () => makePage(loadedCookie),
    storageState: async (opts?: { path?: string }) => {
      if (opts?.path) {
        state.lastContextStorageWrite = opts.path;
        writeFileSync(opts.path, JSON.stringify({ authCookie: loadedCookie }), "utf8");
      }
      return {};
    },
    close: async () => undefined,
  };
}

function makePage(loadedCookie: string | null) {
  const authed = loadedCookie === "valid-session";
  return {
    goto: async () => undefined,
    waitForSelector: async () => null,
    title: async () => (authed ? "Protected" : "Login"),
    url: () => "https://auth-walled.example.test/",
    click: async () => undefined,
    fill: async () => undefined,
    evaluate: async () =>
      authed
        ? "Authenticated content — welcome, operator."
        : "Please sign in to continue.",
    setViewportSize: async () => undefined,
    screenshot: async () => Buffer.from("fake"),
    isClosed: () => false,
    close: async () => undefined,
  };
}

describe("browser lifecycle — authenticated profile", () => {
  let workDir: string;

  beforeEach(async () => {
    vi.resetModules();
    state.capturedContextOptions = [];
    state.lastContextStorageWrite = null;
    workDir = mkdtempSync(join(tmpdir(), "kota-browser-lifecycle-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("loads storageState and unlocks auth-walled content", async () => {
    const profilePath = join(workDir, "x-profile.json");
    writeFileSync(profilePath, JSON.stringify({ authCookie: "valid-session" }), "utf8");
    const lifecycle = await import("./lifecycle.js");
    lifecycle.configureBrowserProfile({ storageStatePath: profilePath, persist: false });
    const page = await lifecycle.getPage();
    await page.goto("https://auth-walled.example.test/");
    const content = (await page.evaluate("document.body.innerText")) as string;
    expect(content).toBe("Authenticated content — welcome, operator.");
    expect(state.capturedContextOptions[0]?.storageState).toBe(profilePath);
    await lifecycle.closeBrowser();
  });

  it("falls back to ephemeral context when storageState file is absent", async () => {
    const profilePath = join(workDir, "absent.json");
    const lifecycle = await import("./lifecycle.js");
    lifecycle.configureBrowserProfile({ storageStatePath: profilePath, persist: false });
    const page = await lifecycle.getPage();
    await page.goto("https://auth-walled.example.test/");
    const content = (await page.evaluate("document.body.innerText")) as string;
    expect(content).toBe("Please sign in to continue.");
    expect(state.capturedContextOptions[0]?.storageState).toBeUndefined();
    await lifecycle.closeBrowser();
  });

  it("persists storage state on close when persist=true", async () => {
    const profilePath = join(workDir, "persisted.json");
    writeFileSync(profilePath, JSON.stringify({ authCookie: "valid-session" }), "utf8");
    const lifecycle = await import("./lifecycle.js");
    lifecycle.configureBrowserProfile({ storageStatePath: profilePath, persist: true });
    await lifecycle.getPage();
    await lifecycle.closeBrowser();
    expect(state.lastContextStorageWrite).toBe(profilePath);
    const persisted = JSON.parse(readFileSync(profilePath, "utf8"));
    expect(persisted.authCookie).toBe("valid-session");
  });

  it("does not persist when persist=false even with profile configured", async () => {
    const profilePath = join(workDir, "nopersist.json");
    writeFileSync(profilePath, JSON.stringify({ authCookie: "valid-session" }), "utf8");
    const lifecycle = await import("./lifecycle.js");
    lifecycle.configureBrowserProfile({ storageStatePath: profilePath, persist: false });
    await lifecycle.getPage();
    await lifecycle.closeBrowser();
    expect(state.lastContextStorageWrite).toBeNull();
  });

  it("treats absence of a profile as ephemeral context", async () => {
    const lifecycle = await import("./lifecycle.js");
    lifecycle.configureBrowserProfile({ storageStatePath: null, persist: false });
    await lifecycle.getPage();
    expect(state.capturedContextOptions[0]?.storageState).toBeUndefined();
    await lifecycle.closeBrowser();
  });
});
