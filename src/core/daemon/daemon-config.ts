import type { AgentDef } from "#core/agents/agent-types.js";
import type { ChannelDef } from "#core/channels/channel.js";
import type { KotaConfig } from "#core/config/config.js";
import type {
  ControlRouteRegistration,
  HealthCheckResult,
  ModuleSummary,
  RouteRegistration,
} from "#core/modules/module-types.js";
import type { LogFormat } from "#core/util/log-format.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import type { ConfiguredProjectInput } from "./scope-registry.js";

export type DaemonConfig = {
  /**
   * Single-project bootstrap shorthand. When `projects` is set, that array
   * supplies the initial seed and `projectDir` is ignored. When neither is
   * set, the seed defaults to `process.cwd()`.
   */
  projectDir?: string;
  /**
   * Initial multi-project seed. The first entry becomes the default only when
   * no persisted registry exists. After bootstrap, `project-registry.json` is
   * authoritative and live lifecycle mutations survive later config changes.
   *
   * Each configured project gets a runtime bundle through
   * `ProjectRuntimeRegistry`; daemon-wide control surfaces keep a default
   * project for compatibility with older single-project clients.
   */
  projects?: readonly ConfiguredProjectInput[];
  /** Override the operator-owned authority file path for tests or embedders. */
  authorityConfigPath?: string;
  model?: string;
  verbose?: boolean;
  config?: KotaConfig;
  idleIntervalMs?: number;
  pollIntervalMs?: number;
  stateDir?: string;
  workflows?: readonly RegisteredWorkflowDefinitionInput[];
  channels?: readonly ChannelDef[];
  /**
   * Daemon-control routes contributed by loaded modules. Registered on the
   * daemon's control server alongside its built-in routes; collisions fail
   * at server construction.
   */
  controlRoutes?: readonly ControlRouteRegistration[];
  /**
   * Module HTTP routes (`KotaModule.routes`). Registered on the daemon's
   * control server as a fallthrough after built-in and control routes do
   * not match, so a running daemon serves the same `/api/*` surface those
   * modules publish to `kota serve`. Bearer-token auth still applies unless
   * a route declares `bypassAuth: true`.
   */
  routes?: readonly RouteRegistration[];
  /** Loaded module summaries used for setup/auth status and module inspection. */
  getModuleSummaries?: () => readonly ModuleSummary[];
  /** How long a session may be idle before it is swept. Default: 5 minutes. */
  sessionIdleTtlMs?: number;
  /** How often to run the session sweep. Default: 1 minute. */
  sessionSweepIntervalMs?: number;
  /**
   * How long (ms) to wait for active runs before aborting them on SIGTERM.
   * 0 = drain indefinitely. Default: 60000 (60 s), or `daemon.shutdownGracePeriodMs` from kota.config.
   */
  shutdownGracePeriodMs?: number;
  /**
   * Log format for daemon operational output.
   * "json" emits NDJSON; "text" (default) emits human-readable lines.
   * Also controlled by KOTA_DAEMON_LOG_FORMAT=json env var.
   */
  logFormat?: LogFormat;
  resolveAgentDef?: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
  probeModuleHealthChecks?: () => Promise<Record<string, HealthCheckResult>>;
  moduleConfigKeys?: ReadonlySet<string>;
  unloadModules?: () => Promise<void>;
  /**
   * Called after a restart-requested daemon has completed clean shutdown.
   * Defaults to `process.exit(code)`, which lets the supervisor restart the
   * child without leaving an idle process alive. Tests and embedders can
   * inject a recorder or alternate shutdown handoff.
   */
  restartExit?: (code: number) => void;
};
