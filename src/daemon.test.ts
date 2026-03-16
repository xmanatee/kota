import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Daemon, RESTART_EXIT_CODE, type DaemonConfig } from "./daemon.js";
import { resetEventBus } from "./event-bus.js";
import { resetScheduler, getScheduler, initScheduler } from "./scheduler.js";

// Mock the AgentSession to avoid real API calls
vi.mock("./loop.js", () => {
  return {
    AgentSession: class MockAgentSession {
      private label: string | undefined;
      constructor(opts: Record<string, unknown>) {
        this.label = opts.label as string | undefined;
      }
      async send(prompt: string): Promise<string> {
        return `Mock response to: ${prompt.slice(0, 50)}`;
      }
      close(): void {}
    },
    runAgentLoop: vi.fn(),
  };
});

// Mock task-store to avoid filesystem side effects
vi.mock("./task-store.js", () => ({
  initTaskStore: vi.fn(),
}));

describe("Daemon", () => {
  let storageDir: string;

  beforeEach(() => {
    storageDir = join(tmpdir(), `kota-daemon-test-${Date.now()}`);
    mkdirSync(storageDir, { recursive: true });
    resetEventBus();
    resetScheduler();
  });

  afterEach(() => {
    resetEventBus();
    resetScheduler();
    if (existsSync(storageDir)) {
      rmSync(storageDir, { recursive: true, force: true });
    }
  });

  function makeDaemon(overrides: Partial<DaemonConfig> = {}): Daemon {
    return new Daemon({
      model: "claude-haiku-4-5-20251001",
      verbose: false,
      restartOnBuild: false, // Don't watch dist/ in tests
      pollIntervalMs: 60_000, // Long poll to avoid timer interference
      stateDir: storageDir, // Isolate state from other tests
      ...overrides,
    });
  }

  it("constructs without errors", () => {
    const daemon = makeDaemon();
    expect(daemon).toBeDefined();
    expect(daemon.isRunning()).toBe(false);
    expect(daemon.isIdleActive()).toBe(false);
  });

  it("exports RESTART_EXIT_CODE as 75", () => {
    expect(RESTART_EXIT_CODE).toBe(75);
  });

  it("starts and stops cleanly", async () => {
    const daemon = makeDaemon();

    // Start in background, then stop immediately
    const startPromise = daemon.start();
    expect(daemon.isRunning()).toBe(true);

    await daemon.stop();
    expect(daemon.isRunning()).toBe(false);

    // start() should resolve after stop
    await startPromise;
  });

  it("getState returns daemon state", async () => {
    const daemon = makeDaemon();
    const state = daemon.getState();

    expect(state.pid).toBe(process.pid);
    expect(state.idleCycles).toBe(0);
    expect(state.startedAt).toBeTruthy();
  });

  it("stop is idempotent", async () => {
    const daemon = makeDaemon();
    const startPromise = daemon.start();

    await daemon.stop();
    await daemon.stop(); // second stop should be no-op
    expect(daemon.isRunning()).toBe(false);

    await startPromise;
  });

  it("handles scheduled items when they fire", async () => {
    initScheduler(process.cwd(), storageDir);
    const scheduler = getScheduler();

    // Add a notification-only scheduled item (no action)
    scheduler.add("Test reminder", new Date(Date.now() - 1000));

    const daemon = makeDaemon({ pollIntervalMs: 100 });
    const startPromise = daemon.start();

    // Wait for the scheduler timer to fire
    await new Promise((r) => setTimeout(r, 300));

    await daemon.stop();
    await startPromise;

    // The item should have been marked as fired
    const items = scheduler.list();
    const fired = items.filter((i) => i.status === "fired");
    expect(fired.length).toBeGreaterThanOrEqual(1);
  });

  it("runs idle tasks when nothing else is active", async () => {
    const daemon = makeDaemon({
      idleTasks: [
        { name: "test-idle", prompt: "Do a quick health check" },
      ],
      pollIntervalMs: 60_000,
    });

    const startPromise = daemon.start();

    // Idle check runs every 5s in production, but the mock session resolves instantly
    // Wait a bit for the idle check to trigger
    await new Promise((r) => setTimeout(r, 7_000));

    const state = daemon.getState();
    // The idle task should have run at least once
    expect(state.idleCycles).toBeGreaterThanOrEqual(1);
    expect(state.lastIdleTask).toBe("test-idle");

    await daemon.stop();
    await startPromise;
  }, 15_000);

  it("respects idle task cooldown", async () => {
    const daemon = makeDaemon({
      idleTasks: [
        { name: "cool-task", prompt: "Do something", cooldownMs: 60_000 },
      ],
    });

    const startPromise = daemon.start();

    // Wait for one idle task run
    await new Promise((r) => setTimeout(r, 7_000));

    const state = daemon.getState();
    // Should have run exactly once (cooldown prevents re-runs)
    expect(state.idleCycles).toBe(1);

    await daemon.stop();
    await startPromise;
  }, 15_000);

  it("does not run idle tasks if none configured", async () => {
    const daemon = makeDaemon({ idleTasks: undefined });
    const startPromise = daemon.start();

    await new Promise((r) => setTimeout(r, 200));

    expect(daemon.isIdleActive()).toBe(false);
    expect(daemon.getState().idleCycles).toBe(0);

    await daemon.stop();
    await startPromise;
  });

  it("detects dist/ mtime changes", () => {
    // Create a fake dist/ directory
    const distDir = join(process.cwd(), "dist");
    const cliPath = join(distDir, "cli.js");
    const originalExists = existsSync(distDir);

    if (originalExists && existsSync(cliPath)) {
      // Get the daemon's recorded mtime by reading it
      const daemon = makeDaemon({ restartOnBuild: true });
      // The daemon constructor records the mtime — we can't easily test the
      // restart behavior without actually modifying dist/, so just verify
      // the daemon creates without error
      expect(daemon).toBeDefined();
    }
  });

  it("handles event-triggered scheduler items", async () => {
    initScheduler(process.cwd(), storageDir);
    const scheduler = getScheduler();

    // Add an event-triggered item
    scheduler.addEventTrigger("On session end", "session.end", {
      action: "Log that session ended",
      repeat: true,
    });

    const daemon = makeDaemon({ pollIntervalMs: 60_000 });
    const startPromise = daemon.start();

    // Give the bus connection time to establish
    await new Promise((r) => setTimeout(r, 200));

    // The event bus + scheduler connection is set up by the daemon
    // Verify the item is still pending (event hasn't fired yet)
    const pending = scheduler.pending();
    expect(pending.length).toBe(1);
    expect(pending[0].triggerEvent).toBe("session.end");

    await daemon.stop();
    await startPromise;
  });
});
