import type { ChannelAdapter, ChannelStatus } from "#core/channels/channel.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { EventJournal } from "#core/events/event-journal.js";
import type { HealthCheckResult } from "#core/modules/module-types.js";
import type { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRuntime } from "#core/workflow/runtime.js";
import type { DaemonConfig } from "./daemon-config.js";
import type {
  DaemonControlServer,
  InteractiveSession,
} from "./daemon-control.js";
import type { DaemonControlHandle } from "./daemon-control-types.js";
import type { DaemonLogger } from "./daemon-logger.js";
import type { DaemonState } from "./daemon-state.js";
import type { DaemonStateRoot } from "./daemon-state-root.js";
import type { DaemonEventLoopLatencyMonitor } from "./event-loop-latency.js";
import type { ProjectRuntimeRegistry } from "./project-runtime.js";
import type { ScopeAuthorityOperatorTokenVerifier } from "./scope-authority-operator-token.js";
import type { ScopeAuthorityService } from "./scope-authority-service.js";
import type { ScopeLifecycleService } from "./scope-lifecycle.js";
import type { ScopeRegistry } from "./scope-registry.js";
import type { ScopeRuntimeHost } from "./scope-runtime-host.js";

/** Mutable and immutable lifecycle state for one daemon instance. */
export type DaemonRuntimeContext = {
  readonly config: DaemonConfig;
  readonly logger: DaemonLogger;
  readonly log: (message: string) => void;
  readonly projectDir: string;
  readonly stateDir: string;
  readonly stateRoot: DaemonStateRoot;
  readonly bus: EventBus;
  readonly eventJournal: EventJournal;
  readonly uninstallEventJournal: () => void;
  readonly runStore: WorkflowRunStore;
  readonly workflows: WorkflowRuntime;
  readonly controlServer: DaemonControlServer;
  readonly handle: DaemonControlHandle;
  readonly token: string;
  readonly state: DaemonState;
  readonly sessions: Map<string, InteractiveSession>;
  readonly projectRegistry: ScopeRegistry;
  readonly scopeAuthority: ScopeAuthorityService;
  readonly projectRuntimes: ProjectRuntimeRegistry;
  readonly scopeLifecycle: ScopeLifecycleService;
  readonly scopeRuntimeHost: ScopeRuntimeHost;
  readonly eventLoopLatency: DaemonEventLoopLatencyMonitor;
  unsubscribe: (() => void) | null;
  sessionSweepTimer: ReturnType<typeof setInterval> | null;
  healthCheckTimer: ReturnType<typeof setInterval> | null;
  shutdownHandler: ((signal?: NodeJS.Signals) => void) | null;
  activeChannels: ChannelAdapter[];
  channelStatuses: ChannelStatus[];
  moduleHealthChecks: Record<string, HealthCheckResult>;
  running: boolean;
  stopping: boolean;
  restartRequested: boolean;
  restartReason: string | null;
};

export type BuildDaemonInitParams = {
  config: DaemonConfig;
  projectDir: string;
  stateDir: string;
  stateRoot: DaemonStateRoot;
  bus: EventBus;
  logger: DaemonLogger;
  log: (message: string) => void;
  state: DaemonState;
  token: string;
  eventJournal: EventJournal;
  uninstallEventJournal: () => void;
  projectRegistry: ScopeRegistry;
  scopeAuthority: ScopeAuthorityService;
  scopeAuthorityOperatorVerifier: ScopeAuthorityOperatorTokenVerifier;
  projectRuntimes: ProjectRuntimeRegistry;
};
