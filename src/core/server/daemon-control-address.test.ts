import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isDaemonControlAddressReachable,
  readLiveDaemonControlAddress,
} from "./daemon-control-address.js";

describe("readLiveDaemonControlAddress", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = join(
      tmpdir(),
      `kota-daemon-control-address-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
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
});
