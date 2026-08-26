import { Command } from "commander";
import { loadConfig } from "#core/config/config.js";
import { resolveProjectDir } from "#core/config/project-dir.js";
import { Daemon } from "#core/daemon/daemon.js";
import { initEventBus } from "#core/events/event-bus.js";
import { loadRuntimeModules } from "#core/modules/runtime-loader.js";
import type { LogFormat } from "#core/util/log-format.js";
import { getRepoTaskQueueSnapshot } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  addDaemonStartOptions,
  DAEMON_CHILD_ENV,
  DAEMON_COMMAND_DESCRIPTION,
  DAEMON_START_DESCRIPTION,
  type DaemonStartOptions,
  installDaemonPresetEnv,
  parseIntOption,
  preflightDaemonPresetAuth,
  resolveDaemonHarness,
  resolveDaemonStartOptions,
} from "./daemon-cli-options.js";
import { runDaemonSupervisor } from "./daemon-supervisor.js";
import { DaemonDashboard } from "./dashboard.js";

async function startDaemon(rawOpts: DaemonStartOptions, command?: Command): Promise<void> {
  const opts = resolveDaemonStartOptions(rawOpts, command);
  const logFormat: LogFormat | undefined = opts.logFormat
    ?? (process.env.KOTA_DAEMON_LOG_FORMAT === "json" ? "json" : undefined);
  if (process.env[DAEMON_CHILD_ENV] !== String(process.ppid)) {
    await runDaemonSupervisor();
    return;
  }

  const useDashboard = process.stdout.isTTY === true && !logFormat;
  const projectDir = resolveProjectDir(opts.projectDir);
  const config = loadConfig(projectDir);
  const presetResolution = installDaemonPresetEnv(opts.preset, config.defaultPreset);
  const preset = presetResolution.preset;
  const effectiveHarness = resolveDaemonHarness(
    config.defaultAgentHarness,
    presetResolution,
  );
  const effectiveConfig = {
    ...config,
    defaultPreset: preset.id,
    defaultAgentHarness: effectiveHarness,
  };
  preflightDaemonPresetAuth(preset, effectiveHarness);
  const verbose = opts.verbose || effectiveConfig.verbose || false;
  const eventBus = initEventBus();
  const loader = await loadRuntimeModules({
    config: effectiveConfig,
    cwd: projectDir,
    verbose,
    eventBus,
  });
  const daemon = new Daemon({
    runtimeModuleHost: { eventBus, moduleLoader: loader },
    projectDir,
    verbose,
    config: effectiveConfig,
    idleIntervalMs: 30_000,
    pollIntervalMs: parseIntOption(opts.pollInterval, "poll-interval") * 1000,
    workflows: loader.getContributedWorkflows(),
    channels: loader.getContributedChannels(),
    controlRoutes: loader.getContributedControlRoutes(),
    routes: loader.getRoutes(),
    getModuleSummaries: () => loader.getModuleSummaries(),
    logFormat,
    resolveAgentDef: (name) => loader.getAgentDef(name),
    resolveSkillsPrompt: (names, agentName) => loader.getSkillsPromptFor(names, agentName),
    probeModuleHealthChecks: () => loader.probeHealthChecks(),
    moduleConfigKeys: loader.getRegisteredConfigKeys(),
    unloadModules: () => loader.unloadAll(),
    restartExit: (code) => process.exit(code),
  });
  if (!useDashboard) {
    await daemon.start();
    return;
  }
  const daemonRun = daemon.start();
  await daemon.whenReady();
  const dashboard = new DaemonDashboard(() => ({
    ...daemon.getDashboardSnapshot(),
    taskQueue: getRepoTaskQueueSnapshot(projectDir),
  }));
  dashboard.start();
  try {
    await daemonRun;
  } finally {
    dashboard.stop();
  }
}

export function createDaemonCommand(): Command {
  const command = addDaemonStartOptions(
    new Command("daemon").description(DAEMON_COMMAND_DESCRIPTION),
  ).action(async (opts: DaemonStartOptions) => startDaemon(opts));
  command.addCommand(
    addDaemonStartOptions(
      new Command("start")
        .summary("Start the KOTA daemon host and foreground dashboard")
        .description(DAEMON_START_DESCRIPTION),
    ).action(async (opts: DaemonStartOptions, child: Command) => startDaemon(opts, child)),
  );
  return command;
}
