import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Daemon } from "#core/daemon/daemon.js";
import type { DaemonControlAddress } from "#core/daemon/daemon-control.js";
import { resetScheduler } from "#core/daemon/scheduler.js";
import { resetEventBus } from "#core/events/event-bus.js";
import { isProcessAlive } from "#core/util/process-alive.js";
import { localDaemonStop } from "./daemon-ops-operations.js";
import { DaemonDashboard } from "./dashboard.js";
import { DaemonTaskQueueProjection } from "./task-queue-projection.js";

const CONTROL_LATENCY_BOUND_MS = 500;
const STOP_CONTROL_LATENCY_BOUND_MS = 1_000;
const LARGE_QUEUE_SIZE = 1_600;

vi.mock("#core/util/process-alive.js", () => ({
  isProcessAlive: vi.fn(() => true),
}));

function initializeLargeQueueRepo(projectDir: string): void {
  writeFileSync(join(projectDir, ".gitignore"), ".kota/\n", "utf8");
  execFileSync("git", ["init", "--quiet"], { cwd: projectDir });
  execFileSync("git", ["config", "user.name", "Kota Tests"], {
    cwd: projectDir,
  });
  execFileSync("git", ["config", "user.email", "kota@example.com"], {
    cwd: projectDir,
  });
  const tasksDir = join(projectDir, "data", "tasks");
  for (const state of [
    "backlog",
    "ready",
    "doing",
    "blocked",
    "done",
    "dropped",
  ]) {
    mkdirSync(join(tasksDir, state), { recursive: true });
  }
  mkdirSync(join(projectDir, "data", "inbox"), { recursive: true });
  for (let index = 0; index < LARGE_QUEUE_SIZE; index += 1) {
    const id = `task-dashboard-load-${String(index).padStart(4, "0")}`;
    writeFileSync(
      join(tasksDir, "backlog", `${id}.md`),
      `---\nid: ${id}\ntitle: Dashboard load ${index}\nstatus: backlog\npriority: p2\narea: core\ntask_class: Platform\nsummary: Queue fixture ${index}.\ncreated_at: 2026-08-13T00:00:00.000Z\nupdated_at: 2026-08-13T00:00:00.000Z\n---\n\n## Done When\n\n- Complete.\n\n## Acceptance Evidence\n\n- Fixture evidence.\n`,
      "utf8",
    );
  }
  execFileSync("git", ["add", ".gitignore"], { cwd: projectDir });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], {
    cwd: projectDir,
  });
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("condition was not met before timeout");
}

describe("foreground dashboard responsiveness", () => {
  let projectDir = "";

  afterEach(() => {
    vi.restoreAllMocks();
    resetEventBus();
    resetScheduler();
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
  });

  it("caches one large projection, coalesces log bursts, and leaves status/stop responsive", async () => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-dashboard-responsive-"));
    initializeLargeQueueRepo(projectDir);
    resetEventBus();
    resetScheduler();
    const stateDir = join(projectDir, ".kota");
    mkdirSync(stateDir, { recursive: true });

    const daemon = new Daemon({
      projectDir,
      stateDir,
      workflows: [],
      idleIntervalMs: 60_000,
      pollIntervalMs: 60_000,
      config: { defaultAgentHarness: "claude-agent-sdk" },
    });
    const sigtermListenersBefore = new Set(process.listeners("SIGTERM"));
    const daemonRun = daemon.start();
    await waitUntil(() => existsSync(join(stateDir, "daemon-control.json")));
    const address = JSON.parse(
      readFileSync(join(stateDir, "daemon-control.json"), "utf8"),
    ) as DaemonControlAddress;
    const daemonSignalHandler = process
      .listeners("SIGTERM")
      .find((listener) => !sigtermListenersBefore.has(listener));
    expect(daemonSignalHandler).toBeDefined();

    let daemonPidAlive = true;
    vi.mocked(isProcessAlive).mockImplementation(
      (pid) => pid === address.pid && daemonPidAlive,
    );
    const killSpy = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      expect(pid).toBe(address.pid);
      expect(signal).toBe("SIGTERM");
      daemonSignalHandler?.call(process, "SIGTERM");
      daemonPidAlive = false;
      return true;
    });

    const projection = new DaemonTaskQueueProjection(projectDir);
    const refreshProjection = vi.fn((signal: AbortSignal) =>
      projection.refresh(signal),
    );
    const writeEvidence = process.stdout.write.bind(process.stdout);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const dashboard = new DaemonDashboard(() => {
      const taskQueue = projection.getSnapshot();
      return {
        ...daemon.getDashboardSnapshot(),
        ...(taskQueue !== undefined ? { taskQueue } : {}),
      };
    }, { refreshProjection });

    dashboard.start();
    try {
      expect(refreshProjection).toHaveBeenCalledTimes(1);
      expect(projection.getSnapshot()).toBeUndefined();

      const statusStartedAt = performance.now();
      const status = await fetch(`http://127.0.0.1:${address.port}/status`, {
        headers: {
          ...(address.token !== undefined
            ? { Authorization: `Bearer ${address.token}` }
            : {}),
        },
      });
      const statusLatencyMs = performance.now() - statusStartedAt;
      expect(status.status).toBe(200);
      expect(statusLatencyMs).toBeLessThan(CONTROL_LATENCY_BOUND_MS);

      const framesBeforeBurst = stdoutSpy.mock.calls.length;
      for (let index = 0; index < 250; index += 1) {
        process.stderr.write(`[kota-daemon] queue burst ${index}\n`);
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(stdoutSpy.mock.calls.length - framesBeforeBurst).toBe(1);
      expect(refreshProjection).toHaveBeenCalledTimes(1);

      const stopStartedAt = performance.now();
      const stopResult = await localDaemonStop({ projectDir, timeoutSec: 2 });
      const stopLatencyMs = performance.now() - stopStartedAt;
      expect(stopResult).toEqual({ ok: true });
      expect(killSpy).toHaveBeenCalledWith(address.pid, "SIGTERM");
      expect(stopLatencyMs).toBeLessThan(STOP_CONTROL_LATENCY_BOUND_MS);
      await daemonRun;
      expect(daemon.getState().lastStopReason).toBe("sigterm");

      await waitUntil(() => projection.getSnapshot() !== undefined);
      expect(projection.getSnapshot()?.counts.backlog).toBe(LARGE_QUEUE_SIZE);
      expect(refreshProjection).toHaveBeenCalledTimes(1);
      writeEvidence(
        `[dashboard-responsiveness-evidence] ${JSON.stringify({
          taskCount: LARGE_QUEUE_SIZE,
          stderrBurstCount: 250,
          framesForBurst: 1,
          projectionRefreshCount: refreshProjection.mock.calls.length,
          statusLatencyMs,
          stopLatencyMs,
          latencyBoundMs: CONTROL_LATENCY_BOUND_MS,
          stopLatencyBoundMs: STOP_CONTROL_LATENCY_BOUND_MS,
          stopControlPath: "authenticated /status -> pid SIGTERM -> daemon signal handler",
          terminalStopReason: daemon.getState().lastStopReason,
        })}\n`,
      );
    } finally {
      dashboard.stop();
      if (daemon.isRunning()) {
        await daemon.stop(1_000, "programmatic", 1_000);
        await daemonRun;
      }
    }
  });
});
