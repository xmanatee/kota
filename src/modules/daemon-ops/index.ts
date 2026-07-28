import { spawn, spawnSync } from "node:child_process";
import { Command } from "commander";
import { loadConfig } from "#core/config/config.js";
import { resolveProjectDir } from "#core/config/project-dir.js";
import type { ClientIdentity } from "#core/daemon/client-identity.js";
import { Daemon, RESTART_EXIT_CODE } from "#core/daemon/daemon.js";
import type { DaemonLiveStatus, InteractiveSession, WorkflowRunDetail } from "#core/daemon/daemon-control.js";
import type {
  ConfiguredProject,
  ProjectId,
  ProjectRegistryProjection,
} from "#core/daemon/scope-registry.js";
import { buildUiSurfaceBundle } from "#core/daemon/ui-surface.js";
import type { SessionGuardrailsReloadSummary } from "#core/events/event-bus-types.js";
import {
  checkPresetAuth,
  PRESET_ENV_VAR,
  resolvePreset,
} from "#core/model/preset.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { loadRuntimeModules } from "#core/modules/runtime-loader.js";
import { daemonManagedHttp } from "#core/server/daemon-client.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type { KotaClient } from "#core/server/kota-client.js";
import { scopeSelectorQuery } from "#core/server/scope-selector.js";
import { jsonResponse } from "#core/server/session-pool.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { LogFormat } from "#core/util/log-format.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
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
  stack,
  statusBanner,
} from "#modules/rendering/primitives.js";
import { print, printToStderr, renderToString, writeJson, writeStdout, writeStdoutLine } from "#modules/rendering/transport.js";
import { getRepoTaskQueueSnapshot } from "#modules/repo-tasks/repo-tasks-domain.js";
import type {
  DaemonOpsClient,
  ProjectsClient,
  ProjectsUseResult,
  SessionsClient,
  SessionsSetAutonomyModeResult,
  UiActionExecuteInput,
  UiClient,
} from "./client.js";
import {
  daemonOpsClientForProject,
  localDaemonPid,
  localDaemonReload,
  localDaemonStatus,
  localDaemonStop,
  recordDaemonStopAttempt,
  stopDaemonPid,
} from "./daemon-ops-operations.js";
import { DaemonDashboard } from "./dashboard.js";
import { buildEventsCommand } from "./events-cli.js";
import { abbreviateRunId, formatDuration, formatTimeAgo, formatUptime } from "./format-utils.js";
import { buildOperatorInboxSnapshot, type OperatorInboxSnapshot } from "./operator-inbox.js";
import { buildInboxCommand } from "./operator-inbox-cli.js";
import type {
  UiActionExecutionResult,
  UiClientNamespaceExecutor,
  UiJsonValue,
  UiRouteExecutor,
  UiSurfaceBundle,
} from "./operator-ui.js";
import {
  buildContinuityProjection,
  buildContinuityUiSurface,
  buildInboxUiSurface,
  buildModulesAgentsUiSurface,
  buildOperatorControlUiSurface,
  buildRuntimeUiSurface,
  buildScopeUiSurface,
  buildSetupUiSurface,
  buildStatusUiSurface,
  buildStoresUiSurface,
  executeUiAction,
  findUiAction,
  type SurfaceRead,
} from "./operator-ui.js";
import { buildUiCommand } from "./operator-ui-cli.js";
import type { UiActionOperation } from "./operator-ui-types.js";
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
import { buildStatusCommand, gatherStatus } from "./status-cli.js";

export type {
  ContinuityProjection,
  ContinuityProjectionInput,
  ContinuityState,
  UiAction,
  UiActionEffect,
  UiActionExecutionResult,
  UiClientNamespaceExecutor,
  UiConfirmation,
  UiIntent,
  UiListItem,
  UiNode,
  UiRole,
  UiRouteExecutor,
  UiStatusEntry,
  UiSurface,
  UiSurfaceBundle,
} from "./operator-ui.js";
export {
  buildContinuityProjection,
  buildContinuityUiSurface,
  buildInboxUiSurface,
  buildModulesAgentsUiSurface,
  buildOperatorControlUiSurface,
  buildRuntimeUiSurface,
  buildScopeUiSurface,
  buildSetupUiSurface,
  buildStatusInboxBundle,
  buildStatusUiSurface,
  buildStoresUiSurface,
  CONTINUITY_COMPOSED_STORES,
  executeUiAction,
  renderUiSurface,
} from "./operator-ui.js";
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
const DAEMON_PROJECT_DIR_OPTION_DESCRIPTION =
  "Project directory the daemon operates on (overrides KOTA_PROJECT_DIR env and cwd)";
const DAEMON_HOST_HELP = [
  "Foreground daemon mode:",
  "  This command hosts and monitors the daemon. It is not the interactive operator console.",
  "  Open the console with `kota navigate` or bare `kota`.",
  "  Inspect and control workflow dispatch with `kota workflow status`, `pause`, `resume`, and `follow`.",
  "  Render the shared operator controls with `kota ui render operator-control`.",
].join("\n");
const DAEMON_COMMAND_DESCRIPTION = [
  "Run the KOTA daemon host and foreground dashboard.",
  "",
  DAEMON_HOST_HELP,
].join("\n");
const DAEMON_START_DESCRIPTION = [
  "Start the KOTA daemon host and foreground dashboard.",
  "",
  DAEMON_HOST_HELP,
].join("\n");

