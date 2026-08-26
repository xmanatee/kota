import { spawnSync } from "node:child_process";
import type { Command } from "commander";
import { line, plain, span, stack } from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import {
  DAEMON_SCOPE_ROOT_OPTION_DESCRIPTION,
  printDaemonError,
  resolveDaemonCommandScopeRoot,
  writeRawBlock,
} from "./daemon-cli-options.js";
import {
  buildLaunchdPlist,
  buildSystemdUnit,
  getLaunchdPlistPath,
  getSystemdServicePath,
  removeServiceFile,
  SERVICE_LABEL_LAUNCHD,
  SERVICE_NAME_SYSTEMD,
  writeServiceFile,
} from "./service-install.js";

const SERVICE_COMMAND_TIMEOUT_MS = 10_000;

function runServiceCommand(command: string, args: readonly string[]) {
  return spawnSync(command, args, {
    encoding: "utf8",
    timeout: SERVICE_COMMAND_TIMEOUT_MS,
  });
}

export function addDaemonServiceCommands(command: Command): void {
  command
    .command("install")
    .description("Register the KOTA daemon as a user-level OS service (launchd on macOS, systemd on Linux)")
    .option("--scope-root <path>", DAEMON_SCOPE_ROOT_OPTION_DESCRIPTION)
    .option("--dry-run", "Print the service unit without installing")
    .action((opts: { dryRun?: boolean; scopeRoot?: string }, child: Command) => {
      const scopeRoot = resolveDaemonCommandScopeRoot(opts, child);
      if (process.platform === "darwin") {
        installLaunchdService(scopeRoot, opts.dryRun === true);
      } else if (process.platform === "linux") {
        installSystemdService(scopeRoot, opts.dryRun === true);
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
        runServiceCommand("launchctl", ["unload", plistPath]);
        finishServiceRemoval(plistPath, removeServiceFile(plistPath));
      } else if (process.platform === "linux") {
        const servicePath = getSystemdServicePath();
        runServiceCommand("systemctl", ["--user", "disable", "--now", SERVICE_NAME_SYSTEMD]);
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

function installLaunchdService(scopeRoot: string, dryRun: boolean): void {
  const plistPath = getLaunchdPlistPath();
  const content = buildLaunchdPlist(scopeRoot);
  if (dryRun) {
    print(line(plain("# Would write: "), span(plistPath, "accent")));
    writeRawBlock(content);
    return;
  }
  const writeError = writeServiceFile(plistPath, content);
  if (writeError) {
    fail(String(writeError));
    return;
  }
  const result = runServiceCommand("launchctl", ["load", plistPath]);
  if (result.status !== 0) {
    fail(`launchctl load failed:\n${result.stderr || result.stdout}`);
    return;
  }
  print(stack(
    line(span("Daemon service installed and started.", "success")),
    line(plain("  plist: "), span(plistPath, "accent")),
    line(plain("  label: "), span(SERVICE_LABEL_LAUNCHD, "muted")),
    line(plain("To stop: "), span(`launchctl unload ${plistPath}`, "muted")),
  ));
}

function installSystemdService(scopeRoot: string, dryRun: boolean): void {
  const servicePath = getSystemdServicePath();
  const content = buildSystemdUnit(scopeRoot);
  if (dryRun) {
    print(line(plain("# Would write: "), span(servicePath, "accent")));
    writeRawBlock(content);
    return;
  }
  const writeError = writeServiceFile(servicePath, content);
  if (writeError) {
    fail(String(writeError));
    return;
  }
  const daemonReload = runServiceCommand("systemctl", ["--user", "daemon-reload"]);
  if (daemonReload.status !== 0) {
    fail(`systemctl daemon-reload failed:\n${daemonReload.stderr || daemonReload.stdout}`);
    return;
  }
  const enable = runServiceCommand(
    "systemctl",
    ["--user", "enable", "--now", SERVICE_NAME_SYSTEMD],
  );
  if (enable.status !== 0) {
    fail(`systemctl enable failed:\n${enable.stderr || enable.stdout}`);
    return;
  }
  print(stack(
    line(span("Daemon service installed and started.", "success")),
    line(plain("  service: "), span(servicePath, "accent")),
    line(plain("To stop: "), span(`systemctl --user stop ${SERVICE_NAME_SYSTEMD}`, "muted")),
  ));
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
