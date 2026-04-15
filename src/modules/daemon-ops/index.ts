import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { Daemon, RESTART_EXIT_CODE } from "#core/daemon/daemon.js";
import type { DaemonControlAddress } from "#core/daemon/daemon-control.js";
import type { KotaModule } from "#core/modules/module-types.js";
import { DaemonControlClient } from "#core/server/daemon-client.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { LogFormat } from "#core/util/log-format.js";
import { isProcessAlive } from "#core/util/process-alive.js";
import { DaemonDashboard } from "./dashboard.js";
import { buildEventsCommand } from "./events-cli.js";
import { buildQrCommand } from "./qr-cli.js";
import { buildSessionCommand } from "./session-cli.js";
import { buildStatusCommand } from "./status-cli.js";

const DAEMON_CHILD_ENV = "KOTA_DAEMON_CHILD";
const LAUNCHD_LABEL = "com.kota.daemon";
const SYSTEMD_SERVICE = "kota-daemon.service";

function parseIntOption(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`Error: --${name} must be a positive integer, got "${value}"`);
    process.exit(1);
  }
  return parsed;
}

async function runDaemonSupervisor(): Promise<void> {
  const childArgs = process.argv.slice(1);
  let forwardSignal: ((signal: NodeJS.Signals) => void) | null = null;

  try {
    while (true) {
      const exitCode = await new Promise<number>((resolve, reject) => {
        const child = spawn(process.execPath, [...process.execArgv, ...childArgs], {
          stdio: "inherit",
          env: {
            ...process.env,
            [DAEMON_CHILD_ENV]: "1",
          },
        });

        forwardSignal = (signal) => {
          child.kill(signal);
        };
        process.on("SIGINT", forwardSignal);
        process.on("SIGTERM", forwardSignal);

        const clearForwarder = () => {
          if (!forwardSignal) return;
          process.removeListener("SIGINT", forwardSignal);
          process.removeListener("SIGTERM", forwardSignal);
          forwardSignal = null;
        };

        child.once("error", (error) => {
          clearForwarder();
          reject(error);
        });
        child.once("exit", (code) => {
          clearForwarder();
          resolve(code ?? 1);
        });
      });

      if (exitCode !== RESTART_EXIT_CODE) {
        process.exitCode = exitCode;
        return;
      }
    }
  } finally {
    if (forwardSignal) {
      process.removeListener("SIGINT", forwardSignal);
      process.removeListener("SIGTERM", forwardSignal);
    }
  }
}

/** Returns the path to the launchd plist file for macOS. */
export function getLaunchdPlistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

/** Returns the path to the systemd user service file for Linux. */
export function getSystemdServicePath(): string {
  return join(homedir(), ".config", "systemd", "user", SYSTEMD_SERVICE);
}

/** Returns true if a service unit file exists for the current OS. */
export function isServiceInstalled(): boolean {
  if (process.platform === "darwin") {
    return existsSync(getLaunchdPlistPath());
  }
  if (process.platform === "linux") {
    return existsSync(getSystemdServicePath());
  }
  return false;
}

/** Generates the macOS launchd plist content. */
export function buildLaunchdPlist(projectDir: string): string {
  const kotaBin = process.argv[1]!;
  const logDir = join(projectDir, ".kota");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `  <key>Label</key>`,
    `  <string>${LAUNCHD_LABEL}</string>`,
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    `    <string>${process.execPath}</string>`,
    ...(process.execArgv.map((arg) => `    <string>${arg}</string>`)),
    `    <string>${kotaBin}</string>`,
    `    <string>daemon</string>`,
    `  </array>`,
    `  <key>EnvironmentVariables</key>`,
    `  <dict>`,
    `    <key>KOTA_PROJECT_DIR</key>`,
    `    <string>${projectDir}</string>`,
    `  </dict>`,
    `  <key>WorkingDirectory</key>`,
    `  <string>${projectDir}</string>`,
    `  <key>RunAtLoad</key>`,
    `  <true/>`,
    `  <key>KeepAlive</key>`,
    `  <true/>`,
    `  <key>StandardOutPath</key>`,
    `  <string>${logDir}/daemon.log</string>`,
    `  <key>StandardErrorPath</key>`,
    `  <string>${logDir}/daemon.err</string>`,
    `</dict>`,
    `</plist>`,
  ].join("\n");
}

