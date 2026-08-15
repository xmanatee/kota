import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
      profilePath,
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

    expect(lifecycleTestState.lastContextStorageWrite).toBe(profilePath);
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

  it("resolves relative storage paths from each canonical project, not its workspace", async () => {
    const projectA = join(workDir, "project-a");
    const projectB = join(workDir, "project-b");
    mkdirSync(join(projectA, "profiles"), { recursive: true });
    mkdirSync(join(projectB, "profiles"), { recursive: true });
    const relativePath = join("profiles", "browser.json");
    writeFileSync(
      join(projectA, relativePath),
      JSON.stringify({ authCookie: "valid-session" }),
    );
    writeFileSync(
      join(projectB, relativePath),
      JSON.stringify({ authCookie: "other-session" }),
    );
    const lifecycle = await loadConfiguredLifecycle(
      projectA,
      { storageStatePath: relativePath },
      { projectDir: projectA },
    );

    const pageA = await lifecycle.getPage(
      await activateRunnerContext(runnerContext(
        projectA,
        "session-a",
        "scope-a",
        join(workDir, "worktrees", "project-a"),
      )),
    );
    const pageB = await lifecycle.getPage(
      await activateRunnerContext(
        runnerContext(projectB, "session-b", "scope-b"),
      ),
    );

    expect(
      lifecycleTestState.capturedContextOptions.map(
        (entry) => entry.storageState,
      ),
    ).toEqual([join(projectA, relativePath), join(projectB, relativePath)]);
    expect(await pageA.title()).toBe("Protected");
    expect(await pageB.title()).toBe("Login");
  });

  it.each([
    ["absolute", (root: string) => join(root, "shared-profile.json")],
    ["project-escaping", () => join("..", "shared-profile.json")],
  ])(
    "loads and persists a %s profile only for its owning scope",
    async (_kind, configuredPath) => {
      const projectA = join(workDir, "project-a");
      const projectB = join(workDir, "project-b");
      mkdirSync(projectA, { recursive: true });
      mkdirSync(projectB, { recursive: true });
      const profilePath = join(workDir, "shared-profile.json");
      writeFileSync(
        profilePath,
        JSON.stringify({ authCookie: "valid-session" }),
      );
      const lifecycle = await loadConfiguredLifecycle(
        projectA,
        { storageStatePath: configuredPath(workDir), persist: true },
        { projectDir: projectA },
      );
      const scopeA = await activateRunnerContext(
        runnerContext(projectA, "session-a", "scope-a"),
      );
      const scopeB = await activateRunnerContext(
        runnerContext(projectB, "session-b", "scope-b"),
      );

      const pageA = await lifecycle.getPage(scopeA);
      const pageB = await lifecycle.getPage(scopeB);

      expect(lifecycleTestState.capturedContextOptions).toEqual([
        { storageState: profilePath },
        {},
      ]);
      expect(await pageA.title()).toBe("Protected");
      expect(await pageB.title()).toBe("Login");

      await lifecycle.closeBrowserSession(scopeB);
      expect(lifecycleTestState.lastContextStorageWrite).toBeNull();
      await lifecycle.closeBrowserSession(scopeA);
      expect(lifecycleTestState.lastContextStorageWrite).toBe(profilePath);
    },
  );

  it("does not load or persist another scope's profile through a local symlink", async () => {
    const projectA = join(workDir, "project-a");
    const projectB = join(workDir, "project-b");
    const relativePath = join("profiles", "browser.json");
    const profileA = join(projectA, relativePath);
    const profileB = join(projectB, relativePath);
    mkdirSync(join(projectA, "profiles"), { recursive: true });
    mkdirSync(join(projectB, "profiles"), { recursive: true });
    writeFileSync(
      profileA,
      JSON.stringify({ authCookie: "valid-session" }),
    );
    symlinkSync(profileA, profileB);
    const lifecycle = await loadConfiguredLifecycle(
      projectA,
      { storageStatePath: relativePath, persist: true },
      { projectDir: projectA },
    );
    const scopeA = await activateRunnerContext(
      runnerContext(projectA, "session-a", "scope-a"),
    );
    const scopeB = await activateRunnerContext(
      runnerContext(projectB, "session-b", "scope-b"),
    );

    const pageA = await lifecycle.getPage(scopeA);
    const pageB = await lifecycle.getPage(scopeB);

    expect(lifecycleTestState.capturedContextOptions).toEqual([
      { storageState: profileA },
      {},
    ]);
    expect(await pageA.title()).toBe("Protected");
    expect(await pageB.title()).toBe("Login");

    await lifecycle.closeBrowserSession(scopeB);
    expect(lifecycleTestState.lastContextStorageWrite).toBeNull();
    await lifecycle.closeBrowserSession(scopeA);
    expect(lifecycleTestState.lastContextStorageWrite).toBe(profileA);
  });
});
