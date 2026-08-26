import { join } from "node:path";
import {
  createScopeRuntime,
  type ScopeRuntime,
  type ScopeRuntimeFactoryOptions,
} from "#core/daemon/scope-runtime.js";
import { RunCoordinator } from "#core/workflow/run-coordinator.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";

export {
  createTestWorkflowRuntime,
  type TestWorkflowRuntime,
} from "#core/workflow/testing/runtime-fixture.js";

function initializeRunState(scopeRoot: string, scopeId: string) {
  const runState = new RunStateDatabase(join(scopeRoot, ".kota"));
  const startedAt = new Date().toISOString();
  runState.registerScope({
    id: scopeId,
    rootPath: scopeRoot,
    createdAt: startedAt,
  });
  const daemonEpoch = runState.beginDaemonSession(startedAt).epoch;
  return { runState, daemonEpoch };
}

export function createTestScopeRuntime(
  options: Omit<
    ScopeRuntimeFactoryOptions,
    "runState" | "runCoordinator" | "daemonEpoch"
  >,
): ScopeRuntime {
  const { runState, daemonEpoch } = initializeRunState(
    options.scope.scopeRoot,
    options.scope.scopeId,
  );
  let runtime!: ScopeRuntime;
  const runCoordinator = new RunCoordinator({
    store: runState,
    daemonEpoch,
    concurrency: 4,
    execute: (run, signal) => runtime.workflowRuntime.executeAdmittedRun(run, signal),
    deliverPublication: (publication) =>
      runtime.workflowRuntime.deliverPublication(publication),
  });
  runtime = createScopeRuntime({
    ...options,
    runState,
    runCoordinator,
    daemonEpoch,
  });
  return runtime;
}
