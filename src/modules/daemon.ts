/**
 * Daemon module — long-running KOTA process with scheduler, event bus, and idle tasks.
 *
 * Extracts the daemon CLI command from cli.ts into a KotaModule,
 * continuing the modular architecture plan. The actual daemon logic
 * lives in src/daemon.ts; this module wires it into the CLI as `kota daemon`.
 */

import { Command } from "commander";
import type { KotaModule } from "../module-types.js";
import { Daemon, type IdleTask } from "../daemon.js";

function parseIntOption(value: string, name: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`Error: --${name} must be a positive integer, got "${value}"`);
    process.exit(1);
  }
  return n;
}

const daemonModule: KotaModule = {
  name: "daemon",
  version: "1.0.0",
  description: "Long-running KOTA process with scheduler, event bus, and idle tasks",

  commands: (ctx) => {
    const cmd = new Command("daemon")
      .description("Run KOTA as a long-running daemon with scheduler, event bus, and idle tasks")
      .option("-m, --model <model>", "Model to use")
      .option("-v, --verbose", "Show debug output")
      .option("--idle-prompt <prompt>", "Prompt for a default idle task")
      .option("--idle-cooldown <seconds>", "Cooldown between idle task runs in seconds")
      .option("--poll-interval <seconds>", "Scheduler poll interval in seconds", "30")
      .option("--no-restart", "Disable auto-restart on dist/ changes")
      .action(async (opts) => {
        if (!process.env.ANTHROPIC_API_KEY) {
          console.error(
            "Error: ANTHROPIC_API_KEY environment variable is not set.\n",
          );
          console.error("To get started:");
          console.error(
            "  1. Get your API key at https://console.anthropic.com/settings/keys",
          );
          console.error("  2. Export it in your shell:\n");
          console.error("     export ANTHROPIC_API_KEY=sk-ant-...\n");
          process.exit(1);
        }

        const idleTasks: IdleTask[] = [];
        if (opts.idlePrompt) {
          const cooldownMs = opts.idleCooldown
            ? parseIntOption(opts.idleCooldown, "idle-cooldown") * 1000
            : undefined;
          idleTasks.push({
            name: "default",
            prompt: opts.idlePrompt,
            cooldownMs,
          });
        }

        const pollIntervalMs = parseIntOption(opts.pollInterval, "poll-interval") * 1000;

        const daemon = new Daemon({
          model: opts.model || ctx.config.model,
          verbose: opts.verbose || ctx.config.verbose,
          config: ctx.config,
          idleTasks: idleTasks.length > 0 ? idleTasks : undefined,
          pollIntervalMs,
          restartOnBuild: opts.restart !== false,
        });

        await daemon.start();
      });

    return [cmd];
  },
};

export default daemonModule;
