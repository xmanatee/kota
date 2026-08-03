import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { getGlobalConfigPath } from "#core/config/config.js";
import { initEventBus } from "#core/events/event-bus.js";
import { EventJournal, installEventJournal } from "#core/events/event-journal.js";
import type { DaemonConfig } from "./daemon-config.js";
import {
  recordEventEmitFailureDeadLetter,
  scopeLineageForId,
} from "./daemon-event-failures.js";
import { buildDaemonInit, type DaemonRuntimeContext } from "./daemon-init.js";
import { DaemonLogger } from "./daemon-logger.js";
import type { DaemonState } from "./daemon-state.js";
import { loadDaemonStateFromDisk } from "./daemon-state-persistence.js";
import { prepareDaemonStateRoot } from "./daemon-state-root.js";
import { installEventIdempotency } from "./idempotency-events.js";
import { ProjectRuntimeRegistry } from "./project-runtime.js";
import { createScopeAuthorityOperatorTokenVerifier } from "./scope-authority-operator-token.js";
import { ScopeAuthorityService } from "./scope-authority-service.js";
import { ScopeAuthorityStore } from "./scope-authority-store.js";
import { resolveConfiguredProjects, ScopeRegistry } from "./scope-registry.js";

export type DaemonRuntimeContextHooks = {
  onScopeTrustRevoked?: (scopeId: string) => void;
};

export function createDaemonRuntimeContext(
  config: DaemonConfig,
  hooks: DaemonRuntimeContextHooks = {},
): DaemonRuntimeContext {
  const logger = new DaemonLogger(config.logFormat);
  const log = (message: string) => logger.line(message);
  const configuredProjects = resolveConfiguredProjects({
    projects: config.projects,
    projectDir: config.projectDir,
    fallbackProjectDir: process.cwd(),
  });
  const stateRoot = prepareDaemonStateRoot(
    configuredProjects[0]!.projectDir,
    config.stateDir,
  );
  const stateDir = stateRoot.path;
  const projectRegistry = new ScopeRegistry({ stateDir, projects: configuredProjects });
  const authorityConfigPath = config.authorityConfigPath ?? getGlobalConfigPath();
  const scopeAuthority = new ScopeAuthorityService(
    new ScopeAuthorityStore(authorityConfigPath),
    projectRegistry,
    undefined,
    undefined,
    hooks.onScopeTrustRevoked,
  );
  const scopeAuthorityOperatorVerifier = createScopeAuthorityOperatorTokenVerifier(
    config.authorityConfigPath,
  );
  const projectDir = projectRegistry.getDefault().projectDir;
  const state: DaemonState = loadDaemonStateFromDisk(stateDir) ?? {
    startedAt: new Date().toISOString(),
    pid: process.pid,
  };
  state.pid = process.pid;
  state.startedAt = new Date().toISOString();
  const token = randomBytes(32).toString("hex");
  const bus = initEventBus();
  const eventJournal = new EventJournal(join(stateDir, "events"), {
    scopeLineage: (scopeId) => scopeLineageForId(scopeId, projectRegistry),
  });
  const projectRuntimes = ProjectRuntimeRegistry.create({
    registry: projectRegistry,
    authorityConfigPath,
    bus,
    eventJournal,
    config: config.config,
    workflows: config.workflows,
    model: config.model ?? config.config?.model,
    idleIntervalMs: config.idleIntervalMs,
    resolveAgentDef: config.resolveAgentDef,
    resolveSkillsPrompt: config.resolveSkillsPrompt,
    onLog: log,
    quietHours: config.config?.notifications?.quietHours,
    scopePolicyAuthority: scopeAuthority,
  });
  const uninstallEventIdempotency = installEventIdempotency(bus, {
    getDefaultScopeId: () => projectRegistry.getDefaultScopeId(),
    resolveStore: (scopeId) => projectRuntimes.get(scopeId).idempotencyStore,
    log,
  });
  const uninstallEventDeadLetters = bus.addEmitFailureHandler((failure) => {
    if (failure.stage === "fanout") return;
    recordEventEmitFailureDeadLetter({
      failure,
      runtimes: projectRuntimes,
      defaultProjectId: projectRegistry.getDefaultProjectId(),
      log,
    });
  });
  const uninstallEventJournalMiddleware = installEventJournal(bus, eventJournal);
  const uninstallEventJournal = () => {
    uninstallEventJournalMiddleware();
    uninstallEventDeadLetters();
    uninstallEventIdempotency();
  };

  return buildDaemonInit({
    config,
    projectDir,
    stateDir,
    stateRoot,
    bus,
    logger,
    log,
    state,
    token,
    eventJournal,
    uninstallEventJournal,
    projectRegistry,
    scopeAuthority,
    scopeAuthorityOperatorVerifier,
    projectRuntimes,
  });
}
