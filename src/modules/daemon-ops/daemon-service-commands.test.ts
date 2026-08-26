import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDaemonServiceCommands } from "./daemon-service-commands.js";

const spawnSyncMock = vi.hoisted(() => vi.fn());
const ensureLaunchdLogDirectoryMock = vi.hoisted(() => vi.fn());
const removeServiceFileMock = vi.hoisted(() => vi.fn());
const writeServiceFileMock = vi.hoisted(() => vi.fn());
const isDaemonControlPlaneReadyMock = vi.hoisted(() => vi.fn());
const waitForDaemonControlPlaneMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, spawnSync: spawnSyncMock };
});

vi.mock("./service-install.js", () => ({
  buildLaunchdPlist: () => "plist",
  buildSystemdUnit: () => "unit",
  ensureLaunchdLogDirectory: ensureLaunchdLogDirectoryMock,
  getLaunchdLogDirectory: () => "/tmp/logs/com.kota.daemon",
  getLaunchdPlistPath: () => "/tmp/com.kota.daemon.plist",
  getSystemdServicePath: () => "/tmp/kota-daemon.service",
  removeServiceFile: removeServiceFileMock,
  SERVICE_LABEL_LAUNCHD: "com.kota.daemon",
  SERVICE_NAME_SYSTEMD: "kota-daemon.service",
  writeServiceFile: writeServiceFileMock,
}));

vi.mock("./daemon-readiness.js", () => ({
  isDaemonControlPlaneReady: isDaemonControlPlaneReadyMock,
  waitForDaemonControlPlane: waitForDaemonControlPlaneMock,
}));

function daemonCommand(): Command {
  const command = new Command("daemon");
  command.exitOverride();
  addDaemonServiceCommands(command);
  return command;
}

beforeEach(() => {
  process.exitCode = undefined;
  spawnSyncMock.mockReset().mockReturnValue({
    status: 0,
    stdout: "",
    stderr: "",
  });
  ensureLaunchdLogDirectoryMock.mockReset();
  removeServiceFileMock.mockReset().mockReturnValue(null);
  writeServiceFileMock.mockReset().mockReturnValue(null);
  isDaemonControlPlaneReadyMock.mockReset().mockResolvedValue(false);
  waitForDaemonControlPlaneMock.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("daemon service subprocesses", () => {
  it("bootstraps launchd through the GUI domain and waits for daemon readiness", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    vi.spyOn(process, "getuid").mockReturnValue(501);
    await daemonCommand().parseAsync(["install"], { from: "user" });

    expect(ensureLaunchdLogDirectoryMock).toHaveBeenCalledOnce();
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "/bin/launchctl",
      ["bootstrap", "gui/501", "/tmp/com.kota.daemon.plist"],
      expect.objectContaining({ timeout: 10_000 }),
    );
    expect(waitForDaemonControlPlaneMock).toHaveBeenCalledWith(process.cwd());
    expect(process.exitCode).toBeUndefined();
  });

  it("rolls back launchd registration and service file when readiness fails", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    vi.spyOn(process, "getuid").mockReturnValue(501);
    waitForDaemonControlPlaneMock.mockResolvedValue(false);

    await daemonCommand().parseAsync(["install"], { from: "user" });

    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      2,
      "/bin/launchctl",
      ["bootout", "gui/501/com.kota.daemon"],
      expect.objectContaining({ timeout: 10_000 }),
    );
    expect(removeServiceFileMock).toHaveBeenCalledWith("/tmp/com.kota.daemon.plist");
    expect(process.exitCode).toBe(1);
  });

  it("removes the new service file when launchd rejects bootstrap", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    vi.spyOn(process, "getuid").mockReturnValue(501);
    spawnSyncMock.mockReturnValue({ status: 5, stdout: "", stderr: "bootstrap failed" });

    await daemonCommand().parseAsync(["install"], { from: "user" });

    expect(removeServiceFileMock).toHaveBeenCalledWith("/tmp/com.kota.daemon.plist");
    expect(waitForDaemonControlPlaneMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("preserves the launchd service file when bootout fails during uninstall", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    vi.spyOn(process, "getuid").mockReturnValue(501);
    spawnSyncMock.mockReturnValue({ status: 1, stdout: "", stderr: "bootout failed" });

    await daemonCommand().parseAsync(["uninstall"], { from: "user" });

    expect(spawnSyncMock).toHaveBeenCalledWith(
      "/bin/launchctl",
      ["bootout", "gui/501/com.kota.daemon"],
      expect.objectContaining({ timeout: 10_000 }),
    );
    expect(removeServiceFileMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("preserves the systemd service file when disable fails during uninstall", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    spawnSyncMock.mockReturnValue({ status: 1, stdout: "", stderr: "disable failed" });

    await daemonCommand().parseAsync(["uninstall"], { from: "user" });

    expect(removeServiceFileMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("refuses installation while another daemon control plane is already ready", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    isDaemonControlPlaneReadyMock.mockResolvedValue(true);

    await daemonCommand().parseAsync(["install"], { from: "user" });

    expect(writeServiceFileMock).not.toHaveBeenCalled();
    expect(spawnSyncMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("rolls back a systemd install whose daemon never becomes ready", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    waitForDaemonControlPlaneMock.mockResolvedValue(false);

    await daemonCommand().parseAsync(["install"], { from: "user" });

    expect(spawnSyncMock.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      ["systemctl", ["--user", "daemon-reload"]],
      ["systemctl", ["--user", "enable", "--now", "kota-daemon.service"]],
      ["systemctl", ["--user", "disable", "--now", "kota-daemon.service"]],
      ["systemctl", ["--user", "daemon-reload"]],
    ]);
    expect(removeServiceFileMock).toHaveBeenCalledWith("/tmp/kota-daemon.service");
    expect(process.exitCode).toBe(1);
  });

  it("bounds every service supervisor command", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    await daemonCommand().parseAsync(["install"], { from: "user" });
    await daemonCommand().parseAsync(["uninstall"], { from: "user" });
    for (const call of spawnSyncMock.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ timeout: 10_000 }));
    }
  });
});
