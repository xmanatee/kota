import { spawn, spawnSync } from "node:child_process";
import { Command } from "commander";
import { loadConfig } from "#core/config/config.js";
import { resolveProjectDir } from "#core/config/project-dir.js";
import { Daemon, RESTART_EXIT_CODE } from "#core/daemon/daemon.js";
import type { DaemonLiveStatus, InteractiveSession } from "#core/daemon/daemon-control.js";
import type {
  ConfiguredProject,
  ProjectId,
  ProjectRegistryProjection,
} from "#core/daemon/project-registry.js";
import {
  checkPresetAuth,
  PRESET_ENV_VAR,
  resolvePreset,
} from "#core/model/preset.js";
import type { KotaModule } from "#core/modules/module-types.js";
import { loadRuntimeModules } from "#core/modules/runtime-loader.js";
import { daemonManagedHttp } from "#core/server/daemon-client.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { LogFormat } from "#core/util/log-format.js";
import {
  type ColumnRow,
  columns,
  dashboard,
  type KVEntry,
  kvBlock,
  line,
  plain,
  type RenderNode,
  span,
  statusBanner,
} from "#modules/rendering/primitives.js";
import { renderToString } from "#modules/rendering/transport.js";
import { getRepoTaskQueueSnapshot } from "#modules/repo-tasks/repo-tasks-domain.js";
import type {
  DaemonOpsClient,
  ProjectsClient,
  ProjectsUseResult,
  SessionsClient,
  SessionsSetAutonomyModeResult,
} from "./client.js";
import {
  localDaemonPid,
  localDaemonReload,
  localDaemonStatus,
  localDaemonStop,
} from "./daemon-ops-operations.js";
import { DaemonDashboard } from "./dashboard.js";
import { buildEventsCommand } from "./events-cli.js";
import { abbreviateRunId, formatDuration, formatTimeAgo, formatUptime } from "./format-utils.js";
import { buildProjectCommand } from "./projects-cli.js";
import { projectsLocalClient } from "./projects-local.js";
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

