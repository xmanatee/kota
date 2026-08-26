import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { getGlobalConfigPath } from "#core/config/config.js";
import { EventBus } from "#core/events/event-bus.js";
import { EventJournal, installEventJournal } from "#core/events/event-journal.js";
import { resolveWorkflowConcurrency } from "#core/workflow/concurrency.js";
import { RunCoordinator } from "#core/workflow/run-coordinator.js";
import { recoverInterruptedRuns } from "#core/workflow/run-restart-recovery.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import type { DaemonConfig } from "./daemon-config.js";
import {
  recordEventEmitFailureDeadLetter,
  scopeLineageForId,
} from "./daemon-event-failures.js";
import { buildDaemonInit, type DaemonRuntimeContext } from "./daemon-init.js";
import {
  acquireInstanceLock,
  releaseInstanceLock,
} from "./daemon-instance-lock.js";
import { DaemonLogger } from "./daemon-logger.js";
import type { DaemonState } from "./daemon-state.js";
import { loadDaemonStateFromDisk } from "./daemon-state-persistence.js";
import { prepareDaemonStateRoot } from "./daemon-state-root.js";
import { installEventIdempotency } from "./idempotency-events.js";
import { createScopeAuthorityOperatorTokenVerifier } from "./scope-authority-operator-token.js";
import { ScopeAuthorityService } from "./scope-authority-service.js";
import { ScopeAuthorityStore } from "./scope-authority-store.js";
import { resolveConfiguredScopes, ScopeRegistry } from "./scope-registry.js";
import { ScopeRuntimeRegistry } from "./scope-runtime.js";

export type DaemonRuntimeContextHooks = {
  onScopeTrustRevoked?: (scopeId: string) => void;
};

export async function createDaemonRuntimeContext(
  config: DaemonConfig,
  hooks: DaemonRuntimeContextHooks = {},
): Promise<DaemonRuntimeContext> {
  const bus = config.runtimeModuleHost?.eventBus ?? new EventBus();
  config.runtimeModuleHost?.moduleLoader.assertEventBusAuthority(bus);
  const logger = new DaemonLogger(config.logFormat);
  const log = (message: string) => logger.line(message);
  const configuredScopes = resolveConfiguredScopes({
    scopes: config.scopes,
    scopeRoot: config.scopeRoot,
    fallbackScopeRoot: process.cwd(),
  });
  const stateRoot = prepareDaemonStateRoot(
    configuredScopes[0]!.scopeRoot,
    config.stateDir,
  );
  const stateDir = stateRoot.path;
  const scopeRegistry = new ScopeRegistry({ stateDir, scopes: configuredScopes });
  const authorityConfigPath = config.authorityConfigPath ?? getGlobalConfigPath();
  const scopeAuthority = new ScopeAuthorityService(
    new ScopeAuthorityStore(authorityConfigPath),
    scopeRegistry,
    undefined,
    undefined,
    hooks.onScopeTrustRevoked,
  );
  const scopeAuthorityOperatorVerifier = createScopeAuthorityOperatorTokenVerifier(
    config.authorityConfigPath,
  );
  const scopeRoot = scopeRegistry.getDefault().scopeRoot;
  const state: DaemonState = loadDaemonStateFromDisk(stateDir) ?? {
    startedAt: new Date().toISOString(),
    pid: process.pid,
  };
  state.pid = process.pid;
  state.startedAt = new Date().toISOString();
  const token = randomBytes(32).toString("hex");
  const instanceIdentity = {
    pid: state.pid,
    startedAt: state.startedAt,
    token,
  };
  await acquireInstanceLock(scopeRoot, stateRoot, instanceIdentity, log);
  let runState: RunStateDatabase | undefined;
  try {
  const eventJournal = new EventJournal(join(stateDir, "events"), {
    scopeLineage: (scopeId) => scopeLineageForId(scopeId, scopeRegistry),
  });
  runState = new RunStateDatabase(stateDir);
  for (const scope of scopeRegistry.list()) {
    runState.registerScope({
      id: scope.scopeId,
      rootPath: scope.scopeRoot,
      displayName: scope.displayName,
      createdAt: state.startedAt,
    });
  }
  const session = runState.beginDaemonSession(state.startedAt);
  const daemonEpoch = session.epoch;
  const blockedRecovery = await recoverInterruptedRuns({
    store: runState,
    daemonEpoch,
    attempts: session.recovered,
    log,
  });
  let scopeRuntimes!: ScopeRuntimeRegistry;
  const runCoordinator = new RunCoordinator({
    store: runState,
    daemonEpoch,
    concurrency: resolveWorkflowConcurrency(config.config?.scheduler),
    execute: (run, signal) =>
      scopeRuntimes.get(run.scopeId).workflowRuntime.executeAdmittedRun(run, signal),
    deliverPublication: (publication) =>
      scopeRuntimes
        .get(publication.scopeId)
        .workflowRuntime.deliverPublication(publication),
    onPublicationError: (error, publication) => {
      log(
        `Deferred publication ${publication.id} after delivery failure: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
    onError: (error, run) => {
      log(
        `Run coordinator paused after state transition failure for ${run.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  });
  runCoordinator.pauseGlobalAdmission();
  for (const scope of scopeRegistry.list()) {
    runCoordinator.pauseScopeAdmission(scope.scopeId);
  }
  if (blockedRecovery.length > 0) {
    log(
      `Dispatch starts paused: ${blockedRecovery.length} interrupted run(s) require process-ownership review`,
    );
  }
  scopeRuntimes = ScopeRuntimeRegistry.create({
    registry: scopeRegistry,
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
    runState,
    runCoordinator,
    daemonEpoch,
  });
  const uninstallEventIdempotency = installEventIdempotency(bus, {
    getDefaultScopeId: () => scopeRegistry.getDefaultScopeId(),
    resolveStore: (scopeId) => scopeRuntimes.get(scopeId).idempotencyStore,
    log,
  });
  const uninstallEventDeadLetters = bus.addEmitFailureHandler((failure) => {
    if (failure.stage === "fanout") return;
    recordEventEmitFailureDeadLetter({
      failure,
      runtimes: scopeRuntimes,
      defaultScopeId: scopeRegistry.getDefaultScopeId(),
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
    scopeRoot: scopeRoot,
    stateDir,
    stateRoot,
    bus,
    logger,
    log,
    state,
    token,
    eventJournal,
    runState,
    runCoordinator,
    uninstallEventJournal,
    scopeRegistry: scopeRegistry,
    scopeAuthority,
    scopeAuthorityOperatorVerifier,
    scopeRuntimes,
    startupDispatchPaused: blockedRecovery.length > 0,
  });
  } catch (error) {
    runState?.close();
    releaseInstanceLock(stateRoot, instanceIdentity);
    throw error;
  }
}
