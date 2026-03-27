import { spawn } from "node:child_process";
import { Command } from "commander";
import type { KotaExtension } from "../extension-types.js";
import { Daemon, RESTART_EXIT_CODE } from "../scheduler/daemon.js";
import type { RegisteredWorkflowDefinitionInput } from "../workflow/types.js";
import { getRegisteredWorkflowDefinitions } from "../workflow/registry.js";

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
      .action(async (opts) => {
        if (process.env[DAEMON_CHILD_ENV] !== "1") {
          await runDaemonSupervisor({
            model: opts.model || ctx.config.model,
            verbose: opts.verbose || ctx.config.verbose,
            idleInterval: opts.idleInterval,
            pollInterval: opts.pollInterval,
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
        });

        await daemon.start();
      });

    return [cmd];
  },
};

export default daemonModule;
