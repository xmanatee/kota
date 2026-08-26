import { join } from "node:path";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { RunCoordinator } from "../run-coordinator.js";
import { RunStateDatabase } from "../run-state-database.js";
import { WorkflowRuntime, type WorkflowRuntimeConfig } from "../runtime.js";

export type TestWorkflowRuntime = Readonly<{
  runtime: WorkflowRuntime;
  runState: RunStateDatabase;
  stop(): Promise<void>;
}>;

export function createTestWorkflowRuntime(
  config: Omit<
    WorkflowRuntimeConfig,
    "scopeId" | "runState" | "runCoordinator" | "daemonEpoch"
  > & { scopeRoot: string; scopeId?: string },
  concurrency = 4,
): TestWorkflowRuntime {
  const runState = new RunStateDatabase(join(config.scopeRoot, ".kota", "state"));
  const scopeId =
    config.scopeId ??
    config.pbus?.getScopeId() ??
    deriveDirectoryScopeId(config.scopeRoot);
  const startedAt = new Date().toISOString();
  runState.registerScope({
    id: scopeId,
    rootPath: config.scopeRoot,
    createdAt: startedAt,
  });
  const daemonEpoch = runState.beginDaemonSession(startedAt).epoch;
  let runtime!: WorkflowRuntime;
  const runCoordinator = new RunCoordinator({
    store: runState,
    daemonEpoch,
    concurrency,
    execute: (run, signal) => runtime.executeAdmittedRun(run, signal),
    deliverPublication: (publication) => runtime.deliverPublication(publication),
  });
  runtime = new WorkflowRuntime({
    ...config,
    pbus: config.pbus ?? new ScopedEventBus(config.bus, scopeId),
    scopeId,
    runState,
    runCoordinator,
    daemonEpoch,
  });
  return {
    runtime,
    runState,
    async stop() {
      await runtime.stop();
      runState.close();
    },
  };
}
