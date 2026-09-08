import "./network-test-support.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { ToolRunnerContext } from "#core/tools/index.js";
import { registerSessionEnvironment, unregisterSessionEnvironment } from "#core/tools/session-environment.js";
import { runBrowserNavigate } from "./browser-interaction-tools.js";
import { closeBrowser } from "./lifecycle.js";
import { requestThroughProxy, type TestProxy } from "./network-test-support.js";
import { loadPlaywrightModule, type PlaywrightModule } from "./playwright-loader.js";

vi.mock("./playwright-loader.js", () => ({ loadPlaywrightModule: vi.fn() }));

// Chromium is the controlled subprocess port. Navigation uses exactly the proxy
// supplied at launch; authorization runs in the production proxy, not this double.
function chromiumPort(proxy: TestProxy): Awaited<ReturnType<PlaywrightModule["chromium"]["launch"]>> {
  let connected = true;
  return {
    isConnected: () => connected,
    close: async () => { connected = false; },
    newContext: async () => ({
      close: async () => {},
      storageState: async () => ({}),
      newPage: async () => {
        let url = "about:blank";
        let body = "";
        let closed = false;
        return {
          goto: async (target) => {
            body = await requestThroughProxy(proxy, target);
            url = target;
          },
          title: async () => body,
          url: () => url,
          isClosed: () => closed,
          close: async () => { closed = true; },
          waitForSelector: async () => null,
          click: async () => {},
          fill: async () => {},
          evaluate: async () => body,
          setViewportSize: async () => {},
          screenshot: async () => Buffer.from(""),
        };
      },
    }),
  };
}

describe("browser scope network authorization", () => {
  let root: string;
  let authorityConfigPath: string;
  const contexts: ToolRunnerContext[] = [];
  const proxies: TestProxy[] = [];
  const privateUrl = "http://127.0.0.1:8080/private";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-browser-network-"));
    authorityConfigPath = join(root, "authority.json");
    proxies.length = 0;
    vi.mocked(loadPlaywrightModule).mockResolvedValue({
      chromium: {
        launch: async (options) => {
          if (!options?.proxy) throw new Error("Chromium must use a proxy");
          proxies.push(options.proxy);
          return chromiumPort(options.proxy);
        },
      },
    });
  });

  afterEach(async () => {
    for (const context of contexts.splice(0)) await unregisterSessionEnvironment(context);
    await closeBrowser();
    rmSync(root, { recursive: true, force: true });
  });

  function session(scope: string, sessionId = "session"): ToolRunnerContext {
    const scopeRoot = join(root, scope);
    mkdirSync(scopeRoot, { recursive: true });
    const context = {
      scopeRoot,
      scopeId: deriveDirectoryScopeId(scopeRoot),
      sessionId,
      cwd: join(root, "writer"),
      authorityConfigPath,
    };
    contexts.push(context);
    registerSessionEnvironment(context);
    return context;
  }

  function configure(scope: string, privateAccess: boolean) {
    const scopeRoot = join(root, scope);
    mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
    writeFileSync(join(scopeRoot, ".kota", "config.json"), JSON.stringify({
      modules: { browser: { networkProfile: privateAccess
        ? { name: "configured-provider", allowedOrigins: [new URL(privateUrl).origin] }
        : { name: "public-untrusted" } } },
    }));
  }

  it.each(["provider-first", "public-first", "concurrent"])(
    "keeps private access exclusive to the configured scope (%s)",
    async (order) => {
      configure("provider", true);
      configure("public", false);
      writeFileSync(authorityConfigPath, JSON.stringify({
        trustedScopes: [join(root, "provider"), join(root, "public")],
      }));
      const provider = session("provider");
      const publicScope = session("public");
      const navigate = (context: ToolRunnerContext) => runBrowserNavigate({ url: privateUrl }, context);
      const first = order === "public-first" ? publicScope : provider;
      const second = first === provider ? publicScope : provider;
      const results = order === "concurrent"
        ? await Promise.all([navigate(first), navigate(second)])
        : [await navigate(first), await navigate(second)];
      const [allowed, denied] = first === provider ? results : results.reverse();
      expect(allowed).toMatchObject({ content: expect.stringContaining("Private target response") });
      expect(allowed?.is_error).toBeUndefined();
      expect(denied).toMatchObject({ is_error: true, content: expect.stringContaining("network policy denied") });
      expect(await navigate(session("unconfigured"))).toMatchObject({ is_error: true });

      // Closing one scope must leave the other scope's proxy and session live.
      await closeBrowser(publicScope.scopeId);
      expect(await navigate(provider)).toMatchObject({ content: expect.stringContaining("Private target response") });
      expect(await navigate(publicScope)).toMatchObject({ is_error: true });
      await closeBrowser();
      for (const proxy of proxies) {
        await expect(requestThroughProxy(proxy, privateUrl)).rejects.toThrow("proxy is closed");
      }
    },
  );

  it("uses the current scope policy for a new session while an older browser remains active", async () => {
    configure("provider", true);
    writeFileSync(authorityConfigPath, JSON.stringify({ trustedScopes: [join(root, "provider")] }));
    const original = session("provider");
    expect(await runBrowserNavigate({ url: privateUrl }, original)).toMatchObject({
      content: expect.stringContaining("Private target response"),
    });
    configure("provider", false);
    expect(await runBrowserNavigate({ url: privateUrl }, session("provider", "new-session"))).toMatchObject({
      is_error: true,
      content: expect.stringContaining("network policy denied"),
    });
  });

  it("closes the proxy on launch failure and allows a fresh session startup", async () => {
    configure("provider", true);
    writeFileSync(authorityConfigPath, JSON.stringify({ trustedScopes: [join(root, "provider")] }));
    vi.mocked(loadPlaywrightModule).mockResolvedValueOnce({
      chromium: {
        launch: async (options) => {
          if (options?.proxy) proxies.push(options.proxy);
          throw new Error("Chromium launch failed");
        },
      },
    });
    const context = session("provider");
    expect(await runBrowserNavigate({ url: privateUrl }, context)).toMatchObject({
      is_error: true,
      content: expect.stringContaining("Chromium launch failed"),
    });
    expect(proxies).toHaveLength(1);
    await expect(requestThroughProxy(proxies[0]!, privateUrl)).rejects.toThrow("proxy is closed");
    expect(await runBrowserNavigate({ url: privateUrl }, context)).toMatchObject({
      content: expect.stringContaining("Private target response"),
    });
  });

});