function printDaemonError(message: string): void {
  printToStderr(line(span(message, "error")));
}

function writeRawBlock(text: string): void {
  writeStdout(text);
  if (!text.endsWith("\n")) writeStdout("\n");
}

type DaemonProjectDirOptions = {
  projectDir?: string;
};

type DaemonStartOptions = DaemonProjectDirOptions & {
  verbose?: boolean;
  preset?: string;
  pollInterval?: string;
  logFormat?: LogFormat;
};

type ResolvedDaemonStartOptions = Omit<DaemonStartOptions, "pollInterval"> & {
  pollInterval: string;
};

function parseIntOption(value: string, name: string): number {
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

function addDaemonStartOptions(command: Command): Command {
  return command
    .option("-v, --verbose", "Show debug output")
    .option(
      "--preset <id>",
      "Preset bundle (claude | codex | openrouter | openrouter-lab | gemini | gemini-cli | antigravity-cli). Overrides KOTA_PRESET and config.defaultPreset for this daemon process",
    )
    .option("--poll-interval <seconds>", "Scheduler poll interval in seconds", "30")
    .option(
      "--project-dir <path>",
      DAEMON_PROJECT_DIR_OPTION_DESCRIPTION,
    )
    .option("--log-format <format>", "Log format: text (default) or json", parseLogFormatOption);
}

function resolveDaemonStartOptions(
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
    printDaemonError(err instanceof Error ? err.message : String(err));
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
  printDaemonError(
    `Error: preset "${args.preset.id}" requires ${missing.join(" or ")}. ` +
      `Run \`kota doctor --preset ${args.preset.id}\` to diagnose before starting the daemon.`,
  );
  process.exit(1);
}

function resolveDaemonCommandProjectDir(
  opts: DaemonProjectDirOptions,
  command?: Command,
): string {
  const parentOpts = command?.parent?.opts<DaemonProjectDirOptions>() ?? {};
  return resolveProjectDir(opts.projectDir ?? parentOpts.projectDir);
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
          env: withProtectedGitBareRepositoryEnv({
            ...process.env,
            [DAEMON_CHILD_ENV]: String(process.pid),
          }),
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
  if (wf.totalInputTokens != null || wf.totalOutputTokens != null) {
    stateEntries.push({
      label: "Agent tokens",
      value: `${(wf.totalInputTokens ?? 0).toLocaleString()} in / ${(wf.totalOutputTokens ?? 0).toLocaleString()} out`,
    });
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

const EMPTY_INBOX_COUNTS: OperatorInboxSnapshot["counts"] = {
  runtime: 0,
  approval: 0,
  "owner-question": 0,
  "blocked-task": 0,
  setup: 0,
  "failed-run": 0,
};

function emptyInboxSnapshot(projectDir: string): OperatorInboxSnapshot {
  return {
    projectDir,
    generatedAt: new Date().toISOString(),
    items: [],
    counts: { ...EMPTY_INBOX_COUNTS },
  };
}

async function buildSharedUiSurfaceBundle(ctx: ModuleContext): Promise<UiSurfaceBundle> {
  const status = await gatherStatus(ctx.cwd);
  const readSurface = async <T>(
    label: string,
    loader: () => Promise<T>,
  ): Promise<SurfaceRead<T>> => {
    try {
      return { ok: true, value: await loader() };
    } catch (error) {
      return {
        ok: false,
        message: `${label}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
  let inbox = emptyInboxSnapshot(ctx.cwd);
  try {
    inbox = await buildOperatorInboxSnapshot({
      client: ctx.client,
      projectDir: ctx.cwd,
      status,
    });
  } catch (error) {
    if (!(error instanceof Error && error.message.startsWith("No active KotaClient resolved."))) {
      throw error;
    }
    // Daemon control-route handlers do not run inside CLI startup and may not
    // have an active KotaClient. The shared Inbox surface still belongs in the
    // daemon UI graph, even when its live item projection is unavailable.
  }
  const [
    projects,
    sessions,
    workflowStatus,
    runs,
    definitions,
    approvals,
    ownerQuestions,
    ownerDecisions,
    modules,
    agents,
    setup,
    tasks,
    memory,
    knowledge,
    history,
  ] = await Promise.all([
    readSurface("projects", () => ctx.client.projects.list()),
    readSurface("sessions", () => ctx.client.sessions.list()),
    readSurface("workflow status", () => ctx.client.workflow.status()),
    readSurface("workflow runs", () => ctx.client.workflow.listRuns({ limit: 20 })),
    readSurface("workflow definitions", () => ctx.client.workflow.listDefinitions()),
    readSurface("approvals", () => ctx.client.approvals.list({ status: "pending" })),
    readSurface("owner questions", () => ctx.client.ownerQuestions.list({ status: "pending" })),
    readSurface("owner decisions", () => ctx.client.ownerDecisions.list({ status: "pending" })),
    readSurface("modules", () => ctx.client.modules.list()),
    readSurface("agents", () => ctx.client.agents.list()),
    readSurface("setup", () => ctx.client.setup.list()),
    readSurface("tasks", () => ctx.client.tasks.list(["doing", "ready", "blocked"])),
    readSurface("memory", () => ctx.client.memory.list({ limit: 10 })),
    readSurface("knowledge", () => ctx.client.knowledge.list()),
    readSurface("history", () => ctx.client.history.list({ limit: 10 })),
  ]);
  const continuity = buildContinuityProjection({
    status,
    tasks,
    workflowStatus,
    runs,
    definitions,
    approvals,
    ownerQuestions,
    ownerDecisions,
    setup,
    memory,
    knowledge,
  });
  return buildUiSurfaceBundle([
    buildStatusUiSurface(status, { explain: true }),
    buildScopeUiSurface({ status, projects, sessions }),
    buildInboxUiSurface(inbox),
    buildContinuityUiSurface(continuity),
    buildRuntimeUiSurface({
      status,
      workflowStatus,
      runs,
      definitions,
      approvals,
      ownerQuestions,
      sessions,
    }),
    buildModulesAgentsUiSurface({ status, modules, agents }),
    buildSetupUiSurface({ status, setup }),
    buildStoresUiSurface({ status, memory, knowledge, history }),
    ...ctx.getContributedUiSurfaces(),
  ]);
}

function missingUiAction(input: UiActionExecuteInput): UiActionExecutionResult {
  return {
    ok: false,
    reason: "not_found",
    message: `No UI action ${input.surfaceId}/${input.actionId} exists in the shared surface bundle.`,
  };
}

function requestDetachedDaemonStart(projectDir: string): UiActionExecutionResult {
  const current = localDaemonStatus({ projectDir });
  if (current.state === "running") {
    return { ok: true, message: `Daemon already running pid ${current.status.pid}.` };
  }
  const cliEntrypoint = process.argv[1];
  if (!cliEntrypoint) {
    return {
      ok: false,
      reason: "unavailable",
      message: "Unable to resolve the KOTA CLI entrypoint for daemon startup.",
    };
  }
  const env = withProtectedGitBareRepositoryEnv({ ...process.env });
  delete env[DAEMON_CHILD_ENV];
  try {
    const child = spawn(
      process.execPath,
      [...process.execArgv, cliEntrypoint, "daemon", "start", "--project-dir", projectDir],
      {
        cwd: projectDir,
        detached: true,
        env,
        stdio: "ignore",
      },
    );
    child.unref();
    return { ok: true, message: "Daemon start requested." };
  } catch (error) {
    return {
      ok: false,
      reason: "unavailable",
      message: `Unable to start daemon: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function localUiNamespaceExecutor(ctx: ModuleContext): UiClientNamespaceExecutor {
  return async (operation) => {
    if (operation.namespace === "daemonOps" && operation.method === "start") {
      return requestDetachedDaemonStart(ctx.cwd);
    }
    return null;
  };
}

function uiObjectParameter(parameters: UiJsonValue | undefined): { readonly [key: string]: UiJsonValue } | null {
  if (parameters === undefined || parameters === null || Array.isArray(parameters) || typeof parameters !== "object") {
    return null;
  }
  return parameters;
}

function stringUiParameter(parameters: UiJsonValue | undefined, key: string): string | undefined {
  const value = uiObjectParameter(parameters)?.[key];
  return typeof value === "string" ? value : undefined;
}

function booleanUiParameter(parameters: UiJsonValue | undefined, key: string): boolean {
  const value = uiObjectParameter(parameters)?.[key];
  return typeof value === "boolean" ? value : false;
}

type UiParameterParse<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

type SetupRequirementRoute = {
  moduleName: string;
  requirementId: string;
  action?: "form" | "secret" | "start" | "refresh";
};

function parseSetupRequirementRoute(path: string): SetupRequirementRoute | null {
  const match = /^\/setup\/requirements\/([^/]+)\/([^/]+)(?:\/(form|secret|start|refresh))?$/.exec(path);
  if (!match) return null;
  return {
    moduleName: decodeURIComponent(match[1]!),
    requirementId: decodeURIComponent(match[2]!),
    action: match[3] as SetupRequirementRoute["action"],
  };
}

function setupFormValuesFromUi(parameters: UiJsonValue | undefined): UiParameterParse<Record<string, string | number | boolean>> {
  const obj = uiObjectParameter(parameters);
  if (!obj) return { ok: false, message: "Setup form parameters must be a JSON object." };
  const values: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      return { ok: false, message: `Setup form field "${key}" must be string, number, or boolean.` };
    }
    values[key] = value;
  }
  return { ok: true, value: values };
}

function setupSecretValuesFromUi(parameters: UiJsonValue | undefined): UiParameterParse<Record<string, string>> {
  const obj = uiObjectParameter(parameters);
  if (!obj) return { ok: false, message: "Setup secret parameters must be a JSON object." };
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== "string" || value.length === 0) {
      return { ok: false, message: `Setup secret field "${key}" must be a non-empty string.` };
    }
    values[key] = value;
  }
  return { ok: true, value: values };
}

function setupMutationResult(
  result: Awaited<ReturnType<KotaClient["setup"]["submitForm"]>>,
  successMessage: string,
): UiActionExecutionResult {
  if (result.ok) return { ok: true, message: successMessage };
  return { ok: false, reason: result.reason, message: result.message };
}

async function executeLocalSetupRoute(
  ctx: ModuleContext,
  operation: Extract<UiActionOperation, { kind: "daemon-route" }>,
  parameters: UiJsonValue | undefined,
): Promise<UiActionExecutionResult | null> {
  const route = parseSetupRequirementRoute(operation.path);
  if (!route) return null;
  if (operation.method === "POST" && route.action === "form") {
    const values = setupFormValuesFromUi(parameters);
    if (!values.ok) return { ok: false, reason: "invalid-input", message: values.message };
    return setupMutationResult(
      await ctx.client.setup.submitForm(route.moduleName, route.requirementId, values.value),
      "Setup form submitted.",
    );
  }
  if (operation.method === "POST" && route.action === "secret") {
    const values = setupSecretValuesFromUi(parameters);
    if (!values.ok) return { ok: false, reason: "invalid-input", message: values.message };
    return setupMutationResult(
      await ctx.client.setup.storeSecret(route.moduleName, route.requirementId, values.value),
      "Setup secrets stored.",
    );
  }
  if (operation.method === "POST" && route.action === "start") {
    const result = await ctx.client.setup.start(route.moduleName, route.requirementId);
    if (result.ok) return { ok: true, message: "Setup action started." };
    return { ok: false, reason: result.reason, message: result.message };
  }
  if (operation.method === "POST" && route.action === "refresh") {
    return setupMutationResult(
      await ctx.client.setup.refresh(route.moduleName, route.requirementId),
      "Setup status refreshed.",
    );
  }
  if (operation.method === "DELETE" && route.action === undefined) {
    return setupMutationResult(
      await ctx.client.setup.revoke(route.moduleName, route.requirementId),
      "Setup revoked.",
    );
  }
  return { ok: false, reason: "invalid-input", message: `${operation.method} ${operation.path} is not a setup UI action route.` };
}

function setupRouteBody(
  operation: Extract<UiActionOperation, { kind: "daemon-route" }>,
  parameters: UiJsonValue | undefined,
): UiJsonValue | undefined {
  const route = parseSetupRequirementRoute(operation.path);
  if (!route) return parameters;
  if (operation.method === "POST" && route.action === "form") {
    return { values: uiObjectParameter(parameters) ?? {} };
  }
  if (operation.method === "POST" && route.action === "secret") {
    return { secretValues: uiObjectParameter(parameters) ?? {} };
  }
  return undefined;
}

function routeForUiNamespaceOperation(
  operation: Parameters<UiClientNamespaceExecutor>[0],
  parameters: UiJsonValue | undefined,
): { method: string; path: string; body?: UiJsonValue; message: string } | null {
  if (operation.namespace === "projects" && operation.method === "list") {
    return { method: "GET", path: "/projects", message: "Scope registry loaded." };
  }
  if (operation.namespace === "projects" && operation.method === "use") {
    const projectId = booleanUiParameter(parameters, "clear")
      ? null
      : stringUiParameter(parameters, "projectId") ?? null;
    return {
      method: "PATCH",
      path: "/projects/active",
      body: { projectId },
      message: projectId === null ? "Active scope cleared." : `Active scope set to ${projectId}.`,
    };
  }
  if (operation.namespace === "workflow" && operation.method === "status") {
    return { method: "GET", path: "/workflow/status", message: "Workflow status loaded." };
  }
  if (operation.namespace === "workflow" && operation.method === "pause") {
    return { method: "POST", path: "/workflow/pause", message: "Workflow dispatch paused." };
  }
  if (operation.namespace === "workflow" && operation.method === "resume") {
    return { method: "POST", path: "/workflow/resume", message: "Workflow dispatch resumed." };
  }
  if (operation.namespace === "workflow" && operation.method === "abort") {
    return { method: "POST", path: "/workflow/abort", message: "Active workflow runs aborted." };
  }
  if (operation.namespace === "workflow" && operation.method === "abortRun") {
    const runId = stringUiParameter(parameters, "runId");
    if (!runId) {
      return { method: "POST", path: "/workflow/runs//abort", message: "runId is required." };
    }
    return {
      method: "POST",
      path: `/workflow/runs/${encodeURIComponent(runId)}/abort`,
      message: `Run ${runId} aborted.`,
    };
  }
  if (operation.namespace === "workflow" && operation.method === "cancelRun") {
    const runId = stringUiParameter(parameters, "runId");
    if (!runId) {
      return { method: "DELETE", path: "/workflow/runs/", message: "runId is required." };
    }
    return {
      method: "DELETE",
      path: `/workflow/runs/${encodeURIComponent(runId)}`,
      message: `Queued run ${runId} cancelled.`,
    };
  }
  if (operation.namespace === "workflow" && operation.method === "listDefinitions") {
    return { method: "GET", path: "/workflow/definitions", message: "Workflow definitions loaded." };
  }
  if (operation.namespace === "sessions" && operation.method === "list") {
    return { method: "GET", path: "/sessions", message: "Live sessions loaded." };
  }
  if (operation.namespace === "modules" && operation.method === "list") {
    return { method: "GET", path: "/modules", message: "Modules loaded." };
  }
  if (operation.namespace === "agents" && operation.method === "list") {
    return { method: "GET", path: "/agents", message: "Agents loaded." };
  }
  if (operation.namespace === "setup" && operation.method === "list") {
    return { method: "GET", path: "/setup/requirements", message: "Setup requirements loaded." };
  }
  if (operation.namespace === "memory" && operation.method === "list") {
    return { method: "GET", path: "/api/memory?limit=10", message: "Memory loaded." };
  }
  if (operation.namespace === "knowledge" && operation.method === "list") {
    return { method: "GET", path: "/api/knowledge", message: "Knowledge loaded." };
  }
  if (operation.namespace === "history" && operation.method === "list") {
    return { method: "GET", path: "/history?limit=10", message: "History loaded." };
  }
  return null;
}

function uiActionResultFromTrigger(
  runId: string,
  action: "retry" | "replay" | "resume",
  result: UiJsonValue | null,
): UiActionExecutionResult {
  if (result === null) {
    return {
      ok: false,
      reason: "unavailable",
      message: `Unable to queue ${action} for run ${runId}.`,
    };
  }
  return {
    ok: true,
    message: action === "retry"
      ? `Queued retry from ${runId}.`
      : action === "replay"
        ? `Queued replay from ${runId}.`
        : `Queued resume from ${runId}.`,
  };
}

async function executeDaemonRunFollowUp(
  link: DaemonTransport,
  parameters: UiJsonValue | undefined,
  action: "retry" | "replay" | "resume",
): Promise<UiActionExecutionResult> {
  const runId = stringUiParameter(parameters, "runId");
  if (!runId) return { ok: false, reason: "invalid-input", message: "runId is required." };
  const fromStep = stringUiParameter(parameters, "fromStep");
  if (action === "resume" && !fromStep) return { ok: false, reason: "invalid-input", message: "fromStep is required." };
  const run = await link.request<WorkflowRunDetail>(
    "GET",
    `/workflow/runs/${encodeURIComponent(runId)}`,
    undefined,
    { timeoutMs: 10_000 },
  );
  if (run === null) return { ok: false, reason: "not_found", message: `Run ${runId} was not found.` };
  if (run.status === "running") return { ok: false, reason: "active", message: `Run ${runId} is still running.` };
  if (action === "retry" && (run.status === "success" || run.status === "completed-with-warnings")) {
    return { ok: false, reason: "invalid-input", message: `Run ${runId} completed successfully; use replay instead.` };
  }
  const replayPayload = uiObjectParameter(run.triggerPayload as UiJsonValue | undefined) ?? {};
  const { _runId: _discarded, ...cleanPayload } = replayPayload;
  const payload = action === "retry"
    ? { retryOf: runId }
    : action === "replay"
      ? { ...cleanPayload, replayOf: runId, replayTriggeredAt: new Date().toISOString() }
      : { resumedFromRunId: runId, resumeFromStep: fromStep, resumeTriggeredAt: new Date().toISOString() };
  const result = await link.request<UiJsonValue>(
    "POST",
    "/workflow/trigger",
    { name: run.workflow, payload },
    { timeoutMs: 10_000 },
  );
  return uiActionResultFromTrigger(runId, action, result);
}

function daemonUiNamespaceExecutor(link: DaemonTransport): UiClientNamespaceExecutor {
  return async (operation, parameters) => {
    if (operation.namespace === "daemonOps" && operation.method === "start") {
      return { ok: true, message: "Daemon already running." };
    }
    if (operation.namespace === "workflow" && operation.method === "retryRun") {
      return executeDaemonRunFollowUp(link, parameters, "retry");
    }
    if (operation.namespace === "workflow" && operation.method === "replayRun") {
      return executeDaemonRunFollowUp(link, parameters, "replay");
    }
    if (operation.namespace === "workflow" && operation.method === "resumeRun") {
      return executeDaemonRunFollowUp(link, parameters, "resume");
    }
    const route = routeForUiNamespaceOperation(operation, parameters);
    if (route) {
      if (route.path === "/workflow/runs//abort" || route.path === "/workflow/runs/") {
        return { ok: false, reason: "invalid-input", message: route.message };
      }
      const result = await link.request<UiJsonValue>(
        route.method,
        route.path,
        route.body,
        { timeoutMs: 10_000 },
      );
      if (result === null) {
        return {
          ok: false,
          reason: "unavailable",
          message: `${route.method} ${route.path} is unavailable.`,
        };
      }
      return { ok: true, message: route.message };
    }
    return null;
  };
}

async function executeActionFromBundle(args: {
  bundle: UiSurfaceBundle;
  input: UiActionExecuteInput;
  client?: KotaClient;
  clientNamespaceExecutor?: UiClientNamespaceExecutor;
  routeExecutor: UiRouteExecutor;
}): Promise<UiActionExecutionResult> {
  const action = findUiAction(args.bundle, args.input.surfaceId, args.input.actionId);
  if (!action) return missingUiAction(args.input);
  return executeUiAction({
    action,
    client: args.client,
    clientNamespaceExecutor: args.clientNamespaceExecutor,
    parameters: args.input.parameters,
    routeExecutor: args.routeExecutor,
  });
}

function buildLocalUiClient(ctx: ModuleContext): UiClient {
  const listSurfaces = async (): Promise<UiSurfaceBundle> => {
    const status = await gatherStatus(ctx.cwd);
    if (!status.daemonRunning) {
      return { protocolVersion: "ui.surface.v1", surfaces: [] };
    }
    return buildSharedUiSurfaceBundle(ctx);
  };
  return {
    listSurfaces,
    executeAction: async (input) => {
      const bundle = await listSurfaces();
      return executeActionFromBundle({
        bundle,
        input,
        client: ctx.client,
        clientNamespaceExecutor: localUiNamespaceExecutor(ctx),
        routeExecutor: async (operation, parameters) => {
          if (operation.method === "GET" && operation.path === "/ui/surfaces") {
            await listSurfaces();
            return { ok: true, message: "Shared UI surfaces refreshed." };
          }
          const setupResult = await executeLocalSetupRoute(ctx, operation, parameters);
          if (setupResult) return setupResult;
          return {
            ok: false,
            reason: "daemon_required",
            message: `${operation.method} ${operation.path} requires a running daemon.`,
          };
        },
      });
    },
    watchEvents: async function* () {
      // Local mode has no daemon event stream. The method is still present so
      // clients can keep one update loop across daemon and local handlers.
    },
  };
}

function buildUiDaemonHandler(link: DaemonTransport): UiClient {
  const listSurfaces = () => link.requestStrict<UiSurfaceBundle>("GET", "/ui/surfaces");
  return {
    listSurfaces,
    executeAction: async (input) => {
      const bundle = await listSurfaces();
      const action = findUiAction(bundle, input.surfaceId, input.actionId);
      if (!action) return missingUiAction(input);
      return executeUiAction({
        action,
        clientNamespaceExecutor: daemonUiNamespaceExecutor(link),
        parameters: input.parameters,
        routeExecutor: async (operation, parameters) => {
          const result = await link.request<UiJsonValue>(
            operation.method,
            operation.path,
            setupRouteBody(operation, parameters),
            { timeoutMs: 10_000 },
          );
          if (result === null) {
            return {
              ok: false,
              reason: action.result.errors[0]?.reason ?? "unavailable",
              message: action.result.errors[0]?.message ?? "The daemon action is currently unavailable.",
            };
          }
          return { ok: true, message: action.result.success.message };
        },
      });
    },
    watchEvents: async function* (input) {
      const allowed = input?.eventTypes !== undefined ? new Set(input.eventTypes) : null;
      for await (const event of link.events({ signal: input?.signal })) {
        if (allowed !== null && !allowed.has(event.type)) continue;
        yield event;
      }
    },
  };
}

const daemonModule: KotaModule = {
  name: "daemon-ops",
  version: "1.0.0",
  description: "Operator CLI and supervisor surface for the KOTA daemon runtime",
  dependencies: ["git", "repo-tasks", "rendering"],

  uiSurfaces: () => [buildOperatorControlUiSurface()],

  controlRoutes: (ctx) => [
    {
      method: "GET",
      path: "/ui/surfaces",
      capabilityScope: "read",
      handler: async (_req, res) => {
        jsonResponse(res, 200, await buildSharedUiSurfaceBundle(ctx));
      },
    },
  ],

  commands: (ctx) => {
    const startDaemon = async (rawOpts: DaemonStartOptions, command?: Command): Promise<void> => {
      const opts = resolveDaemonStartOptions(rawOpts, command);
      const logFormat: LogFormat | undefined =
        opts.logFormat ??
        (process.env.KOTA_DAEMON_LOG_FORMAT === "json" ? "json" : undefined);

      if (process.env[DAEMON_CHILD_ENV] !== String(process.ppid)) {
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
        getModuleSummaries: () => loader.getModuleSummaries(),
        logFormat,
        resolveAgentDef: (name) => loader.getAgentDef(name),
        resolveSkillsPrompt: (names, agentName) => loader.getSkillsPromptFor(names, agentName),
        probeModuleHealthChecks: () => loader.probeHealthChecks(),
        moduleConfigKeys: loader.getRegisteredConfigKeys(),
        unloadModules: () => loader.unloadAll(),
        restartExit: (code) => {
          process.exit(code);
        },
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
    };

    const cmd = addDaemonStartOptions(
      new Command("daemon")
        .description(DAEMON_COMMAND_DESCRIPTION),
    )
      .action(async (opts: DaemonStartOptions) => {
        await startDaemon(opts);
      });

    cmd.addCommand(
      addDaemonStartOptions(
        new Command("start")
          .summary("Start the KOTA daemon host and foreground dashboard")
          .description(DAEMON_START_DESCRIPTION),
      )
        .action(async (opts: DaemonStartOptions, command: Command) => {
          await startDaemon(opts, command);
        }),
    );

    cmd
      .command("status")
      .description("Show daemon health summary (exits 0 if reachable)")
      .option("--project-dir <path>", DAEMON_PROJECT_DIR_OPTION_DESCRIPTION)
      .option("--json", "Output as JSON")
      .action(async (opts: { json?: boolean; projectDir?: string }, command: Command) => {
        const projectDir = resolveDaemonCommandProjectDir(opts, command);
        const client = await daemonOpsClientForProject(projectDir, buildDaemonOpsDaemonHandler);
        const result = await client.status();
        if (result.state === "running") {
          if (opts.json) {
            writeJson({ ...result.status, managed: result.managed });
            return;
          }
          print(buildDaemonStatusNode(result.status, result.managed));
          return;
        }

        if (opts.json) {
          if (result.state === "stale") {
            writeJson({ running: false, managed: result.managed, staleControlFile: true });
          } else {
            writeJson({ running: false, managed: result.managed });
          }
        } else {
          if (result.state === "stale") {
            printDaemonError(`Stale control file (pid ${result.pid} is not alive). Run 'kota doctor --fix' to clean up.`);
          } else {
            printDaemonError("Daemon is not running.");
          }
          if (result.managed) print(line(plain("managed:  yes (OS service installed)")));
        }
        process.exitCode = 1;
      });

    cmd
      .command("pid")
      .description("Print the PID of the running daemon (exits non-zero if not running)")
      .option("--project-dir <path>", DAEMON_PROJECT_DIR_OPTION_DESCRIPTION)
      .action(async (opts: DaemonProjectDirOptions, command: Command) => {
        const projectDir = resolveDaemonCommandProjectDir(opts, command);
        const client = await daemonOpsClientForProject(projectDir, buildDaemonOpsDaemonHandler);
        const result = await client.pid();
        if (result.state === "running") {
          writeStdoutLine(String(result.pid));
          return;
        }
        if (result.state === "stale") {
          printDaemonError(`Stale control file (pid ${result.pid} is not alive). Run 'kota doctor --fix' to clean up.`);
        } else {
          printDaemonError("Daemon is not running.");
        }
        process.exitCode = 1;
      });

    cmd
      .command("stop")
      .description("Gracefully stop the running daemon (exits 0 on success)")
      .option("--project-dir <path>", DAEMON_PROJECT_DIR_OPTION_DESCRIPTION)
      .option("--timeout <seconds>", "Seconds to wait for clean exit", "90")
      .action(async (opts: { timeout: string; projectDir?: string }, command: Command) => {
        const timeoutSec = Math.max(1, Number.parseInt(opts.timeout, 10) || 10);
        const projectDir = resolveDaemonCommandProjectDir(opts, command);
        const result = await localDaemonStop({ timeoutSec, projectDir });
        if (result.ok) {
          print(line(span("Daemon stopped.", "success")));
          return;
        }
        if (result.reason === "not_running") {
          printDaemonError("Daemon is not running.");
        } else if (result.reason === "stale") {
          printDaemonError("Daemon process is not running (stale control file).");
        } else if (result.reason === "unavailable") {
          printDaemonError("Daemon control endpoint could not be verified; refusing to signal the recorded pid.");
        } else if (result.reason === "timeout") {
          printDaemonError(`Daemon did not stop within ${timeoutSec}s.`);
        }
        process.exitCode = 1;
      });

    cmd
      .command("reload")
      .description("Reload daemon config and re-register module workflow contributions without restart")
      .option("--project-dir <path>", DAEMON_PROJECT_DIR_OPTION_DESCRIPTION)
      .action(async (opts: DaemonProjectDirOptions, command: Command) => {
        const projectDir = resolveDaemonCommandProjectDir(opts, command);
        const client = await daemonOpsClientForProject(projectDir, buildDaemonOpsDaemonHandler);
        const result = await client.reload();
        if (!result.ok) {
          if (result.reason === "not_running") {
            printDaemonError("Daemon is not running.");
          } else {
            printDaemonError("Daemon reload failed or daemon is not reachable.");
          }
          process.exitCode = 1;
          return;
        }
        const lines: RenderNode[] = [
          line(
            span("Reloaded. ", "success"),
            plain(`${result.workflows} workflow definition(s) active.`),
          ),
        ];
        if (result.changedModules.length === 0) {
          lines.push(line(span("  No module config changes detected.", "muted")));
        } else {
          lines.push(line(plain("  Reloaded module(s): "), span(result.changedModules.join(", "), "accent")));
        }
        const guardrails = result.sessionGuardrails;
        lines.push(line(
          plain(`  Session guardrails: ${guardrails.refreshed} refreshed, `),
          plain(`${guardrails.unchanged} unchanged, `),
          span(`${guardrails.nonRefreshable.length} not refreshable.`, guardrails.nonRefreshable.length > 0 ? "warn" : "muted"),
        ));
        for (const session of guardrails.nonRefreshable) {
          lines.push(line(span(`    ${session.id}: ${session.reason}`, "muted")));
        }
        print(stack(...lines));
      });

    cmd
      .command("install")
      .description("Register the KOTA daemon as a user-level OS service (launchd on macOS, systemd on Linux)")
      .option("--project-dir <path>", DAEMON_PROJECT_DIR_OPTION_DESCRIPTION)
      .option("--dry-run", "Print the service unit without installing")
      .action((opts: { dryRun?: boolean; projectDir?: string }, command: Command) => {
        const projectDir = resolveDaemonCommandProjectDir(opts, command);

        if (process.platform === "darwin") {
          const plistPath = getLaunchdPlistPath();
          const content = buildLaunchdPlist(projectDir);
          if (opts.dryRun) {
            print(line(plain("# Would write: "), span(plistPath, "accent")));
            writeRawBlock(content);
            return;
          }
          const writeErr = writeServiceFile(plistPath, content);
          if (writeErr) {
            printDaemonError(String(writeErr));
            process.exitCode = 1;
            return;
          }
          const result = spawnSync("launchctl", ["load", plistPath], { encoding: "utf8" });
          if (result.status !== 0) {
            printDaemonError(`launchctl load failed:\n${result.stderr || result.stdout}`);
            process.exitCode = 1;
            return;
          }
          print(stack(
            line(span("Daemon service installed and started.", "success")),
            line(plain("  plist: "), span(plistPath, "accent")),
            line(plain("  label: "), span(SERVICE_LABEL_LAUNCHD, "muted")),
            line(plain("To stop: "), span(`launchctl unload ${plistPath}`, "muted")),
          ));
        } else if (process.platform === "linux") {
          const servicePath = getSystemdServicePath();
          const content = buildSystemdUnit(projectDir);
          if (opts.dryRun) {
            print(line(plain("# Would write: "), span(servicePath, "accent")));
            writeRawBlock(content);
            return;
          }
          const writeErr = writeServiceFile(servicePath, content);
          if (writeErr) {
            printDaemonError(String(writeErr));
            process.exitCode = 1;
            return;
          }
          const daemon = spawnSync("systemctl", ["--user", "daemon-reload"], { encoding: "utf8" });
          if (daemon.status !== 0) {
            printDaemonError(`systemctl daemon-reload failed:\n${daemon.stderr || daemon.stdout}`);
            process.exitCode = 1;
            return;
          }
          const enable = spawnSync("systemctl", ["--user", "enable", "--now", SERVICE_NAME_SYSTEMD], { encoding: "utf8" });
          if (enable.status !== 0) {
            printDaemonError(`systemctl enable failed:\n${enable.stderr || enable.stdout}`);
            process.exitCode = 1;
            return;
          }
          print(stack(
            line(span("Daemon service installed and started.", "success")),
            line(plain("  service: "), span(servicePath, "accent")),
            line(plain("To stop: "), span(`systemctl --user stop ${SERVICE_NAME_SYSTEMD}`, "muted")),
          ));
        } else {
          printDaemonError(`Unsupported platform: ${process.platform}. Only macOS and Linux are supported.`);
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
            printDaemonError(String(removeErr));
            process.exitCode = 1;
            return;
          }
          print(stack(
            line(span("Daemon service removed.", "success")),
            line(plain("  removed: "), span(plistPath, "accent")),
          ));
        } else if (process.platform === "linux") {
          const servicePath = getSystemdServicePath();
          spawnSync("systemctl", ["--user", "disable", "--now", SERVICE_NAME_SYSTEMD], { encoding: "utf8" });
          const removeErr = removeServiceFile(servicePath);
          if (removeErr) {
            printDaemonError(String(removeErr));
            process.exitCode = 1;
            return;
          }
          spawnSync("systemctl", ["--user", "daemon-reload"], { encoding: "utf8" });
          print(stack(
            line(span("Daemon service removed.", "success")),
            line(plain("  removed: "), span(servicePath, "accent")),
          ));
        } else {
          printDaemonError(`Unsupported platform: ${process.platform}. Only macOS and Linux are supported.`);
          process.exitCode = 1;
        }
      });

    cmd.addCommand(buildQrCommand());
    return [
      cmd,
      buildEventsCommand(ctx),
      buildSessionCommand(ctx),
      buildStatusCommand(ctx),
      buildInboxCommand(ctx),
      buildUiCommand(ctx),
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
  localClient: (ctx) => {
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
      ui: buildLocalUiClient(ctx),
    };
  },
  daemonClient: (link) => ({
    sessions: buildSessionsDaemonHandler(link),
    daemonOps: buildDaemonOpsDaemonHandler(link),
    projects: buildProjectsDaemonHandler(link),
    ui: buildUiDaemonHandler(link),
  }),
};

/**
 * Daemon-side `DaemonOpsClient` backed by the typed `DaemonTransport`. Calls
 * the `GET /status` and `POST /reload` control routes the daemon owns.
 *
 *  - `status()` calls `link.request<DaemonLiveStatus>("GET", "/status")`,
 *    adding the optional project scope query when supplied. On
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
 *  - `stop(options)` reads `/status`, signals the published daemon pid, and
 *    waits for process exit using the same helper as the local CLI path.
 *  - `reload()` calls `link.request` for the daemon's reload response. On `null` it returns
 *    `{ ok: false, reason: "reload_failed" }`. On success it returns `{ ok:
 *    true, workflows, changedModules, sessionGuardrails }`. The daemon-up branch never returns
 *    `not_running` because the client only exists when the selector resolved
 *    to a daemon address.
 */
function buildDaemonOpsDaemonHandler(link: DaemonTransport): DaemonOpsClient {
  return {
    status: async (filter) => {
      const path = `/status${scopeSelectorQuery(filter)}`;
      const status = await link.request<DaemonLiveStatus>("GET", path);
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
    stop: async (options) => {
      const status = await link.request<DaemonLiveStatus>("GET", "/status");
      if (!status || typeof status.pid !== "number") {
        return { ok: false, reason: "not_running" };
      }
      const identity = await link.request<ClientIdentity>("GET", "/identity");
      const timeoutSec = options?.timeoutSec ?? 90;
      const result = await stopDaemonPid(status.pid, timeoutSec);
      if (!result.ok && result.reason !== "not_running" && identity?.projectDir) {
        recordDaemonStopAttempt({
          projectDir: identity.projectDir,
          timeoutSec,
          result,
        });
      }
      return result;
    },
    reload: async () => {
      const result = await link.request<{
        ok: boolean;
        workflows: number;
        changedModules: string[];
        sessionGuardrails: SessionGuardrailsReloadSummary;
      }>("POST", "/reload");
      if (!result) return { ok: false, reason: "reload_failed" };
      return {
        ok: true,
        workflows: result.workflows,
        changedModules: result.changedModules,
        sessionGuardrails: result.sessionGuardrails,
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
