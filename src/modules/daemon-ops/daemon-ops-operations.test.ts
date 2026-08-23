import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonLiveStatus } from "#core/daemon/daemon-control.js";
import { isProcessAlive } from "#core/util/process-alive.js";
import { localDaemonStop } from "./daemon-ops-operations.js";

vi.mock("#core/util/process-alive.js", () => ({
  isProcessAlive: vi.fn(),
}));

const mockedIsProcessAlive = vi.mocked(isProcessAlive);

function daemonStatus(pid: number): DaemonLiveStatus {
  return {
    pid,
    startedAt: "2026-06-20T19:00:00.000Z",
    running: true,
    workflow: {
      activeRuns: [],
      pendingRuns: [],
      queueLength: 0,
      completedRuns: 0,
      workflows: {},
      paused: false,
      agentConcurrency: 1,
      codeConcurrency: 4,
    },
    sessions: [],
    channels: [],
  };
}

function writeControlFile(projectDir: string, pid: number): void {
  mkdirSync(join(projectDir, ".kota"), { recursive: true });
  writeFileSync(
    join(projectDir, ".kota", "daemon-control.json"),
    JSON.stringify({
      port: 56789,
      pid,
      startedAt: "2026-06-20T19:00:00.000Z",
      token: "expected-token",
    }),
  );
}

describe("localDaemonStop", () => {
  let projectDir: string;
  let originalFetch: typeof globalThis.fetch;
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-local-daemon-stop-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    originalFetch = globalThis.fetch;
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(projectDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("refuses to signal the recorded pid when /status is unauthenticated", async () => {
    const pid = 4321;
    writeControlFile(projectDir, pid);
    mockedIsProcessAlive.mockReturnValue(true);
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 401 })) as typeof fetch;

    await expect(localDaemonStop({ projectDir, timeoutSec: 1 })).resolves.toEqual({
      ok: false,
      reason: "unavailable",
      pid,
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer expected-token",
    );
    expect(killSpy).not.toHaveBeenCalledWith(pid, "SIGTERM");
  });

  it("refuses to signal the recorded pid when authenticated /status reports a different pid", async () => {
    const pid = 4321;
    writeControlFile(projectDir, pid);
    mockedIsProcessAlive.mockReturnValue(true);
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(daemonStatus(9876)), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    ) as typeof fetch;

    await expect(localDaemonStop({ projectDir, timeoutSec: 1 })).resolves.toEqual({
      ok: false,
      reason: "unavailable",
      pid,
    });
    expect(killSpy).not.toHaveBeenCalledWith(pid, "SIGTERM");
  });

  it("signals the recorded pid only after authenticated /status reports the same pid", async () => {
    const pid = 4321;
    writeControlFile(projectDir, pid);
    mockedIsProcessAlive
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(daemonStatus(pid)), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    ) as typeof fetch;

    await expect(localDaemonStop({ projectDir, timeoutSec: 1 })).resolves.toEqual({
      ok: true,
    });
    expect(killSpy).toHaveBeenCalledWith(pid, "SIGTERM");
  });
});
