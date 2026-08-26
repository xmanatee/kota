import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDaemonServiceCommands } from "./daemon-service-commands.js";

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, spawnSync: spawnSyncMock };
});

vi.mock("./service-install.js", () => ({
  buildLaunchdPlist: () => "plist",
  buildSystemdUnit: () => "unit",
  getLaunchdPlistPath: () => "/tmp/com.kota.daemon.plist",
  getSystemdServicePath: () => "/tmp/kota-daemon.service",
  removeServiceFile: () => null,
  SERVICE_LABEL_LAUNCHD: "com.kota.daemon",
  SERVICE_NAME_SYSTEMD: "kota-daemon.service",
  writeServiceFile: () => null,
}));

function daemonCommand(): Command {
  const command = new Command("daemon");
  command.exitOverride();
  addDaemonServiceCommands(command);
  return command;
}

beforeEach(() => {
  spawnSyncMock.mockReset().mockReturnValue({
    status: 0,
    stdout: "",
    stderr: "",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("daemon service subprocesses", () => {
  it("bounds every launchctl and systemctl command", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    await daemonCommand().parseAsync(["install"], { from: "user" });
    await daemonCommand().parseAsync(["uninstall"], { from: "user" });

    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    await daemonCommand().parseAsync(["install"], { from: "user" });
    await daemonCommand().parseAsync(["uninstall"], { from: "user" });

    expect(spawnSyncMock).toHaveBeenCalledTimes(6);
    for (const call of spawnSyncMock.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ timeout: 10_000 }));
    }
  });
});
