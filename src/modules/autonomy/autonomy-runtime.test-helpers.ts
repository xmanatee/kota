import { join } from "node:path";
import {
  createProjectRuntime,
  type ProjectRuntime,
  type ProjectRuntimeFactoryOptions,
} from "#core/daemon/project-runtime.js";
import { RunCoordinator } from "#core/workflow/run-coordinator.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";

export {
  createTestWorkflowRuntime,
  type TestWorkflowRuntime,
} from "#core/workflow/testing/runtime-fixture.js";

function initializeRunState(projectDir: string, projectId: string) {
  const runState = new RunStateDatabase(join(projectDir, ".kota"));
  const startedAt = new Date().toISOString();
  runState.registerProject({
    id: projectId,
    rootPath: projectDir,
    createdAt: startedAt,
  });
  const daemonEpoch = runState.beginDaemonSession(startedAt).epoch;
  return { runState, daemonEpoch };
}

export function createTestProjectRuntime(
  options: Omit<
    ProjectRuntimeFactoryOptions,
    "runState" | "runCoordinator" | "daemonEpoch"
  >,
): ProjectRuntime {
  const { runState, daemonEpoch } = initializeRunState(
    options.project.projectDir,
    options.project.projectId,
  );
  let runtime!: ProjectRuntime;
  const runCoordinator = new RunCoordinator({
    store: runState,
    daemonEpoch,
    concurrency: 4,
    execute: (run, signal) => runtime.workflowRuntime.executeAdmittedRun(run, signal),
    deliverPublication: (publication) =>
      runtime.workflowRuntime.deliverPublication(publication),
  });
  runtime = createProjectRuntime({
    ...options,
    runState,
    runCoordinator,
    daemonEpoch,
  });
  return runtime;
}