/** Generates the Linux systemd user service unit content. */
export function buildSystemdUnit(projectDir: string): string {
  const kotaBin = process.argv[1]!;
  const execArgs = [...process.execArgv, kotaBin, "daemon"].join(" ");
  return [
    `[Unit]`,
    `Description=KOTA Daemon`,
    `After=default.target`,
    ``,
    `[Service]`,
    `Type=simple`,
    `ExecStart=${process.execPath} ${execArgs}`,
    `WorkingDirectory=${projectDir}`,
    `Environment=KOTA_PROJECT_DIR=${projectDir}`,
    `Restart=on-failure`,
    `StandardOutput=journal`,
    `StandardError=journal`,
    ``,
    `[Install]`,
    `WantedBy=default.target`,
  ].join("\n");
}

/**
 * Writes a service file to the given path, creating parent dirs as needed.
 * Returns an error message if the file already exists, null on success.
 */
export function writeServiceFile(path: string, content: string): string | null {
  if (existsSync(path)) {
    return `KOTA daemon service is already installed at ${path}. Run 'kota daemon uninstall' first.`;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return null;
}

/**
 * Removes a service file at the given path.
 * Returns an error message if the file does not exist, null on success.
 */
export function removeServiceFile(path: string): string | null {
  if (!existsSync(path)) {
    return "No KOTA daemon service found. Run 'kota daemon install' first.";
  }
  rmSync(path);
  return null;
}

const daemonModule: KotaModule = {
  name: "daemon-ops",
  version: "1.0.0",
  description: "Operator CLI and supervisor surface for the KOTA daemon runtime",

  commands: (ctx) => {
    const cmd = new Command("daemon")
      .description("Run KOTA as a long-running daemon with autonomous workflows")
      .option("-v, --verbose", "Show debug output")
      .option("--poll-interval <seconds>", "Scheduler poll interval in seconds", "30")
      .option("--log-format <format>", "Log format: text (default) or json", (v) => {
        if (v !== "text" && v !== "json") {
          console.error(`Error: --log-format must be "text" or "json", got "${v}"`);
          process.exit(1);
        }
        return v as LogFormat;
      })
      .action(async (opts) => {
        const logFormat: LogFormat | undefined =
          opts.logFormat ??
          (process.env.KOTA_DAEMON_LOG_FORMAT === "json" ? "json" : undefined);

        if (process.env[DAEMON_CHILD_ENV] !== "1") {
          await runDaemonSupervisor();
          return;
        }

        const useDashboard =
          process.stdout.isTTY === true &&
          !logFormat;

        const daemon = new Daemon({
          verbose: opts.verbose || ctx.config.verbose,
          config: ctx.config,
          idleIntervalMs: 30_000,
          pollIntervalMs: parseIntOption(opts.pollInterval, "poll-interval") * 1000,
          workflows: ctx.getContributedWorkflows(),
          channels: ctx.getContributedChannels(),
          logFormat,
          resolveAgentDef: (name) => ctx.resolveAgentDef(name),
          resolveSkillsPrompt: (names, agentName) => ctx.resolveSkillsPrompt(names, agentName),
          probeModuleHealthChecks: () => ctx.probeHealthChecks(),
          moduleConfigKeys: ctx.getRegisteredConfigKeys(),
        });

        if (useDashboard) {
          const dashboard = new DaemonDashboard(() => daemon.getDashboardSnapshot());
          dashboard.start();
          try {
            await daemon.start();
          } finally {
            dashboard.stop();
          }
        } else {
          await daemon.start();
        }
      });

    cmd
      .command("status")
      .description("Show daemon health summary (exits 0 if reachable)")
      .option("--json", "Output as JSON")
      .action(async (opts: { json?: boolean }) => {
        const managed = isServiceInstalled();
        const client = DaemonControlClient.fromStateDir();
        if (!client) {
          if (opts.json) {
            console.log(JSON.stringify({ running: false, managed }));
          } else {
            console.error("Daemon is not running.");
            if (managed) console.log("managed:  yes (OS service installed)");
          }
          process.exitCode = 1;
          return;
        }
        const status = await client.getDaemonStatus();
        if (!status) {
          const address = readOptionalJsonFile<DaemonControlAddress>(
            join(process.cwd(), ".kota", "daemon-control.json"),
          );
          const stale = address && typeof address.pid === "number" && !isProcessAlive(address.pid);
          if (opts.json) {
            console.log(JSON.stringify({ running: false, managed, staleControlFile: !!stale }));
          } else {
            if (stale) {
              console.error(`Stale control file (pid ${address!.pid} is not alive). Run 'kota doctor --fix' to clean up.`);
            } else {
              console.error("Daemon is not reachable.");
            }
            if (managed) console.log("managed:  yes (OS service installed)");
          }
          process.exitCode = 1;
          return;
        }
        if (opts.json) {
          console.log(JSON.stringify({ ...status, managed }));
          return;
        }
        const wf = status.workflow;
        const uptimeSec = status.startedAt
          ? Math.floor((Date.now() - new Date(status.startedAt).getTime()) / 1000)
          : null;
        const uptime = uptimeSec !== null ? `${uptimeSec}s` : "unknown";
        console.log(`running:  yes`);
        console.log(`pid:      ${status.pid}`);
        console.log(`uptime:   ${uptime}`);
        console.log(`started:  ${status.startedAt}`);
        console.log(`active:   ${wf.activeRuns.length} run(s)`);
        console.log(`pending:  ${wf.pendingRuns.length} run(s)`);
        console.log(`sessions: ${status.sessions.length}`);
        console.log(`paused:   ${wf.paused}`);
        console.log(`managed:  ${managed ? "yes (OS service installed)" : "no"}`);
      });

    cmd
      .command("pid")
      .description("Print the PID of the running daemon (exits non-zero if not running)")
      .action(() => {
        const address = readOptionalJsonFile<DaemonControlAddress>(
          join(process.cwd(), ".kota", "daemon-control.json"),
        );
        if (!address || typeof address.pid !== "number") {
          console.error("Daemon is not running.");
          process.exitCode = 1;
          return;
        }
        if (!isProcessAlive(address.pid)) {
          console.error(`Stale control file (pid ${address.pid} is not alive). Run 'kota doctor --fix' to clean up.`);
          process.exitCode = 1;
          return;
        }
        console.log(String(address.pid));
      });

    cmd
      .command("stop")
      .description("Gracefully stop the running daemon (exits 0 on success)")
      .option("--timeout <seconds>", "Seconds to wait for clean exit", "10")
      .action(async (opts: { timeout: string }) => {
        const address = readOptionalJsonFile<DaemonControlAddress>(
          join(process.cwd(), ".kota", "daemon-control.json"),
        );
        if (!address || typeof address.pid !== "number") {
          console.error("Daemon is not running.");
          process.exitCode = 1;
          return;
        }
        const pid = address.pid;
        try {
          process.kill(pid, 0);
        } catch {
          console.error("Daemon process is not running (stale control file).");
          process.exitCode = 1;
          return;
        }
        process.kill(pid, "SIGTERM");
        const timeoutSec = Math.max(1, Number.parseInt(opts.timeout, 10) || 10);
        const deadline = Date.now() + timeoutSec * 1000;
        while (Date.now() < deadline) {
          await new Promise<void>((r) => setTimeout(r, 500));
          try {
            process.kill(pid, 0);
          } catch {
            console.log("Daemon stopped.");
            return;
          }
        }
        console.error(`Daemon did not stop within ${timeoutSec}s.`);
        process.exitCode = 1;
      });

    cmd
      .command("reload")
      .description("Reload daemon config and re-register module workflow contributions without restart")
      .action(async () => {
        const client = DaemonControlClient.fromStateDir();
        if (!client) {
          console.error("Daemon is not running.");
          process.exitCode = 1;
          return;
        }
        const result = await client.reloadConfig();
        if (!result) {
          console.error("Daemon reload failed or daemon is not reachable.");
          process.exitCode = 1;
          return;
        }
        console.log(`Reloaded. ${result.workflows} workflow definition(s) active.`);
        if (result.changedModules.length === 0) {
          console.log("  No module config changes detected.");
        } else {
          console.log(`  Reloaded module(s): ${result.changedModules.join(", ")}`);
        }
      });

    cmd
      .command("install")
      .description("Register the KOTA daemon as a user-level OS service (launchd on macOS, systemd on Linux)")
      .option("--dry-run", "Print the service unit without installing")
      .action((opts: { dryRun?: boolean }) => {
        const projectDir = process.cwd();

        if (process.platform === "darwin") {
          const plistPath = getLaunchdPlistPath();
          const content = buildLaunchdPlist(projectDir);
          if (opts.dryRun) {
            console.log(`# Would write: ${plistPath}`);
            console.log(content);
            return;
          }
          const writeErr = writeServiceFile(plistPath, content);
          if (writeErr) {
            console.error(writeErr);
            process.exitCode = 1;
            return;
          }
          const result = spawnSync("launchctl", ["load", plistPath], { encoding: "utf8" });
          if (result.status !== 0) {
            console.error(`launchctl load failed:\n${result.stderr || result.stdout}`);
            process.exitCode = 1;
            return;
          }
          console.log(`Daemon service installed and started.`);
          console.log(`  plist: ${plistPath}`);
          console.log(`  label: ${LAUNCHD_LABEL}`);
          console.log(`To stop: launchctl unload ${plistPath}`);
        } else if (process.platform === "linux") {
          const servicePath = getSystemdServicePath();
          const content = buildSystemdUnit(projectDir);
          if (opts.dryRun) {
            console.log(`# Would write: ${servicePath}`);
            console.log(content);
            return;
          }
          const writeErr = writeServiceFile(servicePath, content);
          if (writeErr) {
            console.error(writeErr);
            process.exitCode = 1;
            return;
          }
          const daemon = spawnSync("systemctl", ["--user", "daemon-reload"], { encoding: "utf8" });
          if (daemon.status !== 0) {
            console.error(`systemctl daemon-reload failed:\n${daemon.stderr || daemon.stdout}`);
            process.exitCode = 1;
            return;
          }
          const enable = spawnSync("systemctl", ["--user", "enable", "--now", SYSTEMD_SERVICE], { encoding: "utf8" });
          if (enable.status !== 0) {
            console.error(`systemctl enable failed:\n${enable.stderr || enable.stdout}`);
            process.exitCode = 1;
            return;
          }
          console.log(`Daemon service installed and started.`);
          console.log(`  service: ${servicePath}`);
          console.log(`To stop: systemctl --user stop ${SYSTEMD_SERVICE}`);
        } else {
          console.error(`Unsupported platform: ${process.platform}. Only macOS and Linux are supported.`);
          process.exitCode = 1;
        }
      });

    cmd
      .command("uninstall")
      .description("Remove the KOTA daemon OS service installed by 'daemon install'")
      .action(() => {
        if (process.platform === "darwin") {
          const plistPath = getLaunchdPlistPath();
          spawnSync("launchctl", ["unload", plistPath], { encoding: "utf8" });
          const removeErr = removeServiceFile(plistPath);
          if (removeErr) {
            console.error(removeErr);
            process.exitCode = 1;
            return;
          }
          console.log(`Daemon service removed.`);
          console.log(`  removed: ${plistPath}`);
        } else if (process.platform === "linux") {
          const servicePath = getSystemdServicePath();
          spawnSync("systemctl", ["--user", "disable", "--now", SYSTEMD_SERVICE], { encoding: "utf8" });
          const removeErr = removeServiceFile(servicePath);
          if (removeErr) {
            console.error(removeErr);
            process.exitCode = 1;
            return;
          }
          spawnSync("systemctl", ["--user", "daemon-reload"], { encoding: "utf8" });
          console.log(`Daemon service removed.`);
          console.log(`  removed: ${servicePath}`);
        } else {
          console.error(`Unsupported platform: ${process.platform}. Only macOS and Linux are supported.`);
          process.exitCode = 1;
        }
      });

    cmd.addCommand(buildQrCommand());
    return [cmd, buildEventsCommand(), buildSessionCommand(), buildStatusCommand()];
  },
};

export default daemonModule;
