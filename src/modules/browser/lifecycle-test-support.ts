import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { vi } from "vitest";
import type { ToolRunnerContext } from "#core/tools/index.js";
import type {
  BrowserProfileOptions,
  BrowserProfileOwner,
} from "./browser-profile.js";

type LaunchOptions = {
  headless?: boolean;
  args?: string[];
  proxy?: { server: string; username?: string; password?: string };
};

export type LifecycleTestState = {
  capturedContextOptions: Array<{ storageState?: string }>;
  capturedLaunchOptions: LaunchOptions[];
  lastContextStorageWrite: string | null;
  closedContexts: number;
  closedPages: number;
};

const { lifecycleTestState } = vi.hoisted(() => ({
  lifecycleTestState: {
    capturedContextOptions: [] as Array<{ storageState?: string }>,
    capturedLaunchOptions: [] as LaunchOptions[],
    lastContextStorageWrite: null as string | null,
    closedContexts: 0,
    closedPages: 0,
  } as LifecycleTestState,
}));

const activeRunnerContexts: ToolRunnerContext[] = [];

export function getLifecycleTestState(): LifecycleTestState {
  return lifecycleTestState;
}

vi.mock("./playwright-loader.js", async () => ({
  loadPlaywrightModule: vi.fn(async () => mockPlaywright()),
}));

function mockPlaywright() {
  return {
    chromium: {
      launch: async (options?: LaunchOptions) => {
        lifecycleTestState.capturedLaunchOptions.push(options ?? {});
        return makeBrowser();
      },
    },
  };
}

function makeBrowser() {
  return {
    isConnected: () => true,
    newContext: async (options?: { storageState?: string }) => {
      lifecycleTestState.capturedContextOptions.push(options ?? {});
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
    storageState: async (options?: { path?: string }) => {
      if (options?.path) {
        lifecycleTestState.lastContextStorageWrite = options.path;
        writeFileSync(
          options.path,
          JSON.stringify({ authCookie: loadedCookie }),
          "utf8",
        );
      }
      return {};
    },
    close: async () => {
      lifecycleTestState.closedContexts++;
    },
  };
}

function makePage(loadedCookie: string | null) {
  const authenticated = loadedCookie === "valid-session";
  let currentUrl = "about:blank";
  let closed = false;
  return {
    goto: async (url: string) => {
      currentUrl = url;
    },
    waitForSelector: async () => null,
    title: async () => (authenticated ? "Protected" : "Login"),
    url: () => currentUrl,
    click: async () => undefined,
    fill: async () => undefined,
    evaluate: async () =>
      authenticated
        ? "Authenticated content — welcome, operator."
        : "Please sign in to continue.",
    setViewportSize: async () => undefined,
    screenshot: async () => Buffer.from("fake"),
    isClosed: () => closed,
    close: async () => {
      closed = true;
      lifecycleTestState.closedPages++;
    },
  };
}

export function resetLifecycleTestState(): void {
  lifecycleTestState.capturedContextOptions = [];
  lifecycleTestState.capturedLaunchOptions = [];
  lifecycleTestState.lastContextStorageWrite = null;
  lifecycleTestState.closedContexts = 0;
  lifecycleTestState.closedPages = 0;
}

export function runnerContext(
  scopeRoot: string,
  sessionId = "session-a",
  scopeId = "scope-a",
  cwd = scopeRoot,
): ToolRunnerContext {
  return {
    sessionId,
    scopeId,
    scopeRoot,
    cwd,
  };
}

export async function activateRunnerContext(
  context: ToolRunnerContext,
): Promise<ToolRunnerContext> {
  const sessionEnvironment = await import("#core/tools/session-environment.js");
  sessionEnvironment.registerSessionEnvironment(context);
  activeRunnerContexts.push(context);
  return context;
}

export async function loadConfiguredLifecycle(
  scopeRoot: string,
  options: Partial<BrowserProfileOptions> = {},
  owner: Partial<BrowserProfileOwner> = {},
) {
  const lifecycle = await import("./lifecycle.js");
  lifecycle.configureBrowserProfile(
    {
      storageStatePath: null,
      persist: false,
      headless: true,
      networkProfile: { name: "public-untrusted" },
      ...options,
    },
    {
      scopeId: owner.scopeId ?? "scope-a",
      scopeRoot: owner.scopeRoot ?? scopeRoot,
    },
  );
  return lifecycle;
}

export async function cleanUpLifecycleTest(workDir: string): Promise<void> {
  const lifecycle = await import("./lifecycle.js");
  await lifecycle.closeBrowser();
  const sessionEnvironment = await import("#core/tools/session-environment.js");
  for (const context of activeRunnerContexts.splice(0)) {
    await sessionEnvironment.unregisterSessionEnvironment(context);
  }
  rmSync(workDir, { recursive: true, force: true });
}