function installDaemonPresetEnv(args: {
  flagValue: string | undefined;
  configValue: string | undefined;
}): ReturnType<typeof resolvePreset> {
  try {
    const resolution = resolvePreset({
      flag: args.flagValue,
      env: process.env[PRESET_ENV_VAR],
      config: args.configValue,
    });
    process.env[PRESET_ENV_VAR] = resolution.preset.id;
    return resolution;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

function preflightDaemonPresetAuth(args: {
  preset: ReturnType<typeof resolvePreset>["preset"];
  harnessName: string;
}): void {
  if (args.harnessName !== args.preset.harness) return;
  const { missing } = checkPresetAuth(args.preset);
  if (missing.length === 0) return;
  console.error(
    `Error: preset "${args.preset.id}" requires ${missing.join(" or ")}. ` +
      `Run \`kota doctor --preset ${args.preset.id}\` to diagnose before starting the daemon.`,
  );
  process.exit(1);
}

function resolveDaemonHarness(args: {
  configHarness: string | undefined;
  presetResolution: ReturnType<typeof resolvePreset>;
}): string {
  if (args.presetResolution.source === "flag" || args.presetResolution.source === "env") {
    return args.presetResolution.preset.harness;
  }
  return args.configHarness ?? args.presetResolution.preset.harness;
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

  const stateEntries: KVEntry[] = [
    {
      label: "Status",
      value: `running  (pid ${status.pid}, up ${uptime}, started ${started})`,
      role: "success",
    },
    { label: "Sessions", value: `${status.sessions.length} interactive` },
    { label: "Paused", value: wf.paused ? "yes" : "no", role: wf.paused ? "warn" : "muted" },
    {
      label: "Managed",
      value: managed ? "yes (OS service installed)" : "no",
      role: managed ? "info" : "muted",
    },
  ];
  if (wf.totalCostUsd != null && wf.totalCostUsd > 0) {
    stateEntries.push({ label: "Cost", value: `$${wf.totalCostUsd.toFixed(2)} total` });
  }

  const activitySummary = `${wf.activeRuns.length} active · ${wf.pendingRuns.length} pending · ${wf.completedRuns} completed`;
  const activityChildren: RenderNode[] = [
    line(span(activitySummary, "muted")),
  ];

  if (wf.activeRuns.length > 0) {
    const rows: ColumnRow[] = wf.activeRuns.map((run) => ({
      cells: [
        { spans: [span(run.workflow, "tool", true)] },
        { spans: [plain(formatDuration(run.startedAt))] },
        { spans: [span(abbreviateRunId(run.runId), "muted")] },
      ],
    }));
    activityChildren.push(
      columns(
        [
          { header: "Active", role: "tool", headerRole: "muted", minWidth: 12 },
          { header: "Duration", align: "right", minWidth: 9 },
          { header: "Run", role: "muted", minWidth: 7 },
        ],
        rows,
      ),
    );
  }

  if (wf.pendingRuns.length > 0) {
    const shown = wf.pendingRuns.slice(0, 5);
    const overflow = wf.pendingRuns.length - shown.length;
    const rows: ColumnRow[] = shown.map((run) => ({
      cells: [
        { spans: [plain(run.workflowName)] },
        { spans: [span(run.runId ? abbreviateRunId(run.runId) : "-", "muted")] },
      ],
    }));
    activityChildren.push(
      columns(
        [
          { header: `Pending${overflow > 0 ? ` (+${overflow} more)` : ""}`, headerRole: "muted", minWidth: 12 },
          { header: "Run", role: "muted", minWidth: 7 },
        ],
        rows,
      ),
    );
  }

  if (wf.activeRuns.length === 0 && wf.pendingRuns.length === 0) {
    activityChildren.push(line(span("queue idle — no active or pending runs", "muted")));
  }

  const sections: { title: string; role: "info" | "accent"; body: RenderNode }[] = [
    { title: "State", role: "info", body: kvBlock(stateEntries) },
    {
      title: "Activity",
      role: "accent",
      body: activityChildren.length === 1
        ? activityChildren[0]!
        : { kind: "stack", children: activityChildren },
    },
  ];
  if (wf.paused) {
    sections.unshift({
      title: "Notice",
      role: "accent",
      body: statusBanner("warn", "workflow scheduler paused", "no new runs are being dispatched"),
    });
  }
  return dashboard(sections);
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
      .option("--preset <id>", "Preset bundle (claude | codex | gemini | gemini-cli). Overrides KOTA_PRESET and config.defaultPreset for this daemon process")
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

        // The CLI bootstraps a `"commands"` ModuleLoader for fast
        // subcommand registration, but the daemon is a long-lived runtime
        // host: serving `/api/knowledge`, `/api/memory`, `/recall`,
        // `/answer`, etc. requires every module's `onLoad` to have
        // registered its provider-backed seam. Drive a fresh runtime-mode
        // load here so the Daemon never reads contributions from the CLI's
        // partial state — the loader's typed accessors enforce this too.
        const config = loadConfig(projectDir);
        const presetResolution = installDaemonPresetEnv({
          flagValue: opts.preset,
          configValue: config.defaultPreset,
        });
        const preset = presetResolution.preset;
        const effectiveHarness = resolveDaemonHarness({
          configHarness: config.defaultAgentHarness,
          presetResolution,
        });
        const effectiveConfig = {
          ...config,
          defaultPreset: preset.id,
          defaultAgentHarness: effectiveHarness,
        };
        preflightDaemonPresetAuth({
          preset,
          harnessName: effectiveHarness,
        });
        const verbose = opts.verbose || effectiveConfig.verbose || false;
        const loader = await loadRuntimeModules({ config: effectiveConfig, cwd: projectDir, verbose });

        const daemon = new Daemon({
          projectDir,
          verbose,
          config: effectiveConfig,
          idleIntervalMs: 30_000,
          pollIntervalMs: parseIntOption(opts.pollInterval, "poll-interval") * 1000,
          workflows: loader.getContributedWorkflows(),
          channels: loader.getContributedChannels(),
          controlRoutes: loader.getContributedControlRoutes(),
          routes: loader.getRoutes(),
          logFormat,
          resolveAgentDef: (name) => loader.getAgentDef(name),
          resolveSkillsPrompt: (names, agentName) => loader.getSkillsPromptFor(names, agentName),
          probeModuleHealthChecks: () => loader.probeHealthChecks(),
          moduleConfigKeys: loader.getRegisteredConfigKeys(),
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
    return [
      cmd,
      buildEventsCommand(ctx),
      buildSessionCommand(ctx),
      buildStatusCommand(ctx),
      buildProjectCommand(ctx),
    ];
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
    return {
      sessions: sessionsLocalClient(),
      daemonOps,
      projects: projectsLocalClient(),
    };
  },
  daemonClient: (link) => ({
    sessions: buildSessionsDaemonHandler(link),
    daemonOps: buildDaemonOpsDaemonHandler(link),
    projects: buildProjectsDaemonHandler(link),
  }),
};

/**
 * Daemon-side `DaemonOpsClient` backed by the typed `DaemonTransport`. Calls
 * the `GET /status` and `POST /reload` control routes the daemon owns.
 *
 *  - `status()` calls `link.request<DaemonLiveStatus>("GET", "/status")`. On
 *    `null` (transport failure or non-ok response) it throws `"Daemon
 *    unreachable while reading daemon status"`. On success it probes
 *    `daemonManagedHttp` (the daemon-up `managed` policy stub) and returns
 *    `{ state: "running", managed, status }`. Only the local handler emits
 *    `not_running` / `stale` arms — the daemon-up branch only exists when
 *    the selector resolved to a daemon address.
 *  - `pid()` calls `link.request<DaemonLiveStatus>("GET", "/status")`
 *    independently (no caching across calls). On `null` or missing
 *    `status.pid` it throws `"Daemon unreachable while reading daemon
 *    pid"`. On success it returns `{ state: "running", pid: status.pid }`.
 *  - `stop(options)` throws `"daemonOps.stop is owned by the local handler
 *    — the daemon cannot SIGTERM itself."`. The arm exists to satisfy the
 *    typed contract; runtime callers always reach the local handler.
 *  - `reload()` calls `link.request<{ ok: boolean; workflows: number;
 *    changedModules: string[] }>("POST", "/reload")`. On `null` it returns
 *    `{ ok: false, reason: "reload_failed" }`. On success it returns `{ ok:
 *    true, workflows, changedModules }`. The daemon-up branch never returns
 *    `not_running` because the client only exists when the selector resolved
 *    to a daemon address.
 */
function buildDaemonOpsDaemonHandler(link: DaemonTransport): DaemonOpsClient {
  return {
    status: async () => {
      const status = await link.request<DaemonLiveStatus>("GET", "/status");
      if (!status) {
        throw new Error("Daemon unreachable while reading daemon status");
      }
      const managed = await daemonManagedHttp();
      return { state: "running", managed, status };
    },
    pid: async () => {
      const status = await link.request<DaemonLiveStatus>("GET", "/status");
      if (!status || typeof status.pid !== "number") {
        throw new Error("Daemon unreachable while reading daemon pid");
      }
      return { state: "running", pid: status.pid };
    },
    stop: async (_options) => {
      throw new Error(
        "daemonOps.stop is owned by the local handler — the daemon cannot SIGTERM itself.",
      );
    },
    reload: async () => {
      const result = await link.request<{
        ok: boolean;
        workflows: number;
        changedModules: string[];
      }>("POST", "/reload");
      if (!result) return { ok: false, reason: "reload_failed" };
      return {
        ok: true,
        workflows: result.workflows,
        changedModules: result.changedModules,
      };
    },
  };
}

/**
 * Wire shape returned by the daemon's `PATCH /sessions/:id` route. The success
 * envelope carries snake_case `autonomy_mode` plus optional `source` /
 * `serveOwned` fields the namespace contract reshapes to camelCase
 * `autonomyMode` with explicit defaults.
 */
type SessionsSetAutonomyModeWireBody = {
  autonomy_mode: AutonomyMode;
  source?: "daemon" | "serve";
  serveOwned?: boolean;
};

/**
 * Daemon-side `SessionsClient` backed by the typed `DaemonTransport`. Calls
 * the `GET /sessions` and `PATCH /sessions/:id` control routes the daemon
 * owns. The PATCH wire shape uses the snake_case `autonomy_mode` key on both
 * the request body and the response — `handlePatchDaemonSession` parses
 * `body.autonomy_mode` and emits `body.autonomy_mode` back, so the namespace
 * contract's camelCase `autonomyMode` is the typed client-side shape, not
 * the wire shape.
 *
 * `list()` throws on non-ok HTTP responses and on transport failure — the
 * `sessions.list()` namespace shape does not include a `daemon_required` arm,
 * matching today's pre-migration behavior.
 *
 * `setAutonomyMode(id, mode)` distinguishes three failure classes:
 *  - `404 → { ok: false, reason: "not_found" }`,
 *  - other non-ok HTTP responses → throw the daemon's error message,
 *  - transient transport failures (network error, JSON parse failure inside
 *    the `try` block) → `{ ok: false, reason: "daemon_required" }`.
 *
 * The success arm reshapes the daemon's snake_case `autonomy_mode` field to
 * camelCase `autonomyMode`, defaults `source` to `"daemon"` and `serveOwned`
 * to `false` when the daemon response omits either.
 */
function buildSessionsDaemonHandler(link: DaemonTransport): SessionsClient {
  return {
    list: async () => {
      const res = await link.fetchRaw("/sessions", {
        method: "GET",
        headers: link.authHeaders(),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const parsed = (await res.json()) as { sessions: InteractiveSession[] };
      return { sessions: parsed.sessions };
    },
    setAutonomyMode: async (
      id: string,
      mode: AutonomyMode,
    ): Promise<SessionsSetAutonomyModeResult> => {
      try {
        const res = await link.fetchRaw(`/sessions/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...link.authHeaders() },
          body: JSON.stringify({ autonomy_mode: mode }),
        });
        if (res.status === 404) return { ok: false, reason: "not_found" };
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const body = (await res.json()) as SessionsSetAutonomyModeWireBody;
        return {
          ok: true,
          autonomyMode: body.autonomy_mode,
          source: body.source ?? "daemon",
          serveOwned: body.serveOwned === true,
        };
      } catch (err) {
        if (err instanceof Error && /HTTP/.test(err.message)) throw err;
        return { ok: false, reason: "daemon_required" };
      }
    },
  };
}

/**
 * Wire shape returned by `GET /projects`: the registry projection plus
 * the operator-selected active project id (or `null`).
 */
type ProjectsListWireBody = ProjectRegistryProjection & {
  activeProjectId: ProjectId | null;
};

/**
 * Daemon-side `ProjectsClient` backed by the typed `DaemonTransport`.
 * Calls `GET /projects` to read the registry plus active selection in
 * one round trip, and `PATCH /projects/active` to switch.
 *
 * `list()` throws when the daemon is reachable but returns a non-ok
 * response (e.g. transport-level error after the selector chose this
 * branch) and surfaces `daemon_required` on transient transport
 * failures so the CLI can degrade with the same shape the local handler
 * uses.
 *
 * `use(projectId)` distinguishes:
 *  - `200 → { ok: true, activeProjectId }`,
 *  - `404 → { ok: false, reason: "not_found", projectId }`,
 *  - other non-ok responses → throw the daemon's error message,
 *  - transport failure → `{ ok: false, reason: "daemon_required" }`.
 */
function buildProjectsDaemonHandler(link: DaemonTransport): ProjectsClient {
  return {
    list: async () => {
      try {
        const res = await link.fetchRaw("/projects", {
          method: "GET",
          headers: link.authHeaders(),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const parsed = (await res.json()) as ProjectsListWireBody;
        return {
          ok: true,
          projects: parsed.projects as ConfiguredProject[],
          defaultProjectId: parsed.defaultProjectId,
          activeProjectId: parsed.activeProjectId,
        };
      } catch (err) {
        if (err instanceof Error && /HTTP/.test(err.message)) throw err;
        return { ok: false, reason: "daemon_required" };
      }
    },
    use: async (projectId: string | null): Promise<ProjectsUseResult> => {
      try {
        const res = await link.fetchRaw("/projects/active", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...link.authHeaders() },
          body: JSON.stringify({ projectId }),
        });
        if (res.status === 404) {
          const body = (await res.json().catch(() => ({}))) as { projectId?: string };
          return {
            ok: false,
            reason: "not_found",
            projectId: body.projectId ?? (projectId ?? ""),
          };
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const body = (await res.json()) as { activeProjectId: ProjectId | null };
        return { ok: true, activeProjectId: body.activeProjectId };
      } catch (err) {
        if (err instanceof Error && /HTTP/.test(err.message)) throw err;
        return { ok: false, reason: "daemon_required" };
      }
    },
  };
}

export default daemonModule;
