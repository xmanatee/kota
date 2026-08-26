import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Daemon } from "#core/daemon/daemon.js";
import {
  DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE,
  type DaemonRuntimeScope,
} from "#core/daemon/runtime-scope-provider.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { EventBus } from "#core/events/event-bus.js";
import { initEventBus } from "#core/events/event-bus.js";
import { loadRuntimeModules } from "#core/modules/runtime-loader.js";
import { autonomyIssueDecisionRequested } from "#modules/autonomy/autonomy-issue-events.js";
import { readAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
import { autonomyHealthSignal } from "#modules/autonomy/health-signal.js";
import {
  AUTONOMY_SOURCE_EVENT_NAMES,
  createRuntimeSourceFixture,
  flushCapturedWarningBatch,
  type RuntimeSourceFixture,
  type ScopedAutonomyHealthSignal,
} from "#root/daemon-runtime-event-fixture.integration.js";

const RUNTIME_CONFIG = {
  defaultAgentHarness: "claude-agent-sdk",
  model: "ollama/gpt-5.6-sol",
} as const;

export function initializeRuntimeRoutingScope(scopeRoot: string): void {
  mkdirSync(scopeRoot, { recursive: true });
  writeFileSync(join(scopeRoot, ".gitignore"), ".kota/\n", "utf-8");
  execFileSync("git", ["init", "--quiet"], { cwd: scopeRoot });
  execFileSync("git", ["add", ".gitignore"], { cwd: scopeRoot });
  execFileSync(
    "git",
    [
      "-c",
      "user.email=kota@example.test",
      "-c",
      "user.name=KOTA Test",
      "commit",
      "--quiet",
      "--no-gpg-sign",
      "-m",
      "seed runtime routing fixture",
    ],
    { cwd: scopeRoot },
  );
}

export type RuntimeDecision = {
  scopeId: string;
  issueKey: string;
};

export type RuntimeRoutingScenario = {
  eventBus: EventBus;
  scopeB: string;
  fixtureA: RuntimeSourceFixture;
  fixtureB: RuntimeSourceFixture;
  healthSignals: ScopedAutonomyHealthSignal[];
  decisions: RuntimeDecision[];
  sourceListenerCounts: ReadonlyMap<string, number>;
  runtimeA: DaemonRuntimeScope;
  runtimeB: DaemonRuntimeScope;
  stop: () => Promise<void>;
};

async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 8_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

export async function startRuntimeRoutingScenario(args: {
  rootDir: string;
  scopeRoot: string;
  stateDir: string;
}): Promise<RuntimeRoutingScenario> {
  const { rootDir, scopeRoot, stateDir } = args;
  const scopeB = join(rootDir, "scope-b");
  initializeRuntimeRoutingScope(scopeRoot);
  initializeRuntimeRoutingScope(scopeB);
  const eventBus = initEventBus();
  const loader = await loadRuntimeModules({
    config: RUNTIME_CONFIG,
    cwd: scopeRoot,
    eventBus,
  });
  const sourceListenerCounts = new Map(
    AUTONOMY_SOURCE_EVENT_NAMES.map((event) => [
      event,
      eventBus.listenerCount(event),
    ]),
  );
  const issueProjectionWorkflowNames = new Set([
    "runtime-health-auditor",
    "autonomy-health-reviewer",
    "autonomy-issue-projection-materialization",
  ]);
  const issueProjectionWorkflows = loader
    .getContributedWorkflows()
    .filter((workflow) => issueProjectionWorkflowNames.has(workflow.name));
  if (issueProjectionWorkflows.length !== issueProjectionWorkflowNames.size) {
    await loader.unloadAll();
    throw new Error("runtime modules did not contribute the autonomy issue publication path");
  }

  const healthSignals: ScopedAutonomyHealthSignal[] = [];
  const decisions: RuntimeDecision[] = [];
  eventBus.on(autonomyHealthSignal, (payload) => healthSignals.push(payload));
  eventBus.on(autonomyIssueDecisionRequested, (payload) => decisions.push(payload));

  const daemon = new Daemon({
    runtimeModuleHost: { eventBus, moduleLoader: loader },
    scopes: [{ scopeRoot }, { scopeRoot: scopeB }],
    stateDir,
    idleIntervalMs: 60_000,
    pollIntervalMs: 60_000,
    workflows: issueProjectionWorkflows,
    channels: [],
    controlRoutes: loader.getContributedControlRoutes(),
    routes: loader.getRoutes(),
    config: RUNTIME_CONFIG,
    unloadModules: () => loader.unloadAll(),
  });
  const startPromise = daemon.start();
  const stop = async (): Promise<void> => {
    await daemon.stop();
    await startPromise;
  };

  try {
    await waitFor(
      () => daemon.getHostedScopeCount() === 2,
      "two-scope daemon did not host both runtimes",
    );
    const provider = loader.getProviderRegistry().get(
      DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE,
    );
    const runtimeA = provider?.resolve(deriveDirectoryScopeId(scopeRoot));
    const runtimeB = provider?.resolve(deriveDirectoryScopeId(scopeB));
    if (!runtimeA?.ok || !runtimeB?.ok) {
      throw new Error("production daemon did not expose both runtime scopes");
    }
    await waitFor(
      () => [runtimeA.runtime, runtimeB.runtime].every((runtime) => {
        const runs = runtime.runState.listRuns(runtime.scope.scopeId);
        return runs.some(
          (run) =>
            run.workflow === "runtime-health-auditor" &&
            run.trigger.event === "autonomy.runtime-health.audit.scheduled",
        ) && runs.every((run) =>
          run.state !== "queued" &&
          run.state !== "running" &&
          run.state !== "integrating"
        );
      }),
      "initial production health audits did not settle",
    );
    return {
      eventBus,
      scopeB,
      fixtureA: createRuntimeSourceFixture({ bus: eventBus, scope: runtimeA.runtime, tag: "a" }),
      fixtureB: createRuntimeSourceFixture({ bus: eventBus, scope: runtimeB.runtime, tag: "b" }),
      healthSignals,
      decisions,
      sourceListenerCounts,
      runtimeA: runtimeA.runtime,
      runtimeB: runtimeB.runtime,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

export function projectionContains(
  scopeRoot: string,
  predicate: (rootCauseKey: string) => boolean,
): boolean {
  return readAutonomyIssueProjection(scopeRoot).issues.some(
    (issue) => predicate(issue.rootCauseKey),
  );
}

export function emitWarningFamily(args: {
  scenario: RuntimeRoutingScenario;
  emit: () => void;
  scopeId: string;
  predicate: (signal: ScopedAutonomyHealthSignal) => boolean;
}): void {
  const { scenario, emit, scopeId, predicate } = args;
  const cursor = scenario.healthSignals.length;
  emit();
  const signal = scenario.healthSignals.slice(cursor).find(
    (candidate) => candidate.scopeId === scopeId && predicate(candidate),
  );
  if (!signal) {
    throw new Error(`source fixture did not emit its warning signal for ${scopeId}`);
  }
  flushCapturedWarningBatch(scenario.eventBus, signal);
}

export async function waitForRuntimeEvidence(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  await waitFor(predicate, message);
}
