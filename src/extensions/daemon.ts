import { spawn } from "node:child_process";
import { join } from "node:path";
import { Command } from "commander";
import type { KotaExtension } from "../extension-types.js";
import { readOptionalJsonFile } from "../json-file.js";
import type { LogFormat } from "../log-format.js";
import { Daemon, RESTART_EXIT_CODE } from "../scheduler/daemon.js";
import type { DaemonControlAddress } from "../scheduler/daemon-control.js";
import { DaemonControlClient } from "../server/daemon-client.js";
import { getRegisteredWorkflowDefinitions } from "../workflow/registry.js";
import type { RegisteredWorkflowDefinitionInput } from "../workflow/types.js";

const DAEMON_CHILD_ENV = "KOTA_DAEMON_CHILD";

function parseIntOption(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`Error: --${name} must be a positive integer, got "${value}"`);
    process.exit(1);
  }
  return parsed;
}

export function buildDaemonChildArgs(opts: {
  model?: string;
  verbose?: boolean;
  idleInterval: string;
  pollInterval: string;
  logFormat?: LogFormat;
}): string[] {
  const args = [
    process.argv[1]!,
    "daemon",
    "--idle-interval",
    opts.idleInterval,
    "--poll-interval",
    opts.pollInterval,
  ];
  if (opts.model) args.push("--model", opts.model);
  if (opts.verbose) args.push("--verbose");
  if (opts.logFormat) args.push("--log-format", opts.logFormat);
  return args;
}

export function resolveDaemonWorkflowDefinitions(
  contributedWorkflows: readonly RegisteredWorkflowDefinitionInput[] = [],
): RegisteredWorkflowDefinitionInput[] {
  return getRegisteredWorkflowDefinitions(contributedWorkflows);
}

async function runDaemonSupervisor(
  opts: Parameters<typeof buildDaemonChildArgs>[0],
): Promise<void> {
  const childArgs = buildDaemonChildArgs(opts);
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

const daemonModule: KotaExtension = {
  name: "daemon",
  version: "1.0.0",
  description: "Long-running KOTA process with scheduler and code-defined workflows",

  commands: (ctx) => {
    const cmd = new Command("daemon")
      .description("Run KOTA as a long-running daemon with autonomous workflows")
      .option("-m, --model <model>", "Model to use")
      .option("-v, --verbose", "Show debug output")
      .option(
        "--idle-interval <seconds>",
        "How often to emit runtime.idle while no workflow is running",
        "30",
      )
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
          await runDaemonSupervisor({
            model: opts.model || ctx.config.model,
            verbose: opts.verbose || ctx.config.verbose,
            idleInterval: opts.idleInterval,
            pollInterval: opts.pollInterval,
            logFormat,
          });
          return;
        }

        const daemon = new Daemon({
          model: opts.model || ctx.config.model,
          verbose: opts.verbose || ctx.config.verbose,
          config: ctx.config,
          idleIntervalMs: parseIntOption(opts.idleInterval, "idle-interval") * 1000,
          pollIntervalMs: parseIntOption(opts.pollInterval, "poll-interval") * 1000,
          workflows: resolveDaemonWorkflowDefinitions(ctx.getContributedWorkflows()),
          channels: ctx.getContributedChannels(),
          logFormat,
        });

        await daemon.start();
      });

    cmd
      .command("status")
      .description("Show daemon health summary (exits 0 if reachable)")
      .option("--json", "Output as JSON")
      .action(async (opts: { json?: boolean }) => {
        const client = DaemonControlClient.fromStateDir();
        if (!client) {
          if (opts.json) {
            console.log(JSON.stringify({ running: false }));
          } else {
            console.error("Daemon is not running.");
          }
          process.exitCode = 1;
          return;
        }
        const status = await client.getDaemonStatus();
        if (!status) {
          if (opts.json) {
            console.log(JSON.stringify({ running: false }));
          } else {
            console.error("Daemon is not reachable.");
          }
          process.exitCode = 1;
          return;
        }
        if (opts.json) {
          console.log(JSON.stringify(status));
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

    return [cmd];
  },
};

export default daemonModule;
