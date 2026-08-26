import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectStrandedDaemonProcess,
  isKotaDaemonCommand,
} from "./stranded-daemon.js";

describe("stranded daemon detection", () => {
  let scopeRoot: string;

  beforeEach(() => {
    scopeRoot = join(
      tmpdir(),
      `kota-stranded-daemon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("recognizes built and source daemon command lines", () => {
    expect(isKotaDaemonCommand("node dist/cli.js daemon")).toBe(true);
    expect(isKotaDaemonCommand("/usr/local/bin/node /repo/dist/cli.js daemon --scope-root /repo")).toBe(true);
    expect(isKotaDaemonCommand("tsx src/cli.ts daemon --log-format json")).toBe(true);
    expect(isKotaDaemonCommand("node dist/cli.js status")).toBe(false);
  });

  it("reports an alive daemon-state pid with no control file as stranded", () => {
    writeFileSync(
      join(scopeRoot, ".kota", "daemon-state.json"),
      JSON.stringify({
        pid: 4242,
        startedAt: "2026-06-05T00:51:24.000Z",
      }),
    );

    expect(
      detectStrandedDaemonProcess(scopeRoot, {
        processIsAlive: (pid) => pid === 4242,
        readProcessCommand: (pid) =>
          pid === 4242 ? "/opt/node /repo/dist/cli.js daemon" : null,
      }),
    ).toEqual({
      kind: "stranded",
      pid: 4242,
      command: "/opt/node /repo/dist/cli.js daemon",
    });
  });

  it("does not report a process as stranded while the control file exists", () => {
    writeFileSync(
      join(scopeRoot, ".kota", "daemon-state.json"),
      JSON.stringify({ pid: 4242 }),
    );
    writeFileSync(
      join(scopeRoot, ".kota", "daemon-control.json"),
      JSON.stringify({
        port: 8765,
        pid: 4242,
        startedAt: "2026-06-05T00:51:24.000Z",
        token: "token",
      }),
    );

    expect(
      detectStrandedDaemonProcess(scopeRoot, {
        processIsAlive: () => true,
        readProcessCommand: () => "node dist/cli.js daemon",
      }),
    ).toEqual({ kind: "none" });
  });
});
