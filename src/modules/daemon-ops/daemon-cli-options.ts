import type { Command } from "commander";
import { resolveProjectDir } from "#core/config/project-dir.js";
import { checkPresetAuth, PRESET_ENV_VAR, resolvePreset } from "#core/model/preset.js";
import type { LogFormat } from "#core/util/log-format.js";
import { line, span } from "#modules/rendering/primitives.js";
import { printToStderr, writeStdout } from "#modules/rendering/transport.js";

export const DAEMON_CHILD_ENV = "KOTA_DAEMON_CHILD";
export const DAEMON_PROJECT_DIR_OPTION_DESCRIPTION =
  "Project directory the daemon operates on (overrides KOTA_PROJECT_DIR env and cwd)";
const DAEMON_HOST_HELP = [
  "Foreground daemon mode:",
  "  This command hosts and monitors the daemon. It is not the interactive operator console.",
  "  Open the console with `kota navigate` or bare `kota`.",
  "  Inspect and control workflow dispatch with `kota workflow status`, `pause`, `resume`, and `follow`.",
  "  Render live workflow controls with `kota ui render runs`.",
].join("\n");
export const DAEMON_COMMAND_DESCRIPTION = [
  "Run the KOTA daemon host and foreground dashboard.",
  "",
  DAEMON_HOST_HELP,
].join("\n");
export const DAEMON_START_DESCRIPTION = [
  "Start the KOTA daemon host and foreground dashboard.",
  "",
  DAEMON_HOST_HELP,
].join("\n");

export type DaemonProjectDirOptions = { projectDir?: string };
export type DaemonStartOptions = DaemonProjectDirOptions & {
  verbose?: boolean;
  preset?: string;
  pollInterval?: string;
  logFormat?: LogFormat;
};
type ResolvedDaemonStartOptions = Omit<DaemonStartOptions, "pollInterval"> & {
  pollInterval: string;
};

export function printDaemonError(message: string): void {
  printToStderr(line(span(message, "error")));
}

export function writeRawBlock(value: string): void {
  writeStdout(value);
  if (!value.endsWith("\n")) writeStdout("\n");
}

export function parseIntOption(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    printDaemonError(`Error: --${name} must be a positive integer, got "${value}"`);
    process.exit(1);
  }
  return parsed;
}

function parseLogFormatOption(value: string): LogFormat {
  if (value !== "text" && value !== "json") {
    printDaemonError(`Error: --log-format must be "text" or "json", got "${value}"`);
    process.exit(1);
  }
  return value;
}

export function addDaemonStartOptions(command: Command): Command {
  return command
    .option("-v, --verbose", "Show debug output")
    .option(
      "--preset <id>",
      "Preset bundle (claude | codex | openrouter | openrouter-lab | gemini | gemini-cli | antigravity-cli). Overrides KOTA_PRESET and config.defaultPreset for this daemon process",
    )
    .option("--poll-interval <seconds>", "Scheduler poll interval in seconds", "30")
    .option("--project-dir <path>", DAEMON_PROJECT_DIR_OPTION_DESCRIPTION)
    .option("--log-format <format>", "Log format: text (default) or json", parseLogFormatOption);
}

export function resolveDaemonStartOptions(
  opts: DaemonStartOptions,
  command?: Command,
): ResolvedDaemonStartOptions {
  const parentOpts = command?.parent?.opts<DaemonStartOptions>() ?? {};
  return {
    verbose: opts.verbose ?? parentOpts.verbose,
    preset: opts.preset ?? parentOpts.preset,
    pollInterval: opts.pollInterval ?? parentOpts.pollInterval ?? "30",
    projectDir: opts.projectDir ?? parentOpts.projectDir,
    logFormat: opts.logFormat ?? parentOpts.logFormat,
  };
}

export function installDaemonPresetEnv(
  flagValue: string | undefined,
  configValue: string | undefined,
): ReturnType<typeof resolvePreset> {
  try {
    const resolution = resolvePreset({
      flag: flagValue,
      env: process.env[PRESET_ENV_VAR],
      config: configValue,
    });
    process.env[PRESET_ENV_VAR] = resolution.preset.id;
    return resolution;
  } catch (err) {
    printDaemonError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export function preflightDaemonPresetAuth(
  preset: ReturnType<typeof resolvePreset>["preset"],
  harnessName: string,
): void {
  if (harnessName !== preset.harness) return;
  const { missing } = checkPresetAuth(preset);
  if (missing.length === 0) return;
  printDaemonError(
    `Error: preset "${preset.id}" requires ${missing.join(" or ")}. ` +
      `Run \`kota doctor --preset ${preset.id}\` to diagnose before starting the daemon.`,
  );
  process.exit(1);
}

export function resolveDaemonCommandProjectDir(
  opts: DaemonProjectDirOptions,
  command?: Command,
): string {
  return resolveProjectDir(opts.projectDir ?? command?.parent?.opts<DaemonProjectDirOptions>().projectDir);
}

export function resolveDaemonHarness(
  configHarness: string | undefined,
  presetResolution: ReturnType<typeof resolvePreset>,
): string {
  if (presetResolution.source === "flag" || presetResolution.source === "env") {
    return presetResolution.preset.harness;
  }
  return configHarness ?? presetResolution.preset.harness;
}
