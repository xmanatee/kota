import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { outboundHttp } from "#core/outbound-http/index.js";
import { isDaemonControlAddressReachable, readLiveDaemonControlAddress } from "./daemon-control-address.js";

describe("readLiveDaemonControlAddress", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = join(tmpdir(), `kota-daemon-control-address-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("returns the daemon address when the published pid is alive", () => {
    writeFileSync(
      join(stateDir, "daemon-control.json"),
      JSON.stringify({
        port: 12345,
        pid: process.pid,
        startedAt: "2026-05-22T17:00:00.000Z",
        token: "token",
      }),
    );

    expect(readLiveDaemonControlAddress(stateDir)).toMatchObject({
      port: 12345,
      pid: process.pid,
      token: "token",
    });
  });

  it("returns null for a stale daemon-control file with a dead pid", () => {
    writeFileSync(
      join(stateDir, "daemon-control.json"),
      JSON.stringify({
        port: 12345,
        pid: 999999,
        startedAt: "2026-05-22T17:00:00.000Z",
        token: "token",
      }),
    );

    expect(readLiveDaemonControlAddress(stateDir)).toBeNull();
  });

  it("reports an alive pid with an unreachable port as not reachable", async () => {
    await expect(
      isDaemonControlAddressReachable(
        {
          port: 9,
          pid: process.pid,
          startedAt: "2026-05-22T17:00:00.000Z",
          token: "token",
        },
        50,
      ),
    ).resolves.toBe(false);
  });

  it("uses the daemon-loopback transport policy for health probes", async () => {
    const request = vi.spyOn(outboundHttp, "request").mockResolvedValue({
      profile: "daemon-loopback",
      operation: "daemon-control.health-probe",
      method: "GET",
      url: "http://127.0.0.1:31337/health",
      redirected: false,
      response: new Response(null, { status: 204 }),
      byteLength: 0,
      retry: {
        eligible: false,
        reason: "response-not-transient",
      },
    });

    await expect(
      isDaemonControlAddressReachable(
        {
          port: 31_337,
          pid: process.pid,
          startedAt: "2026-05-22T17:00:00.000Z",
          token: "token",
        },
        75,
      ),
    ).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith({
      profile: { name: "daemon-loopback" },
      operation: "daemon-control.health-probe",
      url: "http://127.0.0.1:31337/health",
      limits: {
        timeoutMs: 75,
        responseBytes: 65_536,
      },
    });
  });
});
