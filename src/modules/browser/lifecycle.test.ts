import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateRunnerContext,
  cleanUpLifecycleTest,
  getLifecycleTestState,
  loadConfiguredLifecycle,
  resetLifecycleTestState,
  runnerContext,
} from "./lifecycle-test-support.js";

const lifecycleTestState = getLifecycleTestState();

describe("browser lifecycle — session isolation", () => {
  let workDir: string;

  beforeEach(() => {
    vi.resetModules();
    resetLifecycleTestState();
    workDir = mkdtempSync(join(tmpdir(), "kota-browser-lifecycle-"));
  });

  afterEach(async () => {
    await cleanUpLifecycleTest(workDir);
  });

  it("isolates contexts and current pages by scope and session", async () => {
    const lifecycle = await loadConfiguredLifecycle(workDir);
    const sessionA = await activateRunnerContext(
      runnerContext(workDir, "session-a", "scope-a"),
    );
    const sessionB = await activateRunnerContext(
      runnerContext(workDir, "session-b", "scope-a"),
    );
    const scopeB = await activateRunnerContext(
      runnerContext(workDir, "session-a", "scope-b"),
    );
    const pageA = await lifecycle.getPage(sessionA);
    const pageB = await lifecycle.getPage(sessionB);
    const pageOtherScope = await lifecycle.getPage(scopeB);

    expect(await lifecycle.getPage(sessionA)).toBe(pageA);
    expect(pageB).not.toBe(pageA);
    expect(pageOtherScope).not.toBe(pageA);
    expect(lifecycleTestState.capturedContextOptions).toHaveLength(3);

    await pageA.goto("https://private.example.test/session-a");
    expect(pageA.url()).toContain("session-a");
    expect(pageB.url()).toBe("about:blank");
    expect(pageOtherScope.url()).toBe("about:blank");
  });

  it("binds context teardown to the owning session lifecycle", async () => {
    const context = await activateRunnerContext(runnerContext(workDir));
    const sessionEnvironment = await import("#core/tools/session-environment.js");
    const lifecycle = await loadConfiguredLifecycle(workDir);
    const page = await lifecycle.getPage(context);

    sessionEnvironment.unregisterSessionEnvironment(context);

    await vi.waitFor(() => expect(page.isClosed()).toBe(true));
    expect(lifecycleTestState.closedContexts).toBe(1);
  });

  it("closes only the invoking session resource", async () => {
    const lifecycle = await loadConfiguredLifecycle(workDir);
    const sessionA = await activateRunnerContext(
      runnerContext(workDir, "session-a"),
    );
    const sessionB = await activateRunnerContext(
      runnerContext(workDir, "session-b"),
    );
    const pageA = await lifecycle.getPage(sessionA);
    const pageB = await lifecycle.getPage(sessionB);

    await lifecycle.closeBrowserSession(sessionA);

    expect(pageA.isClosed()).toBe(true);
    expect(pageB.isClosed()).toBe(false);
    expect(await lifecycle.getPage(sessionB)).toBe(pageB);
  });

  it("fails closed without complete or consistent session identity", async () => {
    const lifecycle = await import("./lifecycle.js");
    await expect(lifecycle.getPage()).rejects.toThrow("session identity");
    await expect(
      lifecycle.getPage({ sessionId: "session-a", cwd: workDir }),
    ).rejects.toThrow("scope");
    await expect(
      lifecycle.getPage({ sessionId: "session-a", scopeId: "scope-a" }),
    ).rejects.toThrow("scope root");
    await expect(
      lifecycle.getPage({
        sessionId: "ended-session",
        scopeId: "scope-a",
        scopeRoot: workDir,
        cwd: workDir,
      }),
    ).rejects.toThrow("live session");
  });

  it("detects scope-local Playwright without CommonJS globals", async () => {
    const lifecycle = await import("./lifecycle.js");
    const scopeRoot = join(workDir, "scope");
    const packageDir = join(scopeRoot, "node_modules", "playwright");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(scopeRoot, "package.json"), '{"name":"fixture"}\n');
    writeFileSync(
      join(packageDir, "package.json"),
      '{"name":"playwright","version":"0.0.0","main":"index.js"}\n',
    );
    writeFileSync(join(packageDir, "index.js"), "module.exports = {};\n");

    expect(lifecycle.isPlaywrightAvailable(scopeRoot)).toBe(true);
  });
});
