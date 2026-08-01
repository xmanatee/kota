import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import {
  Daemon,
  type DaemonConfig,
  resetScheduler,
} from "#core/daemon/index.js";
import { resetEventBus } from "#core/events/event-bus.js";
import { executeWithAgentSDK } from "#modules/claude-agent-harness/executor.js";

vi.mock("#modules/claude-agent-harness/executor.js", async () => {
  const actual = await vi.importActual<typeof import("#modules/claude-agent-harness/executor.js")>(
    "#modules/claude-agent-harness/executor.js",
  );
  return { ...actual, executeWithAgentSDK: vi.fn() };
});

vi.mock("#core/daemon/task-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#core/daemon/task-store.js")>();
  return { ...actual, initTaskStore: vi.fn() };
});

import "#modules/claude-agent-harness/index.js";

export const mockedExecuteWithAgentSDK = vi.mocked(executeWithAgentSDK);
export let projectDir = "";
export let stateDir = "";

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function initializeFixtureGitRepo(): void {
  writeFileSync(join(projectDir, ".gitignore"), ".kota/\n");
  execFileSync("git", ["init"], { cwd: projectDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Kota Tests"], {
    cwd: projectDir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.email", "kota@example.com"], {
    cwd: projectDir,
    stdio: "ignore",
  });
  execFileSync("git", ["add", ".gitignore"], { cwd: projectDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: projectDir, stdio: "ignore" });
}

export function commitFixtureFiles(targetProjectDir = projectDir): void {
  execFileSync("git", ["add", "-A"], { cwd: targetProjectDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "fixture"], {
    cwd: targetProjectDir,
    stdio: "ignore",
  });
}

export function makeDaemon(overrides: Partial<DaemonConfig> = {}): Daemon {
  return new Daemon({
    projectDir,
    model: "claude-sonnet-4-6",
    verbose: false,
    idleIntervalMs: 1000,
    pollIntervalMs: 60_000,
    stateDir,
    config: { defaultAgentHarness: "claude-agent-sdk" },
    ...overrides,
  });
}

beforeEach(() => {
  projectDir = join(
    tmpdir(),
    `kota-daemon-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  stateDir = join(projectDir, ".kota");
  mkdirSync(join(projectDir, "src", "modules", "autonomy", "workflows", "builder"), {
    recursive: true,
  });
  initializeFixtureGitRepo();
  resetEventBus();
  resetScheduler();
  mockedExecuteWithAgentSDK.mockReset();
});

afterEach(() => {
  resetEventBus();
  resetScheduler();
  rmSync(projectDir, { recursive: true, force: true });
});
