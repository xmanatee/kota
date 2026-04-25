import { spawn, spawnSync } from "node:child_process";
import { Command } from "commander";
import { resolveProjectDir } from "#core/config/project-dir.js";
import { Daemon, RESTART_EXIT_CODE } from "#core/daemon/daemon.js";
import type { DaemonLiveStatus } from "#core/daemon/daemon-control.js";
import type { KotaModule } from "#core/modules/module-types.js";
import type { DaemonOpsClient } from "#core/server/kota-client.js";
import type { LogFormat } from "#core/util/log-format.js";
import {
  blank,
  heading,
  type KVEntry,
  kvBlock,
  list,
  type RenderNode,
  stack,
} from "#modules/rendering/primitives.js";
import { renderToString } from "#modules/rendering/transport.js";
import { getRepoTaskQueueSnapshot } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  localDaemonPid,
  localDaemonReload,
  localDaemonStatus,
  localDaemonStop,
} from "./daemon-ops-operations.js";
import { DaemonDashboard } from "./dashboard.js";
import { buildEventsCommand } from "./events-cli.js";
import { abbreviateRunId, formatDuration, formatTimeAgo, formatUptime } from "./format-utils.js";
import { buildQrCommand } from "./qr-cli.js";
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
import { buildSessionCommand } from "./session-cli.js";
import { sessionsLocalClient } from "./sessions-local.js";
import { buildStatusCommand } from "./status-cli.js";

export {
  buildLaunchdPlist,
  buildSystemdUnit,
  getLaunchdPlistPath,
  getSystemdServicePath,
  isServiceInstalled,
  removeServiceFile,
  writeServiceFile,
} from "./service-install.js";

const DAEMON_CHILD_ENV = "KOTA_DAEMON_CHILD";

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

export function buildDaemonStatusNode(
  status: DaemonLiveStatus,
  managed: boolean,
): RenderNode {
  const uptime = status.startedAt ? formatUptime(status.startedAt) : "unknown";
  const started = status.startedAt ? formatTimeAgo(status.startedAt) : "unknown";
  const wf = status.workflow;

  const headerEntries: KVEntry[] = [
    {
      label: "Status",
      value: `running  (pid ${status.pid}, up ${uptime}, started ${started})`,
      role: "success",
    },
    { label: "Active", value: `${wf.activeRuns.length} run(s), ${wf.pendingRuns.length} pending` },
    { label: "Sessions", value: `${status.sessions.length} interactive` },
    { label: "Paused", value: wf.paused ? "yes" : "no", role: wf.paused ? "warn" : "muted" },
    {
      label: "Managed",
      value: managed ? "yes (OS service installed)" : "no",
      role: managed ? "info" : "muted",
    },
  ];

  if (wf.totalCostUsd != null && wf.totalCostUsd > 0) {
    headerEntries.push({ label: "Cost", value: `$${wf.totalCostUsd.toFixed(2)} total` });
  }

  const children: RenderNode[] = [kvBlock(headerEntries)];

  if (wf.activeRuns.length > 0) {
    children.push(blank());
    children.push(heading("Active runs:", 2));
    children.push(
      list(
        wf.activeRuns.map((run) => ({
          spans: [
            { text: run.workflow.padEnd(20) },
            { text: ` ${formatDuration(run.startedAt).padEnd(10)} `, role: "muted" },
            { text: abbreviateRunId(run.runId), role: "muted" },
          ],
        })),
      ),
    );
  }

  if (wf.pendingRuns.length > 0) {
    children.push(blank());
    const shown = wf.pendingRuns.slice(0, 5);
    const suffix = wf.pendingRuns.length > 5 ? ` (+${wf.pendingRuns.length - 5} more)` : "";
    children.push(heading(`Pending runs:${suffix}`, 2));
    children.push(
      list(
        shown.map((run) => ({
          spans: [
            { text: run.workflowName.padEnd(20) },
            { text: ` ${run.runId ? abbreviateRunId(run.runId) : "-"}`, role: "muted" },
          ],
        })),
      ),
    );
  }

  return stack(...children);
}

export function formatDaemonStatus(status: DaemonLiveStatus, managed: boolean): string {
  return renderToString(buildDaemonStatusNode(status, managed));
}

