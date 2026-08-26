import { spawnSync } from "node:child_process";
import type { Command } from "commander";
import { line, plain, span, stack } from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import {
  DAEMON_PROJECT_DIR_OPTION_DESCRIPTION,
  printDaemonError,
  resolveDaemonCommandProjectDir,
  writeRawBlock,
} from "./daemon-cli-options.js";
import {
  isDaemonControlPlaneReady,
  waitForDaemonControlPlane,
} from "./daemon-readiness.js";
import {
  buildLaunchdPlist,
  buildSystemdUnit,
  ensureLaunchdLogDirectory,
  getLaunchdLogDirectory,
  getLaunchdPlistPath,
  getSystemdServicePath,
  removeServiceFile,
  SERVICE_LABEL_LAUNCHD,
  SERVICE_NAME_SYSTEMD,
  writeServiceFile,
} from "./service-install.js";

const SERVICE_COMMAND_TIMEOUT_MS = 10_000;
const LAUNCHCTL_PATH = "/bin/launchctl";

function runServiceCommand(command: string, args: readonly string[]) {
  return spawnSync(command, args, {
    encoding: "utf8",
    timeout: SERVICE_COMMAND_TIMEOUT_MS,
  });
}

function serviceCommandFailure(result: ReturnType<typeof runServiceCommand>): string {
  return result.error?.message || result.stderr.trim() || result.stdout.trim() ||
    `process exited with status ${String(result.status)}`;
}

function launchdDomain(): string {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("launchd service management requires a POSIX user id");
  return `gui/${uid}`;
}

function launchdServiceTarget(): string {
  return `${launchdDomain()}/${SERVICE_LABEL_LAUNCHD}`;
}

export function addDaemonServiceCommands(command: Command): void {
  command
    .command("install")
    .description("Register the KOTA daemon as a user-level OS service (launchd on macOS, systemd on Linux)")
    .option("--project-dir <path>", DAEMON_PROJECT_DIR_OPTION_DESCRIPTION)
    .option("--dry-run", "Print the service unit without installing")
    .action(async (opts: { dryRun?: boolean; projectDir?: string }, child: Command) => {
      const projectDir = resolveDaemonCommandProjectDir(opts, child);
      if (process.platform === "darwin") {
        await installLaunchdService(projectDir, opts.dryRun === true);
      } else if (process.platform === "linux") {
        await installSystemdService(projectDir, opts.dryRun === true);
      } else {
        printDaemonError(`Unsupported platform: ${process.platform}. Only macOS and Linux are supported.`);
        process.exitCode = 1;
      }
    });

  command
    .command("uninstall")
    .description("Remove the KOTA daemon OS service installed by 'daemon install'")
    .action(() => {
      if (process.platform === "darwin") {
        const plistPath = getLaunchdPlistPath();
        const result = runServiceCommand(LAUNCHCTL_PATH, ["bootout", launchdServiceTarget()]);
        if (result.status !== 0) {
          fail(`launchctl bootout failed; service file was preserved:\n${serviceCommandFailure(result)}`);
          return;
        }
        finishServiceRemoval(plistPath, removeServiceFile(plistPath));
      } else if (process.platform === "linux") {
        const servicePath = getSystemdServicePath();
        const disable = runServiceCommand(
          "systemctl",
          ["--user", "disable", "--now", SERVICE_NAME_SYSTEMD],
        );
        if (disable.status !== 0) {
          fail(`systemctl disable failed; service file was preserved:\n${serviceCommandFailure(disable)}`);
          return;
        }
        const removeError = removeServiceFile(servicePath);
        if (!removeError) {
          runServiceCommand("systemctl", ["--user", "daemon-reload"]);
        }
        finishServiceRemoval(servicePath, removeError);
      } else {
        printDaemonError(`Unsupported platform: ${process.platform}. Only macOS and Linux are supported.`);
        process.exitCode = 1;
      }
    });
}

