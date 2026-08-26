import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

describe("browser lifecycle — authenticated profile", () => {
  let workDir: string;

  beforeEach(() => {
    vi.resetModules();
    resetLifecycleTestState();
    workDir = mkdtempSync(join(tmpdir(), "kota-browser-profile-"));
  });

  afterEach(async () => {
    await cleanUpLifecycleTest(workDir);
  });

  it("loads storageState and unlocks auth-walled content", async () => {
    const profilePath = join(workDir, "x-profile.json");
    writeFileSync(
      profilePath,
      JSON.stringify({ authCookie: "valid-session" }),
    );
    const lifecycle = await loadConfiguredLifecycle(workDir, {
      storageStatePath: profilePath,
    });

    const page = await lifecycle.getPage(
      await activateRunnerContext(runnerContext(workDir)),
    );
    await page.goto("https://auth-walled.example.test/");
    const content = await page.evaluate("document.body.innerText");

    expect(content).toBe("Authenticated content — welcome, operator.");
    expect(lifecycleTestState.capturedContextOptions[0]?.storageState).toBe(
      realpathSync(profilePath),
    );
    expect(lifecycleTestState.capturedLaunchOptions[0]).toMatchObject({
      headless: true,
      args: ["--proxy-bypass-list=<-loopback>"],
      proxy: {
        server: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
        username: expect.any(String),
        password: expect.any(String),
      },
    });
  });

  it("uses an ephemeral context when storageState is absent", async () => {
    const lifecycle = await loadConfiguredLifecycle(workDir, {
      storageStatePath: join(workDir, "absent.json"),
    });

    const page = await lifecycle.getPage(
      await activateRunnerContext(runnerContext(workDir)),
    );

    expect(await page.title()).toBe("Login");
    expect(lifecycleTestState.capturedContextOptions[0]?.storageState).toBeUndefined();
  });

  it("persists storage state on close only when enabled", async () => {
    const profilePath = join(workDir, "persisted.json");
    writeFileSync(
      profilePath,
      JSON.stringify({ authCookie: "valid-session" }),
    );
    const context = await activateRunnerContext(runnerContext(workDir));
    const lifecycle = await loadConfiguredLifecycle(workDir, {
      storageStatePath: profilePath,
      persist: true,
    });

    await lifecycle.getPage(context);
    await lifecycle.closeBrowserSession(context);

    expect(lifecycleTestState.lastContextStorageWrite).toBe(realpathSync(profilePath));
    expect(JSON.parse(readFileSync(profilePath, "utf8")).authCookie).toBe(
      "valid-session",
    );
  });

  it("does not persist storage state when disabled", async () => {
    const profilePath = join(workDir, "not-persisted.json");
    writeFileSync(
      profilePath,
      JSON.stringify({ authCookie: "valid-session" }),
    );
    const context = await activateRunnerContext(runnerContext(workDir));
    const lifecycle = await loadConfiguredLifecycle(workDir, {
      storageStatePath: profilePath,
    });

    await lifecycle.getPage(context);
    await lifecycle.closeBrowserSession(context);

    expect(lifecycleTestState.lastContextStorageWrite).toBeNull();
  });

  it("launches a headed browser when explicitly configured", async () => {
    const lifecycle = await loadConfiguredLifecycle(workDir, {
      headless: false,
    });

    await lifecycle.getPage(
      await activateRunnerContext(runnerContext(workDir)),
    );

    expect(lifecycleTestState.capturedLaunchOptions[0]?.headless).toBe(false);
  });

  it("resolves relative storage paths from each canonical scope, not its workspace", async () => {
    const scopeARoot = join(workDir, "scope-a");
    const scopeBRoot = join(workDir, "scope-b");
    mkdirSync(join(scopeARoot, "profiles"), { recursive: true });
    mkdirSync(join(scopeBRoot, "profiles"), { recursive: true });
    const relativePath = join("profiles", "browser.json");
    writeFileSync(
      join(scopeARoot, relativePath),
      JSON.stringify({ authCookie: "valid-session" }),
    );
    writeFileSync(
      join(scopeBRoot, relativePath),
      JSON.stringify({ authCookie: "other-session" }),
    );
    const lifecycle = await loadConfiguredLifecycle(
      scopeARoot,
      { storageStatePath: relativePath },
      { scopeRoot: scopeARoot },
    );

    const pageA = await lifecycle.getPage(
      await activateRunnerContext(runnerContext(
        scopeARoot,
        "session-a",
        "scope-a",
        join(workDir, "worktrees", "scope-a"),
      )),
    );
    const pageB = await lifecycle.getPage(
      await activateRunnerContext(
        runnerContext(scopeBRoot, "session-b", "scope-b"),
      ),
    );

    expect(
      lifecycleTestState.capturedContextOptions.map(
        (entry) => entry.storageState,
      ),
    ).toEqual([
      realpathSync(join(scopeARoot, relativePath)),
      realpathSync(join(scopeBRoot, relativePath)),
    ]);
    expect(await pageA.title()).toBe("Protected");
    expect(await pageB.title()).toBe("Login");
  });

  it.each([
    ["absolute", (root: string) => join(root, "shared-profile.json")],
    ["scope-escaping", () => join("..", "shared-profile.json")],
  ])(
    "loads and persists a %s profile only for its owning scope",
    async (_kind, configuredPath) => {
      const scopeARoot = join(workDir, "scope-a");
      const scopeBRoot = join(workDir, "scope-b");
      mkdirSync(scopeARoot, { recursive: true });
      mkdirSync(scopeBRoot, { recursive: true });
      const profilePath = join(workDir, "shared-profile.json");
      writeFileSync(
        profilePath,
        JSON.stringify({ authCookie: "valid-session" }),
      );
      const lifecycle = await loadConfiguredLifecycle(
        scopeARoot,
        { storageStatePath: configuredPath(workDir), persist: true },
        { scopeRoot: scopeARoot },
      );
      const contextA = await activateRunnerContext(
        runnerContext(scopeARoot, "session-a", "scope-a"),
      );
      const contextB = await activateRunnerContext(
        runnerContext(scopeBRoot, "session-b", "scope-b"),
      );

      const pageA = await lifecycle.getPage(contextA);
      const pageB = await lifecycle.getPage(contextB);

      expect(lifecycleTestState.capturedContextOptions).toEqual([
        { storageState: realpathSync(profilePath) },
        {},
      ]);
      expect(await pageA.title()).toBe("Protected");
      expect(await pageB.title()).toBe("Login");

      await lifecycle.closeBrowserSession(contextB);
      expect(lifecycleTestState.lastContextStorageWrite).toBeNull();
      await lifecycle.closeBrowserSession(contextA);
      expect(lifecycleTestState.lastContextStorageWrite).toBe(realpathSync(profilePath));
    },
  );

  it("does not load or persist another scope's profile through a local symlink", async () => {
    const scopeARoot = join(workDir, "scope-a");
    const scopeBRoot = join(workDir, "scope-b");
    const relativePath = join("profiles", "browser.json");
    const profileA = join(scopeARoot, relativePath);
    const profileB = join(scopeBRoot, relativePath);
    mkdirSync(join(scopeARoot, "profiles"), { recursive: true });
    mkdirSync(join(scopeBRoot, "profiles"), { recursive: true });
    writeFileSync(
      profileA,
      JSON.stringify({ authCookie: "valid-session" }),
    );
    symlinkSync(profileA, profileB);
    const lifecycle = await loadConfiguredLifecycle(
      scopeARoot,
      { storageStatePath: relativePath, persist: true },
      { scopeRoot: scopeARoot },
    );
    const contextA = await activateRunnerContext(
      runnerContext(scopeARoot, "session-a", "scope-a"),
    );
    const contextB = await activateRunnerContext(
      runnerContext(scopeBRoot, "session-b", "scope-b"),
    );

    const pageA = await lifecycle.getPage(contextA);
    const pageB = await lifecycle.getPage(contextB);

    expect(lifecycleTestState.capturedContextOptions).toEqual([
      { storageState: realpathSync(profileA) },
      {},
    ]);
    expect(await pageA.title()).toBe("Protected");
    expect(await pageB.title()).toBe("Login");

    await lifecycle.closeBrowserSession(contextB);
    expect(lifecycleTestState.lastContextStorageWrite).toBeNull();
    await lifecycle.closeBrowserSession(contextA);
    expect(lifecycleTestState.lastContextStorageWrite).toBe(realpathSync(profileA));
  });

  it("rejects persistence outside an agent's declared write roots", async () => {
    const scopeRoot = join(workDir, "scope");
    const workspaceRoot = join(workDir, "worktree");
    mkdirSync(scopeRoot, { recursive: true });
    mkdirSync(workspaceRoot, { recursive: true });
    const profilePath = join(scopeRoot, "profile.json");
    writeFileSync(profilePath, JSON.stringify({ authCookie: "valid-session" }));
    const context = await activateRunnerContext({
      ...runnerContext(scopeRoot, "agent-session", "scope-a", workspaceRoot),
      agentWriteScope: ["."],
    });
    const lifecycle = await loadConfiguredLifecycle(scopeRoot, {
      storageStatePath: profilePath,
      persist: true,
    });

    await lifecycle.getPage(context);

    await expect(lifecycle.closeBrowserSession(context)).rejects.toThrow(
      "outside the agent write scope",
    );
    expect(lifecycleTestState.lastContextStorageWrite).toBeNull();
  });

  it("rejects a profile target redirected after the session opens", async () => {
    const scopeRoot = join(workDir, "scope");
    const profileDir = join(scopeRoot, "profiles");
    const movedProfileDir = join(scopeRoot, "original-profiles");
    const redirectDir = join(workDir, "redirect");
    mkdirSync(profileDir, { recursive: true });
    mkdirSync(redirectDir, { recursive: true });
    writeFileSync(
      join(profileDir, "profile.json"),
      JSON.stringify({ authCookie: "valid-session" }),
    );
    writeFileSync(
      join(redirectDir, "profile.json"),
      JSON.stringify({ authCookie: "other-session" }),
    );
    const context = await activateRunnerContext(runnerContext(scopeRoot));
    const lifecycle = await loadConfiguredLifecycle(scopeRoot, {
      storageStatePath: join("profiles", "profile.json"),
      persist: true,
    });
    await lifecycle.getPage(context);
    renameSync(profileDir, movedProfileDir);
    symlinkSync(redirectDir, profileDir);

    await expect(lifecycle.closeBrowserSession(context)).rejects.toThrow(
      "storage target changed",
    );
    expect(lifecycleTestState.lastContextStorageWrite).toBeNull();
  });
});