const daemonModule: KotaModule = {
  name: "daemon-ops",
  version: "1.0.0",
  description: "Operator CLI and supervisor surface for the KOTA daemon runtime",
  dependencies: ["repo-tasks", "rendering"],

  commands: (ctx) => {
    const cmd = new Command("daemon")
      .description("Run KOTA as a long-running daemon with autonomous workflows")
      .option("-v, --verbose", "Show debug output")
      .option("--poll-interval <seconds>", "Scheduler poll interval in seconds", "30")
      .option(
        "--project-dir <path>",
        "Project directory the daemon operates on (overrides KOTA_PROJECT_DIR env and cwd)",
      )
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

        const projectDir = resolveProjectDir(opts.projectDir);

        const daemon = new Daemon({
          projectDir,
          verbose: opts.verbose || ctx.config.verbose,
          config: ctx.config,
          idleIntervalMs: 30_000,
          pollIntervalMs: parseIntOption(opts.pollInterval, "poll-interval") * 1000,
          workflows: ctx.getContributedWorkflows(),
          channels: ctx.getContributedChannels(),
          controlRoutes: ctx.getContributedControlRoutes(),
          routes: ctx.getRoutes(),
          logFormat,
          resolveAgentDef: (name) => ctx.resolveAgentDef(name),
          resolveSkillsPrompt: (names, agentName) => ctx.resolveSkillsPrompt(names, agentName),
          probeModuleHealthChecks: () => ctx.probeHealthChecks(),
          moduleConfigKeys: ctx.getRegisteredConfigKeys(),
        });

        if (useDashboard) {
          const dashboard = new DaemonDashboard(() => ({
            ...daemon.getDashboardSnapshot(),
            taskQueue: getRepoTaskQueueSnapshot(projectDir),
          }));
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
        const result = await ctx.client.daemonOps.status();
        if (result.state === "running") {
          if (opts.json) {
            console.log(JSON.stringify({ ...result.status, managed: result.managed }));
            return;
          }
          console.log(formatDaemonStatus(result.status, result.managed));
          return;
        }

        if (opts.json) {
          if (result.state === "stale") {
            console.log(JSON.stringify({ running: false, managed: result.managed, staleControlFile: true }));
          } else {
            console.log(JSON.stringify({ running: false, managed: result.managed }));
          }
        } else {
          if (result.state === "stale") {
            console.error(`Stale control file (pid ${result.pid} is not alive). Run 'kota doctor --fix' to clean up.`);
          } else {
            console.error("Daemon is not running.");
          }
          if (result.managed) console.log("managed:  yes (OS service installed)");
        }
        process.exitCode = 1;
      });

    cmd
      .command("pid")
      .description("Print the PID of the running daemon (exits non-zero if not running)")
      .action(async () => {
        const result = await ctx.client.daemonOps.pid();
        if (result.state === "running") {
          console.log(String(result.pid));
          return;
        }
        if (result.state === "stale") {
          console.error(`Stale control file (pid ${result.pid} is not alive). Run 'kota doctor --fix' to clean up.`);
        } else {
          console.error("Daemon is not running.");
        }
        process.exitCode = 1;
      });

    cmd
      .command("stop")
      .description("Gracefully stop the running daemon (exits 0 on success)")
      .option("--timeout <seconds>", "Seconds to wait for clean exit", "90")
      .action(async (opts: { timeout: string }) => {
        const timeoutSec = Math.max(1, Number.parseInt(opts.timeout, 10) || 10);
        const result = await ctx.client.daemonOps.stop({ timeoutSec });
        if (result.ok) {
          console.log("Daemon stopped.");
          return;
        }
        if (result.reason === "not_running") {
          console.error("Daemon is not running.");
        } else if (result.reason === "stale") {
          console.error("Daemon process is not running (stale control file).");
        } else if (result.reason === "timeout") {
          console.error(`Daemon did not stop within ${timeoutSec}s.`);
        }
        process.exitCode = 1;
      });

    cmd
      .command("reload")
      .description("Reload daemon config and re-register module workflow contributions without restart")
      .action(async () => {
        const result = await ctx.client.daemonOps.reload();
        if (!result.ok) {
          if (result.reason === "not_running") {
            console.error("Daemon is not running.");
          } else {
            console.error("Daemon reload failed or daemon is not reachable.");
          }
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
        const projectDir = resolveProjectDir();

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
          console.log(`  label: ${SERVICE_LABEL_LAUNCHD}`);
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
          const enable = spawnSync("systemctl", ["--user", "enable", "--now", SERVICE_NAME_SYSTEMD], { encoding: "utf8" });
          if (enable.status !== 0) {
            console.error(`systemctl enable failed:\n${enable.stderr || enable.stdout}`);
            process.exitCode = 1;
            return;
          }
          console.log(`Daemon service installed and started.`);
          console.log(`  service: ${servicePath}`);
          console.log(`To stop: systemctl --user stop ${SERVICE_NAME_SYSTEMD}`);
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
          spawnSync("systemctl", ["--user", "disable", "--now", SERVICE_NAME_SYSTEMD], { encoding: "utf8" });
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

  /**
   * Local-side `sessions` and `daemonOps` namespaces.
   *
   * The selector picks LocalKotaClient only when no daemon is reachable, so
   * `sessions.list` returns an empty list and mutations surface
   * `daemon_required`. `daemonOps` reads `.kota/daemon-control.json` directly
   * to distinguish "not running" from "stale control file" without re-doing
   * that filesystem logic in the operator CLI handlers.
   */
  localClient: () => {
    const daemonOps: DaemonOpsClient = {
      async status() {
        return localDaemonStatus();
      },
      async pid() {
        return localDaemonPid();
      },
      async stop(options) {
        return localDaemonStop(options);
      },
      async reload() {
        return localDaemonReload();
      },
    };
    return { sessions: sessionsLocalClient(), daemonOps };
  },
};

export default daemonModule;