async function installLaunchdService(projectDir: string, dryRun: boolean): Promise<void> {
  const plistPath = getLaunchdPlistPath();
  const content = buildLaunchdPlist(projectDir);
  if (dryRun) {
    print(line(plain("# Would write: "), span(plistPath, "accent")));
    writeRawBlock(content);
    return;
  }
  if (await isDaemonControlPlaneReady(projectDir)) {
    fail("A daemon is already running for this project. Stop it before installing the OS service.");
    return;
  }
  ensureLaunchdLogDirectory();
  const writeError = writeServiceFile(plistPath, content);
  if (writeError) {
    fail(String(writeError));
    return;
  }
  const result = runServiceCommand(LAUNCHCTL_PATH, ["bootstrap", launchdDomain(), plistPath]);
  if (result.status !== 0) {
    const removeError = removeServiceFile(plistPath);
    fail(
      `launchctl bootstrap failed:\n${serviceCommandFailure(result)}` +
      (removeError ? `\nRollback failed: ${removeError}` : ""),
    );
    return;
  }
  if (!await waitForDaemonControlPlane(projectDir)) {
    const rollback = runServiceCommand(LAUNCHCTL_PATH, ["bootout", launchdServiceTarget()]);
    if (rollback.status !== 0) {
      fail(
        "Daemon control plane did not become ready and launchd rollback failed; " +
        `service file was preserved. Logs: ${getLaunchdLogDirectory()}\n` +
        serviceCommandFailure(rollback),
      );
      return;
    }
    const removeError = removeServiceFile(plistPath);
    fail(
      `Daemon control plane did not become ready. Logs: ${getLaunchdLogDirectory()}` +
      (removeError ? `\nRollback failed: ${removeError}` : ""),
    );
    return;
  }
  print(stack(
    line(span("Daemon service installed and started.", "success")),
    line(plain("  plist: "), span(plistPath, "accent")),
    line(plain("  label: "), span(SERVICE_LABEL_LAUNCHD, "muted")),
    line(plain("To stop: "), span(`${LAUNCHCTL_PATH} bootout ${launchdServiceTarget()}`, "muted")),
  ));
}

async function installSystemdService(projectDir: string, dryRun: boolean): Promise<void> {
  const servicePath = getSystemdServicePath();
  const content = buildSystemdUnit(projectDir);
  if (dryRun) {
    print(line(plain("# Would write: "), span(servicePath, "accent")));
    writeRawBlock(content);
    return;
  }
  if (await isDaemonControlPlaneReady(projectDir)) {
    fail("A daemon is already running for this project. Stop it before installing the OS service.");
    return;
  }
  const writeError = writeServiceFile(servicePath, content);
  if (writeError) {
    fail(String(writeError));
    return;
  }
  const daemonReload = runServiceCommand("systemctl", ["--user", "daemon-reload"]);
  if (daemonReload.status !== 0) {
    const removeError = removeServiceFile(servicePath);
    fail(
      `systemctl daemon-reload failed:\n${serviceCommandFailure(daemonReload)}` +
      (removeError ? `\nRollback failed: ${removeError}` : ""),
    );
    return;
  }
  const enable = runServiceCommand(
    "systemctl",
    ["--user", "enable", "--now", SERVICE_NAME_SYSTEMD],
  );
  if (enable.status !== 0) {
    const rollbackError = rollbackSystemdInstall(servicePath);
    fail(
      `systemctl enable failed:\n${serviceCommandFailure(enable)}` +
      (rollbackError ? `\nRollback failed: ${rollbackError}` : ""),
    );
    return;
  }
  if (!await waitForDaemonControlPlane(projectDir)) {
    const rollbackError = rollbackSystemdInstall(servicePath);
    fail(
      "Daemon control plane did not become ready." +
      (rollbackError ? ` Rollback failed: ${rollbackError}` : ""),
    );
    return;
  }
  print(stack(
    line(span("Daemon service installed and started.", "success")),
    line(plain("  service: "), span(servicePath, "accent")),
    line(plain("To stop: "), span(`systemctl --user stop ${SERVICE_NAME_SYSTEMD}`, "muted")),
  ));
}

function rollbackSystemdInstall(servicePath: string): string | null {
  const disable = runServiceCommand(
    "systemctl",
    ["--user", "disable", "--now", SERVICE_NAME_SYSTEMD],
  );
  if (disable.status !== 0) return serviceCommandFailure(disable);
  const removeError = removeServiceFile(servicePath);
  if (removeError) return removeError;
  const reload = runServiceCommand("systemctl", ["--user", "daemon-reload"]);
  return reload.status === 0 ? null : serviceCommandFailure(reload);
}

function finishServiceRemoval(path: string, error: string | null): void {
  if (error) {
    fail(String(error));
    return;
  }
  print(stack(
    line(span("Daemon service removed.", "success")),
    line(plain("  removed: "), span(path, "accent")),
  ));
}

function fail(message: string): void {
  printDaemonError(message);
  process.exitCode = 1;
}
