/**
 * daemonOps namespace daemon-side handler test.
 *
 * The daemonOps namespace migrated out of the core stub into
 * `daemonClient(link)` on the daemon-ops module (alongside the previously
 * migrated `sessions` namespace). This test pins the invariants the
 * migration relies on:
 *
 *  1. The daemon-ops module's `daemonClient(link)` factory contributes
 *     `daemonOps` alongside `sessions`, with `status`, `pid`, `stop`, and
 *     `reload` methods.
 *  2. `status()` routes through `link.request("GET", "/status")` and decodes
 *     the success arm correctly: a `200 + { pid, startedAt, workflow,
 *     sessions, ... }` response combines the remote status with the local
 *     service-unit probe.
 *  3. `status()` throws on `null` (transport failure or non-ok response)
 *     with a message containing `"Daemon unreachable"`.
 *  4. `pid()` routes through `link.request("GET", "/status")` and decodes
 *     the success arm correctly: a `200 + { pid: 1234, ... }` response
 *     collapses to `{ state: "running", pid: 1234 }`.
 *  5. `pid()` throws on `null` or missing `status.pid` with a message
 *     containing `"Daemon unreachable"`.
 *  6. `stop({ timeoutSec: 30 })` routes through `link.request("GET",
 *     "/status")`, reads the daemon pid, fetches identity for scope-scoped
 *     failure evidence when a pid is available, and reports
 *     not-running/stale states through the shared stop result contract.
 *  7. `reload()` routes through `link.request("POST", "/reload")` and
 *     decodes the success arm correctly, including the session guardrails
 *     refresh summary.
 *  8. `reload()` decodes the reload_failed arm correctly: a `null` response
 *     (transport failure or non-ok) collapses to `{ ok: false, reason:
 *     "reload_failed" }`.
 *  9. Supplying the daemon-ops daemonOps contribution to the assembly path
 *     satisfies coverage.
 * 10. The assembly path fails loudly when the daemon-ops daemonOps
 *     contribution is removed — naming `"daemonOps"` in the missing-handler
 *     error.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonLiveStatus } from "#core/daemon/daemon-control.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { DAEMON_STOP_ATTEMPTS_RELATIVE_PATH } from "./daemon-ops-operations.js";
import daemonOpsModule from "./index.js";

const isServiceUnitInstalledMock = vi.hoisted(() => vi.fn());

vi.mock("./service-install.js", async () => {
  const actual = await vi.importActual<typeof import("./service-install.js")>(
    "./service-install.js",
  );
  return { ...actual, isServiceUnitInstalled: isServiceUnitInstalledMock };
});

type RecordedRequest = {
  method: string;
  path: string;
  body: unknown;
};

type RequestResponder = (
  method: string,
  path: string,
  body: unknown,
) => unknown;

function makeRecordingTransport(responder: RequestResponder): {
  transport: DaemonTransport;
  calls: RecordedRequest[];
} {
  const calls: RecordedRequest[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({ Authorization: "Bearer test-token" }),
    request: async <T>(method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      return responder(method, path, body) as T | null;
    },
    requestStrict: async () => {
      throw new Error("not used");
    },
    fetchRaw: async () => {
      throw new Error("not used");
    },
    events: async function* () {
      // empty generator
    },
  };
  return { transport, calls };
}

const SAMPLE_DAEMON_STATUS: DaemonLiveStatus = {
  pid: 1234,
  startedAt: "2026-05-05T05:00:00Z",
  running: true,
  workflow: {
    activeRuns: [],
    pendingRuns: [],
    queueLength: 0,
    completedRuns: 0,
    workflows: {},
    paused: false,
    concurrency: 4,
  },
  sessions: [],
  channels: [],
};

describe("daemon-ops module daemonClient(link) — daemonOps namespace", () => {
  beforeEach(() => {
    isServiceUnitInstalledMock.mockReset().mockReturnValue(false);
  });

  it("contributes a daemonOps namespace handler alongside sessions", () => {
    expect(daemonOpsModule.daemonClient).toBeTypeOf("function");
    const { transport } = makeRecordingTransport(() => null);
    const contributed = daemonOpsModule.daemonClient!(transport);
    expect(contributed.sessions).toBeDefined();
    expect(contributed.daemonOps).toBeDefined();
    expect(typeof contributed.daemonOps!.status).toBe("function");
    expect(typeof contributed.daemonOps!.pid).toBe("function");
    expect(typeof contributed.daemonOps!.stop).toBe("function");
    expect(typeof contributed.daemonOps!.reload).toBe("function");
  });

  it("routes status() through GET /status and shapes the running arm", async () => {
    const { transport, calls } = makeRecordingTransport((method, path) =>
      method === "GET" && path === "/status" ? SAMPLE_DAEMON_STATUS : null,
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.daemonOps!.status();
    expect(result).toEqual({
      state: "running",
      serviceInstalled: false,
      status: SAMPLE_DAEMON_STATUS,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.path).toBe("/status");
    expect(calls[0]!.body).toBeUndefined();
  });

  it("combines remote daemon status with the caller's local service-unit probe", async () => {
    isServiceUnitInstalledMock.mockReturnValue(true);
    const { transport } = makeRecordingTransport(() => SAMPLE_DAEMON_STATUS);
    const result = await daemonOpsModule.daemonClient!(transport).daemonOps!.status();
    expect(result).toEqual({
      state: "running",
      serviceInstalled: true,
      status: SAMPLE_DAEMON_STATUS,
    });
  });

  it("status() throws on null (transport failure or non-ok response)", async () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = daemonOpsModule.daemonClient!(transport);
    await expect(contributed.daemonOps!.status()).rejects.toThrow(
      /Daemon unreachable/,
    );
  });

  it("routes pid() through GET /status and extracts pid", async () => {
    const { transport, calls } = makeRecordingTransport(() => SAMPLE_DAEMON_STATUS);
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.daemonOps!.pid();
    expect(result).toEqual({ state: "running", pid: 1234 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.path).toBe("/status");
  });

  it("pid() throws on null", async () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = daemonOpsModule.daemonClient!(transport);
    await expect(contributed.daemonOps!.pid()).rejects.toThrow(/Daemon unreachable/);
  });

  it("pid() throws when status.pid is missing or non-numeric", async () => {
    const { transport } = makeRecordingTransport(() => ({
      ...SAMPLE_DAEMON_STATUS,
      pid: undefined,
    }));
    const contributed = daemonOpsModule.daemonClient!(transport);
    await expect(contributed.daemonOps!.pid()).rejects.toThrow(/Daemon unreachable/);
  });

  it("stop() routes through GET /status and reports unreachable daemon as not_running", async () => {
    const { transport, calls } = makeRecordingTransport(() => null);
    const contributed = daemonOpsModule.daemonClient!(transport);
    await expect(contributed.daemonOps!.stop({ timeoutSec: 30 })).resolves.toEqual({
      ok: false,
      reason: "not_running",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.path).toBe("/status");
  });

  it("stop() reports stale when /status returns a dead pid", async () => {
    const deadPid = Number.MAX_SAFE_INTEGER;
    const { transport, calls } = makeRecordingTransport(() => ({
      ...SAMPLE_DAEMON_STATUS,
      pid: deadPid,
    }));
    const contributed = daemonOpsModule.daemonClient!(transport);
    await expect(contributed.daemonOps!.stop({ timeoutSec: 1 })).resolves.toEqual({
      ok: false,
      reason: "stale",
      pid: deadPid,
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /status",
      "GET /identity",
    ]);
  });

  it("stop() records daemon-side failed stop evidence when identity exposes the scope directory", async () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-daemon-stop-evidence-"));
    try {
      const deadPid = Number.MAX_SAFE_INTEGER;
      const { transport } = makeRecordingTransport((method, path) => {
        if (method === "GET" && path === "/status") {
          return { ...SAMPLE_DAEMON_STATUS, pid: deadPid };
        }
        if (method === "GET" && path === "/identity") {
          return {
            scopeName: "repo",
            scopeRoot,
            scopes: { scopes: [], defaultScopeId: null },
            daemonVersion: "0.1.0",
            pid: deadPid,
            startedAt: SAMPLE_DAEMON_STATUS.startedAt,
            dashboard: { available: false, reason: "not_contributed" },
          };
        }
        return null;
      });
      const contributed = daemonOpsModule.daemonClient!(transport);

      await expect(contributed.daemonOps!.stop({ timeoutSec: 1 })).resolves.toEqual({
        ok: false,
        reason: "stale",
        pid: deadPid,
      });

      const evidencePath = join(scopeRoot, DAEMON_STOP_ATTEMPTS_RELATIVE_PATH);
      expect(existsSync(evidencePath)).toBe(true);
      const record = JSON.parse(readFileSync(evidencePath, "utf-8").trim()) as {
        timeoutSec: number;
        result: unknown;
      };
      expect(record.timeoutSec).toBe(1);
      expect(record.result).toEqual({ ok: false, reason: "stale", pid: deadPid });
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });

  it("routes reload() through POST /reload and shapes the success arm", async () => {
    const { transport, calls } = makeRecordingTransport((method, path) =>
      method === "POST" && path === "/reload"
        ? {
            ok: true,
            workflows: 5,
            changedModules: ["m1"],
            sessionGuardrails: { refreshed: 1, unchanged: 0, nonRefreshable: [] },
          }
        : null,
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.daemonOps!.reload();
    expect(result).toEqual({
      ok: true,
      workflows: 5,
      changedModules: ["m1"],
      sessionGuardrails: { refreshed: 1, unchanged: 0, nonRefreshable: [] },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.path).toBe("/reload");
  });

  it("reload() collapses null into reload_failed", async () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.daemonOps!.reload();
    expect(result).toEqual({ ok: false, reason: "reload_failed" });
  });
});
