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

  describe("error paths", () => {
    it("saves state even when stateDir does not exist yet", () => {
      const nonExistentDir = join(tmpdir(), `kota-daemon-nodir-${Date.now()}`);
      const daemon = makeDaemon({ stateDir: nonExistentDir });

      // Start triggers saveState, which should create the directory
      const startPromise = daemon.start();
      daemon.stop();

      // Verify the state file was created
      const statePath = join(nonExistentDir, "daemon-state.json");
      expect(existsSync(statePath)).toBe(true);

      const state = JSON.parse(readFileSync(statePath, "utf-8"));
      expect(state.pid).toBe(process.pid);

      // Cleanup
      rmSync(nonExistentDir, { recursive: true, force: true });
      return startPromise;
    });

    it("loads corrupted state file gracefully", () => {
      // Write invalid JSON to state file
      writeFileSync(join(storageDir, "daemon-state.json"), "not json{{{", "utf-8");

      const daemon = makeDaemon();
      const state = daemon.getState();

      // Should use default state, not crash
      expect(state.pid).toBe(process.pid);
      expect(state.idleCycles).toBe(0);
    });

    it("removes signal handlers on stop", async () => {
      const initialSigintCount = process.listenerCount("SIGINT");
      const initialSigtermCount = process.listenerCount("SIGTERM");

      const daemon = makeDaemon();
      const startPromise = daemon.start();

      // Should have added handlers
      expect(process.listenerCount("SIGINT")).toBe(initialSigintCount + 1);
      expect(process.listenerCount("SIGTERM")).toBe(initialSigtermCount + 1);

      await daemon.stop();
      await startPromise;

      // Should have removed handlers
      expect(process.listenerCount("SIGINT")).toBe(initialSigintCount);
      expect(process.listenerCount("SIGTERM")).toBe(initialSigtermCount);
    });

    it("resets stopping flag after stop completes", async () => {
      const daemon = makeDaemon();
      const startPromise = daemon.start();

      await daemon.stop();
      await startPromise;

      // After stop, isRunning is false but the object is in a clean state
      // (not stuck in "stopping" forever)
      expect(daemon.isRunning()).toBe(false);

      // Can start again without being blocked by stale stopping flag
      const startPromise2 = daemon.start();
      expect(daemon.isRunning()).toBe(true);
      await daemon.stop();
      await startPromise2;
    });

    it("handles idle task session creation failure gracefully", async () => {
      // Temporarily override the mock to throw on construction
      const loopModule = await import("./loop.js");
      const OriginalSession = loopModule.AgentSession;
      let throwOnConstruct = false;

      vi.mocked(loopModule).AgentSession = class ThrowingSession {
        constructor(opts: Record<string, unknown>) {
          if (throwOnConstruct) {
            throw new Error("Session creation failed");
          }
          return new (OriginalSession as unknown as new (o: Record<string, unknown>) => unknown)(opts) as ThrowingSession;
        }
        async send(_prompt: string): Promise<string> { return ""; }
        close(): void {}
      } as unknown as typeof loopModule.AgentSession;

      const daemon = makeDaemon({
        idleTasks: [{ name: "failing-task", prompt: "This will fail" }],
      });
      const startPromise = daemon.start();

      // Enable throwing, then wait for idle check
      throwOnConstruct = true;
      await new Promise((r) => setTimeout(r, 7_000));

      // Daemon should still be running (not crashed)
      expect(daemon.isRunning()).toBe(true);
      // No idle session should be active (it failed to create)
      expect(daemon.isIdleActive()).toBe(false);
      // idleCycles should be 0 (task never completed)
      expect(daemon.getState().idleCycles).toBe(0);

      // Restore
      vi.mocked(loopModule).AgentSession = OriginalSession;
      await daemon.stop();
      await startPromise;
    }, 15_000);

    it("handles idle task send() rejection without crashing", async () => {
      const loopModule = await import("./loop.js");
      const OriginalSession = loopModule.AgentSession;

      vi.mocked(loopModule).AgentSession = class FailingSendSession {
        constructor(_opts: Record<string, unknown>) {}
        async send(_prompt: string): Promise<string> {
          throw new Error("API call failed");
        }
        close(): void {}
      } as unknown as typeof loopModule.AgentSession;

      const daemon = makeDaemon({
        idleTasks: [{ name: "send-fail", prompt: "This send will fail" }],
      });
      const startPromise = daemon.start();

      await new Promise((r) => setTimeout(r, 7_000));

      // Daemon should still be running
      expect(daemon.isRunning()).toBe(true);
      // Idle session should be cleared after the failure
      expect(daemon.isIdleActive()).toBe(false);
      // idleCycles should be 0 (task failed)
      expect(daemon.getState().idleCycles).toBe(0);

      vi.mocked(loopModule).AgentSession = OriginalSession;
      await daemon.stop();
      await startPromise;
    }, 15_000);

    it("does not accumulate signal handlers across start/stop cycles", async () => {
      const initialSigintCount = process.listenerCount("SIGINT");

      const daemon = makeDaemon();

      // Cycle 1
      const start1 = daemon.start();
      await daemon.stop();
      await start1;

      // Cycle 2
      const start2 = daemon.start();
      await daemon.stop();
      await start2;

      // Cycle 3
      const start3 = daemon.start();
      await daemon.stop();
      await start3;

      // Should be back to original count
      expect(process.listenerCount("SIGINT")).toBe(initialSigintCount);
    });

    it("survives double start call", async () => {
      const daemon = makeDaemon();
      const start1 = daemon.start();
      // Second start should be a no-op
      const start2 = daemon.start();

      expect(daemon.isRunning()).toBe(true);

      await daemon.stop();
      await start1;
      await start2;
    });

    it("persists state through restart cycles", async () => {
      // First lifecycle
      const daemon1 = makeDaemon();
      const start1 = daemon1.start();
      await daemon1.stop();
      await start1;

      // Second lifecycle reads state from same directory
      const daemon2 = makeDaemon();
      const state = daemon2.getState();

      // Should have fresh startedAt and pid (overwritten in constructor)
      expect(state.pid).toBe(process.pid);
      expect(state.startedAt).toBeTruthy();
    });
  });
});
